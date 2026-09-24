/** BullMQ queue for inbound messages, consumed by the US-03 worker (spec 004 D26). */
export const INBOUND_QUEUE = 'inbound-messages';
export const INBOUND_JOB_NAME = 'inbound-message';

/** Longest the webhook waits for `queue.add()` before leaving the row to the sweep (D29). */
export const ENQUEUE_TIMEOUT_MS = 200;

/** Relay sweep (D13, D14). */
export const SWEEP_INTERVAL_MS = 10_000;
export const SWEEP_STALE_AFTER_SECONDS = 30;
export const SWEEP_MAX_ATTEMPTS = 5;
export const SWEEP_BATCH_SIZE = 100;

export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';
