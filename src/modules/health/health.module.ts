import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';

@Module({
  // Terminus's own logger prints full error details; the controller logs
  // failures itself.
  imports: [TerminusModule.forRoot({ logger: false })],
  controllers: [HealthController],
  providers: [RedisHealthIndicator],
})
export class HealthModule {}
