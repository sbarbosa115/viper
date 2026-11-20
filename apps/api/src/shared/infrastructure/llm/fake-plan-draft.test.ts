import { describe, expect, test } from 'vitest';
import { LlmPlanDrafter } from '../../../modules/planning/infrastructure/llm-plan-drafter.js';
import { fakePlanDraft } from './fake-plan-draft.js';
import { fakeWelcomeChat } from './fake-welcome-chat.js';
import { ScriptedLlmClient } from './scripted-llm-client.js';

const profile = {
  complete: true,
  location: { label: '1200 E 6th St, Austin, TX 78702', lat: 30.2624, lng: -97.7262 },
  deliveryRadiusMiles: 3,
  products: [
    { id: 'p-powdered', name: 'Powdered sugar, 25 lb bag', description: '' },
    { id: 'p-cane', name: 'Cane sugar, 50 lb bag', description: '' },
  ],
};

// The fake reads the drafter's real prompt, so a prompt change that breaks it fails here.
const drafter = new LlmPlanDrafter(
  new ScriptedLlmClient((r) =>
    r.purpose === 'planning.draft' ? fakePlanDraft(r) : fakeWelcomeChat(r),
  ),
);

describe('fake mode: planning draft', () => {
  test('a Goal with a segment, a distance and a Product becomes a one-segment draft', async () => {
    const draft = await drafter.draft({
      goal: 'Bakeries within 3 miles that could buy our cane sugar',
      profile,
    });
    expect(draft).toEqual({
      name: 'Bakeries near Austin',
      segments: [
        {
          name: 'Bakeries',
          fitSignals: [
            'Bakes on site',
            'Sells bread or pastries daily',
            'Independent, not a chain',
          ],
          exclusions: ['Chain bakeries', 'Grocery store bakeries'],
          productId: 'p-cane',
        },
      ],
      place: null,
      radiusMiles: 3,
    });
  });

  test('another place and no distance: place set, radius left to the profile', async () => {
    const draft = await drafter.draft({ goal: 'Restaurants near Fredericksburg', profile });
    expect(draft.name).toBe('Restaurants near Fredericksburg');
    expect(draft.place).toBe('Fredericksburg');
    expect(draft.radiusMiles).toBeNull();
    expect(draft.segments[0]?.productId).toBe('p-powdered');
  });
});
