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

/** Side effects written with the state change and relayed afterwards. */
@Entity({ name: 'outbox_message' })
@Unique('uq_outbox_message_tenant_external_id', ['tenantId', 'externalId'])
@Index('ix_outbox_message_unpublished', ['createdAt'], {
  where: '"published_at" IS NULL',
})
export class OutboxMessageEntity extends MessageRecord {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_outbox_message',
  })
  id!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'fk_outbox_message_tenant',
  })
  tenant?: TenantEntity;
}
