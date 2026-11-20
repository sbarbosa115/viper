/**
 * Valid example values for the contract shapes. Contract tests parse them; web MSW handlers and
 * API tests may start from them (`{ ...examples.plan, name: 'x' }`). Invented data only.
 */
import type { Dashboard, Customer } from './reporting.js';
import type { Me } from './identity.js';
import type { PlatformSettings } from './platform.js';
import type { CreditWallet, LedgerEntry, CreditPack } from './billing.js';
import type { Profile, Product } from './profile.js';
import type { Conversation, Message } from './assistant.js';
import type { Plan } from './planning.js';
import type { Flow, RunSummary, StaffRunDetail, StaffRunSummary } from './research.js';
import type { Tool } from './tools.js';
import type { Lead, LeadSummary } from './leads.js';
import type { AuditLogEntry } from './platform.js';

export const ids = {
  business: '0193a1b2-0000-7000-8000-000000000001',
  member: '0193a1b2-0000-7000-8000-000000000002',
  product: '0193a1b2-0000-7000-8000-000000000003',
  plan: '0193a1b2-0000-7000-8000-000000000004',
  segment: '0193a1b2-0000-7000-8000-000000000005',
  run: '0193a1b2-0000-7000-8000-000000000006',
  lead: '0193a1b2-0000-7000-8000-000000000007',
  pack: '0193a1b2-0000-7000-8000-000000000008',
  ledger: '0193a1b2-0000-7000-8000-000000000009',
  conversation: '0193a1b2-0000-7000-8000-00000000000a',
  message: '0193a1b2-0000-7000-8000-00000000000b',
  toolCall: '0193a1b2-0000-7000-8000-00000000000c',
  audit: '0193a1b2-0000-7000-8000-00000000000d',
} as const;

const at = '2026-11-19T10:00:00.000Z';

export const me: Me = {
  member: {
    id: ids.member,
    name: 'Sam',
    email: 'owner@demo.test',
    emailVerified: true,
    isStaff: false,
  },
  business: { id: ids.business, name: 'Sweet Supply Co' },
  actingAs: null,
  twoFactor: { required: false, passed: false, setUp: false },
};

const noSecret = { set: false, last4: null, updatedAt: null };
const someSecret = { set: true, last4: 'a1f3', updatedAt: at };

export const platformSettings: PlatformSettings = {
  ai: {
    anthropicApiKey: someSecret,
    planningModel: 'claude-opus-5-5',
    chatModel: 'claude-sonnet-5-5',
    fastModel: 'claude-haiku-5-5',
  },
  providers: {
    apify: { apiKey: someSecret },
    googleMaps: { apiKey: noSecret },
    firecrawl: { apiKey: noSecret },
    apollo: { apiKey: noSecret },
    hunter: { apiKey: noSecret },
    zerobounce: { apiKey: noSecret },
    twilio: { accountSid: null, authToken: noSecret },
  },
  email: {
    host: 'mailpit',
    port: 1025,
    username: null,
    password: noSecret,
    tls: 'none',
    fromName: 'Llyner Leads',
    fromAddress: 'hello@demo.test',
    replyTo: null,
  },
  stripe: { secretKey: noSecret, webhookSecret: noSecret, taxEnabled: true },
  analytics: { gaMeasurementId: null },
  ceilings: {
    maxCredits: 1000,
    maxLeads: 500,
    maxActiveMinutes: 120,
    maxTotalHours: 4,
    maxAttempts: 5,
    trialCredits: 50,
  },
  landing: { youtubeVideoId: 'dQw4w9WgXcQ' },
  support: { supportEmail: 'support@demo.test' },
};

export const auditLogEntry: AuditLogEntry = {
  id: ids.audit,
  at,
  staff: { id: ids.member, email: 'staff@demo.test' },
  business: { id: ids.business, name: 'Sweet Supply Co' },
  action: 'plan.updated',
  targetType: 'plan',
  targetId: ids.plan,
  details: { fields: ['name'] },
};

export const creditPack: CreditPack = {
  id: ids.pack,
  name: 'Starter',
  credits: 2500,
  priceCents: 2500,
  active: true,
};

export const creditWallet: CreditWallet = {
  balance: 1000,
  reserved: 400,
  available: 600,
  packs: [
    { id: ids.pack, name: 'Starter', credits: 2500, price: { cents: 2500, currency: 'usd' } },
  ],
  paymentsAvailable: true,
};

