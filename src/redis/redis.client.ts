import { Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { errorMessage } from '../common/error-message';

export interface RedisClientOptions {
  host: string;
  port: number;
}

/**
 * Creates the shared client. ioredis connects in the background and keeps
 * reconnecting on its own, so an unreachable Redis never blocks boot.
 */
export function createRedisClient(
  options: RedisClientOptions,
  logger = new Logger('Redis'),
): Redis {
  const client = new Redis({ host: options.host, port: options.port });
  logConnectionState(client, logger);
  return client;
}

/**
 * ioredis emits `error` on every failed reconnect attempt. Log only on
 * transitions (up → down, down → up) to keep outages from flooding the logs.
 */
export function logConnectionState(client: Redis, logger: Logger): void {
  let state: 'unknown' | 'up' | 'down' = 'unknown';

  const markDown = (reason: string): void => {
    if (state === 'down') return;
    state = 'down';
    logger.warn(`Redis unavailable, reconnecting in background: ${reason}`);
  };

  client.on('ready', () => {
    if (state === 'up') return;
    state = 'up';
    logger.log('Redis connection ready');
  });
  client.on('error', (err: unknown) => markDown(errorMessage(err)));
  client.on('close', () => {
    // Only a drop from a live connection; failed attempts already emit `error`.
    if (state === 'up') markDown('connection closed');
  });
}
