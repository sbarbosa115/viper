/**
 * Customer-facing strings of the public site (FR-33 to FR-35). Product name: "Llyner Leads".
 * The landing copy lives in the repo (PRD section 13); the video ID and support email are
 * Platform settings.
 */
export const siteCopy = {
  product: 'Llyner Leads',
  skipToContent: 'Skip to content',
  nav: {
    label: 'Main',
    how: 'How it works',
    features: 'Features',
    pricing: 'Pricing',
    faq: 'FAQ',
    logIn: 'Log in',
    startFree: 'Start free',
    openApp: 'Open the app',
    menu: 'Open menu',
  },
  meta: {
    title: 'Llyner Leads: find local B2B buyers with verified contacts',
    description:
      'Tell us what you sell. Llyner Leads researches maps, websites and social profiles and delivers verified local buyers, why each one fits, and what to pitch.',
    shareImageAlt: 'Llyner Leads: find the businesses most likely to buy what you sell.',
  },
  hero: {
    overline: 'Prospecting for local B2B sellers',
    headline: 'Find the businesses most likely to buy what you sell.',
    lede: 'Tell us what you sell in a short chat. Our research agent searches maps, websites and social profiles, then hands you verified local buyers, the reason each one fits, and what to pitch.',
    perks: ['50 free credits', 'No subscription', 'Verified emails and phones'],
  },
  video: {
    play: 'Play the product video',
    caption: 'See how Llyner Leads finds your next customers',
    title: 'Llyner Leads product video',
    description:
      'How Llyner Leads turns a short chat about your business into a list of verified local buyers.',
  },
  card: {
    tabsLabel: 'Account',
    signupTab: 'Create account',
    loginTab: 'Log in',
    signupTitle: 'Start with 50 free credits',
    signupSubtitle: 'Enough for your first leads. No card needed.',
    loginTitle: 'Welcome back',
    loginSubtitle: 'Log in to see your Plans and Leads.',
    businessName: 'Business name',
    name: 'Your name',
    workEmail: 'Work email',
    email: 'Email',
    password: 'Password',
    passwordHint: 'At least 10 characters',
    createAccount: 'Create account',
    creatingAccount: 'Creating account…',
    logIn: 'Log in',
    loggingIn: 'Logging in…',
    forgotPassword: 'Forgot password?',
    legalPrefix: 'By signing up you agree to the',
    terms: 'Terms of Service',
    and: 'and',
    privacy: 'Privacy Policy',
    signedInTitle: "You're signed in",
    signedInSubtitle: 'Pick up where you left off: your chat, Plans and Leads are in the app.',
    openApp: 'Open the app',
  },
  errors: {
    businessName: 'Enter your business name (2 to 120 characters).',
    name: 'Enter your name (up to 80 characters).',
    email: 'Enter a valid email address.',
    password: 'Use at least 10 characters (up to 128).',
    loginPassword: 'Enter your password.',
    emailTaken: 'You already have an account. Log in instead.',
    invalidCredentials: 'Wrong email or password.',
    signupTooMany: 'Too many sign-up attempts from your network. Try again in an hour.',
    loginTooMany: 'Too many attempts, try again in 15 minutes.',
    forbidden: 'This form must be sent from the Llyner Leads site. Reload the page and try again.',
    generic: 'Something went wrong. Try again in a moment.',
  },
  how: {
    overline: 'How it works',
    title: 'From a short chat to a list you can call today',
    steps: [
      {
        title: 'Describe your business',
        body: 'What you sell, where you are, how far you deliver. Two minutes in a chat.',
      },
      {
        title: 'Set a goal',
        body: '"Bakeries within 3 miles that could buy our cane sugar." We turn it into a plan you can adjust.',
      },
      {
        title: 'Get verified leads',
        body: 'Our agent researches in the background and emails you when your leads are ready.',
      },
    ],
  },
  features: {
    overline: 'Features',
    title: 'Every lead comes with the reason it fits',
    items: [
      {
        title: 'Fit score with evidence',
        body: 'A 0–100 score built from facts you can check, each linked to where we found it.',
      },
      {
        title: 'Verified contacts',
        body: 'Emails checked for delivery and phones checked for line type before you see them.',
      },
      {
        title: 'A pitch for each lead',
        body: 'Which of your products to offer and why, based on what they make or serve.',
      },
      {
        title: 'Local by design',
        body: 'Search within 1 to 25 miles of you, across maps, websites, Yelp and Instagram.',
      },
      {
        title: 'Export to CSV',
        body: 'Take your list to a spreadsheet or CRM in one click.',
      },
      {
        title: 'Pay per research run',
        body: 'You see the budget before a run starts and the real cost per lead after.',
      },
    ],
  },
  sample: {
    overline: 'What you get',
    title: 'A lead you can act on, not just a name',
    body: 'This is an example lead for a sugar distributor in Austin. Every fact shows its source and the points it adds to the score.',
    cardLabel: 'Example lead',
    name: 'Sweet Crumbs Bakery',
    meta: 'Bakery · 1.2 mi · E 6th St, Austin',
    score: 92,
    scoreLabel: 'Fit score 92',
    contacts: [
      { text: '(512) 555-0142', verified: true },
      { text: 'orders@sweetcrumbs.example', verified: true },
      { text: '@sweetcrumbsatx', verified: false },
      { text: 'sweetcrumbs.example', verified: false },
    ],
    verified: 'verified',
    evidence: [
      { text: 'Bakes cakes and pastries on site daily', points: 30 },
      { text: 'Menu lists 14 sugar-heavy items', points: 22 },
      { text: 'Open 6 days, 4.7 stars from 310 reviews', points: 15 },
    ],
    sources: 'Sources: website, Google Maps, Yelp · checked Nov 18',
    pitchLead: 'Pitch: cane sugar, 50 lb bag.',
    pitch: 'They bake from scratch daily and buy in volume; offer weekly delivery.',
  },
  pricing: {
    overline: 'Pricing',
    title: 'Buy credits once. Use them when you need leads.',
    body: 'Start with 50 free credits. Each research run is charged what it really used. Credits never expire.',
    credits: 'credits',
    bonus: '{n}% bonus',
    startFree: 'Start free',
    buyCredits: 'Buy credits',
    notes:
      'Sales tax added at checkout where it applies. Credits never expire and are not refundable.',
    empty: 'Credit packs will be listed here soon. Start with 50 free credits today.',
    /** Short lines for the seeded packs; other packs show none. */
    blurbs: {
      Starter: 'Try a few plans in your area.',
      Growth: 'Weekly research for one market.',
      Pro: 'Several markets and product lines.',
    } as Record<string, string>,
    freeOffer: 'Free trial',
    freeOfferDescription: '50 free credits',
  },
  faq: {
    overline: 'FAQ',
    title: 'Questions sellers ask first',
    items: [
      {
        q: 'Where does the data come from?',
        a: 'Public business information: Google Maps, OpenStreetMap, business websites, Yelp and Instagram, plus email and phone verification services. Every fact shows its source.',
      },
      {
        q: 'How much does a lead cost?',
        a: 'It depends on how hard the businesses are to research. You set a budget before each run and see the real cost per lead when it finishes.',
      },
      {
        q: 'What if a run finds nothing?',
        a: "If a run fails on our side and delivers no leads, you aren't charged.",
      },
      {
        q: 'Do credits expire? Can I get a refund?',
        a: 'Credits never expire. Purchases are not refundable; credits can be spent on any research run.',
      },
      {
        q: 'Do you send emails to the leads for me?',
        a: 'No. You get the list and decide how to reach out. Follow the rules for cold email and calls in our Terms.',
      },
    ],
  },
  cta: {
    title: 'Your next customers are already nearby.',
    body: 'Describe your business and get your first leads with 50 free credits.',
    button: 'Create your free account',
  },
  footer: {
    label: 'Legal',
    copyright: '© {year} Llyner Leads',
    terms: 'Terms',
    privacy: 'Privacy',
    acceptableUse: 'Acceptable Use',
    cookies: 'Cookies',
  },
  legal: {
    navLabel: 'Legal pages',
    overline: 'Legal',
    draft: 'Draft for founder review',
    lastUpdated: 'Last updated {date}',
    titles: {
      terms: 'Terms of Service',
      privacy: 'Privacy Policy',
      'acceptable-use': 'Acceptable Use',
      cookies: 'Cookie notice',
    },
    descriptions: {
      terms:
        'The terms for using Llyner Leads: accounts, prepaid credits that never expire and are not refundable, contacting leads, and our liability.',
      privacy:
        'What Llyner Leads collects, the public business data we research, who we share data with, and your rights, including the California notice.',
      'acceptable-use':
        'How you may use Llyner Leads: business customers only, no spam or harassment, and no resale of raw lead data.',
      cookies:
        'The cookies Llyner Leads uses: the session cookie, and Google Analytics when enabled.',
    },
  },
} as const;

/** Fills `{name}` placeholders. */
export function fill(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
