import { MessagesUpsertEvent } from '../evolution-webhook.schema';

/** Evolution API v2 `messages.upsert` event, trimmed to the fields we read. */
export function upsertEvent(
  overrides: {
    id?: string;
    remoteJid?: string;
    fromMe?: boolean;
    pushName?: string | null;
    messageType?: string;
    message?: Record<string, unknown> | null;
    instance?: string;
  } = {},
): MessagesUpsertEvent {
  return {
    event: 'messages.upsert',
    instance: overrides.instance ?? 'clinic-demo',
    date_time: '2026-09-24T12:00:00.000Z',
    apikey: 'instance-api-key',
    data: {
      key: {
        id: overrides.id ?? '3EB0C767D26A1D8A2B11',
        remoteJid: overrides.remoteJid ?? '5511999990000@s.whatsapp.net',
        fromMe: overrides.fromMe ?? false,
      },
      pushName: overrides.pushName === undefined ? 'Ana' : overrides.pushName,
      messageType: overrides.messageType ?? 'conversation',
      messageTimestamp: 1790265600,
      message:
        overrides.message === undefined
          ? { conversation: 'quero marcar um exame' }
          : overrides.message,
    },
  };
}
