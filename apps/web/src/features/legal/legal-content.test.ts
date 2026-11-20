import { describe, expect, test } from 'vitest';
import { legalDocuments, legalSlugs } from './documents';

describe('FR-33: legal page drafts', () => {
  test.each(legalSlugs)('%s exists with the draft line, date and placeholders', (slug) => {
    const text = legalDocuments[slug];
    expect(text.length).toBeGreaterThan(200);
    expect(text).toContain('Draft for founder review');
    expect(text).toContain('**Last updated:** 2026-11-19');
    expect(text).toContain('[COMPANY NAME]');
    expect(text).toContain('[SUPPORT EMAIL]');
  });

  test('the terms say credits never expire and are not refundable', () => {
    const terms = legalDocuments.terms;
    expect(terms).toMatch(/Credits never expire/);
    expect(terms).toMatch(/not refundable/);
    expect(terms).toContain('Llyner Leads');
    expect(terms).toContain('[STATE]');
  });

  test('the terms cover the CAN-SPAM opt-out and no auto-dialled calls or texts to mobiles', () => {
    const terms = legalDocuments.terms;
    expect(terms).toContain('CAN-SPAM');
    expect(terms).toMatch(/opt-out in every cold email/);
    expect(terms).toContain('TCPA');
    expect(terms).toMatch(/auto-dialled or pre-recorded calls or texts to mobile numbers/);
  });

  test('the privacy policy lists the providers and the California notice', () => {
    const privacy = legalDocuments.privacy;
    for (const word of ['Anthropic', 'Apify', 'Google', 'Stripe', 'DigitalOcean', 'CCPA']) {
      expect(privacy).toContain(word);
    }
  });

  test('the acceptable use policy and cookie notice cover the required points', () => {
    const aup = legalDocuments['acceptable-use'];
    expect(aup).toMatch(/consumers/);
    expect(aup).toMatch(/Resell raw lead data/);
    expect(aup).toMatch(/suspend/);
    const cookies = legalDocuments.cookies;
    expect(cookies).toContain('Session cookie');
    expect(cookies).toContain('Google Analytics');
  });
});
