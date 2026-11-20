import type { Features } from '../../application/features.js';

/** `isEnabled('billing')` reads FEATURE_BILLING from the given environment. */
export class EnvFeatures implements Features {
  constructor(private readonly env: Readonly<Record<string, string | undefined>>) {}
  isEnabled(name: string): boolean {
    const raw = this.env[`FEATURE_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
    return raw === '1' || raw?.toLowerCase() === 'true';
  }
}

export class StaticFeatures implements Features {
  constructor(private readonly enabled: readonly string[] = []) {}
  isEnabled(name: string): boolean {
    return this.enabled.includes(name);
  }
}
