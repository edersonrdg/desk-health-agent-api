import { randomBytes, randomUUID } from 'node:crypto';
import { initCryptoKeys } from '../../shared/crypto/crypto-keys';
import {
  buildInboundJob,
  inboundMessageJobSchema,
  readInboundJobContent,
} from './inbound-message.job';

describe('inbound message job', () => {
  beforeAll(() => {
    initCryptoKeys({
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      NATIONAL_ID_HMAC_KEY: randomBytes(32).toString('base64'),
    });
  });

  const tenantId = randomUUID();
  const inboxMessageId = randomUUID();
  const traceId = randomUUID();
  const message = {
    external_id: 'ABC',
    remote_jid: '5511999990000@s.whatsapp.net',
    timestamp: '2026-09-24T16:00:00.000Z',
    kind: 'text' as const,
    text: 'dor no peito',
  };

  it('builds a valid v1 job with encrypted content', () => {
    const job = buildInboundJob({ tenantId, inboxMessageId, traceId, message });

    expect(inboundMessageJobSchema.parse(job)).toEqual({
      schema_version: 1,
      tenant_id: tenantId,
      inbox_message_id: inboxMessageId,
      conversation_key: `${tenantId}:5511999990000@s.whatsapp.net`,
      trace_id: traceId,
      kind: 'text',
      content: expect.any(String) as string,
    });
    expect(Buffer.from(job.content, 'base64').toString()).not.toContain(
      'dor no peito',
    );
    expect(readInboundJobContent(job)).toEqual(message);
  });

  it.each(['tenant_id', 'trace_id', 'schema_version', 'content'])(
    'rejects a job without %s',
    (field) => {
      const job: Record<string, unknown> = {
        ...buildInboundJob({ tenantId, inboxMessageId, traceId, message }),
      };
      delete job[field];

      expect(inboundMessageJobSchema.safeParse(job).success).toBe(false);
    },
  );

  it('rejects an ignored kind and unknown fields', () => {
    const job = buildInboundJob({ tenantId, inboxMessageId, traceId, message });

    expect(
      inboundMessageJobSchema.safeParse({ ...job, kind: 'ignored' }).success,
    ).toBe(false);
    expect(
      inboundMessageJobSchema.safeParse({ ...job, text: 'leak' }).success,
    ).toBe(false);
  });
});
