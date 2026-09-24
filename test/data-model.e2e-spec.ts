import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { DataSource, Repository } from 'typeorm';
import { validateEnv } from '../src/config/env.schema';
import { AppointmentEntity } from '../src/modules/appointment/appointment.entity';
import { PatientEntity } from '../src/modules/patient/patient.entity';
import { ServiceEntity } from '../src/modules/service/service.entity';
import { TenantEntity } from '../src/modules/tenant/tenant.entity';
import { initCryptoKeys } from '../src/shared/crypto/crypto-keys';
import {
  CIPHERTEXT_VERSION,
  hmacNationalId,
} from '../src/shared/crypto/field-encryption';
import { buildDataSourceOptions } from '../src/shared/database/database.options';
import { InitialDataModel1790274278271 } from '../src/shared/database/migrations/1790274278271-InitialDataModel';
import { InboxMessageEntity } from '../src/shared/messaging/inbox-message.entity';
import { OutboxMessageEntity } from '../src/shared/messaging/outbox-message.entity';

/**
 * Runs the migrations in a throwaway database next to the compose one, so dev
 * data is never touched. Needs `docker compose up -d` and a `.env`.
 */
jest.setTimeout(30_000);

// Jest sandboxes process.env, so process.loadEnvFile() wouldn't reach it.
const envFile = existsSync('.env')
  ? parseEnv(readFileSync('.env', 'utf8'))
  : {};
const env = validateEnv({ ...envFile, ...process.env });
const TEST_DB = `${env.POSTGRES_DB}_e2e_data_model`;

async function withAdmin(sql: string): Promise<void> {
  const admin = new DataSource({
    ...buildDataSourceOptions(env),
    entities: [],
  });
  await admin.initialize();
  try {
    await admin.query(sql);
  } finally {
    await admin.destroy();
  }
}

/** Postgres reports the violated constraint by name. */
async function expectConstraint(action: Promise<unknown>, constraint: string) {
  await expect(action).rejects.toMatchObject({ driverError: { constraint } });
}

