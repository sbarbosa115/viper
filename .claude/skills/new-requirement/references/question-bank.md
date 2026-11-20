# Question bank

Pick what's relevant. These help you find gaps; don't ask them all. The stack is in `docs/architecture/stack.md`, so don't ask about it.

## Goal & measurement
- What user problem does this solve? What do users do today instead?
- Which riskiest assumption (A-n in product.md) does it test? What result would make us drop or change it?
- Success metric and target ("30% of new users create an order within 7 days")?
- Which user actions should be tracked to measure that (events and their properties)?

## Users & permissions
- Which personas use it? Which roles exist, and what can each do or not do?
- Can users see or change each other's data? Is data separated between organisations or teams?

## Scope
- List the user stories. What is the smallest version worth shipping (the cut line)?
- What comes later? What is explicitly out of scope?

## Functional detail (per story)
- What triggers it? Which inputs (fields, types, required/optional, limits)?
- Business rules and validations? Computed values (totals, prices, statuses)?
- What happens with invalid input, duplicates, missing resources, concurrent edits, or an external service failing?
- Notifications (email, in-app)? Scheduled or recurring work?
- Audit needs: who changed what, and when?

## Screens & UX
- Which screens or pages? What is the main flow, step by step?
- What does each screen show when it's empty, loading, or has failed?
- Mobile use? Any sketches, references, or competitor screens to copy or avoid?

## Interfaces
- Per endpoint: method, path, who may call it, request fields, response fields, error cases.
- Lists: filters, sorting, pagination size?
- External services (payments, maps, AI…): which, how they authenticate, what happens when they're down?
- Webhooks in or out?

## Data
- Entities, fields and types, relationships?
- Volume now and in a year? Retention and deletion (soft delete, GDPR erasure, export)?
- Existing data to import or migrate? File uploads (size, type, where to store)?
- Demo data: which users and roles, and which sample records, make a demo realistic?

## Non-functional
- Performance targets for key pages and endpoints?
- Personal or sensitive data? Encryption, consent, cookie notice?
- Accessibility level (default WCAG 2.1 AA)? Languages and currency formats?

## Risks & open questions
- What are you least sure about? What depends on someone else (partners, legal, content)?
