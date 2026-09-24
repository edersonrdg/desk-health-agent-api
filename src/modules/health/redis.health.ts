import { Inject, Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { errorMessage } from '../../shared/utils/error-message';
import { REDIS_CLIENT } from '../../shared/redis/redis.constants';

export interface RedisPingCheckOptions {
  /** Maximum time for the PING in ms. Defaults to 1000. */
  timeout?: number;
}

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  /** Sends `PING` through the shared client and expects `PONG`. */
  async pingCheck<Key extends string>(
    key: Key,
    options: RedisPingCheckOptions = {},
  ): Promise<HealthIndicatorResult<Key>> {
    const check = this.healthIndicatorService.check(key);
    const timeout = options.timeout ?? 1_000;

    // While disconnected, ioredis would park the PING in its offline queue
    // and every probe would add another one. Fail fast instead.
    if (this.redis.status !== 'ready') {
      return check.down(`client not ready (status: ${this.redis.status})`);
    }

    try {
      const reply = await withTimeout(this.redis.ping(), timeout);
      return reply === 'PONG'
        ? check.up()
        : check.down('unexpected PING reply');
    } catch (err) {
      return check.down(errorMessage(err));
    }
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timeout of ${ms}ms exceeded`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
