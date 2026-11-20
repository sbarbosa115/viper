import type { Decimal, Json, Timestamp } from '../../../shared/infrastructure/db/schema.js';

export type ContactTypeColumn =
  'phone' | 'email' | 'website' | 'instagram' | 'tiktok' | 'yelp' | 'facebook';

export interface SourcesTable {
  id: string;
  name: string;
  url: string | null;
  retrieved_at: Timestamp;
}

export interface ProspectsTable {
  id: string;
  run_id: string;
  business_id: string;
  name: string;
  address: string | null;
  lat: Decimal | null;
  lng: Decimal | null;
  category: string | null;
  phone_normalised: string | null;
  domain: string | null;
  /** e.g. `["google:ChIJ…", "osm:node/123"]`. */
  place_keys: Json<string[]>;
  pre_score: number | null;
  /** Collected facts, contacts and Evidence with their Sources (leads module's shape). */
  data: Json<Record<string, unknown>>;
  created_at: Timestamp;
}

export interface LeadsTable {
  id: string;
  business_id: string;
  plan_id: string;
  run_id: string;
  prospect_id: string;
  place_key: string;
  name: string;
  category: string | null;
  address: string | null;
  distance_miles: Decimal | null;
  fit_score: number;
  pitch_product_id: string | null;
  pitch_product_name: string;
  pitch_reason: string;
  feedback: 'good' | 'not_fit' | null;
  feedback_reason: string | null;
  feedback_at: Timestamp | null;
  removed_at: Timestamp | null;
  delivered_at: Timestamp;
}

export interface LeadContactsTable {
  id: string;
  lead_id: string;
  type: ContactTypeColumn;
  value: string;
  label: string | null;
  verification: 'verified' | 'unverified';
  source_id: string;
}

export interface LeadEvidenceTable {
  id: string;
  lead_id: string;
  fact: string;
  points: number;
  source_id: string;
  position: number;
}

export interface LeadsTables {
  sources: SourcesTable;
  prospects: ProspectsTable;
  leads: LeadsTable;
  lead_contacts: LeadContactsTable;
  lead_evidence: LeadEvidenceTable;
}
