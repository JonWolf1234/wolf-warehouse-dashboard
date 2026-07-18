const recentWebhookEvents = [];
const MAX_RECENT_EVENTS = 20;

function safeObject(value) {
  return value && typeof value === "object"
    ? value
    : {};
}

function pickFirst(source, keys) {
  for (const key of keys) {
    const value = source?.[key];

    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return null;
}

function findOpportunityId(payload) {
  const action = safeObject(payload.action);
  const subject = safeObject(payload.subject);
  const source = safeObject(payload.source);
  const opportunity = safeObject(payload.opportunity);

  return pickFirst(payload, [
    "opportunity_id"
  ]) ??
    pickFirst(opportunity, [
      "id",
      "opportunity_id"
    ]) ??
    pickFirst(subject, [
      "id",
      "opportunity_id"
    ]) ??
    pickFirst(source, [
      "opportunity_id"
    ]) ??
    pickFirst(action, [
      "opportunity_id",
      "subject_id"
    ]);
}

function collectArrays(value, path = "payload", results = []) {
  if (Array.isArray(value)) {
    results.push({
      path,
      value
    });

    value.forEach((item, index) => {
      collectArrays(
        item,
        `${path}[${index}]`,
        results
      );
    });

    return results;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      collectArrays(
        child,
        `${path}.${key}`,
        results
      );
    }
  }

  return results;
}

function looksLikeAsset(record) {
  if (!record || typeof record !== "object") {
    return false;
  }

  return [
    "asset_number",
    "asset_id",
    "opportunity_item_asset_id",
    "stock_level_id",
    "serial_number",
    "barcode"
  ].some(
    (key) =>
      record[key] !== undefined &&
      record[key] !== null
  );
}

function extractPossibleAssets(payload) {
  const arrays = collectArrays(payload);

  const possibleAssets = [];

  for (const entry of arrays) {
    for (const rawRecord of entry.value) {
      if (!looksLikeAsset(rawRecord)) {
        continue;
      }

      possibleAssets.push({
        sourcePath: entry.path,

        assetNumber: pickFirst(rawRecord, [
          "asset_number",
          "serial_number",
          "barcode"
        ]),

        assetId: pickFirst(rawRecord, [
          "asset_id",
          "id",
          "opportunity_item_asset_id"
        ]),

        stockLevelId: pickFirst(rawRecord, [
          "stock_level_id"
        ]),

        opportunityItemId: pickFirst(rawRecord, [
          "opportunity_item_id",
          "item_id"
        ]),

        quantity: pickFirst(rawRecord, [
          "quantity",
          "quantity_scanned",
          "scanned_quantity"
        ]),

        status: pickFirst(rawRecord, [
          "status_name",
          "state_name",
          "status",
          "state"
        ]),

        raw: rawRecord
      });
    }
  }

  return possibleAssets;
}

function simplifyWebhook(payload) {
  const action = safeObject(payload.action);

  return {
    receivedAt:
      new Date().toISOString(),

    opportunityId:
      findOpportunityId(payload),

    actionType:
      pickFirst(payload, [
        "action_type",
        "event",
        "type"
      ]) ??
      pickFirst(action, [
        "action_type",
        "name",
        "type"
      ]),

    subjectType:
      pickFirst(payload, [
        "subject_type"
      ]) ??
      pickFirst(action, [
        "subject_type"
      ]),

    sourceType:
      pickFirst(payload, [
        "source_type"
      ]) ??
      pickFirst(action, [
        "source_type"
      ]),

    possibleAssets:
      extractPossibleAssets(payload),

    payload
  };
}

export function recordCurrentRmsWebhook(payload) {
  const event =
    simplifyWebhook(payload);

  recentWebhookEvents.unshift(event);

  if (
    recentWebhookEvents.length >
    MAX_RECENT_EVENTS
  ) {
    recentWebhookEvents.length =
      MAX_RECENT_EVENTS;
  }

  console.log(
    "[Current RMS webhook]",
    JSON.stringify({
      opportunityId:
        event.opportunityId,

      actionType:
        event.actionType,

      subjectType:
        event.subjectType,

      sourceType:
        event.sourceType,

      possibleAssetCount:
        event.possibleAssets.length,

      possibleAssets:
        event.possibleAssets.map(
          (asset) => ({
            assetNumber:
              asset.assetNumber,

            assetId:
              asset.assetId,

            opportunityItemId:
              asset.opportunityItemId,

            quantity:
              asset.quantity,

            status:
              asset.status,

            sourcePath:
              asset.sourcePath
          })
        )
    })
  );

  return event;
}

export function getRecentCurrentRmsWebhooks() {
  return recentWebhookEvents;
}