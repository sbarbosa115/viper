import type { LlmRequest, LlmResponse } from '../../application/llm-client.js';

/*
 * Fake-mode answers for the welcome chat (TOOLS_MODE=fake), so the live demo and e2e journeys
 * work without an Anthropic key. It reads the markers the assistant's prompts (v1) put in the
 * system prompt: "Question just asked: <topic>" (extraction), "Next question: <topic>",
 * "Suggested goals:" and "Place candidates:" lists (reply). assistant's fake-mode test walks the
 * whole conversation, so a prompt change that breaks these markers fails there.
 */

const EXTRACT_TOOL = 'record_profile_updates';
const REPLY_TOOL = 'write_reply';

function marker(system: string, name: string): string | null {
  const match = new RegExp(`^${name}: *(\\S+)`, 'm').exec(system);
  return match?.[1] ?? null;
}

function list(system: string, heading: string): string[] {
  const start = system.indexOf(`${heading}:\n`);
  if (start < 0) return [];
  const lines = system.slice(start + heading.length + 2).split('\n');
  const items: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('- ')) break;
    items.push(line.slice(2).trim());
  }
  return items;
}

const SUGARS = [
  { key: 'cane', name: 'Cane sugar, 50 lb bag' },
  { key: 'powdered', name: 'Powdered sugar, 25 lb bag' },
  { key: 'brown', name: 'Brown sugar, 50 lb bag' },
] as const;

function sugarProducts(text: string): { name: string; description: string }[] {
  const lower = text.toLowerCase();
  const named = SUGARS.filter((s) => lower.includes(s.key)).map((s) => ({
    name: s.name,
    description: '',
  }));
  return named.length > 0 ? named : [{ name: 'Sugar', description: '' }];
}

/** The fast model's structured profile updates, from the last user message and the topic. */
function extract(request: LlmRequest): Partial<LlmResponse> {
  const topic = marker(request.system, 'Question just asked');
  const text = request.messages.at(-1)?.content.trim() ?? '';
  const lower = text.toLowerCase();
  const input: Record<string, unknown> = {};

  if (lower.includes('sugar')) input.products = sugarProducts(text);
  else if (topic === 'products') input.products = [{ name: text.slice(0, 120), description: '' }];

  const looksLikePlace = /\baustin\b|\b(st|street|ave|avenue|rd|road|blvd)\b|,\s*[a-z]{2}\b/.test(
    lower,
  );
  if (topic === 'location' || topic === 'locationConfirm' || (looksLikePlace && topic !== 'goal')) {
    input.locationQuery = text;
    if (/\baustin\b/.test(lower)) Object.assign(input, { city: 'Austin', state: 'TX' });
  }

  const miles = /(\d+(?:\.\d+)?)\s*(?:mi\b|miles?)/.exec(lower);
  const bare = /^(\d+(?:\.\d+)?)$/.exec(lower);
  if (miles && topic !== 'goal') input.deliveryRadiusMiles = Number(miles[1]);
  else if (bare && topic === 'radius') input.deliveryRadiusMiles = Number(bare[1]);

  if (topic === 'currentCustomers') input.currentCustomers = text.slice(0, 500);
  if (topic === 'priceRange') input.priceRange = text.slice(0, 120);
  const url = /https?:\/\/\S+/.exec(text);
  if (url) input.website = url[0];
  if (topic === 'goal' && text.length >= 5) input.goal = text.slice(0, 500);

  return { toolCall: { name: EXTRACT_TOOL, input }, model: 'fake' };
}

const QUESTIONS: Record<string, { text: string; quickReplies: string[] }> = {
  products: {
    text: "Hi! Let's set up your business profile. What do you sell?",
    quickReplies: ['Cane sugar and powdered sugar'],
  },
  location: {
    text: 'Got it. Where are you located? An address or a city is fine.',
    quickReplies: ['Austin, TX'],
  },
  locationConfirm: {
    text: 'I found a few places with that name. Which one is yours?',
    quickReplies: [],
  },
  radius: {
    text: 'How far do you deliver?',
    quickReplies: ['3 miles', '10 miles', '25 miles'],
  },
  currentCustomers: {
    text: 'Who buys from you today?',
    quickReplies: ['Restaurants', 'Bakeries', 'Coffee shops'],
  },
  priceRange: { text: "What's your typical price range?", quickReplies: [] },
  website: { text: "What's your website? You can skip this.", quickReplies: ['Skip'] },
  goal: { text: 'Your profile is complete. Who would you like to find?', quickReplies: [] },
  planCreated: { text: "Your plan is ready. I've opened it for you.", quickReplies: [] },
};

/** The chat model's reply for the next question the assistant chose. */
function reply(request: LlmRequest): Partial<LlmResponse> {
  const topic = marker(request.system, 'Next question') ?? 'products';
  const base = QUESTIONS[topic] ?? {
    text: 'Tell me a bit more about your business.',
    quickReplies: [],
  };
  const quickReplies =
    topic === 'goal'
      ? list(request.system, 'Suggested goals')
      : topic === 'locationConfirm'
        ? list(request.system, 'Place candidates')
        : base.quickReplies;
  return {
    toolCall: {
      name: REPLY_TOOL,
      input: { text: base.text, quickReplies: quickReplies.slice(0, 4) },
    },
    model: 'fake',
  };
}

/** Fake mode for every LLM purpose; the welcome chat walks a sugar distributor's answers. */
export function fakeWelcomeChat(request: LlmRequest): Partial<LlmResponse> {
  if (request.purpose === 'assistant.extract') return extract(request);
  if (request.purpose === 'assistant.reply') return reply(request);
  return { text: 'OK', model: 'fake' };
}
