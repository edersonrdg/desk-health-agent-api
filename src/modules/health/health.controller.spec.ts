import { ServiceUnavailableException } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
  TerminusModule,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Test, TestingModule } from '@nestjs/testing';
import { CHECK_TIMEOUT_MS, HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';

type PingCheckMock = jest.Mock<
  Promise<HealthIndicatorResult>,
  [key: string, options: { timeout: number }]
>;

describe('HealthController', () => {
  const indicators = new HealthIndicatorService();
  const up = (key: string): Promise<HealthIndicatorResult> =>
    Promise.resolve(indicators.check(key).up());
  const down =
    (message: string) =>
    (key: string): Promise<HealthIndicatorResult> =>
      Promise.resolve(indicators.check(key).down(message));

  let healthController: HealthController;
  let postgres: { pingCheck: PingCheckMock };
  let redis: { pingCheck: PingCheckMock };

  beforeEach(async () => {
    postgres = {
      pingCheck: jest.fn<ReturnType<PingCheckMock>, Parameters<PingCheckMock>>(
        up,
      ),
    };
    redis = {
      pingCheck: jest.fn<ReturnType<PingCheckMock>, Parameters<PingCheckMock>>(
        up,
      ),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule.forRoot({ logger: false })],
      controllers: [HealthController],
      providers: [{ provide: RedisHealthIndicator, useValue: redis }],
    })
      .overrideProvider(TypeOrmHealthIndicator)
      .useValue(postgres)
      .compile();

    healthController = moduleRef.get<HealthController>(HealthController);
  });

  async function readyFailure(): Promise<ServiceUnavailableException> {
    const err: unknown = await healthController
      .ready()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    return err as ServiceUnavailableException;
  }

  describe('check', () => {
    it('should return no body', () => {
      expect(healthController.check()).toBeUndefined();
    });
  });

  describe('ready', () => {
    it('returns ok when both dependencies are up', async () => {
      await expect(healthController.ready()).resolves.toEqual({
        status: 'ok',
        details: { postgres: 'up', redis: 'up' },
      });
    });

    it(`gives each check a ${CHECK_TIMEOUT_MS}ms timeout`, async () => {
      await healthController.ready();

      expect(CHECK_TIMEOUT_MS).toBe(1_000);
      expect(postgres.pingCheck).toHaveBeenCalledWith('postgres', {
        timeout: CHECK_TIMEOUT_MS,
      });
      expect(redis.pingCheck).toHaveBeenCalledWith('redis', {
        timeout: CHECK_TIMEOUT_MS,
      });
    });

    it('returns 503 with postgres down', async () => {
      postgres.pingCheck.mockImplementation(down('connect ECONNREFUSED'));

      const err = await readyFailure();

      expect(err.getStatus()).toBe(503);
      expect(err.getResponse()).toEqual({
        status: 'error',
        details: { postgres: 'down', redis: 'up' },
      });
    });

    it('returns 503 with redis down', async () => {
      redis.pingCheck.mockImplementation(down('client not ready'));

      const err = await readyFailure();

      expect(err.getStatus()).toBe(503);
      expect(err.getResponse()).toEqual({
        status: 'error',
        details: { postgres: 'up', redis: 'down' },
      });
    });

    it('returns 503 when a check times out', async () => {
      postgres.pingCheck.mockImplementation(
        down(`timeout of ${CHECK_TIMEOUT_MS}ms exceeded`),
      );

      const err = await readyFailure();

      expect(err.getResponse()).toEqual({
        status: 'error',
        details: { postgres: 'down', redis: 'up' },
      });
    });

    it('keeps error messages out of the body', async () => {
      redis.pingCheck.mockImplementation(
        down('connect ECONNREFUSED 10.0.0.12:6379'),
      );

      const err = await readyFailure();

      expect(JSON.stringify(err.getResponse())).not.toContain('ECONNREFUSED');
    });
  });
});
