import {
  ExecutionContext,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { WebhookSecretGuard } from './webhook-secret.guard';

describe('WebhookSecretGuard', () => {
  const SECRET = 'correct-horse-battery-staple';

  function run(secret: string | undefined, header?: string) {
    const config = {
      get: () => secret,
    } as unknown as ConfigService<Env, true>;
    const req = {
      traceId: 'trace-1',
      header: (name: string) =>
        name === 'x-webhook-secret' ? header : undefined,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return () => new WebhookSecretGuard(config).canActivate(context);
  }

  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => warn.mockRestore());

  it('answers 503 when the secret is not configured', () => {
    expect(run(undefined, SECRET)).toThrow(ServiceUnavailableException);
  });

  it.each([
    ['missing', undefined],
    ['wrong', 'wrong-secret-of-another-length'],
    ['same length, different', SECRET.replace('c', 'k')],
  ])('answers 401 for a %s header', (_, header) => {
    expect(run(SECRET, header)).toThrow(UnauthorizedException);
  });

  it('lets the right secret through', () => {
    expect(run(SECRET, SECRET)()).toBe(true);
  });

  it('logs the trace id but never the header value', () => {
    expect(run(SECRET, 'leaked-guess')).toThrow(UnauthorizedException);

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('trace-1');
    expect(logged).not.toContain('leaked-guess');
    expect(logged).not.toContain(SECRET);
  });
});
