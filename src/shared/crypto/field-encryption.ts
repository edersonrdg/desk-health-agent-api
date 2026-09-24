import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { getCryptoKeys } from './crypto-keys';

/** Bumped when the key or format changes, so old ciphertext stays readable. */
export const CIPHERTEXT_VERSION = 1;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + IV_LENGTH + TAG_LENGTH;

/** Layout: version (1 byte) | iv (12) | tag (16) | ciphertext. */
export function encrypt(plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getCryptoKeys().encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([
    Buffer.of(CIPHERTEXT_VERSION),
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

/** Errors never carry the input: it may be health data. */
export function decrypt(data: Buffer): Buffer {
  if (data.length < HEADER_LENGTH) {
    throw new Error('Ciphertext is too short');
  }
  if (data[0] !== CIPHERTEXT_VERSION) {
    throw new Error(`Unsupported ciphertext version ${data[0]}`);
  }
  const iv = data.subarray(1, 1 + IV_LENGTH);
  const tag = data.subarray(1 + IV_LENGTH, HEADER_LENGTH);
  const decipher = createDecipheriv(
    ALGORITHM,
    getCryptoKeys().encryptionKey,
    iv,
  );
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([
      decipher.update(data.subarray(HEADER_LENGTH)),
      decipher.final(),
    ]);
  } catch {
    throw new Error('Ciphertext authentication failed');
  }
}

/** CPF-style IDs: formatting (dots, dashes, spaces) doesn't change the hash. */
export function normalizeNationalId(value: string): string {
  return value.replace(/\D/g, '');
}

/** Blind index for exact-match lookup without decrypting. */
export function hmacNationalId(value: string): Buffer {
  return createHmac('sha256', getCryptoKeys().nationalIdHmacKey)
    .update(normalizeNationalId(value))
    .digest();
}