describe('Data model (e2e)', () => {
  let ds: DataSource;
  let tenants: Repository<TenantEntity>;
  let patients: Repository<PatientEntity>;
  let services: Repository<ServiceEntity>;
  let appointments: Repository<AppointmentEntity>;

  const start = new Date('2026-10-01T12:00:00.000Z');
  const end = new Date('2026-10-01T12:30:00.000Z');

  const newTenant = () =>
    tenants.save(
      tenants.create({ name: 'Clinic', timezone: 'America/Sao_Paulo' }),
    );
  const newPatient = (tenantId: string, whatsappId = '5511999990000') =>
    patients.save(patients.create({ tenantId, whatsappId, name: 'Ana' }));
  const newService = (tenantId: string, name = 'Hemograma') =>
    services.save(
      services.create({ tenantId, name, type: 'exam', durationMinutes: 15 }),
    );
  /** Tenant with one patient and one service, for appointment tests. */
  async function newBookingContext() {
    const tenant = await newTenant();
    const patient = await newPatient(tenant.id);
    const service = await newService(tenant.id);
    return { tenant, patient, service };
  }

  beforeAll(async () => {
    initCryptoKeys(env);
    await withAdmin(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
    await withAdmin(`CREATE DATABASE "${TEST_DB}"`);

    ds = new DataSource({
      ...buildDataSourceOptions({ ...env, POSTGRES_DB: TEST_DB }),
      migrations: [InitialDataModel1790274278271],
    });
    await ds.initialize();
    await ds.runMigrations();

    tenants = ds.getRepository(TenantEntity);
    patients = ds.getRepository(PatientEntity);
    services = ds.getRepository(ServiceEntity);
    appointments = ds.getRepository(AppointmentEntity);
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
    await withAdmin(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  });

  it('entities match the migrated schema (no drift)', async () => {
    const log = await ds.driver.createSchemaBuilder().log();

    expect(log.upQueries.map((q) => q.query)).toEqual([]);
  });

  describe('round-trips', () => {
    it('tenant, with defaults', async () => {
      const saved = await tenants.save(
        tenants.create({
          name: 'Clinic',
          timezone: 'America/Sao_Paulo',
          policies: { hold_ttl_seconds: 300 },
        }),
      );
      const loaded = await tenants.findOneByOrFail({ id: saved.id });

      expect(loaded).toMatchObject({
        name: 'Clinic',
        timezone: 'America/Sao_Paulo',
        locale: 'pt-BR',
        policies: { hold_ttl_seconds: 300 },
      });
      expect(loaded.createdAt).toBeInstanceOf(Date);
    });

    it('patient: national_id encrypted, hash kept in sync', async () => {
      const tenant = await newTenant();
      const saved = await patients.save(
        patients.create({
          tenantId: tenant.id,
          whatsappId: '5511988887777',
          name: 'Ana',
          dob: '1990-05-17',
          nationalId: '123.456.789-09',
          insurance: { provider: 'Unimed', plan: 'Gold', member_number: '42' },
          consentAt: start,
        }),
      );

      const loaded = await patients.findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        dob: '1990-05-17',
        nationalId: '123.456.789-09',
        insurance: { provider: 'Unimed', plan: 'Gold', member_number: '42' },
        consentAt: start,
      });

      const [raw] = await ds.query<
        { national_id: Buffer; national_id_hash: Buffer }[]
      >(
        `SELECT "national_id", "national_id_hash" FROM "patient" WHERE "id" = $1`,
        [saved.id],
      );
      expect(raw.national_id[0]).toBe(CIPHERTEXT_VERSION);
      expect(raw.national_id.includes('12345678909')).toBe(false);
      expect(raw.national_id.includes('123.456.789-09')).toBe(false);
      expect(raw.national_id_hash).toEqual(hmacNationalId('12345678909'));

      loaded.nationalId = null;
      await patients.save(loaded);
      expect(await patients.findOneByOrFail({ id: saved.id })).toMatchObject({
        nationalId: null,
        nationalIdHash: null,
      });
    });

    it('service, with defaults and required_sequence', async () => {
      const tenant = await newTenant();
      const lab = await newService(tenant.id, 'Lab draw');
      const saved = await services.save(
        services.create({
          tenantId: tenant.id,
          name: 'Consulta',
          type: 'consultation',
          durationMinutes: 30,
          priceCents: 25000,
          requiredSequence: [lab.id],
        }),
      );

      expect(await services.findOneByOrFail({ id: saved.id })).toMatchObject({
        type: 'consultation',
        durationMinutes: 30,
        priceCents: 25000,
        currency: 'BRL',
        requiredSequence: [lab.id],
        active: true,
        preparation: null,
      });
      expect(
        (await services.findOneByOrFail({ id: lab.id })).requiredSequence,
      ).toEqual([]);
    });

    it('appointment: range as {start, end}, version bumps on save', async () => {
      const { tenant, patient, service } = await newBookingContext();
      const saved = await appointments.save(
        appointments.create({
          tenantId: tenant.id,
          patientId: patient.id,
          serviceId: service.id,
          range: { start, end },
          source: 'whatsapp_agent',
        }),
      );
      expect(saved.version).toBe(1);

      const loaded = await appointments.findOneByOrFail({ id: saved.id });
      expect(loaded).toMatchObject({
        range: { start, end },
        status: 'booked',
        source: 'whatsapp_agent',
        externalRef: null,
        version: 1,
      });

      loaded.status = 'confirmed';
      await appointments.save(loaded);
      expect(
        (await appointments.findOneByOrFail({ id: saved.id })).version,
      ).toBe(2);
    });

    it.each([
      ['inbox', InboxMessageEntity],
      ['outbox', OutboxMessageEntity],
    ] as const)('%s message: payload encrypted', async (_, entity) => {
      const repo = ds.getRepository<InboxMessageEntity>(entity);
      const table = repo.metadata.tableName;
      const tenant = await newTenant();
      const payload = { text: 'dor no peito', from: '5511999990000' };
      const saved = await repo.save(
        repo.create({
          tenantId: tenant.id,
          externalId: 'wamid.ABC',
          eventType: 'whatsapp.message.received',
          payload,
        }),
      );

      expect(await repo.findOneByOrFail({ id: saved.id })).toMatchObject({
        payload,
        publishedAt: null,
        attempts: 0,
        lastError: null,
      });
      const [raw] = await ds.query<{ payload: Buffer }[]>(
        `SELECT "payload" FROM "${table}" WHERE "id" = $1`,
        [saved.id],
      );
      expect(raw.payload[0]).toBe(CIPHERTEXT_VERSION);
      expect(raw.payload.includes('dor no peito')).toBe(false);
    });
  });

  describe('constraints', () => {
    it('whatsapp_id is unique per tenant only', async () => {
      const tenant = await newTenant();
      await newPatient(tenant.id);

      await expectConstraint(
        newPatient(tenant.id),
        'uq_patient_tenant_whatsapp',
      );
      await expect(newPatient((await newTenant()).id)).resolves.toBeDefined();
    });

    it('national_id is unique per tenant, ignoring formatting', async () => {
      const tenant = await newTenant();
      await patients.save(
        patients.create({
          tenantId: tenant.id,
          whatsappId: '1',
          name: 'Ana',
          nationalId: '123.456.789-09',
        }),
      );

      await expectConstraint(
        patients.save(
          patients.create({
            tenantId: tenant.id,
            whatsappId: '2',
            name: 'Bia',
            nationalId: '12345678909',
          }),
        ),
        'uq_patient_tenant_national_id_hash',
      );
    });

    it('national_id and its hash are set together', async () => {
      const tenant = await newTenant();

      await expectConstraint(
        ds.query(
          `INSERT INTO "patient" ("tenant_id", "whatsapp_id", "name", "national_id")
           VALUES ($1, '1', 'Ana', '\\x01')`,
          [tenant.id],
        ),
        'chk_patient_national_id_pair',
      );
    });

    it.each([
      ['inbox_message', 'uq_inbox_message_tenant_external_id'],
      ['outbox_message', 'uq_outbox_message_tenant_external_id'],
    ])('%s external_id is unique per tenant', async (table, constraint) => {
      const tenant = await newTenant();
      const insert = () =>
        ds.query(
          `INSERT INTO "${table}" ("tenant_id", "external_id", "event_type", "payload")
           VALUES ($1, 'wamid.DUP', 'e', '\\x01')`,
          [tenant.id],
        );
      await insert();

      await expectConstraint(insert(), constraint);
    });

    it('locale must be supported', async () => {
      await expectConstraint(
        tenants.save(
          tenants.create({ name: 'X', timezone: 'UTC', locale: 'fr' as 'en' }),
        ),
        'chk_tenant_locale',
      );
    });

    it('duration must be positive and price non-negative', async () => {
      const tenant = await newTenant();
      const base = { tenantId: tenant.id, type: 'exam' as const };

      await expectConstraint(
        services.save(
          services.create({ ...base, name: 'A', durationMinutes: 0 }),
        ),
        'chk_service_duration_positive',
      );
      await expectConstraint(
        services.save(
          services.create({
            ...base,
            name: 'B',
            durationMinutes: 10,
            priceCents: -1,
          }),
        ),
        'chk_service_price_non_negative',
      );
    });

    it.each([
      ['empty'],
      ['(2026-10-01 12:00+00,2026-10-01 12:30+00]'],
      ['[2026-10-01 12:00+00,)'],
      ['(,2026-10-01 12:30+00)'],
    ])('range %s is rejected', async (range) => {
      const { tenant, patient, service } = await newBookingContext();

      await expectConstraint(
        ds.query(
          `INSERT INTO "appointment"
             ("tenant_id", "patient_id", "service_id", "range", "source", "version")
           VALUES ($1, $2, $3, $4, 'staff', 1)`,
          [tenant.id, patient.id, service.id, range],
        ),
        'chk_appointment_range_bounds',
      );
    });

    it('unknown enum values are rejected', async () => {
      const { tenant, patient, service } = await newBookingContext();

      await expect(
        ds.query(
          `INSERT INTO "appointment"
             ("tenant_id", "patient_id", "service_id", "range", "source", "version")
           VALUES ($1, $2, $3, '[2026-10-01 12:00+00,2026-10-01 12:30+00)', 'import', 1)`,
          [tenant.id, patient.id, service.id],
        ),
      ).rejects.toMatchObject({ driverError: { code: '22P02' } });
    });
  });

  describe('deletes', () => {
    async function bookedContext() {
      const ctx = await newBookingContext();
      const appointment = await appointments.save(
        appointments.create({
          tenantId: ctx.tenant.id,
          patientId: ctx.patient.id,
          serviceId: ctx.service.id,
          range: { start, end },
          source: 'staff',
        }),
      );
      return { ...ctx, appointment };
    }

    it('a service with appointments cannot be deleted', async () => {
      const { service } = await bookedContext();

      await expectConstraint(
        services.delete({ id: service.id }),
        'fk_appointment_service',
      );
    });

    it('deleting a patient removes their appointments', async () => {
      const { patient, appointment } = await bookedContext();
      await patients.delete({ id: patient.id });

      expect(await appointments.findOneBy({ id: appointment.id })).toBeNull();
    });

    it('deleting a tenant removes every child row', async () => {
      const { tenant } = await bookedContext();
      await ds.getRepository(InboxMessageEntity).save({
        tenantId: tenant.id,
        externalId: 'in',
        eventType: 'e',
        payload: {},
      });
      await ds.getRepository(OutboxMessageEntity).save({
        tenantId: tenant.id,
        externalId: 'out',
        eventType: 'e',
        payload: {},
      });

      await tenants.delete({ id: tenant.id });

      for (const entity of [
        PatientEntity,
        ServiceEntity,
        AppointmentEntity,
        InboxMessageEntity,
        OutboxMessageEntity,
      ]) {
        expect(
          await ds.getRepository(entity).countBy({ tenantId: tenant.id }),
        ).toBe(0);
      }
    });
  });

  // Last: reverting drops the schema the other tests use.
  it('reverting the migration leaves no tables or enum types', async () => {
    await ds.undoLastMigration();

    const tables = await ds.query<{ table_name: string }[]>(
      `SELECT "table_name" FROM information_schema.tables
       WHERE "table_schema" = 'public' AND "table_name" <> 'migrations'`,
    );
    const types = await ds.query<{ typname: string }[]>(
      `SELECT t."typname" FROM pg_type t
       JOIN pg_namespace n ON n."oid" = t."typnamespace"
       WHERE n."nspname" = 'public' AND t."typtype" = 'e'`,
    );
    expect(tables).toEqual([]);
    expect(types).toEqual([]);
  });
});
