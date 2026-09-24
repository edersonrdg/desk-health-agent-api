import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventEmitter } from 'node:events';
import Redis from 'ioredis';
import { logConnectionState } from './redis.client';
import { REDIS_CLIENT } from './redis.constants';
import { RedisModule } from './redis.module';

describe('RedisModule', () => {
  async function closeWith(status: string) {
    const client = {
      status,
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [RedisModule],
    })
      .overrideProvider(REDIS_CLIENT)
      .useValue(client)
      .compile();

    await moduleRef.close();
    return client;
  }

  it('quits the client on shutdown when connected', async () => {
    const client = await closeWith('ready');

    expect(client.quit).toHaveBeenCalledTimes(1);
    expect(client.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects the client on shutdown when not connected', async () => {
    const client = await closeWith('reconnecting');

    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.quit).not.toHaveBeenCalled();
  });
});

describe('logConnectionState', () => {
  let client: EventEmitter;
  let logger: { log: jest.Mock; warn: jest.Mock };

  beforeEach(() => {
    client = new EventEmitter();
    logger = { log: jest.fn(), warn: jest.fn() };
    logConnectionState(client as unknown as Redis, logger as unknown as Logger);
  });

  it('logs repeated errors once per outage', () => {
    client.emit('error', new Error('connect ECONNREFUSED'));
    client.emit('close');
    client.emit('error', new Error('connect ECONNREFUSED'));

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('logs each up/down transition', () => {
    client.emit('ready');
    client.emit('close');
    client.emit('error', new Error('connect ECONNREFUSED'));
    client.emit('ready');
    client.emit('ready');

    expect(logger.log).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
