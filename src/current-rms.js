import {
  diagnosticSummary,
  extractCollection,
  extractSingle,
  isRelevantToDateRange,
  normaliseOpportunity,
  opportunityLooksActive,
  scheduleDates
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
    throw new Error(
      "CURRENT_RMS_SUBDOMAIN and CURRENT_RMS_API_KEY must be configured."
    );
  }

  return { subdomain, apiKey };
}

function appendParams(url, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, item);
      }
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

function paginationInformation(payload, currentPage, resultLength) {
  const totalRowCount = Number(
    payload?.meta?.total_row_count ??
    payload?.meta?.pagination?.total_row_count ??
    payload?.pagination?.total_row_count ??
    payload?.total_row_count
  );

  const declaredTotalPages = Number(
    payload?.meta?.total_pages ??
    payload?.meta?.pagination?.total_pages ??
    payload?.pagination?.total_pages ??
    payload?.total_pages
  );

  const declaredPerPage = Number(
    payload?.meta?.per_page ??
    payload?.meta?.pagination?.per_page ??
    payload?.pagination?.per_page ??
    payload?.per_page
  );

  const actualPageSize =
    Number.isFinite(declaredPerPage) && declaredPerPage > 0
      ? declaredPerPage
      : resultLength;

  let totalPages = null;

  if (
    Number.isFinite(declaredTotalPages) &&
    declaredTotalPages > 0
  ) {
    totalPages = declaredTotalPages;
  } else if (
    Number.isFinite(totalRowCount) &&
    totalRowCount >= 0 &&
    actualPageSize > 0
  ) {
    totalPages = Math.ceil(
      totalRowCount / actualPageSize
    );
  }

  return {
    currentPage,
    totalPages,
    totalRowCount: Number.isFinite(totalRowCount)
      ? totalRowCount
      : null,
    actualPageSize
  };
}

async function fetchPaginated(
  path,
  params,
  preferredKeys,
  maximumRecords = 1000
) {
  const requestedPerPage = 100;
  const all = [];
  const seenIds = new Set();

  for (let page = 1; page <= 100; page += 1) {
    const payload = await currentRequest(path, {
      ...params,
      page,
      per_page: requestedPerPage
    });

    const records = extractCollection(
      payload,
      preferredKeys
    );

    let newRecordsOnPage = 0;

    for (const record of records) {
      const recordId =
        record?.id ??
        record?.opportunity_id ??
        record?.opportunity_item_id;

      /*
       * Prevent a repeated API page from creating an infinite loop.
       */
      if (
        recordId !== undefined &&
        recordId !== null
      ) {
        const uniqueKey = String(recordId);

        if (seenIds.has(uniqueKey)) {
          continue;
        }

        seenIds.add(uniqueKey);
      }

      all.push(record);
      newRecordsOnPage += 1;

      if (all.length >= maximumRecords) {
        break;
      }
    }

    const pagination = paginationInformation(
      payload,
      page,
      records.length
    );

    console.log(
      `[Current RMS] page=${page} ` +
      `received=${records.length} ` +
      `new=${newRecordsOnPage} ` +
      `totalLoaded=${all.length} ` +
      `totalAvailable=${pagination.totalRowCount ?? "unknown"}`
    );

    if (all.length >= maximumRecords) {
      break;
    }

    if (records.length === 0) {
      break;
    }

    if (newRecordsOnPage === 0) {
      /*
       * The API returned the same page again, so stop safely.
       */
      break;
    }

    if (
      pagination.totalPages !== null &&
      page >= pagination.totalPages
    ) {
      break;
    }

    if (
      pagination.totalRowCount !== null &&
      all.length >= pagination.totalRowCount
    ) {
      break;
    }
  }

  return all.slice(0, maximumRecords);
}

function addDays(dateString, numberOfDays) {
  const date = new Date(`${dateString}T00:00:00Z`);

  date.setUTCDate(date.getUTCDate() + numberOfDays);

  return date.toISOString();
}

