import { initCryptoKeys } from './crypto-keys';
import { encryptedJson, encryptedString } from './encrypted.transformer';
import {
  CIPHERTEXT_VERSION,
  decrypt,
  encrypt,
  hmacNationalId,
  normalizeNationalId,
} from './field-encryption';

describe('field encryption', () => {
  beforeAll(() => {
    initCryptoKeys({
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      NATIONAL_ID_HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
    });
  });

  it('round-trips and prefixes the version byte', () => {
    const ciphertext = encrypt(Buffer.from('123.456.789-09'));

    expect(ciphertext[0]).toBe(CIPHERTEXT_VERSION);
    expect(decrypt(ciphertext).toString()).toBe('123.456.789-09');
  });

  it('uses a random IV, so equal plaintexts differ', () => {
    const plaintext = Buffer.from('same');

    expect(encrypt(plaintext).equals(encrypt(plaintext))).toBe(false);
  });

  it('rejects a tampered ciphertext without echoing it', () => {
    const ciphertext = encrypt(Buffer.from('secret-value'));
    ciphertext[ciphertext.length - 1] ^= 0xff;

    expect(() => decrypt(ciphertext)).toThrow('authentication failed');
  });

  it('rejects an unknown version', () => {
    const ciphertext = encrypt(Buffer.from('x'));
    ciphertext[0] = 99;

    expect(() => decrypt(ciphertext)).toThrow('version 99');
  });

  it('rejects a truncated ciphertext', () => {
    expect(() => decrypt(Buffer.of(CIPHERTEXT_VERSION))).toThrow('too short');
  });

  it('hashes national IDs deterministically, ignoring formatting', () => {
    expect(normalizeNationalId('123.456.789-09')).toBe('12345678909');
    expect(hmacNationalId('123.456.789-09')).toEqual(
      hmacNationalId('12345678909'),
    );
    expect(hmacNationalId('12345678909')).not.toEqual(
      hmacNationalId('12345678900'),
    );
  });

  describe('transformers', () => {
    it('round-trip strings and JSON', () => {
      const text = encryptedString.to('hello') as Buffer;
      const json = encryptedJson.to({ a: [1, 'b'] }) as Buffer;

      expect(encryptedString.from(text)).toBe('hello');
      expect(encryptedJson.from(json)).toEqual({ a: [1, 'b'] });
    });

    it('pass null and undefined through', () => {
      expect(encryptedString.to(null)).toBeNull();
      expect(encryptedString.to(undefined)).toBeUndefined();
      expect(encryptedString.from(null)).toBeNull();
      expect(encryptedJson.to(null)).toBeNull();
      expect(encryptedJson.from(null)).toBeNull();
    });
  });
});
