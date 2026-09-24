import { Env } from '../../config/env.schema';

export interface CryptoKeys {
  encryptionKey: Buffer;
  nationalIdHmacKey: Buffer;
}

let keys: CryptoKeys | undefined;

/**
 * TypeORM transformers are plain objects outside Nest's DI, so they read the
 * keys from this holder. It is filled from the validated env by CryptoModule
 * at bootstrap, by the CLI DataSource and by tests.
 */
export function initCryptoKeys(
  env: Pick<Env, 'ENCRYPTION_KEY' | 'NATIONAL_ID_HMAC_KEY'>,
): void {
  keys = {
    encryptionKey: Buffer.from(env.ENCRYPTION_KEY, 'base64'),
    nationalIdHmacKey: Buffer.from(env.NATIONAL_ID_HMAC_KEY, 'base64'),
  };
}

export function getCryptoKeys(): CryptoKeys {
  if (!keys) {
    throw new Error('Crypto keys are not initialized');
  }
  return keys;
}
