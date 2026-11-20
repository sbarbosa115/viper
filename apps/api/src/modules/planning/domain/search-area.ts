import { ValidationError } from '../../../shared/domain/errors.js';

export const MIN_RADIUS_MILES = 1;
export const MAX_RADIUS_MILES = 25;

/** Rounds to the stored precision (DECIMAL(4,1)). */
function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Keeps a drafted radius inside 1–25 miles (FR-16). */
export function clampRadius(miles: number): number {
  if (!Number.isFinite(miles)) return MIN_RADIUS_MILES;
  return tenths(Math.min(MAX_RADIUS_MILES, Math.max(MIN_RADIUS_MILES, miles)));
}

/**
 * Where to look: a centre point and a radius of 1–25 miles (FR-16, FR-17). Edits that break the
 * rule are rejected with a field named `searchArea.<field>`.
 */
export class SearchArea {
  private constructor(
    readonly label: string,
    readonly lat: number,
    readonly lng: number,
    readonly radiusMiles: number,
  ) {}

  static of(props: { label: string; lat: number; lng: number; radiusMiles: number }): SearchArea {
    const label = props.label.trim();
    if (label.length === 0 || label.length > 200) {
      throw invalid('label', 'Give a place name of 1–200 characters');
    }
    if (!Number.isFinite(props.lat) || props.lat < -90 || props.lat > 90) {
      throw invalid('lat', 'Latitude must be between -90 and 90');
    }
    if (!Number.isFinite(props.lng) || props.lng < -180 || props.lng > 180) {
      throw invalid('lng', 'Longitude must be between -180 and 180');
    }
    const r = props.radiusMiles;
    if (!Number.isFinite(r) || r < MIN_RADIUS_MILES || r > MAX_RADIUS_MILES) {
      throw invalid(
        'radiusMiles',
        `Radius must be between ${MIN_RADIUS_MILES} and ${MAX_RADIUS_MILES} miles`,
      );
    }
    return new SearchArea(label, props.lat, props.lng, tenths(r));
  }

  withRadius(radiusMiles: number): SearchArea {
    return SearchArea.of({ ...this.toSnapshot(), radiusMiles });
  }

  movedTo(place: { label: string; lat: number; lng: number }): SearchArea {
    return SearchArea.of({ ...place, radiusMiles: this.radiusMiles });
  }

  toSnapshot(): { label: string; lat: number; lng: number; radiusMiles: number } {
    return { label: this.label, lat: this.lat, lng: this.lng, radiusMiles: this.radiusMiles };
  }
}

function invalid(field: string, message: string): ValidationError {
  return new ValidationError(message, { [`searchArea.${field}`]: message });
}
