import { randomUUID } from 'node:crypto';
import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export interface TracedRequest extends Request {
  traceId?: string;
}

/**
 * Creates the trace id at ingress, before guards run, so every log line of
 * the request (including a 401) carries it (spec 004, MVP US-01 AC7).
 */
@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: TracedRequest, _res: Response, next: NextFunction): void {
    req.traceId = randomUUID();
    next();
  }
}

export function traceIdOf(req: TracedRequest): string {
  // Only unset when a route forgot the middleware; still give it a trace.
  req.traceId ??= randomUUID();
  return req.traceId;
}

/** Handler parameter holding the request's trace id. */
export const TraceId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    traceIdOf(ctx.switchToHttp().getRequest<TracedRequest>()),
);
