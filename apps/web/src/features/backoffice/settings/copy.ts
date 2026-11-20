import type { SettingsSection } from '@app/contracts/platform';

/** Staff-facing strings of the settings page (FR-8). */
export const copy = {
  title: 'Settings',
  intro:
    'Keys are stored encrypted and never shown again after saving. Every change is recorded in the Audit log.',
  sectionsNav: 'Settings sections',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved',
  saveFailed: 'We could not save this section. Try again.',
  replace: 'Replace',
  addKey: 'Add key',
  remove: 'Remove',
  cancel: 'Cancel',
  notSet: 'Not set',
  set: 'Set',
  updated: 'updated',
  willClear: 'Will be removed when you save',
  newValue: 'new value',
  test: 'Test',
  testing: 'Testing…',
  testFailedToRun: 'The test could not run. Try again.',
  testHint: 'Test checks the saved keys. Save first to test a new one.',
  smtpTo: 'Send test email to',
  smtpTest: 'Send test email',
  required: 'Required',
  invalid: 'Check this value',
  loadFailedTitle: 'Settings did not load',
} as const;

export const sectionTitles: Record<SettingsSection, string> = {
  ai: 'AI models',
  providers: 'Data providers',
  email: 'Email (SMTP)',
  stripe: 'Stripe',
  analytics: 'Analytics',
  ceilings: 'Ceilings for all flows',
  landing: 'Landing page',
  support: 'Support',
};

export const sectionOrder: SettingsSection[] = [
  'ai',
  'providers',
  'email',
  'stripe',
  'analytics',
  'landing',
  'ceilings',
  'support',
];