export const ledgerEntry: LedgerEntry = {
  id: ids.ledger,
  type: 'settlement',
  credits: -137,
  description: 'Run · Bakeries near Austin',
  runId: ids.run,
  createdAt: at,
};

export const product: Product = { id: ids.product, name: 'Cane sugar, 50 lb', description: '' };

export const profile: Profile = {
  businessName: 'Sweet Supply Co',
  description: 'Sugar distributor',
  category: 'Food distributor',
  address: {
    line1: '100 Congress Ave',
    city: 'Austin',
    state: 'TX',
    postalCode: '78701',
    country: 'US',
  },
  location: { lat: 30.2672, lng: -97.7431, label: 'Austin, TX' },
  deliveryRadiusMiles: 3,
  currentCustomers: 'Restaurants',
  priceRange: '$40–$60 per bag',
  website: 'https://sweetsupply.example',
  products: [product],
  complete: true,
};

export const message: Message = {
  id: ids.message,
  role: 'assistant',
  text: 'What do you sell?',
  quickReplies: ['Sugar', 'Flour'],
  createdAt: at,
};

export const conversation: Conversation = {
  id: ids.conversation,
  messages: [message],
  profileComplete: false,
};

export const runSummary: RunSummary = {
  id: ids.run,
  planId: ids.plan,
  flow: { key: 'local-buyers', version: 1 },
  attempt: { current: 1, max: 3 },
  takingLonger: false,
  status: 'completed',
  steps: [
    { key: 'search-terms', name: 'Search terms', status: 'done' },
    { key: 'socials-reviews', name: 'Socials & reviews', status: 'skipped' },
  ],
  startedAt: at,
  finishedAt: at,
  creditsReserved: 400,
  creditsSpent: 137,
  leadsDelivered: 25,
  costPerLead: 5.48,
  budgetReached: false,
  timeReached: false,
  failureReason: null,
};

export const staffRunSummary: StaffRunSummary = {
  ...runSummary,
  business: { id: ids.business, name: 'Sweet Supply Co' },
  planName: 'Bakeries near Austin',
  startedBy: 'owner',
  durationS: 1800,
  providerCostMicros: 420000,
  nextAttemptAt: null,
  resumeFromStep: null,
};

export const staffRunDetail: StaffRunDetail = {
  ...staffRunSummary,
  steps: [
    {
      key: 'websites',
      name: 'Websites',
      status: 'done',
      creditsSpent: 12.5,
      durationS: 300,
      checkpointBytes: 2048,
      error: null,
      toolCalls: [
        {
          id: ids.toolCall,
          toolKey: 'firecrawl.scrape',
          units: 1,
          millicredits: 1500,
          providerCostMicros: 1000,
          status: 'ok',
          error: null,
          durationMs: 850,
          createdAt: at,
          attempt: 2,
          reused: true,
        },
      ],
    },
  ],
  attempts: [
    {
      n: 1,
      startedAt: at,
      endedAt: at,
      outcome: 'worker_stopped',
      from: { stepKey: 'search-terms', item: 0 },
      reached: { stepKey: 'websites', item: 12 },
      error: null,
      handoff: {
        stepKey: 'websites',
        itemsDone: 12,
        itemsLeft: 18,
        notes: 'Most bakeries list emails on their contact page.',
        lastError: null,
        creditsLeft: 250,
        activeSecondsLeft: 2400,
      },
    },
  ],
};

export const plan: Plan = {
  id: ids.plan,
  name: 'Bakeries near Austin',
  goal: 'Bakeries within 3 miles that could buy our cane sugar',
  segments: [
    {
      id: ids.segment,
      name: 'Bakeries',
      fitSignals: ['Bakes on site'],
      exclusions: ['Chains'],
      productId: ids.product,
    },
  ],
  searchArea: { label: 'Austin, TX', lat: 30.2672, lng: -97.7431, radiusMiles: 3 },
  guardrails: { maxCredits: 400, maxLeads: 50, minFitScore: 60 },
  icpEdited: false,
  estimate: { maxCredits: 400, typicalCredits: 240 },
  available: 863,
  lastRun: runSummary,
  leadsCount: 25,
  createdAt: at,
  updatedAt: at,
};

