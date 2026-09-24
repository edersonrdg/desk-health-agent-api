import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import type { TimeRange } from '../../shared/database/tstzrange.transformer';
import { tstzRangeTransformer } from '../../shared/database/tstzrange.transformer';
import { PatientEntity } from '../patient/patient.entity';
import { ServiceEntity } from '../service/service.entity';
import { TenantEntity } from '../tenant/tenant.entity';

export const APPOINTMENT_STATUSES = [
  'booked',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_SOURCES = [
  'whatsapp_agent',
  'staff',
  'external_sync',
] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];

/**
 * A booked service. No professional or exclusion constraint yet: both arrive
 * with the scheduling spec, before any booking write path (spec 003 D1).
 */
@Entity({ name: 'appointment' })
@Index('ix_appointment_tenant_patient', ['tenantId', 'patientId'])
@Index('ix_appointment_tenant_service', ['tenantId', 'serviceId'])
@Check(
  'chk_appointment_range_bounds',
  'NOT isempty("range") AND lower_inc("range") AND NOT upper_inc("range") AND NOT lower_inf("range") AND NOT upper_inf("range")',
)
export class AppointmentEntity {
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'pk_appointment',
  })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'fk_appointment_tenant',
  })
  tenant?: TenantEntity;

  @Column({ name: 'patient_id', type: 'uuid' })
  patientId!: string;

  @ManyToOne(() => PatientEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'patient_id',
    foreignKeyConstraintName: 'fk_appointment_patient',
  })
  patient?: PatientEntity;

  @Column({ name: 'service_id', type: 'uuid' })
  serviceId!: string;

  @ManyToOne(() => ServiceEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'service_id',
    foreignKeyConstraintName: 'fk_appointment_service',
  })
  service?: ServiceEntity;

  /** Half-open `[start, end)`. */
  @Column({
    name: 'range',
    type: 'tstzrange',
    transformer: tstzRangeTransformer,
  })
  range!: TimeRange;

  @Column({
    name: 'status',
    type: 'enum',
    enum: APPOINTMENT_STATUSES,
    enumName: 'appointment_status',
    default: 'booked',
  })
  status!: AppointmentStatus;

  @Column({
    name: 'source',
    type: 'enum',
    enum: APPOINTMENT_SOURCES,
    enumName: 'appointment_source',
  })
  source!: AppointmentSource;

  /** Id of this appointment in the HIS or external calendar. */
  @Column({ name: 'external_ref', type: 'text', nullable: true })
  externalRef!: string | null;

  /**
   * Incremented by TypeORM on every save. Concurrent-change checks need an
   * explicit `WHERE version = :v` (or lock mode): `update()` doesn't check it.
   */
  @VersionColumn({ name: 'version', type: 'integer' })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
