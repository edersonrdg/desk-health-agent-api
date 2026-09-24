import {
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, InsertResult } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { InboxMessageEntity } from '../../shared/messaging/inbox-message.entity';
import { errorClass } from '../../shared/utils/error-message';
import { TenantEntity } from '../tenant/tenant.entity';
import { normalizeEvolutionMessage } from './evolution/evolution-message.normalizer';
import {
  EvolutionWebhookEvent,
  isMessagesUpsert,
} from './evolution/evolution-webhook.schema';
import { buildInboundJob } from './inbound-message.job';
import {
  EnqueuedMessageKind,
  NormalizedInboundMessage,
} from './inbound-message.types';
import { InboundPublisher } from './inbound-publisher';

/** Result of one webhook call, for tests and logs. Never carries content. */
export type ReceiveOutcome =
  | 'unhandled_event'
  | 'duplicate'
  | 'ignored'
  | 'enqueued'
  | 'deferred_to_sweep';

/**
 * Ingests one Evolution webhook event (spec 004): resolve the tenant from the
 * instance, store the normalized message once with its audit event, then
 * enqueue it after commit. Logs carry ids, kinds and the trace id only.
 */
@Injectable()
export class InboundMessageService {
  private readonly logger = new Logger(InboundMessageService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly publisher: InboundPublisher,
  ) {}

  async receive(
    event: EvolutionWebhookEvent,
    traceId: string,
  ): Promise<ReceiveOutcome> {
    if (!this.dataSource.isInitialized) {
      this.logger.warn(
        `Webhook deferred: Postgres not connected (trace_id=${traceId})`,
      );
      throw new ServiceUnavailableException();
    }

    if (!isMessagesUpsert(event)) {
      this.logger.log(
        `Webhook event dropped: ${event.event} (trace_id=${traceId})`,
      );
      return 'unhandled_event';
    }

    const message = normalizeEvolutionMessage(event);
    const stored = await this.store(event.instance, message, traceId);
    if (!stored) {
      this.logger.log(`Duplicate inbound message (trace_id=${traceId})`);
      return 'duplicate';
    }

    const { tenantId, inboxMessageId } = stored;
    const context = `tenant_id=${tenantId} inbox_message_id=${inboxMessageId} kind=${message.kind} trace_id=${traceId}`;
    if (message.kind === 'ignored') {
      this.logger.log(`Inbound message stored as ignored (${context})`);
      return 'ignored';
    }

    return this.enqueue(
      tenantId,
      inboxMessageId,
      traceId,
      { ...message, kind: message.kind },
      context,
    );
  }

  /** Returns null for a duplicate delivery. 404 for an unknown instance. */
  private async store(
    instance: string,
    message: NormalizedInboundMessage,
    traceId: string,
  ): Promise<{ tenantId: string; inboxMessageId: string } | null> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const tenant = await manager.findOne(TenantEntity, {
          select: { id: true },
          where: { evolutionInstance: instance },
        });
        if (!tenant) {
          // The instance name identifies a customer: log the reason only.
          this.logger.warn(
            `Webhook rejected: unknown Evolution instance (trace_id=${traceId})`,
          );
          throw new NotFoundException();
        }

        const result: InsertResult = await manager
          .createQueryBuilder()
          .insert()
          .into(InboxMessageEntity)
          .values({
            tenantId: tenant.id,
            externalId: message.external_id,
            eventType: message.kind,
            payload: message,
            traceId,
            // Ignored rows are never enqueued, so the sweep must skip them (D22).
            ...(message.kind === 'ignored' && { publishedAt: () => 'now()' }),
          })
          .orIgnore()
          .returning(['id'])
          .execute();

        const inserted = (result.raw as { id: string }[])[0];
        if (!inserted) return null;

        await this.audit.record(manager, {
          tenantId: tenant.id,
          actorType: 'system',
          action: 'inbox_message.received',
          entityType: 'inbox_message',
          entityId: inserted.id,
          after: { event_type: message.kind, trace_id: traceId },
          traceId,
        });
        return { tenantId: tenant.id, inboxMessageId: inserted.id };
      });
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Driver messages can quote values; log the class and SQLSTATE only.
      this.logger.error(
        `Webhook storage failed: ${errorClass(err)} (trace_id=${traceId})`,
      );
      throw new ServiceUnavailableException();
    }
  }

  /** After commit. Any failure leaves the row unpublished for the sweep (D6). */
  private async enqueue(
    tenantId: string,
    inboxMessageId: string,
    traceId: string,
    message: NormalizedInboundMessage & { kind: EnqueuedMessageKind },
    context: string,
  ): Promise<ReceiveOutcome> {
    try {
      await this.publisher.publish(
        buildInboundJob({ tenantId, inboxMessageId, traceId, message }),
      );
    } catch (err) {
      this.logger.warn(
        `Inbound message left for the relay sweep: ${errorClass(err)} (${context})`,
      );
      return 'deferred_to_sweep';
    }

    try {
      await this.dataSource
        .createQueryBuilder()
        .update(InboxMessageEntity)
        .set({ publishedAt: () => 'now()' })
        .where('id = :id AND published_at IS NULL', { id: inboxMessageId })
        .execute();
    } catch (err) {
      // The job is queued; the sweep re-adds it under the same jobId.
      this.logger.warn(
        `Inbound message enqueued but not marked published: ${errorClass(err)} (${context})`,
      );
      return 'enqueued';
    }

    this.logger.log(`Inbound message enqueued (${context})`);
    return 'enqueued';
  }
}
