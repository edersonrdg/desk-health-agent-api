import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { getQueueToken } from '@nestjs/bullmq';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { validateEnv } from '../src/config/env.schema';
import { AuditEventEntity } from '../src/modules/audit/audit-event.entity';
import { TenantEntity } from '../src/modules/tenant/tenant.entity';
import { upsertEvent } from '../src/modules/whatsapp/evolution/__fixtures__/evolution-events';
import {
  inboundMessageJobSchema,
  readInboundJobContent,
} from '../src/modules/whatsapp/inbound-message.job';
import { InboundRelaySweep } from '../src/modules/whatsapp/inbound-relay.sweep';
import { INBOUND_QUEUE } from '../src/modules/whatsapp/whatsapp.constants';
import { initCryptoKeys } from '../src/shared/crypto/crypto-keys';
import { CIPHERTEXT_VERSION } from '../src/shared/crypto/field-encryption';
import { buildDataSourceOptions } from '../src/shared/database/database.options';
import { InitialDataModel1790274278271 } from '../src/shared/database/migrations/1790274278271-InitialDataModel';
import { InboundWebhookAndAudit1790282957865 } from '../src/shared/database/migrations/1790282957865-InboundWebhookAndAudit';
import { InboxMessageEntity } from '../src/shared/messaging/inbox-message.entity';

/**
 * Spec 004: POST /webhooks/evolution against the compose Postgres and Redis.
 * Uses a throwaway database: audit rows are append-only and block tenant
 * deletes (D32, D35), so the test can't clean up after itself otherwise.
 */
jest.setTimeout(30_000);

// Jest sandboxes process.env, so process.loadEnvFile() wouldn't reach it.
const envFile = existsSync('.env')
  ? parseEnv(readFileSync('.env', 'utf8'))
  : {};
const baseEnv = validateEnv({ ...envFile, ...process.env });
const TEST_DB = `${baseEnv.POSTGRES_DB}_e2e_webhook`;
const SECRET = 'e2e-webhook-secret';
const INSTANCE = 'e2e-clinic';

async function withAdmin(sql: string): Promise<void> {
  const admin = new DataSource({
    ...buildDataSourceOptions(baseEnv),
    entities: [],
  });
  await admin.initialize();
  try {
    await admin.query(sql);
  } finally {
    await admin.destroy();
  }
}

