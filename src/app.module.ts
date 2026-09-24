import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { QueueOptions } from 'bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { Env, validateEnv } from './config/env.schema';
import { AuditModule } from './modules/audit/audit.module';
import { AppointmentModule } from './modules/appointment/appointment.module';
import { HealthModule } from './modules/health/health.module';
import { PatientModule } from './modules/patient/patient.module';
import { ServiceModule } from './modules/service/service.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { CryptoModule } from './shared/crypto/crypto.module';
import { DatabaseModule } from './shared/database/database.module';
import { MessagingModule } from './shared/messaging/messaging.module';
import { RedisModule } from './shared/redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    CryptoModule,
    DatabaseModule,
    RedisModule,
    // BullMQ opens its own Redis connections (spec 004 D10).
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): QueueOptions => {
        const host: string = config.get('REDIS_HOST', { infer: true });
        const port: number = config.get('REDIS_PORT', { infer: true });
        return { connection: { host, port } };
      },
    }),
    ScheduleModule.forRoot(),
    HealthModule,
    TenantModule,
    PatientModule,
    ServiceModule,
    AppointmentModule,
    MessagingModule,
    AuditModule,
    WhatsappModule,
  ],
})
export class AppModule {}
