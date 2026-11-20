import type { Generated } from 'kysely';
import type { Decimal, Json, Timestamp } from '../../../shared/infrastructure/db/schema.js';

export interface PlansTable {
  id: string;
  business_id: string;
  /** The Research flow the Plan runs (default `local-buyers`). */
  flow_key: Generated<string>;
  name: string;
  goal: string;
  search_label: string;
  lat: Decimal;
  lng: Decimal;
  radius_miles: Decimal;
  max_credits: number;
  max_leads: number;
  min_fit_score: number;
  icp_edited_at: Timestamp | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TargetSegmentsTable {
  id: string;
  plan_id: string;
  name: string;
  fit_signals: Json<string[]>;
  exclusions: Json<string[]>;
  product_id: string;
  position: number;
}

export interface PlanningTables {
  plans: PlansTable;
  target_segments: TargetSegmentsTable;
}
