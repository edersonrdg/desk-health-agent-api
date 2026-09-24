import { HealthIndicatorService } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { RedisHealthIndicator } from './redis.health';

describe('RedisHealthIndicator', () => {
  let indicator: RedisHealthIndicator;
  let redis: { status: string; ping: jest.Mock };

  beforeEach(async () => {
    redis = { status: 'ready', ping: jest.fn().mockResolvedValue('PONG') };
    const moduleRef = await Test.createTestingModule({
      providers: [
        RedisHealthIndicator,
        HealthIndicatorService,
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();

    indicator = moduleRef.get(RedisHealthIndicator);
  });

  it('reports up on PONG', async () => {
    const result = await indicator.pingCheck('redis');

    expect(result.redis.status).toBe('up');
  });

  it('reports down when PING fails', async () => {
    redis.ping.mockRejectedValue(new Error('Connection is closed.'));

    const result = await indicator.pingCheck('redis');

    expect(result.redis).toMatchObject({
      status: 'down',
      message: 'Connection is closed.',
    });
  });

  it('reports down on an unexpected reply', async () => {
    redis.ping.mockResolvedValue('NOPE');

    const result = await indicator.pingCheck('redis');

    expect(result.redis.status).toBe('down');
  });

  it('reports down without queueing a PING while disconnected', async () => {
    redis.status = 'reconnecting';

    const result = await indicator.pingCheck('redis');

    expect(result.redis.status).toBe('down');
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('reports down when PING exceeds the timeout', async () => {
    redis.ping.mockReturnValue(new Promise(() => {}));

    const result = await indicator.pingCheck('redis', { timeout: 50 });

    expect(result.redis).toMatchObject({
      status: 'down',
      message: 'timeout of 50ms exceeded',
    });
  });
});
