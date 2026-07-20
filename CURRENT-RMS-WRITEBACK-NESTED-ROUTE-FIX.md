# Current RMS nested opportunity-item route fix

The flat API route:

PUT /api/v1/opportunity_items/:id

does not exist in this Current RMS account.

The writeback now uses the nested resource route:

PUT /api/v1/opportunities/:opportunityId/opportunity_items/:opportunityItemId

All existing safeguards remain:
- live vacancy validation
- member and stock-level resolution
- application locking
- read-back verification
- failure status rather than false success
