import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.schema';
import { AppointmentModule } from './modules/appointment/appointment.module';
import { HealthModule } from './modules/health/health.module';
import { PatientModule } from './modules/patient/patient.module';
import { ServiceModule } from './modules/service/service.module';
import { TenantModule } from './modules/tenant/tenant.module';
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
    HealthModule,
    TenantModule,
    PatientModule,
    ServiceModule,
    AppointmentModule,
    MessagingModule,
  ],
})
export class AppModule {}
