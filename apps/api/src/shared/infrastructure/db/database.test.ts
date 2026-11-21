import { describe, expect, test } from 'vitest';
import { connectionOptions } from './database.js';

const BASE = 'mysql://viper:secret@db.internal:25060/viper';

describe('shared kernel: database URL to mysql2 options', () => {
  test('a plain URL passes through with TLS off', () => {
    const options = connectionOptions(BASE);
    expect(options.uri).toBe(BASE);
    expect(options.ssl).toBeUndefined();
  });

  test("DigitalOcean's ssl-mode=REQUIRED is removed from the URL and turns TLS on", () => {
    const options = connectionOptions(`${BASE}?ssl-mode=REQUIRED`);
    expect(options.uri).toBe(BASE);
    expect(options.ssl).toEqual({ rejectUnauthorized: false });
  });

  test('ssl-mode VERIFY_CA and VERIFY_IDENTITY check the certificate', () => {
    for (const mode of ['VERIFY_CA', 'verify_identity']) {
      expect(connectionOptions(`${BASE}?ssl-mode=${mode}`).ssl).toEqual({
        rejectUnauthorized: true,
      });
    }
  });

  test('ssl-mode DISABLED keeps TLS off; other parameters are kept', () => {
    const options = connectionOptions(`${BASE}?ssl-mode=DISABLED&connectTimeout=5000`);
    expect(options.uri).toBe(`${BASE}?connectTimeout=5000`);
    expect(options.ssl).toBeUndefined();
  });

  test("an explicit mysql2 ssl parameter wins over ssl-mode", () => {
    const ssl = 'ssl=%7B%22rejectUnauthorized%22%3Afalse%7D';
    const options = connectionOptions(`${BASE}?ssl-mode=REQUIRED&${ssl}`);
    expect(options.uri).toBe(`${BASE}?${ssl}`);
    expect(options.ssl).toBeUndefined();
  });

  test('an unknown ssl-mode is an error, not a silent downgrade', () => {
    expect(() => connectionOptions(`${BASE}?ssl-mode=SOMETIMES`)).toThrow('ssl-mode');
  });
});
