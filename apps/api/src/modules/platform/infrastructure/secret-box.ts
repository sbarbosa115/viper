import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { SealedValue, SecretBox } from '../application/ports.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

/**
 * Key for development and tests only, when SETTINGS_ENCRYPTION_KEY is not set. Production
 * refuses to start without a real key (config/env.ts and createSecretBox).
 */
const DEV_KEY = createHash('sha256').update('viper-dev-settings-encryption-key').digest();

/** AES-256-GCM with a random 96-bit IV per value; the field path is bound as additional data. */
export class AesGcmSecretBox implements SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('SETTINGS_ENCRYPTION_KEY must be 32 bytes');
  }

  encrypt(plaintext: string, context: string): SealedValue {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    };
  }

  decrypt(sealed: SealedValue, context: string): string {
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(sealed.iv, 'base64'));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}

export function createSecretBox(config: {
  NODE_ENV: 'development' | 'test' | 'production';
  SETTINGS_ENCRYPTION_KEY?: string | undefined;
}): SecretBox {
  if (config.SETTINGS_ENCRYPTION_KEY) {
    return new AesGcmSecretBox(Buffer.from(config.SETTINGS_ENCRYPTION_KEY, 'base64'));
  }
  if (config.NODE_ENV === 'production') {
    throw new Error('SETTINGS_ENCRYPTION_KEY is required in production');
  }
  return new AesGcmSecretBox(DEV_KEY);
}
