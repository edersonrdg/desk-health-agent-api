import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { TraceId } from '../../shared/http/trace-id';
import { ZodValidationPipe } from '../../shared/http/zod-validation.pipe';
import type { EvolutionWebhookEvent } from './evolution/evolution-webhook.schema';
import { evolutionWebhookSchema } from './evolution/evolution-webhook.schema';
import { InboundMessageService } from './inbound-message.service';
import { WebhookSecretGuard } from './webhook-secret.guard';

/**
 * Evolution API webhook (spec 004). Answers 200 once the message is stored,
 * never waiting on the AI; the status codes follow D20.
 */
@Controller('webhooks/evolution')
export class EvolutionWebhookController {
  constructor(private readonly inbound: InboundMessageService) {}

  @Post()
  @HttpCode(200)
  @UseGuards(WebhookSecretGuard)
  async receive(
    @Body(new ZodValidationPipe(evolutionWebhookSchema))
    event: EvolutionWebhookEvent,
    @TraceId() traceId: string,
  ): Promise<void> {
    await this.inbound.receive(event, traceId);
  }
}
