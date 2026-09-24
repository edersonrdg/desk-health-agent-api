import { NormalizedInboundMessage } from '../inbound-message.types';
import { MessagesUpsertEvent } from './evolution-webhook.schema';

const STATUS_BROADCAST_JID = 'status@broadcast';
const GROUP_JID_SUFFIX = '@g.us';

/**
 * Maps a validated Evolution `messages.upsert` event to the provider-neutral
 * shape. Own messages, groups and status broadcasts become `ignored` (D22);
 * anything that isn't text, a button reply or a list reply becomes
 * `unsupported` with its type only (D17).
 */
export function normalizeEvolutionMessage(
  event: MessagesUpsertEvent,
): NormalizedInboundMessage {
  const { key, pushName, messageType, messageTimestamp, message } = event.data;
  const base: NormalizedInboundMessage = {
    external_id: key.id,
    remote_jid: key.remoteJid,
    ...(pushName ? { push_name: pushName } : {}),
    timestamp: new Date(messageTimestamp * 1000).toISOString(),
    kind: 'ignored',
  };

  if (
    key.fromMe ||
    key.remoteJid === STATUS_BROADCAST_JID ||
    key.remoteJid.endsWith(GROUP_JID_SUFFIX)
  ) {
    return base;
  }

  const text = message?.conversation ?? message?.extendedTextMessage?.text;
  if (text) {
    return { ...base, kind: 'text', text };
  }

  const button = message?.buttonsResponseMessage;
  if (button?.selectedButtonId) {
    return {
      ...base,
      kind: 'button_reply',
      selection: withTitle(button.selectedButtonId, button.selectedDisplayText),
    };
  }

  const templateButton = message?.templateButtonReplyMessage;
  if (templateButton?.selectedId) {
    return {
      ...base,
      kind: 'button_reply',
      selection: withTitle(
        templateButton.selectedId,
        templateButton.selectedDisplayText,
      ),
    };
  }

  const list = message?.listResponseMessage;
  const rowId = list?.singleSelectReply?.selectedRowId;
  if (rowId) {
    return {
      ...base,
      kind: 'list_reply',
      selection: withTitle(rowId, list?.title),
    };
  }

  return {
    ...base,
    kind: 'unsupported',
    media_type: messageType ?? 'unknown',
  };
}

function withTitle(id: string, title?: string): { id: string; title?: string } {
  return title ? { id, title } : { id };
}
