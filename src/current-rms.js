import {
  diagnosticSummary,
  extractCollection,
  extractSingle,
  isRelevantToDateRange,
  normaliseOpportunity,
  opportunityLooksActive,
  scheduleDates,
  warehouseItemDiagnostics
} from "./normalise.js";

const API_BASE = "https://api.current-rms.com/api/v1";

/**
 * Read a numeric environment variable.
 */
function envNumber(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Confirm that the Current RMS connection settings exist.
 */
function requiredConfiguration() {
  const subdomain =
    process.env.CURRENT_RMS_SUBDOMAIN?.trim();

  const apiKey =
    process.env.CURRENT_RMS_API_KEY?.trim();

  if (!subdomain || !apiKey) {
    throw new Error(
      "CURRENT_RMS_SUBDOMAIN and CURRENT_RMS_API_KEY must be configured."
    );
  }

  return {
    subdomain,
    apiKey
  };
}

/**
 * Add parameters to a URL.
 *
 * Array values are added more than once, for example:
 * q[id_in][]=1&q[id_in][]=2
 */
function appendParams(url, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(
          key,
          String(item)
        );
      }
    } else {
      url.searchParams.set(
        key,
        String(value)
      );
    }
  }
}

/**
 * Send one authenticated request to Current RMS.
 */
async function currentRequest(path, params = {}) {
  const {
    subdomain,
    apiKey
  } = requiredConfiguration();

  const url = new URL(
    `${API_BASE}${path}`
  );

  appendParams(url, params);

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    20_000
  );

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-AUTH-TOKEN": apiKey,
        "X-SUBDOMAIN": subdomain,
        "User-Agent":
          "Wolf-Warehouse-Dashboard/1.0"
      },
      signal: controller.signal
    });

    const text = await response.text();

    let payload;

    try {
      payload = text
        ? JSON.parse(text)
        : {};
    } catch {
      payload = {
        raw: text
      };
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

/**
 * Extract pagination information from a Current RMS response.
 */
function paginationInformation(
  payload,
  currentPage,
  resultLength
) {
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
    Number.isFinite(declaredPerPage) &&
    declaredPerPage > 0
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

    totalRowCount:
      Number.isFinite(totalRowCount)
        ? totalRowCount
        : null,

    actualPageSize
  };
}

/**
 * Retrieve every available page from an API endpoint.
 */
async function fetchPaginated(
  path,
  params,
  preferredKeys,
  maximumRecords = 1000
) {
  const requestedPerPage = 100;

  const all = [];
  const seenIds = new Set();

  for (
    let page = 1;
    page <= 100;
    page += 1
  ) {
    const payload = await currentRequest(
      path,
      {
        ...params,
        page,
        per_page: requestedPerPage
      }
    );

    const records = extractCollection(
      payload,
      preferredKeys
    );

    let newRecordsOnPage = 0;

    for (const record of records) {
      const recordId =
        record?.id ??
        record?.opportunity_id ??
        record?.opportunity_item_id ??
        record?.member_id;

      /*
       * Prevent duplicate pages from creating an
       * infinite loop.
       */
      if (
        recordId !== undefined &&
        recordId !== null
      ) {
        const uniqueKey =
          String(recordId);

        if (seenIds.has(uniqueKey)) {
          continue;
        }

        seenIds.add(uniqueKey);
      }

      all.push(record);
      newRecordsOnPage += 1;

      if (
        all.length >= maximumRecords
      ) {
        break;
      }
    }

    const pagination =
      paginationInformation(
        payload,
        page,
        records.length
      );

    console.log(
      `[Current RMS] page=${page} ` +
      `received=${records.length} ` +
      `new=${newRecordsOnPage} ` +
      `totalLoaded=${all.length} ` +
      `totalAvailable=${
        pagination.totalRowCount ??
        "unknown"
      }`
    );

    if (
      all.length >= maximumRecords
    ) {
      break;
    }

    if (records.length === 0) {
      break;
    }

    if (newRecordsOnPage === 0) {
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
      all.length >=
        pagination.totalRowCount
    ) {
      break;
    }
  }

  return all.slice(
    0,
    maximumRecords
  );
}

/**
 * Add or subtract days from a YYYY-MM-DD value.
 */
function addDays(
  dateString,
  numberOfDays
) {
  const date = new Date(
    `${dateString}T00:00:00Z`
  );

  date.setUTCDate(
    date.getUTCDate() +
    numberOfDays
  );

  return date.toISOString();
}

