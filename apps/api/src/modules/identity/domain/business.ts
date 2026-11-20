import { ValidationError } from '../../../shared/domain/errors.js';

export interface BusinessSnapshot {
  id: string;
  name: string;
  internal: boolean;
  createdAt: Date;
  lastActiveAt: Date | null;
}

/** A Business name: 2 to 120 characters after trimming (FR-1). */
export function businessName(raw: string): string {
  const name = raw.trim();
  if (name.length < 2 || name.length > 120) {
    throw new ValidationError('Business name must be 2 to 120 characters', {
      businessName: 'Must be 2 to 120 characters',
    });
  }
  return name;
}

/** The tenant: everything a customer owns belongs to one Business. */
export class Business {
  private constructor(private state: BusinessSnapshot) {}

  static create(props: { id: string; name: string; now: Date; internal?: boolean }): Business {
    return new Business({
      id: props.id,
      name: businessName(props.name),
      internal: props.internal ?? false,
      createdAt: props.now,
      lastActiveAt: props.now,
    });
  }

  static restore(snapshot: BusinessSnapshot): Business {
    return new Business({ ...snapshot });
  }

  get id(): string {
    return this.state.id;
  }
  get name(): string {
    return this.state.name;
  }
  get internal(): boolean {
    return this.state.internal;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get lastActiveAt(): Date | null {
    return this.state.lastActiveAt;
  }

  rename(name: string): void {
    this.state.name = businessName(name);
  }

  markInternal(internal: boolean): void {
    this.state.internal = internal;
  }

  toSnapshot(): BusinessSnapshot {
    return { ...this.state };
  }
}
