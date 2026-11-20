import { ValidationError } from '../../../shared/domain/errors.js';

export interface ProductSnapshot {
  readonly id: string;
  readonly businessId: string;
  readonly name: string;
  readonly description: string;
  readonly createdAt: Date;
}

function cleanName(raw: string): string {
  const name = raw.trim();
  if (name.length < 1 || name.length > 120) {
    throw new ValidationError('Product name must be 1 to 120 characters', {
      name: 'Must be 1 to 120 characters',
    });
  }
  return name;
}

function cleanDescription(raw: string): string {
  const description = raw.trim();
  if (description.length > 500) {
    throw new ValidationError('Product description is too long', {
      description: 'At most 500 characters',
    });
  }
  return description;
}

/** Something the Business sells; a Plan segment pitches one (FR-15, FR-16). */
export class Product {
  private constructor(private state: ProductSnapshot) {}

  static create(props: {
    id: string;
    businessId: string;
    name: string;
    description?: string;
    now: Date;
  }): Product {
    return new Product({
      id: props.id,
      businessId: props.businessId,
      name: cleanName(props.name),
      description: cleanDescription(props.description ?? ''),
      createdAt: props.now,
    });
  }

  static restore(snapshot: ProductSnapshot): Product {
    return new Product({ ...snapshot });
  }

  get id(): string {
    return this.state.id;
  }

  get name(): string {
    return this.state.name;
  }

  rename(name: string, description: string): void {
    this.state = {
      ...this.state,
      name: cleanName(name),
      description: cleanDescription(description),
    };
  }

  /** Same product name, ignoring case and spacing (the chat must not add duplicates). */
  hasName(name: string): boolean {
    const norm = (v: string) => v.trim().replace(/\s+/g, ' ').toLowerCase();
    return norm(this.state.name) === norm(name);
  }

  toSnapshot(): ProductSnapshot {
    return { ...this.state };
  }
}
