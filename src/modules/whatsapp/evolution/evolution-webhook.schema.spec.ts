import { upsertEvent } from './__fixtures__/evolution-events';
import {
  evolutionWebhookSchema,
  isMessagesUpsert,
} from './evolution-webhook.schema';

describe('evolutionWebhookSchema', () => {
  it('accepts a messages.upsert event and keeps unknown fields', () => {
    const parsed = evolutionWebhookSchema.parse(upsertEvent());

    expect(isMessagesUpsert(parsed)).toBe(true);
    expect(parsed).toHaveProperty('date_time');
  });

  it('coerces a string messageTimestamp', () => {
    const event = upsertEvent();
    (event.data as Record<string, unknown>).messageTimestamp = '1790265600';

    const parsed = evolutionWebhookSchema.parse(event);

    expect(isMessagesUpsert(parsed) && parsed.data.messageTimestamp).toBe(
      1790265600,
    );
  });

  it('accepts an unknown message variant (normalized later as unsupported)', () => {
    expect(
      evolutionWebhookSchema.safeParse(
        upsertEvent({ message: { pollCreationMessage: { name: 'x' } } }),
      ).success,
    ).toBe(true);
  });

  it('accepts other events with only event and instance', () => {
    const parsed = evolutionWebhookSchema.parse({
      event: 'connection.update',
      instance: 'clinic-demo',
      data: { state: 'open' },
    });

    expect(isMessagesUpsert(parsed)).toBe(false);
  });

  it.each([
    ['missing key.id', { data: { key: { remoteJid: 'x', fromMe: false } } }],
    ['missing instance', { instance: undefined }],
  ])('rejects a malformed upsert (%s)', (_, patch) => {
    const event = { ...upsertEvent(), ...patch };

    expect(evolutionWebhookSchema.safeParse(event).success).toBe(false);
  });

  it('rejects a body without an event', () => {
    expect(
      evolutionWebhookSchema.safeParse({ instance: 'clinic-demo' }).success,
    ).toBe(false);
  });
});
