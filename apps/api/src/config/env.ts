import { z } from 'zod';

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'must be 32 bytes, base64 encoded');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
    SETTINGS_ENCRYPTION_KEY: base64Key32.optional(),
    APP_URL: z.url().default('http://localhost:5173'),
    SENTRY_DSN: z.string().optional(),
    TOOLS_MODE: z.enum(['live', 'fake']).default('live'),
    /**
     * Proxy hops in front of the api whose `X-Forwarded-For` entries are trusted (1: App
     * Platform's edge, or Vite's proxy locally). Unset means 1. Never trust every hop: the
     * left-most entry is whatever the client sent.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),
    /**
     * A header the edge sets with the client's address and overwrites when a client sends it
     * (`x-real-ip` from Traefik in production). Preferred over `X-Forwarded-For` when present.
     */
    CLIENT_IP_HEADER: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9-]+$/, 'must be a header name')
      .optional(),
    /** Test-only routes (e.g. the fake Stripe completion used by e2e). Never in production. */
    ENABLE_TEST_HOOKS: z.stringbool().default(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.ENABLE_TEST_HOOKS) {
      ctx.addIssue({
        code: 'custom',
        message: 'ENABLE_TEST_HOOKS is not allowed in production',
        path: ['ENABLE_TEST_HOOKS'],
      });
    }
    if (env.NODE_ENV === 'production' && env.TOOLS_MODE === 'fake') {
      ctx.addIssue({
        code: 'custom',
        path: ['TOOLS_MODE'],
        message: 'fake is forbidden in production',
      });
    }
    if (env.NODE_ENV === 'production' && !env.SETTINGS_ENCRYPTION_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['SETTINGS_ENCRYPTION_KEY'],
        message: 'required in production',
      });
    }
  });

export type Config = z.infer<typeof schema>;

/** Parsed only in main.ts / worker.ts / scripts; everything else receives a Config. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return parsed.data;
}
