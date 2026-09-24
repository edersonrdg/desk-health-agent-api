import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { TenantLocale, TenantPolicies } from './tenant-policies.schema';

/** A hospital, a clinic or one practitioner. Root of tenant isolation. */
@Entity({ name: 'tenant' })
@Check('chk_tenant_locale', `"locale" IN ('pt-BR', 'en', 'es')`)
export class TenantEntity {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_tenant' })
  id!: string;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  /** IANA name; validated by `timezoneSchema` on write. */
  @Column({ name: 'timezone', type: 'text' })
  timezone!: string;

  @Column({ name: 'locale', type: 'text', default: 'pt-BR' })
  locale!: TenantLocale;

  /** Validated by `tenantPoliciesSchema` on write. */
  @Column({ name: 'policies', type: 'jsonb', default: () => "'{}'" })
  policies!: TenantPolicies;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
