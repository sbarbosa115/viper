import { ValidationError } from '../../../shared/domain/errors.js';

export interface CreditPackSnapshot {
  id: string;
  name: string;
  credits: number;
  priceCents: number;
  active: boolean;
  position: number;
}

export type CreditPackDetails = Pick<
  CreditPackSnapshot,
  'name' | 'credits' | 'priceCents' | 'active'
>;

function validated(d: CreditPackDetails): CreditPackDetails {
  const name = d.name.trim();
  const fields: Record<string, string> = {};
  if (name.length < 1 || name.length > 60) fields.name = 'Enter 1 to 60 characters';
  if (!Number.isSafeInteger(d.credits) || d.credits < 1 || d.credits > 1_000_000) {
    fields.credits = 'Enter 1 to 1,000,000';
  }
  if (!Number.isSafeInteger(d.priceCents) || d.priceCents < 50 || d.priceCents > 1_000_000) {
    fields.priceCents = 'Enter 50 to 1,000,000 cents';
  }
  if (Object.keys(fields).length > 0) throw new ValidationError('Invalid Credit pack', fields);
  return { ...d, name };
}

/** A one-time purchase that adds credits (FR-13). */
export class CreditPack {
  private constructor(private s: CreditPackSnapshot) {}

  static create(props: CreditPackDetails & { id: string; position: number }): CreditPack {
    return new CreditPack({ ...validated(props), id: props.id, position: props.position });
  }

  static restore(s: CreditPackSnapshot): CreditPack {
    return new CreditPack({ ...s });
  }

  get id(): string {
    return this.s.id;
  }
  get name(): string {
    return this.s.name;
  }
  get credits(): number {
    return this.s.credits;
  }
  get priceCents(): number {
    return this.s.priceCents;
  }
  get active(): boolean {
    return this.s.active;
  }

  change(details: CreditPackDetails): void {
    this.s = { ...this.s, ...validated(details) };
  }

  toSnapshot(): CreditPackSnapshot {
    return { ...this.s };
  }
}
