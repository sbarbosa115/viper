import type {
  Prospect,
  ProspectContact,
  ProspectInput,
  ProspectPatch,
  ProspectStorePort,
} from '../application/ports.js';
import { domainOf } from '../application/agent/step-context.js';

interface Lead {
  planId: string;
  runId: string;
  prospectId: string;
  placeKey: string;
  fitScore: number;
}

const digits = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
};

const contactKey = (c: { type: string; value: string }) =>
  `${c.type}|${c.type === 'phone' ? digits(c.value) : c.value.toLowerCase()}`;

function metres(
  a: { lat: number | null; lng: number | null },
  b: { lat: number | null; lng: number | null },
): number {
  if (a.lat === null || a.lng === null || b.lat === null || b.lng === null) return Infinity;
  const dLat = (a.lat - b.lat) * 111_320;
  const dLng = (a.lng - b.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * The leads module's Prospect storage as research sees it (merge/dedupe on add, FR-25
 * qualification on deliver), in memory for tests.
 */
export class InMemoryProspectStore implements ProspectStorePort {
  readonly prospects = new Map<string, Prospect & { businessId: string; ownerNames: string[] }>();
  readonly leads: Lead[] = [];
  private n = 0;

  addProspects(
    runId: string,
    businessId: string,
    inputs: readonly ProspectInput[],
  ): Promise<{ added: number; total: number }> {
    let added = 0;
    for (const input of inputs) {
      const existing = this.findDuplicate(runId, input);
      const contacts: ProspectContact[] = [
        ...(input.phone
          ? [
              {
                type: 'phone' as const,
                value: input.phone,
                verification: 'unverified' as const,
                source: input.source,
              },
            ]
          : []),
        ...(input.website
          ? [
              {
                type: 'website' as const,
                value: input.website,
                verification: 'unverified' as const,
                source: input.source,
              },
            ]
          : []),
      ];
      if (existing) {
        this.prospects.set(existing.id, {
          ...existing,
          placeKeys: [...new Set([...existing.placeKeys, ...input.placeKeys])],
          contacts: this.mergeContacts(existing.contacts, contacts),
        });
        continue;
      }
      this.n += 1;
      const id = `prospect-${this.n}`;
      this.prospects.set(id, {
        id,
        runId,
        businessId,
        name: input.name,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
        category: input.category,
        website: input.website,
        domain: domainOf(input.website),
        rating: input.rating,
        reviewsCount: input.reviewsCount,
        placeKeys: [...input.placeKeys],
        segmentId: input.segmentId,
        preScore: null,
        excluded: null,
        contacts,
        evidence: [],
        sources: [input.source],
        fitScore: null,
        pitch: null,
        summary: null,
        ownerNames: [],
      });
      added += 1;
    }
    return Promise.resolve({ added, total: this.ofRun(runId).length });
  }

  listProspects(runId: string): Promise<Prospect[]> {
    return Promise.resolve(structuredClone(this.ofRun(runId)));
  }

  updateProspect(prospectId: string, patch: ProspectPatch): Promise<void> {
    const p = this.prospects.get(prospectId);
    if (!p) return Promise.reject(new Error(`Unknown prospect ${prospectId}`));
    let contacts = this.mergeContacts(p.contacts, patch.addContacts ?? []);
    for (const v of patch.verifyContacts ?? []) {
      contacts = contacts.map((c) =>
        contactKey(c) === contactKey(v)
          ? { ...c, verification: v.verification, source: v.source }
          : c,
      );
    }
    const facts = new Set(p.evidence.map((e) => e.fact));
    this.prospects.set(prospectId, {
      ...p,
      contacts,
      preScore: patch.preScore ?? p.preScore,
      excluded: patch.excluded !== undefined ? patch.excluded : p.excluded,
      evidence: [...p.evidence, ...(patch.addEvidence ?? []).filter((e) => !facts.has(e.fact))],
      sources: [
        ...p.sources,
        ...(patch.addSources ?? []).filter(
          (s) => !p.sources.some((x) => x.url === s.url && x.name === s.name),
        ),
      ],
      fitScore: patch.fitScore ?? p.fitScore,
      pitch: patch.pitch ?? p.pitch,
      summary: patch.summary ?? p.summary,
      ownerNames: [...p.ownerNames, ...(patch.ownerNames ?? [])],
    });
    return Promise.resolve();
  }

  deliver(request: {
    runId: string;
    planId: string;
    minFitScore: number;
    maxLeads: number;
  }): Promise<{ delivered: number }> {
    const already = this.leads.filter((l) => l.runId === request.runId).length;
    if (already > 0) return Promise.resolve({ delivered: already });
    const taken = new Set(
      this.leads.filter((l) => l.planId === request.planId).map((l) => l.placeKey),
    );
    const qualified = this.ofRun(request.runId)
      .filter((p) => p.excluded === null && (p.fitScore ?? -1) >= request.minFitScore)
      .filter((p) =>
        p.contacts.some(
          (c) => (c.type === 'email' || c.type === 'phone') && c.verification === 'verified',
        ),
      )
      .filter((p) => !p.placeKeys.some((k) => taken.has(k)))
      .sort((a, b) => (b.fitScore ?? 0) - (a.fitScore ?? 0))
      .slice(0, request.maxLeads);
    for (const p of qualified) {
      this.leads.push({
        planId: request.planId,
        runId: request.runId,
        prospectId: p.id,
        placeKey: p.placeKeys[0] ?? p.id,
        fitScore: p.fitScore ?? 0,
      });
    }
    return Promise.resolve({ delivered: qualified.length });
  }

  alreadyDeliveredPlaceKeys(planId: string): Promise<ReadonlySet<string>> {
    const keys = new Set<string>();
    for (const lead of this.leads.filter((l) => l.planId === planId)) {
      for (const k of this.prospects.get(lead.prospectId)?.placeKeys ?? [lead.placeKey])
        keys.add(k);
    }
    return Promise.resolve(keys);
  }

  private ofRun(runId: string) {
    return [...this.prospects.values()].filter((p) => p.runId === runId);
  }

  private findDuplicate(runId: string, input: ProspectInput) {
    const domain = domainOf(input.website);
    return this.ofRun(runId).find(
      (p) =>
        p.placeKeys.some((k) => input.placeKeys.includes(k)) ||
        (input.phone !== null &&
          p.contacts.some(
            (c) => c.type === 'phone' && digits(c.value) === digits(input.phone ?? ''),
          )) ||
        (domain !== null && p.domain === domain) ||
        (p.name.toLowerCase() === input.name.toLowerCase() && metres(p, input) <= 50),
    );
  }

  private mergeContacts(
    existing: readonly ProspectContact[],
    more: readonly ProspectContact[],
  ): ProspectContact[] {
    const seen = new Set(existing.map(contactKey));
    return [
      ...existing,
      ...more.filter((c) => !seen.has(contactKey(c)) && seen.add(contactKey(c))),
    ];
  }
}
