import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { TracedRequest, traceIdOf } from '../../shared/http/trace-id';
import { WEBHOOK_SECRET_HEADER } from './whatsapp.constants';

/**
 * Authenticates Evolution API webhooks by the shared secret header (D2, D25).
 * Unset secret → 503, the webhook is disabled (D27). The compare hashes both
 * sides first, so neither the value nor its length leaks through timing.
 */
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSecretGuard.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<TracedRequest>();
    const traceId = traceIdOf(req);
    const secret = this.config.get('EVOLUTION_WEBHOOK_SECRET', {
      infer: true,
    });

    if (!secret) {
      this.logger.warn(
        `Webhook rejected: EVOLUTION_WEBHOOK_SECRET is not set (trace_id=${traceId})`,
      );
      throw new ServiceUnavailableException();
    }

    const received = req.header(WEBHOOK_SECRET_HEADER);
    if (!received || !secretsMatch(received, secret)) {
      this.logger.warn(
        `Webhook rejected: invalid secret header (trace_id=${traceId})`,
      );
      throw new UnauthorizedException();
    }
    return true;
  }
}

function secretsMatch(received: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(received), digest(expected));
}
