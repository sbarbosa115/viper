import type {
  ContactInput,
  EvidenceItem,
  ProspectPatch as LeadsPatch,
  ProspectStage,
  ProspectStore,
  ProspectView,
  SourceRef as LeadsSource,
} from './modules/leads/index.js';
import type {
  ProductNamesPort,
  Prospect,
  ProspectEvidence,
  ProspectStorePort,
  SourceRef,
} from './modules/research/index.js';

/**
 * research's ProspectStorePort on the leads module's ProspectStore (FR-19, FR-25). The two
 * modules describe a Prospect differently; this adapter translates:
 * - `addProspects` returns `{ added, total }` (leads returns one id per input);
 * - `segmentId`, `rating`, `reviewsCount`, `excluded`, `ownerNames`, extra Sources and the website
 *   summary live in the Prospect's `facts`;
 * - `addContacts` / `verifyContacts` become leads Contacts (`checked` for verification results);
 * - `addEvidence` is appended (leads replaces the Evidence list), de-duplicated by fact + Source;
 * - a Pitch without a Product name takes it from profile's Product names.
 *
 * leads writes in its own transaction: research's `within` is not used (follow-up: leads should
 * accept the caller's transaction so Prospects commit with the step progress).
 */
export function researchProspectStore(
  leads: ProspectStore,
  options: { products?: ProductNamesPort } = {},
): ProspectStorePort {
  return {
    async addProspects(runId, businessId, inputs) {
      const before = new Set((await leads.listProspects(runId)).map((p) => p.id));
      const ids = await leads.addProspects(
        runId,
        businessId,
        inputs.map((p) => ({
          name: p.name,
          address: p.address,
          lat: p.lat,
          lng: p.lng,
          category: p.category,
          phone: p.phone,
          website: p.website,
          placeKeys: p.placeKeys,
          source: p.source,
          facts: { segmentId: p.segmentId, rating: p.rating, reviewsCount: p.reviewsCount },
        })),
      );
      const added = new Set(ids.filter((id) => !before.has(id))).size;
      return { added, total: before.size + added };
    },

    async listProspects(runId, filter = {}) {
      const stage = filter.stage as ProspectStage | undefined;
      return (await leads.listProspects(runId, { stage })).map(toResearch);
    },

    async updateProspect(prospectId, patch) {
      const contacts: ContactInput[] = [
        ...(patch.addContacts ?? []).map((c) => ({
          type: c.type,
          value: c.value,
          label: c.label ?? null,
          verification: c.verification,
          source: c.source,
        })),
        ...(patch.verifyContacts ?? []).map((c) => ({
          type: c.type,
          value: c.value,
          verification: c.verification,
          source: c.source,
          checked: true,
        })),
      ];
      const facts: Record<string, unknown> = {
        ...(patch.excluded !== undefined ? { excluded: patch.excluded } : {}),
        ...(patch.ownerNames !== undefined ? { ownerNames: patch.ownerNames } : {}),
        ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      };
      const first: LeadsPatch = {
        ...(patch.preScore !== undefined ? { preScore: patch.preScore } : {}),
        ...(patch.fitScore !== undefined ? { fitScore: patch.fitScore } : {}),
        ...(contacts.length > 0 ? { contacts } : {}),
        ...(Object.keys(facts).length > 0 ? { facts } : {}),
      };
      const current = await leads.updateProspect(prospectId, first);

      // What depends on the stored Prospect: appended Evidence and Sources, the Pitch's Product.
      const second: { -readonly [K in keyof LeadsPatch]: LeadsPatch[K] } = {};
      if (patch.addEvidence && patch.addEvidence.length > 0) {
        second.evidence = appendEvidence(current.evidence, patch.addEvidence);
      }
      if (patch.addSources && patch.addSources.length > 0) {
        const known = [...current.sources, ...extraSources(current)];
        const fresh = patch.addSources.filter((s) => !known.some((k) => sameSource(k, s)));
        if (fresh.length > 0) {
          second.facts = { extraSources: [...extraSources(current), ...fresh] };
        }
      }
      if (patch.pitch) {
        const productName =
          patch.pitch.productName ??
          (await options.products?.names(current.businessId))?.get(patch.pitch.productId) ??
          'Product';
        second.pitch = {
          productId: patch.pitch.productId,
          productName,
          reason: patch.pitch.reason,
        };
      }
      if (Object.keys(second).length > 0) await leads.updateProspect(prospectId, second);
    },

    deliver(request) {
      return leads.deliver(request);
    },

    alreadyDeliveredPlaceKeys(planId) {
      return leads.alreadyDeliveredPlaceKeys(planId);
    },
  };
}

function sameSource(a: SourceRef, b: SourceRef): boolean {
  return a.name === b.name && a.url === b.url && a.retrievedAt === b.retrievedAt;
}

function appendEvidence(
  current: readonly EvidenceItem[],
  added: readonly ProspectEvidence[],
): EvidenceItem[] {
  const all = [...current];
  for (const e of added) {
    if (!all.some((x) => x.fact === e.fact && sameSource(x.source, e.source))) all.push(e);
  }
  return all;
}

function isSource(value: unknown): value is LeadsSource {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.name === 'string' &&
    (v.url === null || typeof v.url === 'string') &&
    typeof v.retrievedAt === 'string'
  );
}

function extraSources(p: ProspectView): LeadsSource[] {
  const raw = p.facts.extraSources;
  return Array.isArray(raw) ? raw.filter(isSource) : [];
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

function toResearch(p: ProspectView): Prospect {
  const websiteContact = p.contacts.find((c) => c.type === 'website')?.value ?? null;
  return {
    id: p.id,
    runId: p.runId,
    name: p.name,
    address: p.address,
    lat: p.lat,
    lng: p.lng,
    category: p.category,
    website: p.website?.url ?? websiteContact,
    domain: p.domain,
    rating: num(p.facts.rating),
    reviewsCount: num(p.facts.reviewsCount),
    placeKeys: p.placeKeys,
    segmentId: str(p.facts.segmentId),
    preScore: p.preScore,
    excluded: str(p.facts.excluded),
    contacts: p.contacts,
    evidence: p.evidence,
    sources: [...p.sources, ...extraSources(p)],
    fitScore: p.fitScore,
    pitch: p.pitch
      ? {
          productId: p.pitch.productId ?? '',
          productName: p.pitch.productName,
          reason: p.pitch.reason,
        }
      : null,
    summary: p.website?.summary ?? str(p.facts.summary),
  };
}
