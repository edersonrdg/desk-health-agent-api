import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  const required = {
    POSTGRES_USER: 'user',
    POSTGRES_PASSWORD: 'secret-password',
    POSTGRES_DB: 'db',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    NATIONAL_ID_HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
  };

  it('applies defaults for hosts and ports', () => {
    expect(validateEnv(required)).toEqual({
      ...required,
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: 5432,
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
    });
  });

  it('coerces ports from strings', () => {
    const env = validateEnv({
      ...required,
      POSTGRES_PORT: '15432',
      REDIS_PORT: '16379',
    });

    expect(env.POSTGRES_PORT).toBe(15432);
    expect(env.REDIS_PORT).toBe(16379);
  });

  it.each([
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
    'ENCRYPTION_KEY',
    'NATIONAL_ID_HMAC_KEY',
  ])('rejects a missing %s', (name) => {
    const env: Record<string, unknown> = { ...required };
    delete env[name];

    expect(() => validateEnv(env)).toThrow(name);
  });

  it('rejects an empty required variable', () => {
    expect(() => validateEnv({ ...required, POSTGRES_DB: '' })).toThrow(
      'POSTGRES_DB',
    );
  });

  it.each([
    ['POSTGRES_PORT', 'abc'],
    ['REDIS_PORT', '70000'],
  ])('rejects an invalid %s', (name, value) => {
    expect(() => validateEnv({ ...required, [name]: value })).toThrow(name);
  });

  it('does not echo received values in the error', () => {
    expect(() =>
      validateEnv({ ...required, POSTGRES_PORT: 'leaked-value' }),
    ).toThrow('POSTGRES_PORT');
    expect(() =>
      validateEnv({ ...required, POSTGRES_PORT: 'leaked-value' }),
    ).not.toThrow('leaked-value');
  });

  it.each([
    ['ENCRYPTION_KEY', Buffer.alloc(16).toString('base64')],
    ['NATIONAL_ID_HMAC_KEY', 'not base64!'],
  ])('rejects a malformed %s', (name, value) => {
    expect(() => validateEnv({ ...required, [name]: value })).toThrow(name);
  });

  it('does not echo a rejected key in the error', () => {
    const shortKey = Buffer.from('short-secret-key').toString('base64');

    expect(() =>
      validateEnv({ ...required, ENCRYPTION_KEY: shortKey }),
    ).not.toThrow(shortKey);
  });
});
