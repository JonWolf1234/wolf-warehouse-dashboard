# Stock-level resolution v2

Current RMS returns one record for:

- q[member_id_eq]
- q[stock_item_id_eq]

but may omit stock_item_id/member_id from the returned object.

This release:
- trusts a single record returned by the exact filtered query;
- retains the raw stock-level object for diagnostics;
- exposes member.service_stock_levels;
- selects the sole returned stock level when it is unambiguous.

No Current RMS write is performed.
