import { ValueTransformer } from 'typeorm';
import { decrypt, encrypt } from './field-encryption';

/** `bytea` column holding an encrypted UTF-8 string. */
export const encryptedString: ValueTransformer = {
  to: (value: string | null | undefined) =>
    value == null ? value : encrypt(Buffer.from(value, 'utf8')),
  from: (value: Buffer | null) =>
    value === null ? null : decrypt(value).toString('utf8'),
};

/** `bytea` column holding an encrypted JSON document. */
export const encryptedJson: ValueTransformer = {
  to: (value: unknown) =>
    value == null ? value : encrypt(Buffer.from(JSON.stringify(value), 'utf8')),
  from: (value: Buffer | null): unknown =>
    value === null ? null : JSON.parse(decrypt(value).toString('utf8')),
};
