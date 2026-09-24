import { Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { encryptedJson } from '../crypto/encrypted.transformer';

/**
 * Columns shared by the inbox and the outbox. Each subclass adds its own id,
 * tenant FK and constraint names.
 */
export abstract class MessageRecord {
  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  /** Dedup key: the WhatsApp `wamid` for the inbox, a client key for the outbox. */
  @Column({ name: 'external_id', type: 'text' })
  externalId!: string;

  @Column({ name: 'event_type', type: 'text' })
  eventType!: string;

  /** Encrypted at rest: it carries message content (health data). */
  @Column({ name: 'payload', type: 'bytea', transformer: encryptedJson })
  payload!: unknown;

  /** Null until the relay has handed the message on. */
  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'attempts', type: 'integer', default: 0 })
  attempts!: number;

  /** Error summary for retries. Must never contain payload or patient data. */
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
