import type {
  LeadFilterValues,
  LeadQuality,
  LeadRepository,
  LeadsUnitOfWork,
  LeadTotals,
  NewLead,
  NewSource,
  ProspectRepository,
} from '../application/ports.js';
import {
  compareLeads,
  isAfterCursor,
  type Feedback,
  type LeadCursor,
  type LeadListRow,
  type LeadRecord,
} from '../domain/lead.js';
import {
  CONTACT_TYPES,
  Prospect,
  type ContactType,
  type ProspectSnapshot,
} from '../domain/prospect.js';

interface StoredLead extends NewLead {
  feedback: Feedback | null;
  feedbackAt: Date | null;
  removedAt: Date | null;
}

const isPhoneOrEmail = (t: string) => t === 'phone' || t === 'email';

/** Contacts read back by type (phone, email, website, …, the ENUM order), then id. */
interface Ordered {
  type: ContactType;
  id: string;
}
function byContactOrder(a: Ordered, b: Ordered): number {
  const t = CONTACT_TYPES.indexOf(a.type) - CONTACT_TYPES.indexOf(b.type);
  return t || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * leads' storage in memory (application tests, other modules' tests, the fake mode). Behaves
 * like the MySQL repositories: cloned snapshots, Business scoping, the (plan, place key) unique
 * rule, the list's filters and orders.
 */
export class InMemoryLeads implements LeadsUnitOfWork {
  readonly prospectRows = new Map<string, ProspectSnapshot>();
  readonly leadRows = new Map<string, StoredLead>();
  readonly sources = new Map<string, NewSource>();

  run<T>(
    fn: (repos: { prospects: ProspectRepository; leads: LeadRepository }) => Promise<T>,
  ): Promise<T> {
    return fn({ prospects: this.prospectRepo(), leads: this.leadRepo() });
  }

  private prospectRepo(): ProspectRepository {
    const rows = this.prospectRows;
    return {
      listByRun: (runId) =>
        Promise.resolve(
          [...rows.values()]
            .filter((p) => p.runId === runId)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map((p) => Prospect.restore(structuredClone(p))),
        ),
      findById: (id) => {
        const p = rows.get(id);
        return Promise.resolve(p ? Prospect.restore(structuredClone(p)) : null);
      },
      save: (p) => {
        rows.set(p.id, structuredClone(p.toSnapshot()));
        return Promise.resolve();
      },
    };
  }

  private record(l: StoredLead): LeadRecord {
    const source = (id: string) => {
      const s = this.sources.get(id);
      if (!s) throw new Error(`Missing Source ${id}`);
      return { name: s.name, url: s.url, retrievedAt: s.retrievedAt };
    };
    return structuredClone({
      id: l.id,
      businessId: l.businessId,
      planId: l.planId,
      runId: l.runId,
      prospectId: l.prospectId,
      placeKey: l.placeKey,
      name: l.name,
      category: l.category,
      address: l.address,
      distanceMiles: l.distanceMiles,
      fitScore: l.fitScore,
      pitch: l.pitch,
      feedback: l.feedback?.value ?? null,
      feedbackReason: l.feedback?.reason ?? null,
      feedbackAt: l.feedbackAt,
      deliveredAt: l.deliveredAt,
      contacts: [...l.contacts]
        .sort((a, b) => byContactOrder(a, b))
        .map(({ sourceId, id: _id, ...c }) => ({ ...c, source: source(sourceId) })),
      evidence: l.evidence.map(({ sourceId, id: _id, ...e }) => ({
        ...e,
        source: source(sourceId),
      })),
    });
  }

  private live(): StoredLead[] {
    return [...this.leadRows.values()].filter((l) => l.removedAt === null);
  }

