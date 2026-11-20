# 0007. Apify as the main scraping layer, for public business data only

- Status: Accepted
- Date: 2026-11-18

## Context
Leads come from many sources without good APIs (Google Maps details, Yelp, directories, Instagram, TikTok). Apify is a legitimate platform, but its terms make the user responsible for how scrapers are used, and platforms' terms restrict scraping.

## Decision
Use Apify actors for sources without a suitable API, and official or open sources where they exist (Google Places API, Overpass, Overture/Foursquare). Safeguards built in from the start:
1. Public data only; never scrape while logged in.
2. Every field stores its Source and the date it was collected.
3. A Removal list: a business that asks is never delivered again. *(Amended 2026-11-19: deferred for the first version, which only hands public business data to the customer and sends no messages; Staff handle any request by hand. See prd-first-version §14.)*
4. Business contact data only (B2B); never consumers. No direct LinkedIn scraping (LinkedIn URLs come from enrichment providers).

## Consequences
Provenance doubles as the Evidence and confidence shown to users. Some risk remains (blocks, cease-and-desist); each source is a separate Tool that staff can switch off.
