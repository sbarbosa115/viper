import type { Generated } from 'kysely';
import type { Decimal, Timestamp } from '../../../shared/infrastructure/db/schema.js';

export interface BusinessProfilesTable {
  business_id: string;
  description: string | null;
  category: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: Generated<string>;
  lat: Decimal | null;
  lng: Decimal | null;
  location_label: string | null;
  delivery_radius_miles: Decimal | null;
  current_customers: string | null;
  price_range: string | null;
  website: string | null;
  completed_at: Timestamp | null;
  updated_at: Timestamp;
}

export interface ProductsTable {
  id: string;
  business_id: string;
  name: string;
  description: Generated<string>;
  created_at: Timestamp;
}

export interface ProfileTables {
  business_profiles: BusinessProfilesTable;
  products: ProductsTable;
}
