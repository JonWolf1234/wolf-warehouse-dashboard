# Current RMS stock-level resolution fix

The authenticated API correctly returns one stock level for:

- member_id = 557
- stock_item_id = 548

Current RMS may omit `stock_item_id` from the returned object even though the
filter was honoured. The resolver now trusts the filtered result and also
reads `member.service_stock_levels`.

No Current RMS write is performed.
