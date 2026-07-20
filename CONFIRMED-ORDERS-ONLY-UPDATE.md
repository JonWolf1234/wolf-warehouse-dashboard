# Confirmed Orders Only update

Publish Work now follows the exact opportunity state model from this Current RMS tenancy:

- `state = 1` — Draft
- `state = 2` — Quotation
- `state = 3` — Order

Only `state = 3` opportunities can create freelancer vacancies.

Removed:
- Debug opportunity status button
- Diagnostic modal
- Diagnostic API endpoint
- Diagnostic backend export

Preserved:
- Search
- Status filters
- Stats tiles
- Returned Vacancy badges
- Filled in Current RMS badges
