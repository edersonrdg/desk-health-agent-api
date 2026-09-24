import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { errorMessage } from '../../shared/utils/error-message';
import { InboundMessageJob } from './inbound-message.job';
import {
  ENQUEUE_TIMEOUT_MS,
  INBOUND_JOB_NAME,
  INBOUND_QUEUE,
} from './whatsapp.constants';

export class EnqueueTimeoutError extends Error {
  constructor() {
    super(`queue.add did not finish within ${ENQUEUE_TIMEOUT_MS}ms`);
    this.name = 'EnqueueTimeoutError';
  }
}

/**
 * Adds inbound jobs to BullMQ. `jobId` is the inbox row id, so the webhook
 * path and the sweep can both add a row without duplicating it (D11). Each
 * add is bounded by ENQUEUE_TIMEOUT_MS so a slow Redis never holds the
 * webhook ack (D29); a late add may still land, and jobId dedups it.
 */
@Injectable()
export class InboundPublisher implements OnModuleInit {
  private readonly logger = new Logger(InboundPublisher.name);
  private redisDown = false;

  constructor(@InjectQueue(INBOUND_QUEUE) private readonly queue: Queue) {}

  onModuleInit(): void {
    // Without a listener, BullMQ prints every connection error to stderr.
    this.queue.on('error', (err: unknown) => {
      if (this.redisDown) return;
      this.redisDown = true;
      this.logger.warn(`Inbound queue unavailable: ${errorMessage(err)}`);
    });
  }

  async publish(job: InboundMessageJob): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new EnqueueTimeoutError()),
        ENQUEUE_TIMEOUT_MS,
      );
    });
    const add = this.queue.add(INBOUND_JOB_NAME, job, {
      jobId: job.inbox_message_id,
    });
    // A late rejection after the timeout must not become unhandled.
    add.catch(() => undefined);
    try {
      await Promise.race([add, timeout]);
      this.redisDown = false;
    } finally {
      clearTimeout(timer);
    }
  }
}
