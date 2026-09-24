import {
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { initCryptoKeys } from '../../shared/crypto/crypto-keys';
import { upsertEvent } from './evolution/__fixtures__/evolution-events';
import { InboundMessageJob } from './inbound-message.job';
import { InboundMessageService } from './inbound-message.service';
import { EnqueueTimeoutError, InboundPublisher } from './inbound-publisher';

const TENANT_ID = '6f1c2b1e-8e0a-4c52-9a55-2f1d0b8c0a11';
const INBOX_ID = '0b7c0f2e-1d6b-4a8e-8f5f-6a3e2c1d9b22';
const TRACE_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c33';

/** Minimal fake of the DataSource / EntityManager surface the service uses. */
function fakes(
  opts: {
    initialized?: boolean;
    tenant?: { id: string } | null;
    insertedId?: string | null;
    storeError?: Error;
    publishError?: Error;
  } = {},
) {
  const values: Record<string, unknown>[] = [];
  const insertBuilder = {
    insert: () => insertBuilder,
    into: () => insertBuilder,
    values: (v: Record<string, unknown>) => {
      values.push(v);
      return insertBuilder;
    },
    orIgnore: () => insertBuilder,
    returning: () => insertBuilder,
    execute: () =>
      Promise.resolve({
        raw:
          opts.insertedId === null ? [] : [{ id: opts.insertedId ?? INBOX_ID }],
      }),
  };
  const manager = {
    findOne: jest.fn(() =>
      opts.storeError
        ? Promise.reject(opts.storeError)
        : Promise.resolve(
            opts.tenant === undefined ? { id: TENANT_ID } : opts.tenant,
          ),
    ),
    createQueryBuilder: () => insertBuilder,
  } as unknown as EntityManager;

  const updateExecute = jest.fn().mockResolvedValue({});
  const updateBuilder = {
    update: () => updateBuilder,
    set: () => updateBuilder,
    where: () => updateBuilder,
    execute: updateExecute,
  };
  const dataSource = {
    isInitialized: opts.initialized ?? true,
    transaction: (fn: (m: EntityManager) => Promise<unknown>) => fn(manager),
    createQueryBuilder: () => updateBuilder,
  } as unknown as DataSource;

  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const published: InboundMessageJob[] = [];
  const publisher = {
    publish: jest.fn((job: InboundMessageJob) => {
      if (opts.publishError) return Promise.reject(opts.publishError);
      published.push(job);
      return Promise.resolve();
    }),
  };

  const service = new InboundMessageService(
    dataSource,
    audit,
    publisher as unknown as InboundPublisher,
  );
  return { service, values, audit, publisher, published, updateExecute };
}

describe('InboundMessageService', () => {
  let logs: jest.SpyInstance[];

  beforeAll(() => {
    initCryptoKeys({
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      NATIONAL_ID_HMAC_KEY: randomBytes(32).toString('base64'),
    });
  });
  beforeEach(() => {
    logs = (['log', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(Logger.prototype, level).mockImplementation(),
    );
  });
  afterEach(() => {
    // No log line may carry content, the JID, the push name or the instance.
    const logged = logs
      .flatMap((spy) => spy.mock.calls.flat() as unknown[])
      .map(String)
      .join(' ');
    for (const leak of [
      'quero marcar',
      '5511999990000',
      'Ana',
      'clinic-demo',
    ]) {
      expect(logged).not.toContain(leak);
    }
    logs.forEach((spy) => spy.mockRestore());
  });

  it('stores, audits, enqueues and marks a text message published', async () => {
    const f = fakes();

    await expect(f.service.receive(upsertEvent(), TRACE_ID)).resolves.toBe(
      'enqueued',
    );

    expect(f.values[0]).toMatchObject({
      tenantId: TENANT_ID,
      externalId: '3EB0C767D26A1D8A2B11',
      eventType: 'text',
      traceId: TRACE_ID,
      payload: { kind: 'text', text: 'quero marcar um exame' },
    });
    expect(f.values[0]).not.toHaveProperty('publishedAt');
    expect(f.audit.record).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT_ID,
      actorType: 'system',
      action: 'inbox_message.received',
      entityType: 'inbox_message',
      entityId: INBOX_ID,
      after: { event_type: 'text', trace_id: TRACE_ID },
      traceId: TRACE_ID,
    });
    expect(f.published[0]).toMatchObject({
      inbox_message_id: INBOX_ID,
      trace_id: TRACE_ID,
      kind: 'text',
    });
    expect(f.updateExecute).toHaveBeenCalled();
  });

  it('answers 503 while Postgres is not connected', async () => {
    const f = fakes({ initialized: false });

    await expect(f.service.receive(upsertEvent(), TRACE_ID)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('drops events other than messages.upsert', async () => {
    const f = fakes();

    await expect(
      f.service.receive(
        { event: 'connection.update', instance: 'clinic-demo' },
        TRACE_ID,
      ),
    ).resolves.toBe('unhandled_event');
    expect(f.values).toEqual([]);
  });

  it('answers 404 for an unknown instance, storing nothing', async () => {
    const f = fakes({ tenant: null });

    await expect(f.service.receive(upsertEvent(), TRACE_ID)).rejects.toThrow(
      NotFoundException,
    );
    expect(f.values).toEqual([]);
  });

  it('treats a duplicate as success, without audit or enqueue', async () => {
    const f = fakes({ insertedId: null });

    await expect(f.service.receive(upsertEvent(), TRACE_ID)).resolves.toBe(
      'duplicate',
    );
    expect(f.audit.record).not.toHaveBeenCalled();
    expect(f.publisher.publish).not.toHaveBeenCalled();
  });

  it('stores ignored messages as published and never enqueues them', async () => {
    const f = fakes();

    await expect(
      f.service.receive(upsertEvent({ fromMe: true }), TRACE_ID),
    ).resolves.toBe('ignored');
    expect(f.values[0]).toMatchObject({ eventType: 'ignored' });
    expect(f.values[0]).toHaveProperty('publishedAt');
    expect(f.audit.record).toHaveBeenCalled();
    expect(f.publisher.publish).not.toHaveBeenCalled();
  });

  it('enqueues unsupported media with its type only', async () => {
    const f = fakes();

    await f.service.receive(
      upsertEvent({
        messageType: 'audioMessage',
        message: { audioMessage: { url: 'https://x' } },
      }),
      TRACE_ID,
    );
    expect(f.published[0].kind).toBe('unsupported');
  });

  it('still answers 200 when the enqueue times out, leaving the row to the sweep', async () => {
    const f = fakes({ publishError: new EnqueueTimeoutError() });

    await expect(f.service.receive(upsertEvent(), TRACE_ID)).resolves.toBe(
      'deferred_to_sweep',
    );
    expect(f.updateExecute).not.toHaveBeenCalled();
  });

  it('answers 503 on a database error, logging only its class', async () => {
    const f = fakes({
      storeError: new QueryFailedError('SELECT', [], new Error('quero marcar')),
    });

    await expect(f.service.receive(upsertEvent(), TRACE_ID)).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
