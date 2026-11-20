import { describe, expect, test } from 'vitest';
import { getWelcomeConversation, sendMessage } from './assistant.js';
import * as ex from './examples.js';
import { createProduct, deleteProduct, getProfile, updateProfile } from './profile.js';

const { products: _p, location: _l, complete: _c, ...profileInput } = ex.profile;

describe('contracts: profile', () => {
  test('FR-15: profile shape', () => {
    expect(getProfile.response.parse(ex.profile)).toEqual(ex.profile);
    expect(
      getProfile.response.safeParse({
        ...ex.profile,
        address: { ...ex.profile.address, country: 'CA' },
      }).success,
    ).toBe(false);
  });

  test('FR-15: profile edit limits', () => {
    expect(updateProfile.body.safeParse(profileInput).success).toBe(true);
    const far = updateProfile.body.safeParse({ ...profileInput, deliveryRadiusMiles: 101 });
    expect(far.error?.issues[0]?.path).toEqual(['deliveryRadiusMiles']);
    expect(updateProfile.body.safeParse({ ...profileInput, website: 'not a url' }).success).toBe(
      false,
    );
  });

  test('FR-15: products', () => {
    expect(createProduct.body.parse({ name: 'Powdered sugar, 25 lb' }).description).toBe('');
    expect(createProduct.body.safeParse({ name: '' }).success).toBe(false);
    expect(createProduct.response.safeParse(ex.product).success).toBe(true);
    expect(deleteProduct.errors).toContainEqual({ status: 409, code: 'PRODUCT_IN_USE' });
  });
});

describe('contracts: assistant', () => {
  test('FR-14: welcome conversation', () => {
    expect(getWelcomeConversation.response.safeParse(ex.conversation).success).toBe(true);
    const tooMany = { ...ex.message, quickReplies: ['a', 'b', 'c', 'd', 'e'] };
    expect(
      getWelcomeConversation.response.safeParse({ ...ex.conversation, messages: [tooMany] })
        .success,
    ).toBe(false);
  });

  test('FR-14: send a message (1–2,000 chars), retry by message id', () => {
    expect(sendMessage.body.safeParse({ text: 'We sell sugar' }).success).toBe(true);
    expect(
      sendMessage.body.safeParse({ text: 'again', retryOfMessageId: ex.ids.message }).success,
    ).toBe(true);
    expect(sendMessage.body.safeParse({ text: '' }).success).toBe(false);
    expect(sendMessage.body.safeParse({ text: 'x'.repeat(2001) }).success).toBe(false);
    const reply = {
      messages: [ex.message],
      profile: ex.profile,
      profileComplete: true,
      planId: ex.ids.plan,
    };
    expect(sendMessage.response.safeParse(reply).success).toBe(true);
    expect(sendMessage.response.safeParse({ ...reply, planId: undefined }).success).toBe(false);
    expect(sendMessage.errors).toContainEqual({ status: 503, code: 'ASSISTANT_UNAVAILABLE' });
  });
});
