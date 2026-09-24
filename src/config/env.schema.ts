import { z } from 'zod';

const port = z.coerce.number().int().min(1).max(65535);

/** A 256-bit key given as base64. The message never includes the value. */
const base64Key = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be base64')
  .refine((value) => Buffer.from(value, 'base64').length === 32, {
    message: 'must decode to exactly 32 bytes',
  });

export const envSchema = z.object({
  POSTGRES_HOST: z.string().min(1).default('localhost'),
  POSTGRES_PORT: port.default(5432),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().min(1),
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: port.default(6379),
  ENCRYPTION_KEY: base64Key,
  NATIONAL_ID_HMAC_KEY: base64Key,
  /** Shared secret for the Evolution API webhook. Unset: the webhook answers 503. */
  EVOLUTION_WEBHOOK_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * `validate` hook for `ConfigModule.forRoot`. Zod messages name the variable
 * and the rule it broke, never the received value, so secrets stay out of the
 * boot error.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
