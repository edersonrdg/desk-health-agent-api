import { upsertEvent } from './__fixtures__/evolution-events';
import { normalizeEvolutionMessage } from './evolution-message.normalizer';

describe('normalizeEvolutionMessage', () => {
  const base = {
    external_id: '3EB0C767D26A1D8A2B11',
    remote_jid: '5511999990000@s.whatsapp.net',
    push_name: 'Ana',
    timestamp: '2026-09-24T16:00:00.000Z',
  };

  it('maps a plain text message', () => {
    expect(normalizeEvolutionMessage(upsertEvent())).toEqual({
      ...base,
      kind: 'text',
      text: 'quero marcar um exame',
    });
  });

  it('maps an extended text message', () => {
    const event = upsertEvent({
      messageType: 'extendedTextMessage',
      message: { extendedTextMessage: { text: 'oi', contextInfo: {} } },
    });

    expect(normalizeEvolutionMessage(event)).toMatchObject({
      kind: 'text',
      text: 'oi',
    });
  });

  it('maps a button reply', () => {
    const event = upsertEvent({
      messageType: 'buttonsResponseMessage',
      message: {
        buttonsResponseMessage: {
          selectedButtonId: 'consent.accept',
          selectedDisplayText: 'Aceito',
        },
      },
    });

    expect(normalizeEvolutionMessage(event)).toEqual({
      ...base,
      kind: 'button_reply',
      selection: { id: 'consent.accept', title: 'Aceito' },
    });
  });

  it('maps a template button reply', () => {
    const event = upsertEvent({
      message: { templateButtonReplyMessage: { selectedId: 'btn.1' } },
    });

    expect(normalizeEvolutionMessage(event)).toMatchObject({
      kind: 'button_reply',
      selection: { id: 'btn.1' },
    });
  });

  it('maps a list reply', () => {
    const event = upsertEvent({
      messageType: 'listResponseMessage',
      message: {
        listResponseMessage: {
          title: 'Terça 10:00',
          singleSelectReply: { selectedRowId: 'slot.42' },
        },
      },
    });

    expect(normalizeEvolutionMessage(event)).toEqual({
      ...base,
      kind: 'list_reply',
      selection: { id: 'slot.42', title: 'Terça 10:00' },
    });
  });

  it.each([
    ['audioMessage', { audioMessage: { url: 'https://x', ptt: true } }],
    ['imageMessage', { imageMessage: { url: 'https://x', caption: 'exame' } }],
    ['stickerMessage', { stickerMessage: { url: 'https://x' } }],
    ['videoMessage', { videoMessage: { url: 'https://x' } }],
    ['documentMessage', { documentMessage: { fileName: 'laudo.pdf' } }],
  ])('marks %s as unsupported, keeping only its type', (type, message) => {
    const normalized = normalizeEvolutionMessage(
      upsertEvent({ messageType: type, message }),
    );

    expect(normalized).toEqual({
      ...base,
      kind: 'unsupported',
      media_type: type,
    });
  });

  it.each([
    ['own message', { fromMe: true }],
    ['group message', { remoteJid: '120363025@g.us' }],
    ['status broadcast', { remoteJid: 'status@broadcast' }],
  ])('marks a %s as ignored, without content', (_, overrides) => {
    const normalized = normalizeEvolutionMessage(upsertEvent(overrides));

    expect(normalized.kind).toBe('ignored');
    expect(normalized).not.toHaveProperty('text');
  });

  it('omits push_name when Evolution sends none', () => {
    expect(
      normalizeEvolutionMessage(upsertEvent({ pushName: null })),
    ).not.toHaveProperty('push_name');
  });

  it('never copies provider fields such as the instance apikey', () => {
    const normalized = normalizeEvolutionMessage(upsertEvent());

    expect(JSON.stringify(normalized)).not.toContain('instance-api-key');
    expect(Object.keys(normalized).sort()).toEqual([
      'external_id',
      'kind',
      'push_name',
      'remote_jid',
      'text',
      'timestamp',
    ]);
  });
});
