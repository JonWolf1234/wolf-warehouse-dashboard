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
  const quantity = quantityForItem(item);

  if (quantity <= 0) {
    return false;
  }

  const opportunityItemType = String(
    item.opportunity_item_type_name ||
    ""
  )
    .trim()
    .toLowerCase();

  const itemType = String(
    item.item_type ||
    item.item_type_name ||
    ""
  )
    .trim()
    .toLowerCase();

  const transactionType = String(
    item.transaction_type_name ||
    item.transaction_type ||
    ""
  )
    .trim()
    .toLowerCase();

  /*
   * Structural rows must never be counted.
   */
  if (
    item.is_group === true ||
    item.is_heading === true ||
    item.group === true ||
    opportunityItemType === "group" ||
    opportunityItemType === "heading"
  ) {
    return false;
  }

  /*
   * Exclude service, labour, transport and sale lines.
   */
  if (
    item.is_service === true ||
    item.is_labour === true ||
    item.is_labor === true ||
    item.is_transport === true ||
    item.is_sale === true ||
    transactionType === "sale" ||
    transactionType === "service"
  ) {
    return false;
  }

  /*
   * Warehouse notes and product notes are generally child
   * text rows attached to another opportunity item.
   */
  const parentItemId =
    item.parent_id ??
    item.parent_item_id ??
    item.parent_opportunity_item_id ??
    item.opportunity_item_parent_id ??
    item.parent_opportunity_item?.id ??
    null;

  const isChildItem =
    parentItemId !== null &&
    parentItemId !== undefined &&
    parentItemId !== "";

  /*
   * Recognise text/manual lines.
   */
  const isTextItem =
    item.is_text === true ||
    itemType === "text" ||
    opportunityItemType === "text";

  if (isTextItem) {
    /*
     * Do not count notes attached beneath products.
     */
    if (isChildItem) {
      return false;
    }

    /*
     * Only count a manually entered text line when it is an
     * actual rental transaction.
     *
     * Your Current RMS diagnostic showed rental items as:
     * transaction_type: 1
     * transaction_type_name: "Rental"
     */
    const isRentalTransaction =
      item.transaction_type === 1 ||
      item.transaction_type === "1" ||
      transactionType === "rental";

    return isRentalTransaction;
  }

  /*
   * Normal Current RMS products and accessories.
   */
  const isProductOrAccessory =
    item.is_item === true ||
    item.is_accessory === true ||
    item.is_rental === true ||
    item.product_id ||
    item.stock_level_id ||
    itemType === "product" ||
    opportunityItemType === "principal" ||
    opportunityItemType === "accessory";

  if (isProductOrAccessory) {
    return (
      item.transaction_type === 1 ||
      item.transaction_type === "1" ||
      transactionType === "rental" ||
      transactionType === ""
    );
  }

  /*
   * Do not use a broad quantity-only fallback.
   * Unknown lines are safer to exclude than to count warehouse
   * notes as equipment.
   */
  return false;
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

  /*
   * First look for an explicit prepared quantity.
   */
  const directValues = PREP_QUANTITY_FIELDS
    .filter(
      (field) =>
        item[field] !== undefined &&
        item[field] !== null
    )
    .map((field) => numeric(item[field]));

  if (directValues.length) {
    return {
      quantity: Math.min(
        totalQuantity,
        Math.max(...directValues, 0)
      ),
      quality: "exact"
    };
  }

  /*
   * Next inspect any individual asset records.
   */
  const assets = assetArray(item);

  if (assets.length) {
    let quantity = 0;
    let recognised = false;

    for (const rawAsset of assets) {
      const asset = unwrapRecord(rawAsset);

      const state = firstValue(asset, [
        "status_name",
        "state_name",
        "warehouse_status",
        "scan_status",
        "item_status",
        "status",
        "state"
      ]);

      const booleanPrepared = [
        asset.prepared,
        asset.is_prepared,
        asset.booked_out,
        asset.is_booked_out,
        asset.checked_in,
        asset.is_checked_in
      ].some(Boolean);

      if (
        state !== null ||
        booleanPrepared
      ) {
        recognised = true;
      }

      if (
        booleanPrepared ||
        statusLooksPrepared(state)
      ) {
        quantity += Math.max(
          1,
          numeric(asset.quantity || 1)
        );
      }
    }

    if (recognised) {
      return {
        quantity: Math.min(
          totalQuantity,
          quantity
        ),
        quality: "exact"
      };
    }
  }

  /*
   * Current RMS supplies the warehouse state on each opportunity
   * item using status_name, for example:
   *
   * Reserved
   * Allocated
   * Prepared
   * Booked Out
   * Checked In
   * Completed
   */
  const itemStatus = firstValue(item, [
    "status_name",
    "state_name",
    "warehouse_status_name",
    "prep_status_name",
    "item_status_name",
    "warehouse_status",
    "prep_status",
    "item_status",
    "state",
    "status"
  ]);

  /*
   * Prepared and all later warehouse states count as prepared.
   */
  if (
    statusLooksPrepared(itemStatus) ||
    item.prepared === true ||
    item.is_prepared === true ||
    item.prepared_at ||
    item.booked_out_at ||
    item.checked_in_at
  ) {
    return {
      quantity: totalQuantity,
      quality: "status-derived"
    };
  }

  /*
   * Some API responses may contain a preparation percentage.
   */
  const percent = numeric(
    firstValue(item, [
      "prepared_percentage",
      "prep_percentage"
    ])
  );

  if (percent > 0) {
    return {
      quantity: Math.min(
        totalQuantity,
        Math.round(
          (totalQuantity * percent) / 100
        )
      ),
      quality: "status-derived"
    };
  }

  /*
   * If Current RMS returned a named status such as Reserved or
   * Allocated, the mapping is working and the prepared quantity
   * is genuinely zero.
   */
  if (
    item.status_name ||
    item.state_name ||
    item.warehouse_status_name ||
    item.prep_status_name ||
    item.item_status_name
  ) {
    return {
      quantity: 0,
      quality: "status-derived"
    };
  }

  /*
   * No useful preparation information was present.
   */
  return {
    quantity: 0,
    quality: "unavailable"
  };
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

