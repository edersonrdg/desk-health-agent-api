import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TraceIdMiddleware } from '../../shared/http/trace-id';
import { AuditModule } from '../audit/audit.module';
import { EvolutionWebhookController } from './evolution-webhook.controller';
import { InboundMessageService } from './inbound-message.service';
import { InboundPublisher } from './inbound-publisher';
import { InboundRelaySweep } from './inbound-relay.sweep';
import { WebhookSecretGuard } from './webhook-secret.guard';
import { INBOUND_QUEUE } from './whatsapp.constants';

/** WhatsApp channel: Evolution API webhook in; sending comes with US-02. */
@Module({
  imports: [
    AuditModule,
    BullModule.registerQueue({
      name: INBOUND_QUEUE,
      defaultJobOptions: { removeOnComplete: true, removeOnFail: 100 },
    }),
  ],
  controllers: [EvolutionWebhookController],
  providers: [
    InboundMessageService,
    InboundPublisher,
    InboundRelaySweep,
    WebhookSecretGuard,
  ],
})
export class WhatsappModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes(EvolutionWebhookController);
  }
}
