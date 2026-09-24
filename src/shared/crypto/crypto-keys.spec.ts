import { getCryptoKeys, initCryptoKeys } from './crypto-keys';

describe('crypto keys', () => {
  it('throws before the keys are initialized', () => {
    expect(() => getCryptoKeys()).toThrow('not initialized');
  });

  it('decodes the base64 keys', () => {
    initCryptoKeys({
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      NATIONAL_ID_HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
    });

    expect(getCryptoKeys()).toEqual({
      encryptionKey: Buffer.alloc(32, 1),
      nationalIdHmacKey: Buffer.alloc(32, 2),
    });
  });
});
