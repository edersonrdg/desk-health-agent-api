import { z } from 'zod';
import { decrypt, encrypt } from '../../shared/crypto/field-encryption';
import {
  EnqueuedMessageKind,
  NormalizedInboundMessage,
} from './inbound-message.types';

export const INBOUND_JOB_SCHEMA_VERSION = 1;

/**
 * Contract of the `inbound-messages` job (spec 004 D7–D11, D26). Single
 * source of truth for producer and consumer: change it only with a
 * `schema_version` bump both sides handle.
 */
export const inboundMessageJobSchema = z.strictObject({
  schema_version: z.literal(INBOUND_JOB_SCHEMA_VERSION),
  tenant_id: z.uuid(),
  inbox_message_id: z.uuid(),
  /** `<tenant_id>:<remoteJid>`: groups the jobs of one conversation (D9). */
  conversation_key: z.string().min(1),
  trace_id: z.uuid(),
  kind: z.enum(['text', 'button_reply', 'list_reply', 'unsupported']),
  /** base64 of the AES-256-GCM encrypted normalized message (D8). */
  content: z.base64(),
});

export type InboundMessageJob = z.infer<typeof inboundMessageJobSchema>;

export interface InboundJobSource {
  tenantId: string;
  inboxMessageId: string;
  traceId: string;
  message: NormalizedInboundMessage & { kind: EnqueuedMessageKind };
}

export function buildInboundJob(source: InboundJobSource): InboundMessageJob {
  const { tenantId, inboxMessageId, traceId, message } = source;
  return {
    schema_version: INBOUND_JOB_SCHEMA_VERSION,
    tenant_id: tenantId,
    inbox_message_id: inboxMessageId,
    conversation_key: `${tenantId}:${message.remote_jid}`,
    trace_id: traceId,
    kind: message.kind,
    content: encrypt(Buffer.from(JSON.stringify(message), 'utf8')).toString(
      'base64',
    ),
  };
}

/** For the consumer: decrypts the job content back into the message. */
export function readInboundJobContent(
  job: InboundMessageJob,
): NormalizedInboundMessage {
  return JSON.parse(
    decrypt(Buffer.from(job.content, 'base64')).toString('utf8'),
  ) as NormalizedInboundMessage;
}