async function migrateTestDatabase(): Promise<void> {
  await withAdmin(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  await withAdmin(`CREATE DATABASE "${TEST_DB}"`);
  const ds = new DataSource({
    ...buildDataSourceOptions({ ...baseEnv, POSTGRES_DB: TEST_DB }),
    migrations: [
      InitialDataModel1790274278271,
      InboundWebhookAndAudit1790282957865,
    ],
  });
  await ds.initialize();
  await ds.runMigrations();
  await ds.destroy();
}

/** Postgres connects in the background after boot (spec 002 D8). */
async function waitForDatabase(ds: DataSource, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!ds.isInitialized && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('Evolution webhook (e2e)', () => {
  let app: INestApplication<App>;
  let ds: DataSource;
  let queue: Queue;
  let tenantId: string;
  let messageSeq = 0;
  const createdJobIds: string[] = [];

  /** Unique Evolution message id per test, so dedup never crosses tests. */
  const nextId = () => `E2E${Date.now()}${messageSeq++}`;

  const post = (body: object, secret: string | null = SECRET) => {
    const req = request(app.getHttpServer()).post('/webhooks/evolution');
    if (secret !== null) req.set('x-webhook-secret', secret);
    return req.send(body);
  };

  const inboxRows = (externalId: string) =>
    ds.getRepository(InboxMessageEntity).findBy({ tenantId, externalId });

  beforeAll(async () => {
    await migrateTestDatabase();
    // ConfigModule reads process.env when AppModule is imported, so set it first.
    process.env.POSTGRES_DB = TEST_DB;
    process.env.EVOLUTION_WEBHOOK_SECRET = SECRET;
    const { AppModule } =
      jest.requireActual<typeof import('../src/app.module')>(
        '../src/app.module',
      );

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    ds = moduleRef.get(DataSource);
    queue = moduleRef.get<Queue>(getQueueToken(INBOUND_QUEUE));
    await waitForDatabase(ds);
    initCryptoKeys(baseEnv);

    const tenant = await ds.getRepository(TenantEntity).save({
      name: 'E2E clinic',
      timezone: 'America/Sao_Paulo',
      evolutionInstance: INSTANCE,
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    // Remove only the jobs this test created from the shared dev Redis.
    for (const id of createdJobIds) await queue?.remove(id);
    await app?.close();
    await withAdmin(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  });

  describe('rejections', () => {
    it.each([
      ['missing', null],
      ['wrong', 'not-the-secret'],
    ])('401 for a %s secret, nothing stored', async (_, secret) => {
      const id = nextId();

      await post(upsertEvent({ id, instance: INSTANCE }), secret).expect(401);
      expect(await inboxRows(id)).toEqual([]);
    });

    it('422 for a malformed upsert, without echoing values', async () => {
      const id = nextId();
      const event = upsertEvent({ id, instance: INSTANCE });
      (event.data as Record<string, unknown>).key = { id, fromMe: false };

      const res = await post(event).expect(422);

      expect(JSON.stringify(res.body)).not.toContain('quero marcar');
      expect(await inboxRows(id)).toEqual([]);
    });

    it('404 for an unknown instance, nothing stored', async () => {
      const id = nextId();

      await post(upsertEvent({ id, instance: 'nobody' })).expect(404);
      expect(await inboxRows(id)).toEqual([]);
    });

    it('200 for other events, nothing stored', async () => {
      const before = await ds.getRepository(InboxMessageEntity).count();

      await post({
        event: 'connection.update',
        instance: INSTANCE,
        data: { state: 'open' },
      }).expect(200);
      expect(await ds.getRepository(InboxMessageEntity).count()).toBe(before);
    });
  });

  describe('a text message', () => {
    it('is stored encrypted, audited, enqueued and marked published', async () => {
      const id = nextId();

      await post(upsertEvent({ id, instance: INSTANCE })).expect(200);

      const [row] = await inboxRows(id);
      createdJobIds.push(row.id);
      expect(row).toMatchObject({
        eventType: 'text',
        payload: { kind: 'text', text: 'quero marcar um exame' },
        attempts: 0,
      });
      expect(row.publishedAt).toBeInstanceOf(Date);

      const [raw] = await ds.query<{ payload: Buffer }[]>(
        `SELECT "payload" FROM "inbox_message" WHERE "id" = $1`,
        [row.id],
      );
      expect(raw.payload[0]).toBe(CIPHERTEXT_VERSION);
      expect(raw.payload.includes('quero marcar')).toBe(false);

      const audits = await ds
        .getRepository(AuditEventEntity)
        .findBy({ entityId: row.id });
      expect(audits).toEqual([
        expect.objectContaining({
          tenantId,
          actorType: 'system',
          action: 'inbox_message.received',
          entityType: 'inbox_message',
          after: { event_type: 'text', trace_id: row.traceId },
          traceId: row.traceId,
        }),
      ]);

      const job = await queue.getJob(row.id);
      const data = inboundMessageJobSchema.parse(job?.data);
      expect(data).toMatchObject({
        tenant_id: tenantId,
        inbox_message_id: row.id,
        trace_id: row.traceId,
        conversation_key: `${tenantId}:5511999990000@s.whatsapp.net`,
        kind: 'text',
      });
      expect(data.content).not.toContain('quero');
      expect(readInboundJobContent(data)).toMatchObject({
        text: 'quero marcar um exame',
      });
    });

    it('is stored once when delivered twice', async () => {
      const id = nextId();
      const event = upsertEvent({ id, instance: INSTANCE });

      await post(event).expect(200);
      await post(event).expect(200);

      const rows = await inboxRows(id);
      createdJobIds.push(rows[0].id);
      expect(rows).toHaveLength(1);
      expect(
        await ds
          .getRepository(AuditEventEntity)
          .countBy({ entityId: rows[0].id }),
      ).toBe(1);
      expect(await queue.getJob(rows[0].id)).toBeDefined();
    });
  });

  describe('other message kinds', () => {
    it.each([
      [
        'button reply',
        {
          buttonsResponseMessage: {
            selectedButtonId: 'consent.accept',
            selectedDisplayText: 'Aceito',
          },
        },
        'button_reply',
        { selection: { id: 'consent.accept', title: 'Aceito' } },
      ],
      [
        'list reply',
        {
          listResponseMessage: {
            title: 'Terça 10:00',
            singleSelectReply: { selectedRowId: 'slot.42' },
          },
        },
        'list_reply',
        { selection: { id: 'slot.42', title: 'Terça 10:00' } },
      ],
      [
        'audio',
        { audioMessage: { url: 'https://example.invalid/a.ogg' } },
        'unsupported',
        { media_type: 'audioMessage' },
      ],
    ])('%s is stored and enqueued', async (_, message, kind, expected) => {
      const id = nextId();
      const event = upsertEvent({
        id,
        instance: INSTANCE,
        message,
        messageType: kind === 'unsupported' ? 'audioMessage' : undefined,
      });

      await post(event).expect(200);

      const [row] = await inboxRows(id);
      createdJobIds.push(row.id);
      expect(row.eventType).toBe(kind);
      expect(row.payload).toMatchObject(expected);
      expect((await queue.getJob(row.id))?.data).toMatchObject({ kind });
    });

    it.each([
      ['own message', { fromMe: true }],
      ['group message', { remoteJid: '120363025000@g.us' }],
      ['status broadcast', { remoteJid: 'status@broadcast' }],
    ])('%s is stored as ignored and never enqueued', async (_, overrides) => {
      const id = nextId();

      await post(upsertEvent({ id, instance: INSTANCE, ...overrides })).expect(
        200,
      );

      const [row] = await inboxRows(id);
      expect(row.eventType).toBe('ignored');
      expect(row.publishedAt).toBeInstanceOf(Date);
      expect(await queue.getJob(row.id)).toBeUndefined();
    });
  });

  it('the relay sweep publishes a stale unpublished row', async () => {
    const repo = ds.getRepository(InboxMessageEntity);
    const row = await repo.save(
      repo.create({
        tenantId,
        externalId: nextId(),
        eventType: 'text',
        traceId: '11111111-2222-4333-8444-555555555555',
        payload: {
          external_id: 'x',
          remote_jid: '5511988887777@s.whatsapp.net',
          timestamp: '2026-09-24T16:00:00.000Z',
          kind: 'text',
          text: 'oi',
        },
      }),
    );
    createdJobIds.push(row.id);
    await ds.query(
      `UPDATE "inbox_message" SET "created_at" = now() - interval '1 minute' WHERE "id" = $1`,
      [row.id],
    );

    await app.get(InboundRelaySweep).sweep();

    expect(
      (await repo.findOneByOrFail({ id: row.id })).publishedAt,
    ).toBeInstanceOf(Date);
    expect((await queue.getJob(row.id))?.data).toMatchObject({
      inbox_message_id: row.id,
      trace_id: row.traceId,
    });
  });
});
