import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { initCryptoKeys } from './crypto-keys';

/** Loads the field encryption keys before any entity is read or written. */
@Global()
@Module({})
export class CryptoModule implements OnModuleInit {
  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    initCryptoKeys({
      ENCRYPTION_KEY: this.config.get('ENCRYPTION_KEY', { infer: true }),
      NATIONAL_ID_HMAC_KEY: this.config.get('NATIONAL_ID_HMAC_KEY', {
        infer: true,
      }),
    });
  }
}