async function listOpportunities(fromDate) {
  const maximumRecords = envNumber("MAX_LIST_RECORDS", 1000);

  /*
   * Include opportunities whose end date is no more than 30 days before
   * the selected dashboard start date.
   *
   * This includes:
   * - Upcoming quotations
   * - Upcoming provisional jobs
   * - Confirmed orders
   * - Jobs currently being prepared
   * - Jobs currently booked out
   */
  const broadFrom = addDays(fromDate, -30);

  try {
    return await fetchPaginated(
      "/opportunities",
{
  "q[ends_at_gteq]": broadFrom,
  "q[s][]": "id asc"
},
      ["opportunities"],
      maximumRecords
    );
  } catch (error) {
    if (![400, 422].includes(error.status)) {
      throw error;
    }

    /*
     * Some Current RMS accounts reject the date filter.
     * If that happens, retrieve the active opportunity list and perform
     * all date filtering inside this application.
     */
    console.warn(
      `[Current RMS] Date filter was rejected (${error.status}); ` +
        "retrying without it."
    );

    return fetchPaginated(
  "/opportunities",
  {
    "q[s][]": "id asc"
  },
  ["opportunities"],
  maximumRecords
);
  }
}

function validTimestamp(value) {
  if (!value) return null;

  const timestamp = new Date(value).getTime();

  return Number.isFinite(timestamp) ? timestamp : null;
}

function summaryRange(opportunity) {
  const dates = scheduleDates(opportunity);

  const startValues = [
    dates.prepAt,
    dates.loadAt,
    dates.deliverAt,
    dates.showAt,
    opportunity?.starts_at,
    opportunity?.start_at
  ]
    .map(validTimestamp)
    .filter((value) => value !== null);

  const endValues = [
    dates.returnAt,
    dates.returnEndsAt,
    opportunity?.ends_at,
    opportunity?.end_at
  ]
    .map(validTimestamp)
    .filter((value) => value !== null);

  const allValues = [...startValues, ...endValues];

  if (!allValues.length) {
    return {
      hasDates: false,
      start: Number.POSITIVE_INFINITY,
      end: Number.POSITIVE_INFINITY
    };
  }

  return {
    hasDates: true,

    start: startValues.length
      ? Math.min(...startValues)
      : Math.min(...allValues),

    end: endValues.length
      ? Math.max(...endValues)
      : Math.max(...allValues)
  };
}

function summaryOverlapsDateRange(opportunity, fromDate, toDate) {
  const range = summaryRange(opportunity);

  /*
   * If the summary record contains no dates, keep it as a candidate.
   * The full opportunity record may contain prep and load dates that
   * are not included in the summary response.
   */
  if (!range.hasDates) {
    return true;
  }

  const from = new Date(`${fromDate}T00:00:00Z`).getTime();
  const to = new Date(`${toDate}T23:59:59Z`).getTime();

  /*
   * Include any opportunity whose overall period overlaps the selected
   * dashboard date range.
   */
  return range.end >= from && range.start <= to;
}

function summarySortValue(opportunity) {
  const range = summaryRange(opportunity);

  return range.start;
}

