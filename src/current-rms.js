import {
  diagnosticSummary,
  extractCollection,
  extractSingle,
  isRelevantToDateRange,
  normaliseOpportunity,
  opportunityLooksActive,
  opportunityLooksLikeOrder
} from "./normalise.js";

const API_BASE = "https://api.current-rms.com/api/v1";

function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function requiredConfiguration() {
  const subdomain = process.env.CURRENT_RMS_SUBDOMAIN?.trim();
  const apiKey = process.env.CURRENT_RMS_API_KEY?.trim();
  if (!subdomain || !apiKey) {
    throw new Error("CURRENT_RMS_SUBDOMAIN and CURRENT_RMS_API_KEY must be configured.");
  }
  return { subdomain, apiKey };
}

function appendParams(url, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
}

async function currentRequest(path, params = {}) {
  const { subdomain, apiKey } = requiredConfiguration();
  const url = new URL(`${API_BASE}${path}`);
  appendParams(url, params);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-AUTH-TOKEN": apiKey,
        "X-SUBDOMAIN": subdomain,
        "User-Agent": "Wolf-Warehouse-Dashboard/1.0"
      },
      signal: controller.signal
    });

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }

    if (!response.ok) {
      const message =
        payload?.message ||
        payload?.error ||
        payload?.errors?.join?.(", ") ||
        `Current RMS returned HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function totalPagesFrom(payload, currentPage, resultLength, perPage) {
  const candidates = [
    payload?.meta?.total_pages,
    payload?.meta?.pagination?.total_pages,
    payload?.pagination?.total_pages,
    payload?.total_pages
  ];
  const declared = candidates.map(Number).find(Number.isFinite);
  if (declared) return declared;
  return resultLength < perPage ? currentPage : currentPage + 1;
}

async function fetchPaginated(path, params, preferredKeys, maximumRecords = 500) {
  const perPage = 100;
  const all = [];

  for (let page = 1; page <= 10; page += 1) {
    const payload = await currentRequest(path, { ...params, page, per_page: perPage });
    const records = extractCollection(payload, preferredKeys);
    all.push(...records);

    const totalPages = totalPagesFrom(payload, page, records.length, perPage);
    if (page >= totalPages || records.length < perPage || all.length >= maximumRecords) break;
  }

  return all.slice(0, maximumRecords);
}

function addDays(dateString, numberOfDays) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + numberOfDays);
  return date.toISOString();
}

async function listOpportunities(fromDate, toDate) {
  const maximumRecords = envNumber("MAX_LIST_RECORDS", 500);
  const broadFrom = addDays(fromDate, -30);
  const broadTo = addDays(toDate, 30);

  const filteredParams = {
    "q[ends_at_gteq]": broadFrom,
    "q[starts_at_lteq]": broadTo
  };

  try {
    return await fetchPaginated("/opportunities", filteredParams, ["opportunities"], maximumRecords);
  } catch (error) {
    // Current RMS has changed the Opportunities API response in v2.1. If a tenant
    // rejects an older filter, retry with the stable pagination parameters only.
    if (![400, 422].includes(error.status)) throw error;
    return fetchPaginated("/opportunities", {}, ["opportunities"], maximumRecords);
  }
}

async function retrieveOpportunity(id) {
  const includeAttempts = [
    ["opportunity_items", "opportunity_item_assets", "customer"],
    ["opportunity_items"],
    []
  ];

  let lastError;
  for (const includes of includeAttempts) {
    try {
      const payload = await currentRequest(`/opportunities/${id}`, {
        "include[]": includes
      });
      return extractSingle(payload, ["opportunity"]);
    } catch (error) {
      lastError = error;
      if (![400, 404, 422].includes(error.status)) throw error;
    }
  }
  throw lastError;
}

async function retrieveOpportunityItems(opportunityId) {
  const routeAttempts = [
    `/opportunities/${opportunityId}/opportunity_items`,
    `/opportunity_items`
  ];

  for (const route of routeAttempts) {
    try {
      const params = route === "/opportunity_items" ? { "q[opportunity_id_eq]": opportunityId } : {};
      const items = await fetchPaginated(route, params, ["opportunity_items"], 1000);
      if (items.length) return items;
    } catch (error) {
      if (![400, 404, 422].includes(error.status)) throw error;
    }
  }
  return [];
}

async function mapWithConcurrency(values, limit, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}

function hasEmbeddedItems(opportunity) {
  return [
    opportunity?.opportunity_items,
    opportunity?.items,
    opportunity?.rental_items,
    opportunity?.included_items
  ].some(Array.isArray);
}

export async function getWarehouseJobs({ fromDate, toDate }) {
  const { subdomain } = requiredConfiguration();
  const maximum = envNumber("MAX_OPPORTUNITIES", 45);
  const includeCustomerName = String(process.env.INCLUDE_CUSTOMER_NAME ?? "true") === "true";

  const list = await listOpportunities(fromDate, toDate);
  const candidates = list
    .filter(opportunityLooksActive)
    .filter(opportunityLooksLikeOrder)
    .slice(0, maximum);

  const jobs = await mapWithConcurrency(candidates, 4, async (summary) => {
    const id = summary.id || summary.opportunity_id;
    if (!id) return null;

    const detail = await retrieveOpportunity(id);
    let items = [];
    if (!hasEmbeddedItems(detail)) {
      items = await retrieveOpportunityItems(id);
    }

    return normaliseOpportunity(detail, items, {
      subdomain,
      includeCustomerName
    });
  });

  return jobs
    .filter(Boolean)
    .filter((job) => isRelevantToDateRange(job, fromDate, toDate))
    .sort((a, b) => new Date(a.prepAt || a.loadAt || a.showAt) - new Date(b.prepAt || b.loadAt || b.showAt));
}

export async function getOpportunityDiagnostics(opportunityId) {
  const detail = await retrieveOpportunity(opportunityId);
  const items = hasEmbeddedItems(detail) ? [] : await retrieveOpportunityItems(opportunityId);
  return diagnosticSummary(detail, items);
}