/**
 * Retrieve the list of Current RMS opportunities.
 */
async function listOpportunities(fromDate) {
  const maximumRecords = envNumber(
    "MAX_LIST_RECORDS",
    1000
  );

  /*
   * Include jobs which finished up to 30 days before
   * the selected start date. This means booked-out
   * jobs which are still due back can remain visible.
   */
  const broadFrom = addDays(
    fromDate,
    -30
  );

  try {
    return await fetchPaginated(
      "/opportunities",
      {
        "q[ends_at_gteq]":
          broadFrom,

        "q[s][]":
          "id asc"
      },
      ["opportunities"],
      maximumRecords
    );
  } catch (error) {
    if (
      ![400, 422].includes(
        error.status
      )
    ) {
      throw error;
    }

    /*
     * Some Current RMS accounts reject the date
     * filter. Retrieve all active opportunities and
     * filter them within this application instead.
     */
    console.warn(
      `[Current RMS] Date filter was rejected ` +
      `(${error.status}); retrying without it.`
    );

    return fetchPaginated(
      "/opportunities",
      {
        "q[s][]":
          "id asc"
      },
      ["opportunities"],
      maximumRecords
    );
  }
}

/**
 * Convert a date value into a sortable timestamp.
 */
function validTimestamp(value) {
  if (!value) {
    return null;
  }

  const timestamp =
    new Date(value).getTime();

  return Number.isFinite(timestamp)
    ? timestamp
    : null;
}

/**
 * Find the overall date period available in an
 * opportunity summary record.
 */
function summaryRange(opportunity) {
  const dates =
    scheduleDates(opportunity);

  const startValues = [
    dates.prepAt,
    dates.loadAt,
    dates.deliverAt,
    dates.showAt,
    opportunity?.starts_at,
    opportunity?.start_at
  ]
    .map(validTimestamp)
    .filter(
      (value) =>
        value !== null
    );

  const endValues = [
    dates.returnAt,
    dates.returnEndsAt,
    opportunity?.ends_at,
    opportunity?.end_at
  ]
    .map(validTimestamp)
    .filter(
      (value) =>
        value !== null
    );

  const allValues = [
    ...startValues,
    ...endValues
  ];

  if (!allValues.length) {
    return {
      hasDates: false,
      start:
        Number.POSITIVE_INFINITY,
      end:
        Number.POSITIVE_INFINITY
    };
  }

  return {
    hasDates: true,

    start:
      startValues.length
        ? Math.min(...startValues)
        : Math.min(...allValues),

    end:
      endValues.length
        ? Math.max(...endValues)
        : Math.max(...allValues)
  };
}

/**
 * Check whether an opportunity summary overlaps the
 * dashboard date range.
 */
function summaryOverlapsDateRange(
  opportunity,
  fromDate,
  toDate
) {
  const range =
    summaryRange(opportunity);

  /*
   * Keep summaries without visible dates. The full
   * opportunity may contain scheduler dates which
   * are absent from the summary.
   */
  if (!range.hasDates) {
    return true;
  }

  const from = new Date(
    `${fromDate}T00:00:00Z`
  ).getTime();

  const to = new Date(
    `${toDate}T23:59:59Z`
  ).getTime();

  return (
    range.end >= from &&
    range.start <= to
  );
}

/**
 * Sort summaries by their earliest available date.
 */
function summarySortValue(opportunity) {
  return summaryRange(
    opportunity
  ).start;
}

/**
 * Retrieve one complete opportunity.
 */
async function retrieveOpportunity(id) {
  /*
   * Current RMS accounts can differ in which include
   * values are accepted, so try several combinations.
   */
  const includeAttempts = [
    [
      "opportunity_items",
      "opportunity_item_assets",
      "customer"
    ],

    [
      "opportunity_items",
      "customer"
    ],

    [
      "opportunity_items"
    ],

    []
  ];

  let lastError;

  for (
    const includes of includeAttempts
  ) {
    try {
      const payload =
        await currentRequest(
          `/opportunities/${id}`,
          {
            "include[]":
              includes
          }
        );

      return extractSingle(
        payload,
        ["opportunity"]
      );
    } catch (error) {
      lastError = error;

      if (
        ![400, 404, 422].includes(
          error.status
        )
      ) {
        throw error;
      }
    }
  }

  throw lastError;
}