async function retrieveOpportunity(id) {
  /*
   * Different Current RMS accounts/API versions accept different
   * include values, so try several combinations.
   */
  const includeAttempts = [
    ["opportunity_items", "opportunity_item_assets", "customer"],
    ["opportunity_items", "customer"],
    ["opportunity_items"],
    []
  ];

  let lastError;

  for (const includes of includeAttempts) {
    try {
      const payload = await currentRequest(
        `/opportunities/${id}`,
        {
          "include[]": includes
        }
      );

      return extractSingle(payload, ["opportunity"]);
    } catch (error) {
      lastError = error;

      if (![400, 404, 422].includes(error.status)) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function retrieveOpportunityItems(opportunityId) {
  /*
   * Try both possible routes for obtaining opportunity items.
   */
  const routeAttempts = [
    `/opportunities/${opportunityId}/opportunity_items`,
    "/opportunity_items"
  ];

  for (const route of routeAttempts) {
    try {
      const params =
        route === "/opportunity_items"
          ? {
              "q[opportunity_id_eq]": opportunityId
            }
          : {};

      const items = await fetchPaginated(
        route,
        params,
        ["opportunity_items"],
        1000
      );

      if (items.length) {
        return items;
      }
    } catch (error) {
      if (![400, 404, 422].includes(error.status)) {
        throw error;
      }
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

      results[index] = await mapper(
        values[index],
        index
      );
    }
  }

  const workerCount = Math.min(
    limit,
    values.length
  );

  await Promise.all(
    Array.from(
      { length: workerCount },
      () => worker()
    )
  );

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

function jobSortValue(job) {
  const value =
    job.prepAt ||
    job.loadAt ||
    job.deliverAt ||
    job.showAt ||
    job.returnAt;

  const timestamp = validTimestamp(value);

  return timestamp ?? Number.POSITIVE_INFINITY;
}

export async function getWarehouseJobs({
  fromDate,
  toDate
}) {
  const { subdomain } = requiredConfiguration();

  /*
   * Maximum number of opportunity detail records to load.
   * This protects the Current RMS API from excessive requests.
   */
  const maximum = envNumber(
    "MAX_OPPORTUNITIES",
    45
  );

  const includeCustomerName =
    String(
      process.env.INCLUDE_CUSTOMER_NAME ?? "true"
    ).toLowerCase() === "true";

  /*
   * First retrieve the Current RMS opportunity list.
   */
  const list = await listOpportunities(fromDate);

  /*
   * Remove cancelled, lost and completed opportunities.
   *
   * Quotations and provisional opportunities remain included.
   */
  const activeOpportunities = list.filter(
    opportunityLooksActive
  );

  /*
   * Use the summary rental/event dates to select opportunities which
   * overlap the chosen dashboard range.
   *
   * Jobs with no visible summary dates are also retained because their
   * prep/load dates may only appear in the full opportunity response.
   */
  const summariesInRange = activeOpportunities
    .filter((opportunity) =>
      summaryOverlapsDateRange(
        opportunity,
        fromDate,
        toDate
      )
    )
    .sort(
      (a, b) =>
        summarySortValue(a) -
        summarySortValue(b)
    );

  /*
   * Only apply the API safety limit after selecting opportunities
   * which overlap the date range.
   *
   * This prevents booked-out jobs from taking all available slots
   * before upcoming opportunities are considered.
   */
  const candidates =
    maximum > 0
      ? summariesInRange.slice(0, maximum)
      : summariesInRange;

  console.log(
    `[Current RMS] listed=${list.length} ` +
      `activeOpportunities=${activeOpportunities.length} ` +
      `summariesInRange=${summariesInRange.length} ` +
      `loadingDetails=${candidates.length}`
  );

  /*
   * Retrieve each opportunity's full details.
   */
  const jobs = await mapWithConcurrency(
    candidates,
    4,
    async (summary) => {
      const id =
        summary.id ||
        summary.opportunity_id;

      if (!id) {
        return null;
      }

      try {
        const detail =
          await retrieveOpportunity(id);

        let items = [];

        /*
         * If the full opportunity did not include its item lines,
         * retrieve them separately.
         */
        if (!hasEmbeddedItems(detail)) {
          items =
            await retrieveOpportunityItems(id);
        }

        return normaliseOpportunity(
          detail,
          items,
          {
            subdomain,
            includeCustomerName
          }
        );
      } catch (error) {
        /*
         * One broken opportunity should not prevent the entire
         * warehouse dashboard from loading.
         */
        console.error(
          `[Current RMS] Could not load opportunity ${id}: ` +
            error.message
        );

        return null;
      }
    }
  );

  const normalisedJobs = jobs.filter(Boolean);

  /*
   * Apply the final filter using the detailed scheduler dates.
   *
   * These include:
   * - Prep date
   * - Load-out date
   * - Delivery date
   * - Event/start date
   * - Return/unload date
   */
  const relevantJobs = normalisedJobs
    .filter((job) =>
      isRelevantToDateRange(
        job,
        fromDate,
        toDate
      )
    )
    .sort(
      (a, b) =>
        jobSortValue(a) -
        jobSortValue(b)
    );

  console.log(
    `[Current RMS] normalised=${normalisedJobs.length} ` +
      `relevant=${relevantJobs.length}`
  );

  return relevantJobs;
}

export async function getOpportunityDiagnostics(
  opportunityId
) {
  const detail =
    await retrieveOpportunity(opportunityId);

  const items = hasEmbeddedItems(detail)
    ? []
    : await retrieveOpportunityItems(
        opportunityId
      );

  return diagnosticSummary(
    detail,
    items
  );
}