# Current RMS write-back test

This release performs a real, admin-only Current RMS allocation when enabled.

## Enable only for the controlled test

ENABLE_CURRENT_RMS_ALLOCATION_WRITES=true

The write operation is:

PUT /api/v1/opportunity_items/:id

with a nested `item_assets_attributes` record containing the resolved resource stock level.

The Staff Hub then reads the opportunity item back and will only mark the application `synced` when the exact stock-level allocation is present.

If Current RMS rejects the endpoint or payload, the application is marked `failed`, the error is stored, and no success is reported.