  private leadRepo(): LeadRepository {
    const all = () => this.live();
    const prospects = this.prospectRows;
    const totalsOf = (leads: readonly StoredLead[]): LeadTotals => {
      const contacts = leads.flatMap((l) => l.contacts).filter((c) => isPhoneOrEmail(c.type));
      return {
        total: leads.length,
        fitScoreSum: leads.reduce((s, l) => s + l.fitScore, 0),
        phoneEmailContacts: contacts.length,
        verifiedPhoneEmail: contacts.filter((c) => c.verification === 'verified').length,
      };
    };
    const matches = (l: StoredLead, f: LeadFilterValues) =>
      (!f.runId || l.runId === f.runId) &&
      (f.minScore === undefined || l.fitScore >= f.minScore) &&
      (!f.feedback ||
        (f.feedback === 'none' ? l.feedback === null : l.feedback?.value === f.feedback)) &&
      (!f.q || l.name.toLowerCase().includes(f.q.toLowerCase()));
    const row = (l: StoredLead): LeadListRow => ({
      id: l.id,
      runId: l.runId,
      name: l.name,
      category: l.category,
      distanceMiles: l.distanceMiles,
      fitScore: l.fitScore,
      feedback: l.feedback?.value ?? null,
      deliveredAt: new Date(l.deliveredAt),
      contactTypes: [...new Set(l.contacts.map((c) => c.type))],
    });
    const count = (key: (l: StoredLead) => string, wanted: readonly string[]) => {
      const counts = new Map<string, number>();
      for (const l of all()) {
        const k = key(l);
        if (wanted.includes(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      return Promise.resolve(counts);
    };

    return {
      deliveredPlaceKeys: (planId) => {
        const keys = new Set<string>();
        for (const l of [...this.leadRows.values()].filter((x) => x.planId === planId)) {
          keys.add(l.placeKey);
          for (const k of prospects.get(l.prospectId)?.placeKeys ?? []) keys.add(k);
        }
        return Promise.resolve(keys);
      },
      countByRun: (runId) =>
        Promise.resolve([...this.leadRows.values()].filter((l) => l.runId === runId).length),
      insert: (sources, leads) => {
        for (const l of leads) {
          const clash = [...this.leadRows.values()].some(
            (x) => x.planId === l.planId && x.placeKey === l.placeKey,
          );
          if (clash) {
            return Promise.reject(
              new Error(`Duplicate entry for leads_plan_place_key ${l.placeKey}`),
            );
          }
        }
        for (const s of sources) this.sources.set(s.id, structuredClone(s));
        for (const l of leads) {
          this.leadRows.set(l.id, {
            ...structuredClone(l),
            feedback: null,
            feedbackAt: null,
            removedAt: null,
          });
        }
        return Promise.resolve();
      },
      findMany: (businessId, ids) =>
        Promise.resolve(
          all()
            .filter((l) => l.businessId === businessId && ids.includes(l.id))
            .map((l) => this.record(l)),
        ),
      saveFeedback: (leadId, feedback, at) => {
        const l = this.leadRows.get(leadId);
        if (l) {
          l.feedback = feedback ? { ...feedback } : null;
          l.feedbackAt = feedback ? at : null;
        }
        return Promise.resolve();
      },
      list: (scope, filters, page: { after?: LeadCursor | undefined; limit: number }) =>
        Promise.resolve(
          all()
            .filter((l) => l.businessId === scope.businessId && l.planId === scope.planId)
            .filter((l) => matches(l, filters))
            .map(row)
            .filter((r) => !page.after || isAfterCursor(r, page.after))
            .sort((a, b) => compareLeads(filters.sort, a, b))
            .slice(0, page.limit),
        ),
      totals: (scope) =>
        Promise.resolve(
          totalsOf(
            all().filter(
              (l) =>
                l.businessId === scope.businessId &&
                l.planId === scope.planId &&
                (!scope.runId || l.runId === scope.runId),
            ),
          ),
        ),
      countsByPlan: (businessId, planIds) =>
        count((l) => (l.businessId === businessId ? l.planId : ''), planIds),
      countsByBusiness: (businessIds) => count((l) => l.businessId, businessIds),
      quality: ({ from, to }): Promise<LeadQuality> => {
        const leads = all().filter((l) => l.deliveredAt >= from && l.deliveredAt < to);
        const t = totalsOf(leads);
        const rated = leads.filter((l) => l.feedback !== null);
        return Promise.resolve({
          delivered: t.total,
          withFeedback: rated.length,
          good: rated.filter((l) => l.feedback?.value === 'good').length,
          phoneEmailContacts: t.phoneEmailContacts,
          verifiedPhoneEmail: t.verifiedPhoneEmail,
        });
      },
    };
  }
}
