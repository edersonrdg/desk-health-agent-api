import { Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InboundMessageJob } from './inbound-message.job';
import { EnqueueTimeoutError, InboundPublisher } from './inbound-publisher';
import { ENQUEUE_TIMEOUT_MS } from './whatsapp.constants';

describe('InboundPublisher', () => {
  const job = { inbox_message_id: 'inbox-1' } as InboundMessageJob;

  function publisherWith(add: jest.Mock) {
    const queue = { add, on: jest.fn() } as unknown as Queue;
    return new InboundPublisher(queue);
  }

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('adds the job with jobId = inbox_message_id', async () => {
    const add = jest.fn().mockResolvedValue({});

    await publisherWith(add).publish(job);

    expect(add).toHaveBeenCalledWith('inbound-message', job, {
      jobId: 'inbox-1',
    });
  });

  it('gives up after the timeout, without an unhandled late rejection', async () => {
    let rejectLate!: (err: Error) => void;
    const add = jest.fn(
      () => new Promise((_, reject) => (rejectLate = reject)),
    );

    const publishing = publisherWith(add).publish(job);
    jest.advanceTimersByTime(ENQUEUE_TIMEOUT_MS);

    await expect(publishing).rejects.toBeInstanceOf(EnqueueTimeoutError);
    rejectLate(new Error('late'));
  });

  it('logs queue errors once per outage', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const on = jest.fn();
    const publisher = new InboundPublisher({ on } as unknown as Queue);
    publisher.onModuleInit();
    const [[, onError]] = on.mock.calls as [[string, (err: Error) => void]];

    onError(new Error('ECONNREFUSED'));
    onError(new Error('ECONNREFUSED'));

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
