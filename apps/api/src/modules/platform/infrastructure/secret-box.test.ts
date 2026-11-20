import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { AesGcmSecretBox, createSecretBox } from './secret-box.js';

const key = randomBytes(32);

describe('FR-8 / NFR-4: SecretBox (AES-256-GCM)', () => {
  test('round-trips a secret and the ciphertext does not contain it', () => {
    const box = new AesGcmSecretBox(key);
    const sealed = box.encrypt('sk-ant-secret-value', 'ai.anthropicApiKey');
    expect(Buffer.from(sealed.ciphertext, 'base64').toString('utf8')).not.toContain('sk-ant');
    expect(JSON.stringify(sealed)).not.toContain('sk-ant-secret-value');
    expect(box.decrypt(sealed, 'ai.anthropicApiKey')).toBe('sk-ant-secret-value');
  });

  test('a fresh IV makes every encryption different', () => {
    const box = new AesGcmSecretBox(key);
    expect(box.encrypt('same', 'x').ciphertext).not.toBe(box.encrypt('same', 'x').ciphertext);
  });

  test('decrypting under another field path fails (bound as additional data)', () => {
    const box = new AesGcmSecretBox(key);
    const sealed = box.encrypt('value', 'email.password');
    expect(() => box.decrypt(sealed, 'ai.anthropicApiKey')).toThrow();
  });

  test('tampered ciphertext or another key fails', () => {
    const box = new AesGcmSecretBox(key);
    const sealed = box.encrypt('value', 'ctx');
    const flipped = Buffer.from(sealed.ciphertext, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() =>
      box.decrypt({ ...sealed, ciphertext: flipped.toString('base64') }, 'ctx'),
    ).toThrow();
    expect(() => new AesGcmSecretBox(randomBytes(32)).decrypt(sealed, 'ctx')).toThrow();
  });

  test('uses SETTINGS_ENCRYPTION_KEY (base64, 32 bytes) when set', () => {
    const configured = createSecretBox({
      NODE_ENV: 'production',
      SETTINGS_ENCRYPTION_KEY: key.toString('base64'),
    });
    const sealed = configured.encrypt('v', 'c');
    expect(new AesGcmSecretBox(key).decrypt(sealed, 'c')).toBe('v');
  });

  test('a dev key is allowed outside production only', () => {
    expect(() => createSecretBox({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => createSecretBox({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => createSecretBox({ NODE_ENV: 'production' })).toThrow(/required in production/);
  });

  test('rejects a key that is not 32 bytes', () => {
    expect(() => new AesGcmSecretBox(randomBytes(16))).toThrow();
  });
});