export function normaliseOpportunity(
  rawOpportunity,
  separatelyFetchedItems,
  options = {}
) {
  const opportunity = unwrapRecord(rawOpportunity);

  const items = extractItems(
    opportunity,
    separatelyFetchedItems
  ).filter(isPhysicalRentalItem);

  let totalItems = 0;
  let preparedItems = 0;

  const qualities = [];

  for (const item of items) {
    const quantity = quantityForItem(item);


const possibleTextLine =
  item.is_text === true ||
  String(item.item_type || "").toLowerCase() === "text" ||
  String(item.item_type_name || "").toLowerCase() === "text" ||
  String(item.opportunity_item_type_name || "").toLowerCase() === "text" ||
  (
    !item.product_id &&
    !item.stock_level_id &&
    quantity > 0
  );

if (possibleTextLine) {
  console.log(
    "[Current RMS text item]",
    JSON.stringify({
      id: item.id,
      name: item.name,
      description: item.description,
      quantity: item.quantity,
      item_type: item.item_type,
      item_type_name: item.item_type_name,
      opportunity_item_type: item.opportunity_item_type,
      opportunity_item_type_name: item.opportunity_item_type_name,
      transaction_type: item.transaction_type,
      transaction_type_name: item.transaction_type_name,
      parent_id: item.parent_id,
      parent_item_id: item.parent_item_id,
      parent_opportunity_item_id: item.parent_opportunity_item_id,
      source_type: item.source_type,
      product_id: item.product_id,
      stock_level_id: item.stock_level_id,
      status: item.status,
      status_name: item.status_name,
      depth: item.depth,
      depth_padding: item.depth_padding,
      position: item.position,
      is_text: item.is_text,
      is_note: item.is_note,
      note: item.note,
      warehouse_note: item.warehouse_note
    })
  );
}


    if (quantity <= 0) {
      continue;
    }

    totalItems += quantity;

    const prepared = preparedForItem(
      item,
      quantity
    );

    preparedItems += prepared.quantity;
    qualities.push(prepared.quality);
  }

  preparedItems = Math.min(
    totalItems,
    preparedItems
  );

  const prepDataQuality =
    combineQuality(qualities);

  const dates =
    scheduleDates(opportunity);

  const id = firstValue(
    opportunity,
    [
      "id",
      "opportunity_id"
    ]
  );

  const reference = firstValue(
    opportunity,
    [
      "number",
      "reference",
      "opportunity_number",
      "order_number",
      "job_number"
    ]
  );

  const name =
    firstValue(
      opportunity,
      [
        "subject",
        "name",
        "title",
        "description"
      ]
    ) ||
    `Job ${reference || id}`;

  const customer =
    options.includeCustomerName
      ? options.customerName ||
        firstValue(
          opportunity,
          [
            "customer_name",
            "organisation_name",
            "organization_name",
            "member_name",
            "billing_address_name",
            "customer.name",
            "organisation.name",
            "organization.name",
            "member.name",
            "member.organisation_name",
            "member.organization_name"
          ]
        )
      : null;

  /*
   * Current RMS uses state_name for the commercial
   * opportunity state, such as:
   *
   * Order
   * Quote
   * Provisional
   */
  const opportunityState =
    firstValue(
      opportunity,
      [
        "state_name",
        "state"
      ]
    );

  /*
   * Current RMS uses status_name for the operational
   * warehouse status, such as:
   *
   * Active
   * Prepared
   * Booked Out
   * Checked In
   */
  const opportunityStatus =
    firstValue(
      opportunity,
      [
        "status_name",
        "status"
      ]
    );

  const type =
    firstValue(
      opportunity,
      [
        "opportunity_type",
        "type_name",
        "type"
      ]
    );

  const subdomain =
    options.subdomain;

  return {
    id,

    reference:
      reference || "",

    name,

    customer:
      customer || "",

    /*
     * New separate values used by the dropdown.
     */
    opportunityState:
      opportunityState || "",

    opportunityStatus:
      opportunityStatus || "",

    /*
     * Keep these older fields for compatibility with
     * the existing search and display code.
     */
    status:
      opportunityStatus ||
      opportunityState ||
      "",

    type:
      type ||
      opportunityState ||
      "",

    totalItems:
      Math.round(
        totalItems * 100
      ) / 100,

    preparedItems:
      Math.round(
        preparedItems * 100
      ) / 100,

    preparedPercent:
      totalItems > 0
        ? Math.round(
            (
              preparedItems /
              totalItems
            ) * 100
          )
        : 0,

    prepDataQuality,

    ...dates,

    currentRmsUrl:
      subdomain && id
        ? `https://${subdomain}.current-rms.com/opportunities/${id}`
        : null
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

export function warehouseItemDiagnostics(
  rawOpportunity,
  separatelyFetchedItems = []
) {
  const opportunity = unwrapRecord(rawOpportunity);

  const rawItems = extractItems(
    opportunity,
    separatelyFetchedItems
  );

  const itemResults = rawItems.map((rawItem) => {
    const item = unwrapRecord(rawItem);

    const quantity = quantityForItem(item);

    const included =
      isPhysicalRentalItem(item);

    const prepared = included
      ? preparedForItem(item, quantity)
      : {
          quantity: 0,
          quality: "excluded"
        };

    const outstandingQuantity = included
      ? Math.max(
          0,
          quantity - prepared.quantity
        )
      : 0;

    return {
      id:
        item.id ??
        item.opportunity_item_id ??
        null,

      name:
        item.name ||
        item.description ||
        "(Unnamed line)",

      description:
        item.description || "",

      itemType:
        item.item_type ??
        item.item_type_name ??
        null,

      opportunityItemType:
        item.opportunity_item_type ??
        null,

      opportunityItemTypeName:
        item.opportunity_item_type_name ??
        null,

      transactionType:
        item.transaction_type ??
        null,

      transactionTypeName:
        item.transaction_type_name ??
        null,

      status:
        item.status ??
        null,

      statusName:
        item.status_name ??
        null,

      productId:
        item.product_id ??
        null,

      stockLevelId:
        item.stock_level_id ??
        null,

      parentId:
        item.parent_id ??
        item.parent_item_id ??
        item.parent_opportunity_item_id ??
        item.opportunity_item_parent_id ??
        null,

      quantity,

      preparedQuantity:
  prepared.quantity,

outstandingQuantity,

preparationQuality:
  prepared.quality,

includedInDashboard:
  included,

rawQuantityFields: Object.fromEntries(
  Object.entries(item).filter(([key]) => {
    const lowerKey = key.toLowerCase();

    return (
      lowerKey.includes("quantity") ||
      lowerKey.includes("prepared") ||
      lowerKey.includes("allocated") ||
      lowerKey.includes("booked") ||
      lowerKey.includes("checked") ||
      lowerKey.includes("asset") ||
      lowerKey.includes("status")
    );
  })
)
};

  const includedItems = itemResults.filter(
    (item) =>
      item.includedInDashboard
  );

  const outstandingItems = includedItems.filter(
    (item) =>
      item.outstandingQuantity > 0
  );

  return {
    opportunity: {
      id:
        opportunity.id ??
        opportunity.opportunity_id ??
        null,

      number:
        opportunity.number ??
        opportunity.reference ??
        null,

      subject:
        opportunity.subject ??
        opportunity.name ??
        null,

      stateName:
        opportunity.state_name ??
        null,

      statusName:
        opportunity.status_name ??
        null
    },

    totals: {
      rawLines:
        itemResults.length,

      includedLines:
        includedItems.length,

      totalQuantity:
        includedItems.reduce(
          (sum, item) =>
            sum +
            Number(item.quantity || 0),
          0
        ),

      preparedQuantity:
        includedItems.reduce(
          (sum, item) =>
            sum +
            Number(
              item.preparedQuantity || 0
            ),
          0
        ),

      outstandingQuantity:
        includedItems.reduce(
          (sum, item) =>
            sum +
            Number(
              item.outstandingQuantity || 0
            ),
          0
        )
    },

    outstandingItems,

    includedItems,

    excludedItems:
      itemResults.filter(
        (item) =>
          !item.includedInDashboard
      )
  };
}