/**
 * Retrieve item lines separately when they are not
 * included in the opportunity response.
 */
async function retrieveOpportunityItems(
  opportunityId
) {
  const routeAttempts = [
    `/opportunities/${opportunityId}/opportunity_items`,
    "/opportunity_items"
  ];

  for (
    const route of routeAttempts
  ) {
    try {
      const params =
        route ===
        "/opportunity_items"
          ? {
              "q[opportunity_id_eq]":
                opportunityId,

              "q[s][]":
                "id asc"
            }
          : {
              "q[s][]":
                "id asc"
            };

      const items =
        await fetchPaginated(
          route,
          params,
          ["opportunity_items"],
          1000
        );

      if (items.length) {
        return items;
      }
    } catch (error) {
      if (
        ![400, 404, 422].includes(
          error.status
        )
      ) {
        throw error;
      }
    }
  }

  return [];
}

/**
 * Choose a readable name from a Current RMS member
 * record.
 */
function memberDisplayName(member) {
  if (
    !member ||
    typeof member !== "object"
  ) {
    return "";
  }

  const directName =
    member.name ||
    member.display_name ||
    member.organisation_name ||
    member.organization_name ||
    member.company_name ||
    member.trading_name ||
    member.billing_address_name;

  if (directName) {
    return String(
      directName
    ).trim();
  }

  const contactName = [
    member.first_name,
    member.last_name
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  return contactName;
}

/**
 * Retrieve all required Current RMS client/member
 * records in batches.
 */
async function retrieveMembers(memberIds) {
  const uniqueIds = [
    ...new Set(
      memberIds
        .filter(
          (id) =>
            id !== undefined &&
            id !== null &&
            id !== ""
        )
        .map(String)
    )
  ];

  const membersById =
    new Map();

  if (!uniqueIds.length) {
    return membersById;
  }

  /*
   * Retrieve up to 50 requested members per batch.
   */
  for (
    let startIndex = 0;
    startIndex <
    uniqueIds.length;
    startIndex += 50
  ) {
    const batchIds =
      uniqueIds.slice(
        startIndex,
        startIndex + 50
      );

    try {
      const members =
        await fetchPaginated(
          "/members",
          {
            "q[id_in][]":
              batchIds,

            "q[s][]":
              "id asc"
          },
          ["members"],
          batchIds.length
        );

      for (const member of members) {
        if (
          member?.id !== undefined &&
          member?.id !== null
        ) {
          membersById.set(
            String(member.id),
            member
          );
        }
      }
    } catch (error) {
      console.error(
        "[Current RMS] Could not retrieve " +
        `client records: ${error.message}`
      );
    }
  }

  console.log(
    `[Current RMS] requestedMembers=${uniqueIds.length} ` +
    `loadedMembers=${membersById.size}`
  );

  return membersById;
}

/**
 * Run asynchronous work with a fixed number of
 * simultaneous requests.
 */
async function mapWithConcurrency(
  values,
  limit,
  mapper
) {
  const results =
    new Array(values.length);

  let nextIndex = 0;

  async function worker() {
    while (
      nextIndex < values.length
    ) {
      const index = nextIndex;

      nextIndex += 1;

      results[index] =
        await mapper(
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
      {
        length: workerCount
      },
      () => worker()
    )
  );

  return results;
}

/**
 * Check whether opportunity item lines are already
 * embedded in an opportunity response.
 */
function hasEmbeddedItems(opportunity) {
  return [
    opportunity?.opportunity_items,
    opportunity?.items,
    opportunity?.rental_items,
    opportunity?.included_items
  ].some(Array.isArray);
}

/**
 * Sort normalised jobs by their earliest warehouse
 * or event date.
 */
function jobSortValue(job) {
  const value =
    job.prepAt ||
    job.loadAt ||
    job.deliverAt ||
    job.showAt ||
    job.returnAt;

  const timestamp =
    validTimestamp(value);

  return (
    timestamp ??
    Number.POSITIVE_INFINITY
  );
}

/**
 * Retrieve and normalise warehouse jobs.
 */
export async function getWarehouseJobs({
  fromDate,
  toDate
}) {
  const {
    subdomain
  } = requiredConfiguration();

  /*
   * Maximum number of full opportunity records to
   * load during one refresh.
   */
  const maximum = envNumber(
    "MAX_OPPORTUNITIES",
    55
  );

  const includeCustomerName =
    String(
      process.env
        .INCLUDE_CUSTOMER_NAME ??
      "true"
    ).toLowerCase() === "true";

  /*
   * Retrieve the opportunity summary list.
   */
  const list =
    await listOpportunities(
      fromDate
    );

  /*
   * Remove cancelled, lost and completed records.
   * Quotations and provisional opportunities remain.
   */
  const activeOpportunities =
    list.filter(
      opportunityLooksActive
    );

  /*
   * Select opportunities whose visible summary
   * dates overlap the dashboard range.
   */
  const summariesInRange =
    activeOpportunities
      .filter(
        (opportunity) =>
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
   * Apply the API safety limit after selecting the
   * relevant date range.
   */
  const candidates =
    maximum > 0
      ? summariesInRange.slice(
          0,
          maximum
        )
      : summariesInRange;

  console.log(
    `[Current RMS] listed=${list.length} ` +
    `activeOpportunities=${activeOpportunities.length} ` +
    `summariesInRange=${summariesInRange.length} ` +
    `loadingDetails=${candidates.length}`
  );

  /*
   * Load each full opportunity and its item lines.
   */
  const loadedOpportunities =
    await mapWithConcurrency(
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
            await retrieveOpportunity(
              id
            );

          let items = [];

          if (
            !hasEmbeddedItems(
              detail
            )
          ) {
            items =
              await retrieveOpportunityItems(
                id
              );
          }

          return {
            detail,
            items
          };
        } catch (error) {
          console.error(
            `[Current RMS] Could not load ` +
            `opportunity ${id}: ` +
            error.message
          );

          return null;
        }
      }
    );

  const successfullyLoaded =
    loadedOpportunities.filter(
      Boolean
    );

  /*
   * Opportunities contain member_id rather than the
   * client name. Collect the member IDs and retrieve
   * the matching member records.
   */
  const memberIds =
    successfullyLoaded
      .map(
        ({ detail }) =>
          detail.member_id ??
          detail.customer_id
      )
      .filter(
        (id) =>
          id !== undefined &&
          id !== null
      );

  const membersById =
    includeCustomerName
      ? await retrieveMembers(
          memberIds
        )
      : new Map();

  /*
   * Normalise each opportunity and add its matching
   * client/member name.
   */
  const jobs =
    successfullyLoaded.map(
      ({
        detail,
        items
      }) => {
        const memberId =
          detail.member_id ??
          detail.customer_id;

        const member =
          memberId !== undefined &&
          memberId !== null
            ? membersById.get(
                String(memberId)
              )
            : null;

        return normaliseOpportunity(
          detail,
          items,
          {
            subdomain,
            includeCustomerName,

            customerName:
              memberDisplayName(
                member
              )
          }
        );
      }
    );

  /*
   * Apply the final date check using the full
   * scheduler dates from each detailed opportunity.
   */
  const relevantJobs = jobs
    .filter(Boolean)
    .filter(
      (job) =>
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
    `[Current RMS] normalised=${jobs.length} ` +
    `relevant=${relevantJobs.length}`
  );

  return relevantJobs;
}

/**
 * Return a limited diagnostic view of an opportunity.
 */
export async function getOpportunityDiagnostics(
  opportunityId
) {
  const detail =
    await retrieveOpportunity(
      opportunityId
    );

  const items =
    hasEmbeddedItems(detail)
      ? []
      : await retrieveOpportunityItems(
          opportunityId
        );

  return diagnosticSummary(
    detail,
    items
  );
}

export async function getWarehouseItemDiagnostics(
  opportunityId
) {
  const detail =
    await retrieveOpportunity(
      opportunityId
    );

  const items =
    hasEmbeddedItems(detail)
      ? []
      : await retrieveOpportunityItems(
          opportunityId
        );

  return warehouseItemDiagnostics(
    detail,
    items
  );
}

export async function getOpportunityItemDiagnostics(
  opportunityItemId
) {
  const pathAttempts = [
    `/opportunity_items/${opportunityItemId}`,
    `/opportunity-items/${opportunityItemId}`
  ];

  let lastError;

  for (const path of pathAttempts) {
    try {
      return await currentRequest(path);
    } catch (error) {
      lastError = error;

      if (![400, 404, 422].includes(error.status)) {
        throw error;
      }
    }
  }

  throw lastError;
}