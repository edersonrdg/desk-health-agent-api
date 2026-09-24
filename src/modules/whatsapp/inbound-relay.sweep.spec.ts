import { Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { initCryptoKeys } from '../../shared/crypto/crypto-keys';
import { InboxMessageEntity } from '../../shared/messaging/inbox-message.entity';
import { InboundMessageJob } from './inbound-message.job';
import { InboundPublisher } from './inbound-publisher';
import { InboundRelaySweep } from './inbound-relay.sweep';

function row(attempts = 0): InboxMessageEntity {
  return {
    id: randomUUID(),
    tenantId: randomUUID(),
    traceId: randomUUID(),
    externalId: 'ABC',
    eventType: 'text',
    payload: {
      external_id: 'ABC',
      remote_jid: '5511999990000@s.whatsapp.net',
      timestamp: '2026-09-24T16:00:00.000Z',
      kind: 'text',
      text: 'dor no peito',
    },
    publishedAt: null,
    attempts,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function fakes(rows: InboxMessageEntity[], failIds: string[] = []) {
  const wheres: string[] = [];
  interface Builder {
    where(sql: string): Builder;
    andWhere(sql: string): Builder;
    orderBy(): Builder;
    limit(): Builder;
    setLock: jest.Mock<Builder, [string]>;
    setOnLocked: jest.Mock<Builder, [string]>;
    getMany(): Promise<InboxMessageEntity[]>;
  }
  const builder: Builder = {
    where: (sql) => (wheres.push(sql), builder),
    andWhere: (sql) => (wheres.push(sql), builder),
    orderBy: () => builder,
    limit: () => builder,
    setLock: jest.fn<Builder, [string]>(() => builder),
    setOnLocked: jest.fn<Builder, [string]>(() => builder),
    getMany: () => Promise.resolve(rows),
  };
  const update = jest.fn().mockResolvedValue({});
  const manager = {
    createQueryBuilder: () => builder,
    update,
  } as unknown as EntityManager;
  const dataSource = {
    isInitialized: true,
    transaction: (fn: (m: EntityManager) => Promise<unknown>) => fn(manager),
  } as unknown as DataSource;
  const publish = jest.fn((job: InboundMessageJob) =>
    failIds.includes(job.inbox_message_id)
      ? Promise.reject(new Error('Connection is closed.'))
      : Promise.resolve(),
  );
  const sweep = new InboundRelaySweep(dataSource, {
    publish,
  } as unknown as InboundPublisher);
  return { sweep, builder, wheres, update, publish, dataSource };
}

describe('InboundRelaySweep', () => {
  let error: jest.SpyInstance;

  beforeAll(() => {
    initCryptoKeys({
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      NATIONAL_ID_HMAC_KEY: randomBytes(32).toString('base64'),
    });
  });
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('claims only stale, unpublished, retryable rows with SKIP LOCKED', async () => {
    const f = fakes([]);

    await f.sweep.sweep();

    expect(f.wheres.join(' ')).toMatch(/published_at IS NULL/);
    expect(f.wheres.join(' ')).toMatch(/attempts < :max/);
    expect(f.wheres.join(' ')).toMatch(/created_at < now\(\)/);
    expect(f.builder.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(f.builder.setOnLocked).toHaveBeenCalledWith('skip_locked');
  });

  it('re-adds each row under its own jobId and marks it published', async () => {
    const r = row();
    const f = fakes([r]);

    await f.sweep.sweep();

    const job = f.publish.mock.calls[0][0];
    expect(job).toMatchObject({ inbox_message_id: r.id, trace_id: r.traceId });
    expect(f.update).toHaveBeenCalledWith(
      InboxMessageEntity,
      { id: r.id },
      { publishedAt: expect.any(Function) as () => string },
    );
  });

  it('counts a failure with a payload-free last_error', async () => {
    const r = row(1);
    const f = fakes([r], [r.id]);

    await f.sweep.sweep();

    const [, , changes] = f.update.mock.calls[0] as [
      unknown,
      unknown,
      { attempts: number; lastError: string },
    ];
    expect(changes.attempts).toBe(2);
    expect(changes.lastError).toBe('Error: Connection is closed.');
    expect(changes.lastError).not.toContain('dor no peito');
    expect(error).not.toHaveBeenCalled();
  });

  it('dead-letters a row on its fifth failure', async () => {
    const r = row(4);
    const f = fakes([r], [r.id]);

    await f.sweep.sweep();

    expect(error).toHaveBeenCalledTimes(1);
    const [[message]] = error.mock.calls as [[string]];
    expect(message).toContain(r.id);
    expect(message).not.toContain('dor no peito');
  });

  it('skips the run while Postgres is not connected', async () => {
    const f = fakes([row()]);
    (f.dataSource as { isInitialized: boolean }).isInitialized = false;

    await f.sweep.sweep();

    expect(f.publish).not.toHaveBeenCalled();
  });
});
