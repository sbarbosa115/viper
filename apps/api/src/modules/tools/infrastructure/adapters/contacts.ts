import type { Clock } from '../../../../shared/domain/clock.js';
import type { ProviderSettings } from '../../application/ports.js';
import { registerAdapter } from './register.js';
import { type RegisteredAdapter } from '../../application/tool-adapter.js';
import {
  domainSearchInput,
  domainSearchOutput,
  organizationInput,
  organizationOutput,
  personInput,
  personOutput,
  type DomainSearchOutput,
} from '../tool-io.js';
import { TOOL_KEYS } from '../../domain/tool-keys.js';
import { requestJson, requireKey, type Fetch } from './http.js';

export const APOLLO_ORG_URL = 'https://api.apollo.io/api/v1/organizations/enrich';
export const APOLLO_PEOPLE_URL = 'https://api.apollo.io/api/v1/people/match';
export const HUNTER_URL = 'https://api.hunter.io/v2/domain-search';

interface Deps {
  settings: ProviderSettings;
  clock: Clock;
  fetch?: Fetch;
}

type Item = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
const obj = (v: unknown): Item => (typeof v === 'object' && v !== null ? (v as Item) : {});

/** Apollo organization enrichment by domain (1 request). */
export function apolloOrganizationAdapter(deps: Deps): RegisteredAdapter {
  const fetchFn = deps.fetch ?? fetch;
  return registerAdapter({
    key: TOOL_KEYS.apolloOrganization,
    requires: 'apollo',
    input: organizationInput,
    output: organizationOutput,
    maxUnits: () => 1,
    async run(input: { domain: string }) {
      const apiKey = requireKey((await deps.settings.provider('apollo')).apiKey, 'Apollo');
      const body = obj(
        await requestJson(
          fetchFn,
          'Apollo',
          `${APOLLO_ORG_URL}?domain=${encodeURIComponent(input.domain)}`,
          {
            headers: {
              'x-api-key': apiKey,
              Accept: 'application/json',
              'Cache-Control': 'no-cache',
            },
          },
        ),
      );
      const o = body.organization ? obj(body.organization) : null;
      const name = o ? str(o.name) : null;
      const url = o ? str(o.website_url) : null;
      return {
        output: {
          organization:
            o && name
              ? {
                  name,
                  domain: str(o.primary_domain),
                  website: url,
                  phone: str(obj(o.primary_phone).number) ?? str(o.phone),
                  industry: str(o.industry),
                  employees: int(o.estimated_num_employees),
                  description: str(o.short_description),
                  city: str(o.city),
                  state: str(o.state),
                  linkedinUrl: str(o.linkedin_url),
                  facebookUrl: str(o.facebook_url),
                }
              : null,
          source: { name: 'Apollo', url, retrievedAt: deps.clock.now().toISOString() },
        },
        units: 1,
      };
    },
  });
}

interface PersonParsed {
  domain: string;
  name?: string | undefined;
  firstName?: string | undefined;
  lastName?: string | undefined;
  title?: string | undefined;
}

/**
 * Apollo people enrichment (people/match): a named person or role at a business domain. Asks for
 * work emails only (`reveal_personal_emails: false`, ADR 0007).
 */
export function apolloPeopleAdapter(deps: Deps): RegisteredAdapter {
  const fetchFn = deps.fetch ?? fetch;
  return registerAdapter({
    key: TOOL_KEYS.apolloPeople,
    requires: 'apollo',
    input: personInput,
    output: personOutput,
    maxUnits: () => 1,
    async run(input: PersonParsed) {
      const apiKey = requireKey((await deps.settings.provider('apollo')).apiKey, 'Apollo');
      const body = obj(
        await requestJson(fetchFn, 'Apollo', APOLLO_PEOPLE_URL, {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            domain: input.domain,
            ...(input.name ? { name: input.name } : {}),
            ...(input.firstName ? { first_name: input.firstName } : {}),
            ...(input.lastName ? { last_name: input.lastName } : {}),
            ...(input.title ? { title: input.title } : {}),
            reveal_personal_emails: false,
            reveal_phone_number: false,
          }),
        }),
      );
      const p = body.person ? obj(body.person) : null;
      const name = p
        ? (str(p.name) ?? [str(p.first_name), str(p.last_name)].filter(Boolean).join(' '))
        : null;
      const linkedin = p ? str(p.linkedin_url) : null;
      return {
        output: {
          person:
            p && name
              ? {
                  name,
                  title: str(p.title),
                  email: str(p.email),
                  emailStatus: str(p.email_status),
                  linkedinUrl: linkedin,
                  organizationName: str(obj(p.organization).name),
                }
              : null,
          source: { name: 'Apollo', url: linkedin, retrievedAt: deps.clock.now().toISOString() },
        },
        units: 1,
      };
    },
  });
}

/** Hunter domain search: emails published for a business domain (1 request). */
export function hunterAdapter(deps: Deps): RegisteredAdapter {
  const fetchFn = deps.fetch ?? fetch;
  return registerAdapter({
    key: TOOL_KEYS.hunter,
    requires: 'hunter',
    input: domainSearchInput,
    output: domainSearchOutput,
    maxUnits: () => 1,
    async run(input: { domain: string; limit: number }) {
      const apiKey = requireKey((await deps.settings.provider('hunter')).apiKey, 'Hunter');
      const url = `${HUNTER_URL}?domain=${encodeURIComponent(input.domain)}&limit=${input.limit}&api_key=${encodeURIComponent(apiKey)}`;
      const data = obj(obj(await requestJson(fetchFn, 'Hunter', url)).data);
      const emails: DomainSearchOutput['emails'] = (
        Array.isArray(data.emails) ? data.emails : []
      ).flatMap((raw) => {
        const e = obj(raw);
        const email = str(e.value);
        if (!email) return [];
        const type = e.type === 'personal' || e.type === 'generic' ? e.type : null;
        const firstSource = Array.isArray(e.sources) ? obj(e.sources[0]) : {};
        return [
          {
            email: email.toLowerCase(),
            type,
            confidence: int(e.confidence),
            firstName: str(e.first_name),
            lastName: str(e.last_name),
            position: str(e.position),
            sourceUrl: str(firstSource.uri),
          },
        ];
      });
      return {
        output: {
          domain: str(data.domain) ?? input.domain,
          organization: str(data.organization),
          emails,
          source: {
            name: 'Hunter',
            url: `https://hunter.io/search/${input.domain}`,
            retrievedAt: deps.clock.now().toISOString(),
          },
        },
        units: 1,
      };
    },
  });
}
