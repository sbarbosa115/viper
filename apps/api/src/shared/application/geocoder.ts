/** Port to geocoding (Google Geocoding in production; fixtures in tests and fake mode). */
export interface GeocodeResult {
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
  /** True when the provider returned several plausible places (FR-14: ask to confirm). */
  readonly ambiguous: boolean;
}

export interface Geocoder {
  /** Up to `limit` (default 5) matches for a free-text place or address; [] when none. */
  search(query: string, limit?: number): Promise<readonly GeocodeResult[]>;
}