export const flow: Flow = {
  key: 'local-buyers',
  name: 'Local buyers',
  version: 1,
  runSettings: {
    maxActiveMinutes: 60,
    maxTotalHours: 3,
    maxAttempts: 3,
    retryWaitsMinutes: [1, 5, 15],
    workerStoppedAfterMinutes: 2,
    scoreAtBudgetPct: 80,
    scoreAtMinutes: 45,
  },
  planDefaults: { maxCredits: 400, maxLeads: 50, minFitScore: 60 },
  steps: [
    {
      key: 'maps-places',
      name: 'Maps & places',
      tools: ['google.places'],
      budgetPct: 60,
      timeLimitMinutes: 20,
      required: true,
    },
    {
      key: 'score-pitch',
      name: 'Score & pitch',
      tools: ['anthropic.messages'],
      budgetPct: 40,
      timeLimitMinutes: 15,
      required: true,
    },
  ],
  ceilings: platformSettings.ceilings,
};

export const tool: Tool = {
  key: 'google.places',
  name: 'Google Places Text Search',
  provider: 'google',
  unit: 'request',
  providerCostMicrosPerUnit: 32000,
  creditsPerUnit: 8,
  marginPct: 60,
  enabled: true,
  configured: true,
  health: { calls24h: 10, errorRate24h: 0, lastErrorAt: null, lastError: null },
};

export const leadSummary: LeadSummary = {
  id: ids.lead,
  name: 'Sunrise Bakery',
  category: 'Bakery',
  distanceMiles: 1.2,
  fitScore: 85,
  contacts: { phone: true, email: true, website: true, instagram: false, tiktok: false },
  feedback: null,
  runId: ids.run,
  deliveredAt: at,
};

export const lead: Lead = {
  ...leadSummary,
  address: '200 Main St, Austin, TX 78701',
  contacts: [
    {
      type: 'email',
      value: 'hello@sunrise.example',
      label: null,
      verification: 'verified',
      source: { name: 'Website', url: 'https://sunrise.example/contact', retrievedAt: at },
    },
  ],
  evidence: [
    {
      fact: 'Bakes bread on site daily',
      points: 20,
      source: { name: 'Website', url: 'https://sunrise.example', retrievedAt: at },
    },
  ],
  pitch: { productId: ids.product, productName: 'Cane sugar, 50 lb', reason: 'They bake daily.' },
  feedbackReason: null,
  planId: ids.plan,
};

const m = (value: number | null, previous: number | null = null) => ({ value, previous });

export const dashboard: Dashboard = {
  period: '30d',
  customers: {
    total: m(12, 10),
    newSignups: { ...m(2, 1), byDay: [{ date: '2026-11-18', count: 2 }] },
    verified: m(10),
    active: m(4),
    paying: m(1),
    trialToPaidPct: m(null),
  },
  revenue: {
    packRevenue: { value: { cents: 2500, currency: 'usd' }, previous: null },
    creditsGranted: m(500),
    creditsPurchased: m(2500),
    creditsSpent: m(137),
    unspentCredits: m(9000),
  },
  runs: {
    started: m(5),
    completedPct: m(80),
    withinLimitsPct: m(80),
    medianDurationS: m(1800),
    avgCredits: m(137),
    failed: [
      { runId: ids.run, businessName: 'Sweet Supply Co', failureReason: 'PROVIDER_ERROR', at },
    ],
  },
  leads: {
    delivered: m(25),
    goodPct: m(72),
    verifiedPct: m(90),
    providerCostPerLeadCents: m(1.7),
    creditsPerLead: m(5.5),
    grossMarginPct: m(69),
  },
  plans: { noIcpEditPct: m(75) },
  northStar: { goodLeadsPerActiveBusinessPerWeek: m(3.2) },
  providers: [{ toolKey: 'google.places', spendCents: 120, errorRatePct: 0 }],
  topBusinesses: [{ id: ids.business, name: 'Sweet Supply Co', creditsSpent: 137 }],
  latestSignups: [
    { id: ids.business, name: 'Sweet Supply Co', ownerEmail: 'owner@demo.test', createdAt: at },
  ],
};

export const customer: Customer = {
  id: ids.business,
  name: 'Sweet Supply Co',
  ownerEmail: 'owner@demo.test',
  signedUpAt: at,
  verified: true,
  availableCredits: 863,
  runs: 1,
  leadsDelivered: 25,
  lastActiveAt: at,
  paying: false,
  internal: false,
};
