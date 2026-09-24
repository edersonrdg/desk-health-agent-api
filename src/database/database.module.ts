import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Env } from '../config/env.schema';
import { DatabaseConnector } from './database-connector.service';

/** Bounds each connect attempt so a black-holed host can't stall the retry loop. */
const CONNECT_TIMEOUT_MS = 5_000;

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        type: 'postgres',
        host: config.get('POSTGRES_HOST', { infer: true }),
        port: config.get('POSTGRES_PORT', { infer: true }),
        username: config.get('POSTGRES_USER', { infer: true }),
        password: config.get('POSTGRES_PASSWORD', { infer: true }),
        database: config.get('POSTGRES_DB', { infer: true }),
        entities: [],
        // The api owns the schema through migrations (added in a later spec).
        synchronize: false,
        connectTimeoutMS: CONNECT_TIMEOUT_MS,
        // Boot must not wait for Postgres; DatabaseConnector connects in the background.
        manualInitialization: true,
      }),
    }),
  ],
  providers: [DatabaseConnector],
})
export class DatabaseModule {}
