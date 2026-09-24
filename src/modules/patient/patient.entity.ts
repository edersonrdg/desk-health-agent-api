import {
  BeforeInsert,
  BeforeUpdate,
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { encryptedString } from '../../shared/crypto/encrypted.transformer';
import { hmacNationalId } from '../../shared/crypto/field-encryption';
import { TenantEntity } from '../tenant/tenant.entity';

export interface PatientInsurance {
  provider: string;
  plan: string | null;
  member_number: string | null;
}

/** One patient per WhatsApp number per tenant in the MVP (spec 003 D16). */
@Entity({ name: 'patient' })
@Unique('uq_patient_tenant_whatsapp', ['tenantId', 'whatsappId'])
@Index('uq_patient_tenant_national_id_hash', ['tenantId', 'nationalIdHash'], {
  unique: true,
  where: '"national_id_hash" IS NOT NULL',
})
@Check(
  'chk_patient_national_id_pair',
  '("national_id" IS NULL) = ("national_id_hash" IS NULL)',
)
export class PatientEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_patient' })
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @ManyToOne(() => TenantEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'tenant_id',
    foreignKeyConstraintName: 'fk_patient_tenant',
  })
  tenant?: TenantEntity;

  @Column({ name: 'whatsapp_id', type: 'text' })
  whatsappId!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  /** `YYYY-MM-DD`, kept as a string to avoid time zone shifts. */
  @Column({ name: 'dob', type: 'date', nullable: true })
  dob!: string | null;

  /** Encrypted at rest (AES-256-GCM). Never log it. */
  @Column({
    name: 'national_id',
    type: 'bytea',
    nullable: true,
    transformer: encryptedString,
  })
  nationalId!: string | null;

  /** HMAC blind index of `nationalId`, kept in sync on save. */
  @Column({ name: 'national_id_hash', type: 'bytea', nullable: true })
  nationalIdHash!: Buffer | null;

  @Column({ name: 'insurance', type: 'jsonb', nullable: true })
  insurance!: PatientInsurance | null;

  @Column({ name: 'consent_at', type: 'timestamptz', nullable: true })
  consentAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @BeforeInsert()
  @BeforeUpdate()
  protected syncNationalIdHash(): void {
    // Undefined means the column wasn't loaded or set: leave the hash alone.
    if (this.nationalId === undefined) return;
    this.nationalIdHash =
      this.nationalId === null ? null : hmacNationalId(this.nationalId);
  }
}
