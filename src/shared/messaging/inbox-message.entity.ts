import {
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { TenantEntity } from '../../modules/tenant/tenant.entity';
import { MessageRecord } from './message-record';

/** Inbound events, deduplicated on the external id (exactly-once ingestion). */
@Entity({ name: 'inbox_message' })
@Unique('uq_inbox_message_tenant_external_id', ['tenantId', 'externalId'])
@Index('ix_inbox_message_unpublished', ['createdAt'], {
  where: '"published_at" IS NULL',
})
export class InboxMessageEntity extends MessageRecord {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_inbox_message',
  })
  id!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'fk_inbox_message_tenant',
  })
  tenant?: TenantEntity;
}
