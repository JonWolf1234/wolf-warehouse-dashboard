# Wolf Staff Hub – Current RMS Allocation Diagnostic

This release adds a read-only allocation diagnostic to accepted freelancer applications.

## What it resolves

- Current RMS opportunity ID and opportunity-item ID
- Service ID
- Freelancer Current RMS member ID
- Existing item-asset allocations
- Candidate resource stock-level IDs
- Live vacancy status
- Prepared item-asset allocation values

## Safety

No Current RMS write is performed.

Keep:

ENABLE_CURRENT_RMS_ALLOCATION_WRITES=false

until an authenticated `api.current-rms.com/api/v1` item-asset creation route has been verified.

## Test

1. Start the app.
2. Open Freelancer Applications as an approver.
3. Accept a test freelancer.
4. Press Allocation details.
5. Confirm the opportunity item, member and resource stock-level values.
