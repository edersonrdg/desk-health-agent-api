import { extname, join } from 'node:path';
import { DataSource } from 'typeorm';
import { validateEnv } from '../../config/env.schema';
import { initCryptoKeys } from '../crypto/crypto-keys';
import { buildDataSourceOptions } from './database.options';

/**
 * DataSource for the TypeORM CLI (`npm run migration:*`). The Nest app uses
 * DatabaseModule instead; both share buildDataSourceOptions.
 */
try {
  // Doesn't override variables already set in the environment.
  process.loadEnvFile();
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

const env = validateEnv(process.env);
initCryptoKeys(env);

export default new DataSource({
  ...buildDataSourceOptions(env),
  // `.ts` under ts-node, `.js` in dist/ (skips the emitted `.d.ts` files).
  migrations: [join(__dirname, 'migrations', `*${extname(__filename)}`)],
});
