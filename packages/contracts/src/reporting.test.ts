import { describe, expect, test } from 'vitest';
import * as ex from './examples.js';
import { getDashboard, listCustomers, updateCustomer } from './reporting.js';
import { siteLogin, siteSignup } from './site.js';

describe('contracts: reporting', () => {
  test('FR-30: dashboard period defaults to 30d; numbers may be null', () => {
    expect(getDashboard.query.parse({}).period).toBe('30d');
    expect(getDashboard.query.safeParse({ period: '1y' }).success).toBe(false);
    expect(getDashboard.response.parse(ex.dashboard)).toEqual(ex.dashboard);
    const noPrevious = { ...ex.dashboard, plans: { noIcpEditPct: { value: 1 } } };
    expect(getDashboard.response.safeParse(noPrevious).success).toBe(false);
  });

  test('FR-31: customer list and internal flag', () => {
    expect(listCustomers.query.parse({ q: 'bakery' })).toMatchObject({
      q: 'bakery',
      sort: 'signedUp',
      limit: 50,
    });
    expect(listCustomers.query.safeParse({ sort: 'name' }).success).toBe(false);
    expect(
      listCustomers.response.safeParse({ items: [ex.customer], nextCursor: null }).success,
    ).toBe(true);
    expect(updateCustomer.body.safeParse({ internal: true }).success).toBe(true);
    expect(updateCustomer.body.safeParse({ internal: 'yes' }).success).toBe(false);
  });
});

describe('contracts: site', () => {
  test('FR-35: the landing card forms reuse the sign-up and log-in bodies', () => {
    expect(siteSignup.formBody).toBe(true);
    expect(
      siteSignup.body.safeParse({
        businessName: 'Sweet',
        name: 'Sam',
        email: 'a@b.co',
        password: '0123456789',
      }).success,
    ).toBe(true);
    expect(siteLogin.body.safeParse({ email: 'a@b.co' }).success).toBe(false);
  });
});
