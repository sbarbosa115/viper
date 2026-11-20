import { updatePlanBody, type Plan, type UpdatePlanBody } from '@app/contracts/planning';
import { zodResolver } from '@hookform/resolvers/zod';
import type { Resolver } from 'react-hook-form';
import { copy } from '../copy';

/** The form has the same shape as the PATCH body, with every part present. */
export interface PlanFormValues {
  name: string;
  segments: {
    id?: string;
    name: string;
    fitSignals: string[];
    exclusions: string[];
    productId: string;
  }[];
  searchArea: { label: string; lat: number; lng: number; radiusMiles: number };
  guardrails: { maxCredits: number; maxLeads: number; minFitScore: number };
}

export function toValues(plan: Plan): PlanFormValues {
  return {
    name: plan.name,
    segments: plan.segments.map((s) => ({
      id: s.id,
      name: s.name,
      fitSignals: [...s.fitSignals],
      exclusions: [...s.exclusions],
      productId: s.productId,
    })),
    searchArea: {
      label: plan.searchArea.label,
      lat: plan.searchArea.lat,
      lng: plan.searchArea.lng,
      radiusMiles: plan.searchArea.radiusMiles,
    },
    guardrails: { ...plan.guardrails },
  };
}

export const toBody = (v: PlanFormValues): UpdatePlanBody => ({
  name: v.name,
  segments: v.segments,
  searchArea: v.searchArea,
  guardrails: v.guardrails,
});

/** Friendly text for a schema failure at a form path. */
export function friendly(path: string, code: string, fallback: string): string {
  if (code === 'invalid_type' && /radiusMiles|guardrails\./.test(path)) return copy.number;
  if (path === 'name') return code === 'too_big' ? copy.nameTooLong : copy.nameRequired;
  if (path === 'searchArea.radiusMiles') return copy.radiusRange;
  if (path === 'guardrails.maxCredits') return copy.creditsMin;
  if (path === 'guardrails.maxLeads') return copy.leadsMin;
  if (path === 'guardrails.minFitScore') return copy.fitRange;
  if (/^segments\.\d+\.name$/.test(path)) {
    return code === 'too_big' ? copy.nameTooLong : copy.segmentNameRequired;
  }
  if (/^segments\.\d+\.fitSignals$/.test(path)) {
    return code === 'too_big' ? copy.signalsTooMany : copy.signalRequired;
  }
  if (/^segments\.\d+\.exclusions$/.test(path)) return copy.exclusionsTooMany;
  if (/^segments\.\d+\.productId$/.test(path)) return copy.productRequired;
  return fallback;
}

function isLeaf(value: unknown): value is { message?: string; type: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function soften(node: unknown, path: string): void {
  if (typeof node !== 'object' || node === null) return;
  for (const [key, child] of Object.entries(node)) {
    if (key === 'ref') continue;
    const at = path === '' ? key : `${path}.${key}`;
    if (isLeaf(child)) child.message = friendly(at, child.type, child.message ?? '');
    else soften(child, at);
  }
}

/** The contract schema (PATCH body), with friendlier messages. */
export const planResolver: Resolver<PlanFormValues> = async (values, context, options) => {
  const result = await (zodResolver(updatePlanBody) as unknown as Resolver<PlanFormValues>)(
    values,
    context,
    options,
  );
  soften(result.errors, '');
  return result;
};
