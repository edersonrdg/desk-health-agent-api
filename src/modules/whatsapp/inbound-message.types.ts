export const INBOUND_MESSAGE_KINDS = [
  'text',
  'button_reply',
  'list_reply',
  'unsupported',
  'ignored',
] as const;
export type InboundMessageKind = (typeof INBOUND_MESSAGE_KINDS)[number];

/** Kinds that are handed to the queue; `ignored` rows are stored only (D22). */
export type EnqueuedMessageKind = Exclude<InboundMessageKind, 'ignored'>;

/**
 * Provider-neutral inbound message. Stored encrypted as the inbox payload
 * (D18) and, encrypted again, as the job content (D8). Only the fields the
 * flow needs: no media bytes, no raw provider event.
 */
export interface NormalizedInboundMessage {
  external_id: string;
  remote_jid: string;
  push_name?: string;
  /** ISO 8601, from the provider's message timestamp. */
  timestamp: string;
  kind: InboundMessageKind;
  text?: string;
  selection?: { id: string; title?: string };
  /** Provider message type, for `unsupported` only (D17). */
  media_type?: string;
}
