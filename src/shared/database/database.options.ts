import { DataSourceOptions } from 'typeorm';
import { Env } from '../../config/env.schema';
import { AppointmentEntity } from '../../modules/appointment/appointment.entity';
import { PatientEntity } from '../../modules/patient/patient.entity';
import { ServiceEntity } from '../../modules/service/service.entity';
import { TenantEntity } from '../../modules/tenant/tenant.entity';
import { InboxMessageEntity } from '../messaging/inbox-message.entity';
import { OutboxMessageEntity } from '../messaging/outbox-message.entity';

export const ENTITIES = [
  TenantEntity,
  PatientEntity,
  ServiceEntity,
  AppointmentEntity,
  InboxMessageEntity,
  OutboxMessageEntity,
];

/** Bounds each connect attempt so a black-holed host can't stall the retry loop. */
const CONNECT_TIMEOUT_MS = 5_000;

type PostgresOptions = Extract<DataSourceOptions, { type: 'postgres' }>;

/** Connection options shared by the Nest app and the migration CLI. */
export function buildDataSourceOptions(
  env: Pick<
    Env,
    | 'POSTGRES_HOST'
    | 'POSTGRES_PORT'
    | 'POSTGRES_USER'
    | 'POSTGRES_PASSWORD'
    | 'POSTGRES_DB'
  >,
): PostgresOptions {
  return {
    type: 'postgres',
    host: env.POSTGRES_HOST,
    port: env.POSTGRES_PORT,
    username: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    database: env.POSTGRES_DB,
    entities: ENTITIES,
    synchronize: false,
    migrationsRun: false,
    installExtensions: false,
    uuidExtension: 'pgcrypto',
    connectTimeoutMS: CONNECT_TIMEOUT_MS,
  };
}
