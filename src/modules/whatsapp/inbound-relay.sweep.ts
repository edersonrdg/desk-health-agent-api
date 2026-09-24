import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DataSource, EntityManager } from 'typeorm';
import { InboxMessageEntity } from '../../shared/messaging/inbox-message.entity';
import { errorClass, errorMessage } from '../../shared/utils/error-message';
import { buildInboundJob } from './inbound-message.job';
import {
  EnqueuedMessageKind,
  NormalizedInboundMessage,
} from './inbound-message.types';
import { InboundPublisher } from './inbound-publisher';
import {
  SWEEP_BATCH_SIZE,
  SWEEP_INTERVAL_MS,
  SWEEP_MAX_ATTEMPTS,
  SWEEP_STALE_AFTER_SECONDS,
} from './whatsapp.constants';

/** `last_error` holds the error class and message only, never payload data. */
const LAST_ERROR_MAX_LENGTH = 500;

/**
 * Re-enqueues inbox rows the webhook couldn't publish (spec 004 D6, D12–D14).
 * Rows are claimed with FOR UPDATE SKIP LOCKED, so replicas never publish
 * the same row at once. After SWEEP_MAX_ATTEMPTS failures a row is
 * dead-lettered: it stays unpublished and the sweep stops picking it.
 */
@Injectable()
export class InboundRelaySweep {
  private readonly logger = new Logger(InboundRelaySweep.name);
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly publisher: InboundPublisher,
  ) {}

  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    if (this.running || !this.dataSource.isInitialized) return;
    this.running = true;
    try {
      await this.dataSource.transaction((manager) => this.sweepBatch(manager));
    } catch (err) {
      this.logger.error(`Relay sweep failed: ${errorClass(err)}`);
    } finally {
      this.running = false;
    }
  }

  private async sweepBatch(manager: EntityManager): Promise<void> {
    const rows = await manager
      .createQueryBuilder(InboxMessageEntity, 'm')
      .where('m.published_at IS NULL')
      .andWhere('m.attempts < :max', { max: SWEEP_MAX_ATTEMPTS })
      .andWhere(`m.created_at < now() - make_interval(secs => :stale)`, {
        stale: SWEEP_STALE_AFTER_SECONDS,
      })
      .orderBy('m.created_at', 'ASC')
      .limit(SWEEP_BATCH_SIZE)
      .setLock('pessimistic_write')
      .setOnLocked('skip_locked')
      .getMany();
    if (rows.length === 0) return;

    // Adds run in parallel: each is bounded by the publisher's timeout.
    const results = await Promise.allSettled(
      rows.map((row) => this.publisher.publish(this.jobFor(row))),
    );

    let published = 0;
    for (const [i, result] of results.entries()) {
      const row = rows[i];
      if (result.status === 'fulfilled') {
        await manager.update(
          InboxMessageEntity,
          { id: row.id },
          { publishedAt: () => 'now()' },
        );
        published++;
        continue;
      }

      const attempts = row.attempts + 1;
      await manager.update(
        InboxMessageEntity,
        { id: row.id },
        { attempts, lastError: lastErrorOf(result.reason) },
      );
      if (attempts >= SWEEP_MAX_ATTEMPTS) {
        this.logger.error(
          `Inbound message dead-lettered after ${attempts} attempts (tenant_id=${row.tenantId} inbox_message_id=${row.id} trace_id=${row.traceId})`,
        );
      }
    }
    this.logger.log(
      `Relay sweep: ${published} published, ${rows.length - published} failed`,
    );
  }

  private jobFor(row: InboxMessageEntity) {
    const message = row.payload as NormalizedInboundMessage & {
      kind: EnqueuedMessageKind;
    };
    return buildInboundJob({
      tenantId: row.tenantId,
      inboxMessageId: row.id,
      traceId: row.traceId,
      message,
    });
  }
}

function lastErrorOf(err: unknown): string {
  return `${errorClass(err)}: ${errorMessage(err)}`.slice(
    0,
    LAST_ERROR_MAX_LENGTH,
  );
}
