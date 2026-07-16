const PREP_QUANTITY_FIELDS = [
  "prepared_quantity",
  "quantity_prepared",
  "prep_quantity",
  "prepared_count",
  "booked_out_quantity",
  "quantity_booked_out",
  "checked_in_quantity",
  "quantity_checked_in",
  "returned_quantity",
  "quantity_returned",
  "completed_quantity",
  "quantity_completed"
];

const TOTAL_QUANTITY_FIELDS = [
  "quantity",
  "rental_quantity",
  "booked_quantity",
  "item_quantity",
  "chargeable_quantity"
];

const PREP_STATES = [
  "prepared",
  "prepped",
  "booked_out",
  "booked out",
  "checked_out",
  "checked out",
  "checked_in",
  "checked in",
  "returned",
  "complete",
  "completed"
];

const EXCLUDED_ITEM_WORDS = [
  "group",
  "heading",
  "service",
  "labour",
  "labor",
  "transport",
  "delivery",
  "collection",
  "sale",
  "text",
  "subtotal",
  "discount",
  "location"
];

export function unwrapRecord(value) {
  if (!value || typeof value !== "object") return {};
  if (value.attributes && typeof value.attributes === "object") {
    return { id: value.id, ...value.attributes, relationships: value.relationships };
  }
  return value;
}

export function extractCollection(payload, preferredKeys = []) {
  if (Array.isArray(payload)) return payload.map(unwrapRecord);
  if (!payload || typeof payload !== "object") return [];

  for (const key of preferredKeys) {
    if (Array.isArray(payload[key])) return payload[key].map(unwrapRecord);
  }

  if (Array.isArray(payload.data)) return payload.data.map(unwrapRecord);

  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) return value.map(unwrapRecord);
  }

  return [];
}

export function extractSingle(payload, preferredKeys = []) {
  if (!payload || typeof payload !== "object") return {};
  for (const key of preferredKeys) {
    if (payload[key] && typeof payload[key] === "object") return unwrapRecord(payload[key]);
  }
  if (payload.data && !Array.isArray(payload.data)) return unwrapRecord(payload.data);
  return unwrapRecord(payload);
}

function valueAtPath(source, path) {
  return path.split(".").reduce((current, part) => current?.[part], source);
}

