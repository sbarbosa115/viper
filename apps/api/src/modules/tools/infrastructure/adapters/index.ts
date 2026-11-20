import type { LlmClient } from '../../../../shared/application/llm-client.js';
import type { Clock } from '../../../../shared/domain/clock.js';
import type { ProviderSettings, Sleeper } from '../../application/ports.js';
import { adapterRegistry, type AdapterRegistry } from '../../application/tool-adapter.js';
import { createFakeAdapters, withControls } from '../fake/fake-adapters.js';
import type { FakeToolControls } from '../fake/fake-tool-controls.js';
import {
  apifyClientRunner,
  apifyGoogleMapsAdapter,
  apifyInstagramAdapter,
  apifyYelpAdapter,
  type ApifyActorRunner,
} from './apify.js';
import { claudeAdapter } from './claude.js';
import { apolloOrganizationAdapter, apolloPeopleAdapter, hunterAdapter } from './contacts.js';
import { firecrawlAdapter } from './firecrawl.js';
import { googleGeocodingAdapter, googlePlacesAdapter } from './google.js';
import type { Fetch } from './http.js';
import { overpassAdapter } from './overpass.js';
import { twilioLookupAdapter, zeroBounceAdapter } from './verification.js';

export interface AdapterDeps {
  settings: ProviderSettings;
  clock: Clock;
  sleeper: Sleeper;
  /** AnthropicLlmClient live; the scripted fake with TOOLS_MODE=fake. */
  llm: LlmClient;
  fetch?: Fetch;
  apify?: ApifyActorRunner;
}

function claudeAdapters(deps: AdapterDeps) {
  return (['planning', 'chat', 'fast'] as const).map((role) => claudeAdapter(role, deps));
}

/** Every live adapter (FR-24), reading keys from Platform settings at call time. */
export function createLiveAdapters(deps: AdapterDeps): AdapterRegistry {
  const http = {
    settings: deps.settings,
    clock: deps.clock,
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  };
  const apify = { runner: deps.apify ?? apifyClientRunner(deps.settings), clock: deps.clock };
  return adapterRegistry([
    googlePlacesAdapter(http),
    googleGeocodingAdapter(http),
    apifyGoogleMapsAdapter(apify),
    apifyInstagramAdapter(apify),
    apifyYelpAdapter(apify),
    overpassAdapter({
      clock: deps.clock,
      sleeper: deps.sleeper,
      ...(deps.fetch ? { fetch: deps.fetch } : {}),
    }),
    firecrawlAdapter(http),
    apolloOrganizationAdapter(http),
    apolloPeopleAdapter(http),
    hunterAdapter(http),
    zeroBounceAdapter(http),
    twilioLookupAdapter(http),
    ...claudeAdapters(deps),
  ]);
}

/** Fixture-backed fakes with switchable error modes (TOOLS_MODE=fake). */
export function createFakeAdapterRegistry(
  deps: AdapterDeps & { controls: FakeToolControls },
): AdapterRegistry {
  return adapterRegistry([
    ...createFakeAdapters({ clock: deps.clock, controls: deps.controls }),
    ...claudeAdapters(deps).map((a) => withControls(a, deps.controls)),
  ]);
}
