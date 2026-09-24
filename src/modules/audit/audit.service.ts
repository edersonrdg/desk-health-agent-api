import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  AuditActorType,
  AuditEventEntity,
  AuditState,
} from './audit-event.entity';

export interface AuditEventInput {
  tenantId: string;
  actorType: AuditActorType;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: AuditState | null;
  after?: AuditState | null;
  modelVersion?: string | null;
  promptVersion?: string | null;
  traceId?: string | null;
}

/**
 * Insert-only access to `audit_event` (rule 9). Callers pass their
 * transaction's manager so the audit row commits with the state change.
 */
@Injectable()
export class AuditService {
  async record(manager: EntityManager, input: AuditEventInput): Promise<void> {
    const event = manager.create(AuditEventEntity, {
      tenantId: input.tenantId,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      modelVersion: input.modelVersion ?? null,
      promptVersion: input.promptVersion ?? null,
      traceId: input.traceId ?? null,
    });
    await manager.save(event);
  }
}