function firstValue(source, paths) {
  for (const path of paths) {
    const value = valueAtPath(source, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function numeric(value) {
  if (typeof value === "boolean") return value ? 1 : 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalisedText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("-", "_");
}

function firstDate(record, paths) {
  const value = firstValue(record, paths);
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function itemDescriptor(item) {
  return normalisedText(
    [
      item.item_type,
      item.opportunity_item_type,
      item.type,
      item.type_name,
      item.item_type_name,
      item.name,
      item.description
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function isPhysicalRentalItem(rawItem) {
  const item = unwrapRecord(rawItem);

  if (item.is_group === true || item.is_heading === true || item.group === true) return false;
  if (item.is_service === true || item.is_labour === true || item.is_labor === true) return false;
  if (item.is_transport === true || item.is_sale === true || item.is_text === true) return false;

  const descriptor = itemDescriptor(item);
  if (EXCLUDED_ITEM_WORDS.some((word) => descriptor.includes(word))) return false;

  if (
    item.is_item === true ||
    item.is_accessory === true ||
    item.is_rental === true ||
    item.product_id ||
    item.stock_level_id ||
    descriptor.includes("product") ||
    descriptor.includes("rental") ||
    descriptor.includes("accessory") ||
    descriptor.includes("stock")
  ) {
    return true;
  }

  return quantityForItem(item) > 0;
}

function quantityForItem(item) {
  for (const field of TOTAL_QUANTITY_FIELDS) {
    if (item[field] !== undefined && item[field] !== null) {
      return Math.max(0, numeric(item[field]));
    }
  }
  return 0;
}

function assetArray(item) {
  const candidates = [
    item.opportunity_item_assets,
    item.item_assets,
    item.assets,
    item.allocated_assets,
    item.stock_levels
  ];
  return candidates.find(Array.isArray) ?? [];
}

function statusLooksPrepared(value) {
  const status = normalisedText(value).replaceAll("_", " ");
  return PREP_STATES.some((candidate) => status.includes(candidate.replaceAll("_", " ")));
}

function preparedForItem(rawItem, totalQuantity) {
  const item = unwrapRecord(rawItem);
  const directValues = PREP_QUANTITY_FIELDS
    .filter((field) => item[field] !== undefined && item[field] !== null)
    .map((field) => numeric(item[field]));

  if (directValues.length) {
    return {
      quantity: Math.min(totalQuantity, Math.max(...directValues, 0)),
      quality: "exact"
    };
  }

  const assets = assetArray(item);
  if (assets.length) {
    let quantity = 0;
    let recognised = false;

    for (const rawAsset of assets) {
      const asset = unwrapRecord(rawAsset);
      const state = firstValue(asset, ["warehouse_status", "scan_status", "status", "state", "item_status"]);
      const booleanPrepared = [
        asset.prepared,
        asset.is_prepared,
        asset.booked_out,
        asset.is_booked_out,
        asset.checked_in,
        asset.is_checked_in
      ].some(Boolean);

      if (state || booleanPrepared) recognised = true;
      if (booleanPrepared || statusLooksPrepared(state)) {
        quantity += Math.max(1, numeric(asset.quantity || 1));
      }
    }

    if (recognised) {
      return {
        quantity: Math.min(totalQuantity, quantity),
        quality: "exact"
      };
    }
  }

  const itemStatus = firstValue(item, [
    "warehouse_status",
    "prep_status",
    "item_status",
    "status",
    "state"
  ]);

  if (
    statusLooksPrepared(itemStatus) ||
    item.prepared === true ||
    item.is_prepared === true ||
    item.prepared_at ||
    item.booked_out_at ||
    item.checked_in_at
  ) {
    return { quantity: totalQuantity, quality: "status-derived" };
  }

  const percent = numeric(firstValue(item, ["prepared_percentage", "prep_percentage"]));
  if (percent > 0) {
    return {
      quantity: Math.min(totalQuantity, Math.round((totalQuantity * percent) / 100)),
      quality: "status-derived"
    };
  }

  return { quantity: 0, quality: "unavailable" };
}

function extractItems(opportunity, separatelyFetchedItems = []) {
  const directCandidates = [
    opportunity.opportunity_items,
    opportunity.items,
    opportunity.rental_items,
    opportunity.included_items
  ];
  const direct = directCandidates.find(Array.isArray);
  if (direct) return direct.map(unwrapRecord);
  return separatelyFetchedItems.map(unwrapRecord);
}

function combineQuality(qualities) {
  if (qualities.includes("exact")) return "exact";
  if (qualities.includes("status-derived")) return "status-derived";
  return "unavailable";
}

export function scheduleDates(opportunity) {
  return {
    prepAt: firstDate(opportunity, ["prep_starts_at", "prep_start_at", "prep_date"]),
    prepEndsAt: firstDate(opportunity, ["prep_ends_at", "prep_end_at"]),
    loadAt: firstDate(opportunity, ["load_starts_at", "load_start_at"]),
    loadEndsAt: firstDate(opportunity, ["load_ends_at", "load_end_at"]),
    deliverAt: firstDate(opportunity, ["deliver_starts_at", "delivery_starts_at"]),
    showAt: firstDate(opportunity, ["show_starts_at", "starts_at", "start_at"]),
    returnAt: firstDate(opportunity, [
      "unload_starts_at",
      "collect_starts_at",
      "collection_starts_at",
      "ends_at",
      "end_at"
    ]),
    returnEndsAt: firstDate(opportunity, [
      "unload_ends_at",
      "collect_ends_at",
      "collection_ends_at",
      "ends_at",
      "end_at"
    ])
  };
}

export function normaliseOpportunity(rawOpportunity, separatelyFetchedItems, options = {}) {
  const opportunity = unwrapRecord(rawOpportunity);
  const items = extractItems(opportunity, separatelyFetchedItems).filter(isPhysicalRentalItem);

  let totalItems = 0;
  let preparedItems = 0;
  const qualities = [];

  for (const item of items) {
    const quantity = quantityForItem(item);
    if (quantity <= 0) continue;
    totalItems += quantity;
    const prepared = preparedForItem(item, quantity);
    preparedItems += prepared.quantity;
    qualities.push(prepared.quality);
  }

  preparedItems = Math.min(totalItems, preparedItems);
  const prepDataQuality = combineQuality(qualities);
  const dates = scheduleDates(opportunity);

  const id = firstValue(opportunity, ["id", "opportunity_id"]);
  const reference = firstValue(opportunity, [
    "number",
    "reference",
    "opportunity_number",
    "order_number",
    "job_number"
  ]);
  const name = firstValue(opportunity, ["subject", "name", "title", "description"]) || `Job ${reference || id}`;
  const customer = options.includeCustomerName
    ? firstValue(opportunity, [
        "customer_name",
        "organization_name",
        "member_name",
        "billing_address_name",
        "customer.name",
        "organization.name",
        "member.name"
      ])
    : null;

  const status = firstValue(opportunity, ["status_name", "status", "state", "opportunity_status"]);
  const type = firstValue(opportunity, ["opportunity_type", "type_name", "type"]);
  const subdomain = options.subdomain;

  return {
    id,
    reference: reference || "",
    name,
    customer: customer || "",
    status: status || "",
    type: type || "",
    totalItems: Math.round(totalItems * 100) / 100,
    preparedItems: Math.round(preparedItems * 100) / 100,
    preparedPercent: totalItems > 0 ? Math.round((preparedItems / totalItems) * 100) : 0,
    prepDataQuality,
    ...dates,
    currentRmsUrl: subdomain && id ? `https://${subdomain}.current-rms.com/opportunities/${id}` : null
  };
}

export function opportunityLooksActive(rawOpportunity) {
  const opportunity = unwrapRecord(rawOpportunity);
  const status = normalisedText(
    firstValue(opportunity, ["status_name", "status", "state", "opportunity_status"])
  );
  return !["cancelled", "canceled", "lost", "dead", "completed", "complete"].some((word) =>
    status.includes(word)
  );
}

export function opportunityLooksLikeOrder(rawOpportunity) {
  const opportunity = unwrapRecord(rawOpportunity);
  const type = normalisedText(firstValue(opportunity, ["opportunity_type", "type_name", "type"]));
  const status = normalisedText(firstValue(opportunity, ["status_name", "status", "state"]));

  if (!type && !status) return true;
  if (["quotation", "quote", "draft", "inquiry", "inquiry"].some((word) => type.includes(word))) return false;
  if (type.includes("order")) return true;
  if (["confirmed", "provisional", "reserved", "prepared", "booked_out"].some((word) => status.includes(word))) {
    return true;
  }
  return true;
}

export function isRelevantToDateRange(job, fromDate, toDate) {
  const from = new Date(
    `${fromDate}T00:00:00Z`
  ).getTime();

  const to = new Date(
    `${toDate}T23:59:59Z`
  ).getTime();

  const values = [
    job.prepAt,
    job.prepEndsAt,
    job.loadAt,
    job.loadEndsAt,
    job.deliverAt,
    job.showAt,
    job.returnAt,
    job.returnEndsAt
  ]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);

  if (!values.length) {
    return false;
  }

  const jobStartsAt = Math.min(...values);
  const jobEndsAt = Math.max(...values);

  return jobStartsAt <= to && jobEndsAt >= from;
}

export function diagnosticSummary(rawOpportunity, separatelyFetchedItems = []) {
  const opportunity = unwrapRecord(rawOpportunity);
  const items = extractItems(opportunity, separatelyFetchedItems).slice(0, 5);
  const interesting = /quantity|prep|prepared|book|check|return|status|state|asset|type|name|description/i;

  return {
    opportunityKeys: Object.keys(opportunity).sort(),
    itemCountDetected: extractItems(opportunity, separatelyFetchedItems).length,
    sampleItems: items.map((item) =>
      Object.fromEntries(
        Object.entries(unwrapRecord(item))
          .filter(([key, value]) => interesting.test(key) && typeof value !== "function")
          .map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, 3) : value])
      )
    )
  };
}
