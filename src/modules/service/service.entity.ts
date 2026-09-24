import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { TenantEntity } from '../tenant/tenant.entity';

export const SERVICE_TYPES = ['consultation', 'exam', 'procedure'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

/** A bookable consultation, exam or procedure. */
@Entity({ name: 'service' })
@Unique('uq_service_tenant_name', ['tenantId', 'name'])
@Check('chk_service_duration_positive', '"duration_minutes" > 0')
@Check(
  'chk_service_price_non_negative',
  '"price_cents" IS NULL OR "price_cents" >= 0',
)
export class ServiceEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_service' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'fk_service_tenant',
  })
  tenant?: TenantEntity;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({
    name: 'type',
    type: 'enum',
    enum: SERVICE_TYPES,
    enumName: 'service_type',
  })
  type!: ServiceType;

  @Column({ name: 'duration_minutes', type: 'integer' })
  durationMinutes!: number;

  @Column({ name: 'preparation', type: 'text', nullable: true })
  preparation!: string | null;

  /** Null when the tenant doesn't disclose the price. */
  @Column({ name: 'price_cents', type: 'integer', nullable: true })
  priceCents!: number | null;

  /** ISO 4217 code. */
  @Column({ name: 'currency', type: 'char', length: 3, default: 'BRL' })
  currency!: string;

  /**
   * Prerequisite service ids, in order (e.g. lab draw before consultation).
   * Not FK-checked by the database: writers validate them.
   */
  @Column({
    name: 'required_sequence',
    type: 'uuid',
    array: true,
    default: () => "'{}'",
  })
  requiredSequence!: string[];

  @Column({ name: 'active', type: 'boolean', default: true })
  active!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
