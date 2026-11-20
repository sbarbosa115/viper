import { errorResponse } from '@app/contracts/errors';
import { platformSettings as settingsExample } from '@app/contracts/examples';
import {
  platformSettings,
  settingsSection,
  settingsSectionInputs,
  settingsSections,
  testSettings,
  type PlatformSettings,
} from '@app/contracts/platform';
import { http, HttpResponse } from 'msw';

export interface SettingsState {
  settings: PlatformSettings;
  /** Every accepted save: the section and the exact body the form sent. */
  saved: { section: string; body: unknown }[];
  tests: { target: string; to?: string | undefined }[];
  testResult: { ok: boolean; message: string };
  /** Make the next saves fail with these field errors (400). */
  fieldErrors: Record<string, string> | null;
}

export const settingsState: SettingsState = {
  settings: settingsExample,
  saved: [],
  tests: [],
  testResult: { ok: true, message: 'Connected' },
  fieldErrors: null,
};

export function resetSettingsState() {
  settingsState.settings = structuredClone(settingsExample);
  settingsState.saved = [];
  settingsState.tests = [];
  settingsState.testResult = { ok: true, message: 'Connected' };
  settingsState.fieldErrors = null;
}

const isSecret = (
  v: unknown,
): v is { set: boolean; last4: string | null; updatedAt: string | null } =>
  typeof v === 'object' && v !== null && 'set' in v && 'last4' in v;

/** Applies a save the way the API does: string replaces a secret, "" clears it, omitted keeps it. */
function merge(current: unknown, body: unknown): unknown {
  if (isSecret(current)) {
    if (typeof body !== 'string') return current;
    if (body === '') return { set: false, last4: null, updatedAt: null };
    return { set: true, last4: body.slice(-4), updatedAt: '2026-11-19T12:00:00.000Z' };
  }
  if (
    typeof current === 'object' &&
    current !== null &&
    typeof body === 'object' &&
    body !== null
  ) {
    const out: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(body))
      out[k] = merge((current as Record<string, unknown>)[k], v);
    return out;
  }
  return body;
}

export const handlers = [
  http.get('*/api/staff/settings', () =>
    HttpResponse.json(platformSettings.parse(settingsState.settings)),
  ),

  http.put('*/api/staff/settings/:section', async ({ params, request }) => {
    const section = settingsSection.parse(params.section);
    const body: unknown = await request.json();
    const parsed = settingsSectionInputs[section].safeParse(body);
    const fields =
      settingsState.fieldErrors ??
      (parsed.success
        ? null
        : Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
    if (fields) {
      return HttpResponse.json(
        errorResponse.parse({ error: { code: 'VALIDATION_ERROR', message: 'Invalid', fields } }),
        { status: 400 },
      );
    }
    settingsState.saved.push({ section, body });
    const next = merge(settingsState.settings[section], body);
    settingsState.settings = { ...settingsState.settings, [section]: next };
    return HttpResponse.json(settingsSections[section].parse(next));
  }),

  http.post('*/api/staff/settings/test', async ({ request }) => {
    const parsed = testSettings.body.safeParse(await request.json());
    if (!parsed.success) {
      return HttpResponse.json(
        errorResponse.parse({ error: { code: 'VALIDATION_ERROR', message: 'Invalid' } }),
        { status: 400 },
      );
    }
    settingsState.tests.push(parsed.data);
    return HttpResponse.json(testSettings.response.parse(settingsState.testResult));
  }),
];
