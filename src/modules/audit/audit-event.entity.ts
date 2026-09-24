import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { encryptedJson } from '../../shared/crypto/encrypted.transformer';
import { TenantEntity } from '../tenant/tenant.entity';

export const AUDIT_ACTOR_TYPES = [
  'agent',
  'staff',
  'patient',
  'system',
] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/** JSON snapshot of an entity (or the part of it the action changed). */
export type AuditState = Record<string, unknown>;

/**
 * Append-only record of a state change (rule 9). A database trigger rejects
 * UPDATE and DELETE (spec 004 D32), and the tenant FK is RESTRICT, so a
 * tenant with audit history can't be deleted (D35).
 */
@Entity({ name: 'audit_event' })
@Index('ix_audit_event_tenant_created_at', ['tenantId', 'createdAt'])
@Index('ix_audit_event_tenant_entity', ['tenantId', 'entityType', 'entityId'])
export class AuditEventEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_audit_event',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'fk_audit_event_tenant',
  })
  tenant?: TenantEntity;

  @Column({
    name: 'actor_type',
    type: 'enum',
    enum: AUDIT_ACTOR_TYPES,
    enumName: 'audit_actor_type',
  })
  actorType!: AuditActorType;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId!: string | null;

  @Column({ name: 'action', type: 'text' })
  action!: string;

  @Column({ name: 'entity_type', type: 'text' })
  entityType!: string;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId!: string | null;

  /** Encrypted at rest: entity state may carry health data (D31). */
  @Column({
    name: 'before',
    type: 'bytea',
    nullable: true,
    transformer: encryptedJson,
  })
  before!: AuditState | null;

  @Column({
    name: 'after',
    type: 'bytea',
    nullable: true,
    transformer: encryptedJson,
  })
  after!: AuditState | null;

  @Column({ name: 'model_version', type: 'text', nullable: true })
  modelVersion!: string | null;

  @Column({ name: 'prompt_version', type: 'text', nullable: true })
  promptVersion!: string | null;

  @Column({ name: 'trace_id', type: 'uuid', nullable: true })
  traceId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
