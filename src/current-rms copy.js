import {
  diagnosticSummary,
  extractCollection,
  extractSingle,
  isRelevantToDateRange,
  normaliseOpportunity,
  opportunityLooksActive,
  opportunityLooksLikeOrder,
  scheduleDates,
  warehouseItemDiagnostics
} from "./normalise.js";

const API_BASE = "https://api.current-rms.com/api/v1";

let nextRequestAt = 0;
let requestCount = 0;

async function waitForRequestSlot() {
  const minimumGap = Math.max(
    1050,
    Number(process.env.CURRENT_RMS_REQUEST_GAP_MS || 1100)
  );
  const wait = Math.max(0, nextRequestAt - Date.now());
  nextRequestAt = Math.max(Date.now(), nextRequestAt) + minimumGap;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

export function consumeCurrentRmsRequestCount() {
  const value = requestCount;
  requestCount = 0;
  return value;
}

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
  await waitForRequestSlot();
  requestCount += 1;

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
 * Send one authenticated JSON write request to Current RMS.
 */
async function currentWriteRequest(
  method,
  path,
  body
) {
  await waitForRequestSlot();
  requestCount += 1;

  const {
    subdomain,
    apiKey
  } = requiredConfiguration();

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    30_000
  );

  try {
    const response = await fetch(
      `${API_BASE}${path}`,
      {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-AUTH-TOKEN": apiKey,
          "X-SUBDOMAIN": subdomain,
          "User-Agent":
            "Wolf-Staff-Hub/1.0"
        },
        body:
          JSON.stringify(body),
        signal:
          controller.signal
      }
    );

    const text =
      await response.text();

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

      const error =
        new Error(message);

      error.status =
        response.status;

      error.payload =
        payload;

      throw error;
    }

    return {
      status:
        response.status,
      payload
    };
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

        "q[item_type_eq]":
          "Service",

        "q[s][]":
          "id asc",

        "include[]": [
          "item",
          "custom_fields",
          "item_allocations",
          "item_assets",
          "opportunity_item_resources"
        ]
      }
    : {
        "q[item_type_eq]":
          "Service",

        "q[s][]":
          "id asc",

        "include[]": [
          "item",
          "custom_fields",
          "item_allocations",
          "item_assets",
          "opportunity_item_resources"
        ]
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

function scalarIds(value) {
  if (Array.isArray(value)) return value.flatMap(scalarIds);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(scalarIds);
  }
  return value === undefined || value === null ? [] : [String(value)];
}

function recordContainsAssignment(record, recordType, recordId, isOpportunityRoot = false) {
  if (!record || typeof record !== "object") return false;

  const wanted = String(recordId);
  const keyPattern = recordType === "contact"
    ? /(assigned_)?contact(_id|_ids)?$|bookable_resource(_id|_ids)?$|resource(_id|_ids)?$/i
    : /(assigned_)?member(_id|_ids)?$|user(_id|_ids)?$|bookable_resource(_id|_ids)?$|resource(_id|_ids)?$/i;

  for (const [key, value] of Object.entries(record)) {
    if (isOpportunityRoot && ["member_id", "customer_id", "contact_id"].includes(key)) {
      continue;
    }

    if (keyPattern.test(key) && scalarIds(value).includes(wanted)) {
      return true;
    }

    if (value && typeof value === "object" && recordContainsAssignment(value, recordType, recordId, false)) {
      return true;
    }
  }

  return false;
}

function loadedOpportunityAssignedTo(loaded, assignment) {
  if (
    !assignment?.recordId ||
    !["member", "contact"].includes(assignment.recordType)
  ) {
    return false;
  }

  return (
    recordContainsAssignment(
      loaded.detail,
      assignment.recordType,
      assignment.recordId,
      true
    ) ||
    recordContainsAssignment(
      loaded.items,
      assignment.recordType,
      assignment.recordId,
      false
    )
  );
}

function assignedServicesForUser(
  items,
  assignment
) {
  if (
    !assignment?.recordId ||
    !["member", "contact"].includes(
      assignment.recordType
    )
  ) {
    return [];
  }

  const values =
    Array.isArray(items)
      ? items
      : [];

  return values
    .filter((item) =>
      recordContainsAssignment(
        item,
        assignment.recordType,
        assignment.recordId,
        false
      )
    )
    .map((item) => ({
      opportunityItemId:
        item.id || null,

      serviceId:
        item.item_id || null,

      name:
        item.name ||
        item.item?.name ||
        "Assigned service",

      startsAt:
        item.starts_at ||
        item.start_at ||
        null,

      endsAt:
        item.ends_at ||
        item.end_at ||
        null,

      quantity:
        Number(item.quantity || 1)
    }));
}

export async function getWarehouseJobs({
  fromDate,
  toDate,
  assignment = null
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

         items =
  await retrieveOpportunityItems(
    id
  );

if (!items.length) {
  items =
    Array.isArray(
      detail?.opportunity_items
    )
      ? detail.opportunity_items
      : [];
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
    loadedOpportunities
      .filter(Boolean)
      .filter((loaded) => {
        if (!assignment) {
          return true;
        }

        return loadedOpportunityAssignedTo(
          loaded,
          assignment
        );
      });



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

       const job =
  normaliseOpportunity(
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

if (!job) {
  return null;
}

job.assignments =
  assignment
    ? assignedServicesForUser(
        items,
        assignment
      )
    : [];

job.assignedRole =
  [
    ...new Set(
      job.assignments
        .map(
          (service) =>
            service.name
        )
        .filter(Boolean)
    )
  ].join(", ");

job.callAt =
  job.assignments
    .map(
      (service) =>
        service.startsAt
    )
    .filter(Boolean)
    .sort()[0] ||
  job.showAt ||
  job.deliverAt ||
  null;

job.finishAt =
  job.assignments
    .map(
      (service) =>
        service.endsAt
    )
    .filter(Boolean)
    .sort()
    .at(-1) ||
  job.returnAt ||
  null;

return job;
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
 * Probe a controlled list of possible Current RMS allocation
 * collections. This is diagnostic-only and returns limited
 * metadata rather than complete customer/job records.
 */
export async function probeOpportunityAllocations({
  opportunityId,
  opportunityItemId,
  recordId
}) {
  const attempts = [
    "/allocations",
    "/opportunity_allocations",
    "/opportunity-allocations",
    "/opportunity_item_allocations",
    "/opportunity-item-allocations",
    "/opportunity_item_resource_allocations",
    "/opportunity-item-resource-allocations",
    "/opportunity_item_resources",
    "/opportunity-item-resources",
    "/allocated_resources",
    "/allocated-resources",
    "/resource_allocations",
    "/resource-allocations",
    "/resource_bookings",
    "/resource-bookings",
    "/bookable_resource_bookings",
    "/bookable-resource-bookings",
    "/service_allocations",
    "/service-allocations"
  ];

  function findMatches(value, target, path = "root", matches = []) {
    if (value === null || value === undefined) {
      return matches;
    }

    if (String(value) === String(target)) {
      matches.push(path);
    }

    if (Array.isArray(value)) {
      value.forEach((child, index) => {
        findMatches(child, target, `${path}[${index}]`, matches);
      });

      return matches;
    }

    if (typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        findMatches(child, target, `${path}.${key}`, matches);
      }
    }

    return matches;
  }

  const results = [];

  for (const path of attempts) {
    try {
      const payload = await currentRequest(path, {
        "q[opportunity_id_eq]": opportunityId,
        "q[opportunity_item_id_eq]": opportunityItemId,
        page: 1,
        per_page: 100,
        filtermode: "all"
      });

      const records = extractCollection(payload, [
        "allocations",
        "opportunity_allocations",
        "opportunity_item_allocations",
        "opportunity_item_resource_allocations",
        "opportunity_item_resources",
        "allocated_resources",
        "resource_allocations",
        "resource_bookings",
        "bookable_resource_bookings",
        "service_allocations"
      ]);

      const sampleKeys = [
        ...new Set(
          records.slice(0, 10).flatMap((record) =>
            record && typeof record === "object"
              ? Object.keys(record)
              : []
          )
        )
      ].sort();

      results.push({
        path,
        status: "available",
        recordCount: records.length,
        topLevelKeys:
          payload && typeof payload === "object"
            ? Object.keys(payload).sort()
            : [],
        sampleKeys,
        matches: {
          recordId: findMatches(records, recordId),
          opportunityId: findMatches(records, opportunityId),
          opportunityItemId: findMatches(records, opportunityItemId)
        }
      });
    } catch (error) {
      results.push({
        path,
        status: "rejected",
        httpStatus: error.status || null,
        message: error.message
      });
    }
  }

  return {
    opportunityId: String(opportunityId),
    opportunityItemId: String(opportunityItemId),
    recordId: String(recordId),
    attempts: results
  };
}

/**
 * Return a limited diagnostic view of an opportunity.
 */


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

function relationRecords(record, names) {
  const found = [];

  for (const name of names) {
    const value = record?.[name];

    if (Array.isArray(value)) {
      found.push(...value);
    } else if (
      value &&
      typeof value === "object"
    ) {
      const nested =
        extractCollection(
          value,
          [
            name,
            "item_allocations",
            "opportunity_item_resources",
            "allocations",
            "resources"
          ]
        );

      if (Array.isArray(nested)) {
        found.push(...nested);
      }
    }
  }

  return found;
}

function activeAllocation(record) {
  const status =
    String(
      record?.status_name ||
      record?.status ||
      record?.state_name ||
      record?.state ||
      ""
    ).toLowerCase();

  return !(
    status.includes("cancel") ||
    status.includes("declin") ||
    status.includes("removed")
  );
}

function allocationIdentity(record) {
  return String(
    record?.member_id ??
    record?.contact_id ??
    record?.resource_id ??
    record?.bookable_resource_id ??
    record?.item_id ??
    record?.id ??
    ""
  );
}

function allocatedQuantity(item) {
  const records =
    relationRecords(
      item,
      [
        "item_allocations",
        "opportunity_item_resources",
        "allocations",
        "resources"
      ]
    )
      .filter(activeAllocation);

  const identities =
    new Set();

  let anonymousQuantity = 0;

  for (const record of records) {
    const identity =
      allocationIdentity(record);

    if (identity) {
      identities.add(identity);
      continue;
    }

    const quantity =
      Number(record?.quantity || 1);

    anonymousQuantity +=
      Number.isFinite(quantity)
        ? quantity
        : 1;
  }

  return (
    identities.size +
    anonymousQuantity
  );
}

function isStaffServiceItem(
  item
) {
  const itemType =
    String(
      item?.item_type ||
      item?.item?.item_type ||
      ""
    ).toLowerCase();

  const transactionType =
    String(
      item?.transaction_type_name ||
      item?.transaction_type ||
      ""
    ).toLowerCase();

  const name =
    String(
      item?.name ||
      item?.item?.name ||
      ""
    ).toLowerCase();

  const excludedTerms = [
    "motor",
    "shackle",
    "zarges",
    "hammer",
    "controller",
    "flood",
    "truss",
    "cable"
  ];

  const looksLikeEquipment =
    excludedTerms.some(
      (term) =>
        name.includes(term)
    );

  const hasResourceRelations =
    Array.isArray(
      item?.opportunity_item_resources
    ) ||
    Array.isArray(
      item?.item_allocations
    ) ||
    Array.isArray(
      item?.allocations
    );

  return (
    !looksLikeEquipment &&
    (
      itemType === "service" ||
      transactionType === "service" ||
      hasResourceRelations
    )
  );
}

function serviceItemLooksOpen(item) {
  const status =
    String(
      item?.status_name ||
      item?.status ||
      ""
    ).toLowerCase();

  return !(
    status.includes("cancel") ||
    status.includes("removed") ||
    status.includes("declined")
  );
}

function normaliseOpenPosition(
  opportunity,
  item,
  subdomain
) {
  const required =
    Math.max(
      0,
      Math.ceil(
        Number(
          item?.quantity || 0
        )
      )
    );

  const allocated =
    Math.max(
      0,
      allocatedQuantity(item)
    );

  const openPositions =
    Math.max(
      0,
      required - allocated
    );

  if (!openPositions) {
    return null;
  }

  return {
    opportunityId:
      String(
        opportunity?.id ||
        opportunity?.opportunity_id ||
        ""
      ),

    opportunityItemId:
      String(item?.id || ""),

    serviceId:
      String(item?.item_id || ""),

    reference:
      opportunity?.reference ||
      opportunity?.number ||
      "",

    name:
      opportunity?.subject ||
      opportunity?.name ||
      opportunity?.description ||
      "Unnamed opportunity",

    customer:
      opportunity?.customer_name ||
      opportunity?.member_name ||
      opportunity?.billing_address_name ||
      "",

    serviceName:
      item?.name ||
      item?.item?.name ||
      "Available position",

    startsAt:
      item?.starts_at ||
      item?.start_at ||
      opportunity?.show_starts_at ||
      opportunity?.starts_at ||
      null,

    endsAt:
      item?.ends_at ||
      item?.end_at ||
      opportunity?.show_ends_at ||
      opportunity?.ends_at ||
      null,

    required,
    allocated,
    openPositions,

    currentRmsUrl:
      opportunity?.id
        ? `https://${subdomain}.current-rms.com/opportunities/${opportunity.id}`
        : null
  };
}

export async function getAvailableWork({
  fromDate,
  toDate,
  suitableServiceIds = [],
  excludeRecordId = null
}) {
  const { subdomain } =
    requiredConfiguration();

  const allowedServices =
    new Set(
      (Array.isArray(suitableServiceIds)
        ? suitableServiceIds
        : []
      )
        .map(String)
        .filter(Boolean)
    );

  const opportunities =
    (
      await listOpportunities(
        fromDate
      )
    )
      .filter(opportunityLooksActive)
      .filter(opportunityLooksLikeOrder)
      .filter((opportunity) =>
        summaryOverlapsDateRange(
          opportunity,
          fromDate,
          toDate
        )
      );

  const loaded =
    await mapWithConcurrency(
      opportunities,
      4,
      async (summary) => {
        const id =
          summary.id ||
          summary.opportunity_id;

        if (!id) {
          return [];
        }

        try {
          const detail =
            await retrieveOpportunity(id);

          const items =
            await retrieveOpportunityItems(id);

          return items
            .filter(isStaffServiceItem)
            .filter(serviceItemLooksOpen)
            .filter((item) => {
              if (!allowedServices.size) {
                return true;
              }

              return allowedServices.has(
                String(item?.item_id || "")
              );
            })
            .filter((item) => {
              if (!excludeRecordId) {
                return true;
              }

              return !recordContainsAssignment(
                item,
                "member",
                excludeRecordId,
                false
              );
            })
            .map((item) =>
              normaliseOpenPosition(
                detail || summary,
                item,
                subdomain
              )
            )
            .filter(Boolean);
        } catch (error) {
          console.warn(
            `[Current RMS] available work skipped opportunity ${id}:`,
            error.message
          );

          return [];
        }
      }
    );

  return loaded
    .flat()
    .filter((position) => {
      if (!position.startsAt) {
        return true;
      }

      const date =
        new Date(position.startsAt);

      const from =
        new Date(
          `${fromDate}T00:00:00Z`
        );

      const to =
        new Date(
          `${toDate}T23:59:59Z`
        );

      return (
        date >= from &&
        date <= to
      );
    })
    .sort((a, b) =>
      new Date(a.startsAt || 0) -
      new Date(b.startsAt || 0)
    );
}


function assignmentRecordMap(items) {
  const result = new Map();
  const keyPattern = /(assigned_)?(member|contact|user|bookable_resource|resource)(_id|_ids)?$/i;

  function visit(value, context = {}) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, context);
      return;
    }

    const serviceContext = {
      opportunityItemId: value.id || context.opportunityItemId || null,
      serviceId: value.item_id || context.serviceId || null,
      name: value.name || value.item?.name || context.name || "Assigned service",
      startsAt: value.starts_at || value.start_at || context.startsAt || null,
      endsAt: value.ends_at || value.end_at || context.endsAt || null,
      quantity: Number(value.quantity || context.quantity || 1)
    };

    for (const [key, nested] of Object.entries(value)) {
      const match = key.match(keyPattern);
      if (match) {
        const type = /contact/i.test(match[2]) ? "contact" : "member";
        for (const id of scalarIds(nested)) {
          if (!/^\d+$/.test(id)) continue;
          const mapKey = `${type}:${id}`;
          const existing =
            result.get(mapKey) || [];

          /*
           * Current RMS can expose the same allocation through
           * both item_allocations and opportunity_item_resources.
           * Nested allocation records have their own IDs, so
           * opportunityItemId alone is not a reliable duplicate key.
           * Treat matching service/time records as one shift.
           */
          const duplicate =
            existing.some(
              (entry) =>
                String(
                  entry.serviceId || ""
                ) ===
                  String(
                    serviceContext.serviceId || ""
                  ) &&
                String(
                  entry.name || ""
                ) ===
                  String(
                    serviceContext.name || ""
                  ) &&
                String(
                  entry.startsAt || ""
                ) ===
                  String(
                    serviceContext.startsAt || ""
                  ) &&
                String(
                  entry.endsAt || ""
                ) ===
                  String(
                    serviceContext.endsAt || ""
                  )
            );

          if (!duplicate) {
            existing.push(
              serviceContext
            );
          }

          result.set(
            mapKey,
            existing
          );
        }
      }
      if (nested && typeof nested === "object") visit(nested, serviceContext);
    }
  }

  visit(items);
  return Object.fromEntries(result);
}

export async function getSharedCurrentRmsSnapshot({ fromDate, toDate }) {
  const { subdomain } = requiredConfiguration();
  const maximum = envNumber("MAX_OPPORTUNITIES", 55);
  const includeCustomerName = String(process.env.INCLUDE_CUSTOMER_NAME ?? "true").toLowerCase() === "true";
  const list = await listOpportunities(fromDate);
  const candidates = list
    .filter(opportunityLooksActive)
    .filter((opportunity) => summaryOverlapsDateRange(opportunity, fromDate, toDate))
    .sort((a,b) => summarySortValue(a) - summarySortValue(b));
  const selected = maximum > 0 ? candidates.slice(0, maximum) : candidates;

  const loaded = await mapWithConcurrency(selected, 1, async (summary) => {
    const id = summary.id || summary.opportunity_id;
    if (!id) return null;
    try {
      const detail = await retrieveOpportunity(id);
      let items = await retrieveOpportunityItems(id);
      if (!items.length && Array.isArray(detail?.opportunity_items)) items = detail.opportunity_items;
      return { detail, items };
    } catch (error) {
      console.error(`[Current RMS cache] opportunity ${id}: ${error.message}`);
      return null;
    }
  });

  const usable = loaded.filter(Boolean);
  const memberIds = usable.map(({detail}) => detail.member_id ?? detail.customer_id).filter((id) => id != null);
  const membersById = includeCustomerName ? await retrieveMembers(memberIds) : new Map();
  const jobs = [];
  const openPositions = [];

  for (const {detail, items} of usable) {
    const memberId = detail.member_id ?? detail.customer_id;
    const member = memberId != null ? membersById.get(String(memberId)) : null;
    const job = normaliseOpportunity(detail, items, {
      subdomain,
      includeCustomerName,
      customerName: memberDisplayName(member)
    });

    if (job) {
      job.assignmentIndex = assignmentRecordMap(items);
      jobs.push(job);
    }

    /*
     * Quotes and provisional work remain visible on normal
     * dashboards, but only confirmed Current RMS orders may
     * create freelancer vacancies.
     */
    if (!opportunityLooksLikeOrder(detail)) {
      continue;
    }

    for (
      const item of items
        .filter(isStaffServiceItem)
        .filter(serviceItemLooksOpen)
    ) {
      const position =
        normaliseOpenPosition(
          detail,
          item,
          subdomain
        );

      if (!position) {
        continue;
      }

      position.assignedRecordKeys =
        Object.keys(
          assignmentRecordMap([item])
        );

      openPositions.push(position);
    }
  }

  jobs.sort((a,b) => jobSortValue(a) - jobSortValue(b));
  openPositions.sort((a,b) => new Date(a.startsAt || 0) - new Date(b.startsAt || 0));
  return { jobs, openPositions, fromDate, toDate, syncedAt: new Date().toISOString() };
}


/**
 * Perform a focused, live Current RMS validation for one
 * opportunity item. This is used immediately before an
 * approver accepts a freelancer, avoiding a slow scan of
 * every active opportunity.
 */
export async function validateAvailablePosition({
  opportunityId,
  opportunityItemId,
  excludeRecordId = null
}) {
  const { subdomain } =
    requiredConfiguration();

  if (
    !/^\d+$/.test(String(opportunityId || "")) ||
    !/^\d+$/.test(String(opportunityItemId || ""))
  ) {
    return {
      available: false,
      reason:
        "The Current RMS opportunity mapping is invalid."
    };
  }

  const detail =
    await retrieveOpportunity(
      opportunityId
    );

  const items =
    await retrieveOpportunityItems(
      opportunityId
    );

  const item =
    items.find(
      (candidate) =>
        String(candidate?.id || "") ===
        String(opportunityItemId)
    );

  if (!item || !isStaffServiceItem(item) || !serviceItemLooksOpen(item)) {
    return {
      available: false,
      reason:
        "The position no longer exists or is no longer open in Current RMS."
    };
  }

  if (
    excludeRecordId &&
    recordContainsAssignment(
      item,
      "member",
      excludeRecordId,
      false
    )
  ) {
    return {
      available: false,
      reason:
        "This freelancer is already allocated to the position in Current RMS."
    };
  }

  const position =
    normaliseOpenPosition(
      detail,
      item,
      subdomain
    );

  if (!position) {
    return {
      available: false,
      reason:
        "The position has already been filled in Current RMS."
    };
  }

  return {
    available: true,
    position
  };
}


function compactAllocationAsset(asset) {
  if (!asset || typeof asset !== "object") {
    return null;
  }

  return {
    id:
      asset.id ?? null,

    opportunityItemId:
      asset.opportunity_item_id ??
      asset.opportunityItemId ??
      null,

    stockLevelId:
      asset.stock_level_id ??
      asset.stockLevelId ??
      null,

    stockLevelMemberId:
      asset.stock_level_member_id ??
      asset.stockLevelMemberId ??
      asset.stock_level?.member_id ??
      null,

    stockLevelAssetNumber:
      asset.stock_level_asset_number ??
      asset.stock_level?.asset_number ??
      null,

    stockCategoryName:
      asset.stock_category_name ??
      asset.stock_level?.stock_category_name ??
      asset.stock_level?.stock_category?.name ??
      null,

    quantity:
      Number(asset.quantity || 1),

    status:
      asset.status_name ??
      asset.status ??
      null
  };
}

async function retrieveMemberRecord(memberId) {
  try {
    const payload =
      await currentRequest(
        `/members/${memberId}`
      );

    return extractSingle(
      payload,
      ["member"]
    );
  } catch (error) {
    if (
      [400, 404, 422].includes(
        error.status
      )
    ) {
      return null;
    }

    throw error;
  }
}

async function findMemberResourceStockLevels({
  memberId,
  serviceId
}) {
  const attempts = [
    {
      path: "/stock_levels",
      params: {
        "q[member_id_eq]":
          memberId,
        "q[item_id_eq]":
          serviceId,
        "q[s][]":
          "id asc"
      }
    },
    {
      path: "/stock_levels",
      params: {
        "q[member_id_eq]":
          memberId,
        "q[stock_item_id_eq]":
          serviceId,
        "q[s][]":
          "id asc"
      }
    },
    {
      path: "/stock_levels",
      params: {
        "q[member_id_eq]":
          memberId,
        "q[s][]":
          "id asc"
      }
    }
  ];

  const diagnostics = [];

  for (const attempt of attempts) {
    try {
      const records =
        await fetchPaginated(
          attempt.path,
          attempt.params,
          [
            "stock_levels",
            "stockLevels"
          ],
          200
        );

      const requestWasServiceFiltered =
        Boolean(
          attempt.params?.["q[item_id_eq]"] ||
          attempt.params?.["q[stock_item_id_eq]"]
        );

      const matching =
        records.filter(
          (record) => {
            if (!serviceId) {
              return true;
            }

            const recordServiceId =
              record?.item_id ??
              record?.stock_item_id ??
              record?.service_id ??
              record?.service_stock_level_id ??
              record?.item?.id ??
              record?.stock_item?.id ??
              record?.service?.id;

            /*
             * Current RMS sometimes honours q[stock_item_id_eq]
             * but omits stock_item_id from the returned stock-level
             * object. In that case the filtered API result itself is
             * authoritative.
             */
            if (
              requestWasServiceFiltered &&
              (
                recordServiceId === undefined ||
                recordServiceId === null ||
                recordServiceId === ""
              )
            ) {
              return true;
            }

            return (
              String(
                recordServiceId || ""
              ) ===
              String(serviceId)
            );
          }
        );

      diagnostics.push({
        path:
          attempt.path,
        params:
          attempt.params,
        status:
          "resolved",
        records:
          records.length,
        matching:
          matching.length
      });

      if (matching.length) {
        return {
          records:
            matching,
          attempts:
            diagnostics
        };
      }

      /*
       * Current RMS may honour q[stock_item_id_eq] but omit
       * the stock_item_id field in the returned stock-level
       * object. A single record returned by this exact filtered
       * query is therefore the matching resource stock level.
       */
      if (
        records.length === 1 &&
        attempt.params?.["q[stock_item_id_eq]"]
      ) {
        diagnostics[
          diagnostics.length - 1
        ].trustedFilteredResult = true;

        return {
          records,
          attempts:
            diagnostics
        };
      }
    } catch (error) {
      diagnostics.push({
        path:
          attempt.path,
        params:
          attempt.params,
        status:
          "rejected",
        httpStatus:
          error.status || null,
        message:
          error.message
      });

      if (
        ![400, 404, 422].includes(
          error.status
        )
      ) {
        throw error;
      }
    }
  }

  return {
    records: [],
    attempts:
      diagnostics
  };
}

export async function getAllocationDiagnostic({
  opportunityId,
  opportunityItemId,
  memberId
}) {
  const validation =
    await validateAvailablePosition({
      opportunityId,
      opportunityItemId,
      excludeRecordId:
        memberId
    });

  const detail =
    await retrieveOpportunity(
      opportunityId
    );

  const items =
    await retrieveOpportunityItems(
      opportunityId
    );

  const item =
    items.find(
      (candidate) =>
        String(
          candidate?.id || ""
        ) ===
        String(
          opportunityItemId
        )
    );

  if (!item) {
    return {
      ready: false,
      reason:
        "The Current RMS opportunity item could not be loaded.",
      opportunityId:
        String(opportunityId),
      opportunityItemId:
        String(opportunityItemId),
      memberId:
        String(memberId)
    };
  }

  const serviceId =
    item.item_id ??
    item.item?.id ??
    null;

  const member =
    await retrieveMemberRecord(
      memberId
    );

  const stockLookup =
    await findMemberResourceStockLevels({
      memberId,
      serviceId
    });

  const memberServiceStockLevels =
    Array.isArray(
      member?.service_stock_levels
    )
      ? member.service_stock_levels
      : [];

  if (
    !stockLookup.records.length &&
    memberServiceStockLevels.length
  ) {
    const matchingMemberLevels =
      memberServiceStockLevels.filter(
        (record) => {
          const recordServiceId =
            record?.item_id ??
            record?.stock_item_id ??
            record?.service_id ??
            record?.item?.id ??
            record?.stock_item?.id ??
            record?.service?.id;

          return (
            !serviceId ||
            recordServiceId === undefined ||
            recordServiceId === null ||
            String(recordServiceId) ===
              String(serviceId)
          );
        }
      );

    stockLookup.records.push(
      ...matchingMemberLevels
    );

    stockLookup.attempts.push({
      path:
        `/members/${memberId}`,
      source:
        "member.service_stock_levels",
      status:
        matchingMemberLevels.length
          ? "resolved"
          : "empty",
      records:
        memberServiceStockLevels.length,
      matching:
        matchingMemberLevels.length
    });
  }

  const relationAssets =
    relationRecords(
      item,
      [
        "item_assets",
        "opportunity_item_assets",
        "assets"
      ]
    )
      .map(
        compactAllocationAsset
      )
      .filter(Boolean);

  const matchingExistingAssets =
    relationAssets.filter(
      (asset) =>
        String(
          asset.stockLevelMemberId || ""
        ) ===
        String(memberId)
    );

  const stockLevels =
    stockLookup.records.map(
      (record) => ({
        id:
          record.id ?? null,
        memberId:
          record.member_id ??
          record.stock_level_member_id ??
          record.member?.id ??
          memberId ??
          null,
        serviceId:
          record.item_id ??
          record.stock_item_id ??
          record.service_id ??
          record.item?.id ??
          record.stock_item?.id ??
          record.service?.id ??
          serviceId ??
          null,
        name:
          record.name ??
          record.description ??
          record.asset_number ??
          record.member?.name ??
          null,
        category:
          record.stock_category_name ??
          record.stock_category?.name ??
          null,
        rawKeys:
          Object.keys(
            record || {}
          ).sort(),

        raw:
          record
      })
    );

  const selectedStockLevel =
    stockLevels.find(
      (stockLevel) =>
        String(
          stockLevel.memberId || ""
        ) ===
          String(memberId) &&
        String(
          stockLevel.serviceId || ""
        ) ===
          String(serviceId)
    ) ||
    (
      stockLevels.length === 1
        ? stockLevels[0]
        : null
    );

  return {
    ready:
      Boolean(
        validation.available &&
        selectedStockLevel?.id &&
        !matchingExistingAssets.length
      ),

    reason:
      !validation.available
        ? validation.reason
        : matchingExistingAssets.length
          ? "This member already has an item-asset allocation on the service line."
          : !selectedStockLevel?.id
            ? "No matching resource stock level could be resolved through the authenticated API."
            : null,

    writeEnabled:
      String(
        process.env
          .ENABLE_CURRENT_RMS_ALLOCATION_WRITES ||
        ""
      ).toLowerCase() ===
      "true",

    opportunity: {
      id:
        String(opportunityId),
      reference:
        detail?.reference ||
        detail?.number ||
        null,
      name:
        detail?.subject ||
        detail?.description ||
        null
    },

    opportunityItem: {
      id:
        String(
          opportunityItemId
        ),
      serviceId:
        serviceId
          ? String(serviceId)
          : null,
      name:
        item.name ||
        item.item?.name ||
        null,
      quantity:
        Number(
          item.quantity || 0
        ),
      startsAt:
        item.starts_at ||
        null,
      endsAt:
        item.ends_at ||
        null
    },

    member: {
      id:
        String(memberId),
      name:
        memberDisplayName(
          member
        ) || null,
      loaded:
        Boolean(member),
      rawKeys:
        member
          ? Object.keys(
              member
            ).sort()
          : [],
      serviceStockLevels:
        Array.isArray(
          member?.service_stock_levels
        )
          ? member.service_stock_levels
          : []
    },

    liveAvailability:
      validation,

    existingItemAssets:
      relationAssets,

    matchingExistingAssets,

    resourceStockLevels:
      stockLevels,

    selectedStockLevel,

    preparedAllocation: {
      opportunityItemId:
        String(
          opportunityItemId
        ),
      stockLevelId:
        selectedStockLevel?.id ||
        null,
      quantity: 1,
      relationship:
        "opportunity item asset",
      browserFormShape: {
        stock_level_id:
          selectedStockLevel?.id ||
          null,
        quantity: 1
      }
    },

    lookupAttempts:
      stockLookup.attempts
  };
}



export async function allocateResourceToOpportunityItem({
  opportunityId,
  opportunityItemId,
  memberId
}) {
  const diagnostic =
    await getAllocationDiagnostic({
      opportunityId,
      opportunityItemId,
      memberId
    });

  if (!diagnostic.ready) {
    const error = new Error(
      diagnostic.reason ||
      "The Current RMS resource mapping is not ready."
    );
    error.status = 409;
    error.diagnostic = diagnostic;
    throw error;
  }

  const stockLevelId =
    diagnostic.selectedStockLevel?.id;

  if (!stockLevelId) {
    const error = new Error(
      "No Current RMS resource stock level was resolved."
    );
    error.status = 409;
    throw error;
  }

  const requestBody = {
    opportunity_item: {
      item_assets_attributes: [
        {
          stock_level_id:
            Number(stockLevelId),
          quantity: "1.0"
        }
      ]
    }
  };

  let writeResult;

  try {
    writeResult =
      await currentWriteRequest(
        "PUT",
        `/opportunity_items/${opportunityItemId}`,
        requestBody
      );
  } catch (error) {
    const wrapped = new Error(
      "Current RMS did not accept the opportunity-item allocation write: " +
      error.message
    );
    wrapped.status =
      error.status || 502;
    wrapped.payload =
      error.payload;
    wrapped.request = {
      method: "PUT",
      path:
        `/opportunity_items/${opportunityItemId}`,
      body: requestBody
    };
    throw wrapped;
  }

  /*
   * Never trust only the write response. Read the live item back
   * and confirm the requested stock level is now allocated.
   */
  const items =
    await retrieveOpportunityItems(
      opportunityId
    );

  const item =
    items.find(
      (candidate) =>
        String(candidate?.id || "") ===
        String(opportunityItemId)
    );

  const assets =
    relationRecords(
      item,
      [
        "item_assets",
        "opportunity_item_assets",
        "assets"
      ]
    )
      .map(compactAllocationAsset)
      .filter(Boolean);

  const created =
    assets.find(
      (asset) =>
        String(asset.stockLevelId || "") ===
        String(stockLevelId)
    );

  if (!created) {
    const error = new Error(
      "Current RMS returned success, but the resource allocation could not be verified afterwards."
    );
    error.status = 502;
    error.writeResponse =
      writeResult.payload;
    error.request = {
      method: "PUT",
      path:
        `/opportunity_items/${opportunityItemId}`,
      body: requestBody
    };
    throw error;
  }

  return {
    allocationId:
      created.id
        ? String(created.id)
        : null,
    stockLevelId:
      String(stockLevelId),
    memberId:
      String(memberId),
    opportunityItemId:
      String(opportunityItemId),
    verified: true,
    writeStatus:
      writeResult.status,
    writeResponse:
      writeResult.payload,
    allocation:
      created
  };
}

async function safeDiagnosticRequest(
  path,
  params = {}
) {
  try {
    const payload =
      await currentRequest(
        path,
        params
      );

    const records =
      extractCollection(
        payload,
        [
          "members",
          "member",
          "stock_levels",
          "stock_level",
          "resources",
          "resource",
          "bookable_resources",
          "bookable_resource",
          "items"
        ]
      );

    return {
      path,
      params,
      status:
        "resolved",
      recordCount:
        Array.isArray(records)
          ? records.length
          : 0,
      payload
    };
  } catch (error) {
    return {
      path,
      params,
      status:
        "rejected",
      httpStatus:
        error.status || null,
      message:
        error.message,
      payload:
        error.payload || null
    };
  }
}

function compactDiagnosticRecord(
  record
) {
  if (
    !record ||
    typeof record !== "object"
  ) {
    return record;
  }

  const preferred = [
    "id",
    "name",
    "description",
    "member_id",
    "contact_id",
    "item_id",
    "stock_item_id",
    "stock_level_id",
    "resource_id",
    "bookable_resource_id",
    "asset_number",
    "stock_category_name",
    "status",
    "status_name",
    "item_type",
    "item_type_name"
  ];

  const compact = {};

  for (const key of preferred) {
    if (
      record[key] !== undefined &&
      record[key] !== null
    ) {
      compact[key] =
        record[key];
    }
  }

  compact.rawKeys =
    Object.keys(record)
      .sort();

  if (
    Array.isArray(
      record.service_stock_levels
    )
  ) {
    compact.service_stock_levels =
      record.service_stock_levels;
  }

  return compact;
}

export async function inspectCurrentRmsMember({
  memberId,
  serviceId = null
}) {
  const probes = [
    {
      path:
        `/members/${memberId}`,
      params: {}
    },
    {
      path:
        `/members/${memberId}/stock_levels`,
      params: {
        "q[s][]":
          "id asc"
      }
    },
    {
      path:
        `/members/${memberId}/resources`,
      params: {
        "q[s][]":
          "id asc"
      }
    },
    {
      path:
        `/members/${memberId}/bookable_resources`,
      params: {
        "q[s][]":
          "id asc"
      }
    },
    {
      path:
        "/stock_levels",
      params: {
        "q[member_id_eq]":
          memberId,
        "q[s][]":
          "id asc"
      }
    },
    {
      path:
        "/resources",
      params: {
        "q[member_id_eq]":
          memberId,
        "q[s][]":
          "id asc"
      }
    },
    {
      path:
        "/bookable_resources",
      params: {
        "q[member_id_eq]":
          memberId,
        "q[s][]":
          "id asc"
      }
    }
  ];

  if (serviceId) {
    probes.push(
      {
        path:
          "/stock_levels",
        params: {
          "q[member_id_eq]":
            memberId,
          "q[item_id_eq]":
            serviceId,
          "q[s][]":
            "id asc"
        }
      },
      {
        path:
          "/stock_levels",
        params: {
          "q[member_id_eq]":
            memberId,
          "q[stock_item_id_eq]":
            serviceId,
          "q[s][]":
            "id asc"
        }
      }
    );
  }

  const results = [];

  for (const probe of probes) {
    results.push(
      await safeDiagnosticRequest(
        probe.path,
        probe.params
      )
    );
  }

  const candidates = [];

  for (const result of results) {
    if (
      result.status !== "resolved"
    ) {
      continue;
    }

    const records =
      extractCollection(
        result.payload,
        [
          "members",
          "member",
          "stock_levels",
          "stock_level",
          "resources",
          "resource",
          "bookable_resources",
          "bookable_resource",
          "items"
        ]
      );

    for (const record of records) {
      const candidate =
        compactDiagnosticRecord(
          record
        );

      const candidateMemberId =
        record?.member_id ??
        record?.stock_level_member_id ??
        record?.member?.id ??
        null;

      const candidateServiceId =
        record?.item_id ??
        record?.stock_item_id ??
        record?.item?.id ??
        null;

      const memberMatches =
        candidateMemberId === null ||
        String(candidateMemberId) ===
          String(memberId);

      const serviceMatches =
        !serviceId ||
        candidateServiceId === null ||
        String(candidateServiceId) ===
          String(serviceId);

      if (
        memberMatches &&
        serviceMatches
      ) {
        candidates.push({
          sourcePath:
            result.path,
          ...candidate
        });
      }
    }
  }

  const memberResponse =
    results.find(
      (result) =>
        result.path ===
        `/members/${memberId}` &&
        result.status ===
        "resolved"
    );

  const memberPayload =
    memberResponse?.payload || null;

  const member =
    memberPayload
      ? extractSingle(
          memberPayload,
          ["member"]
        )
      : null;

  return {
    memberId:
      String(memberId),
    serviceId:
      serviceId
        ? String(serviceId)
        : null,
    member:
      member
        ? compactDiagnosticRecord(
            member
          )
        : null,
    candidates,
    probes:
      results.map(
        (result) => ({
          path:
            result.path,
          params:
            result.params,
          status:
            result.status,
          httpStatus:
            result.httpStatus ||
            null,
          message:
            result.message ||
            null,
          recordCount:
            result.recordCount ??
            null
        })
      )
  };
}


function rangesOverlap(
  startA,
  endA,
  startB,
  endB
) {
  const aStart = validTimestamp(startA);
  const aEnd = validTimestamp(endA);
  const bStart = validTimestamp(startB);
  const bEnd = validTimestamp(endB);

  if (
    aStart === null ||
    aEnd === null ||
    bStart === null ||
    bEnd === null
  ) {
    return false;
  }

  return (
    aStart < bEnd &&
    bStart < aEnd
  );
}

export async function findMemberAssignmentConflicts({
  memberId,
  startsAt,
  endsAt,
  excludeOpportunityItemId = null
}) {
  if (!memberId || !startsAt || !endsAt) {
    return {
      hasConflict: false,
      conflicts: []
    };
  }

  const fromDate =
    new Date(startsAt)
      .toISOString()
      .slice(0, 10);

  const toDate =
    new Date(endsAt)
      .toISOString()
      .slice(0, 10);

  const opportunities =
    (
      await listOpportunities(fromDate)
    )
      .filter(opportunityLooksActive)
      .filter((opportunity) =>
        summaryOverlapsDateRange(
          opportunity,
          fromDate,
          toDate
        )
      );

  const conflicts = [];

  for (const summary of opportunities) {
    const opportunityId =
      summary.id ||
      summary.opportunity_id;

    if (!opportunityId) {
      continue;
    }

    let items;

    try {
      items =
        await retrieveOpportunityItems(
          opportunityId
        );
    } catch (error) {
      console.warn(
        `[Current RMS] conflict check skipped opportunity ${opportunityId}: ${error.message}`
      );
      continue;
    }

    for (const item of items) {
      if (
        excludeOpportunityItemId &&
        String(item?.id || "") ===
          String(excludeOpportunityItemId)
      ) {
        continue;
      }

      if (
        !recordContainsAssignment(
          item,
          "member",
          memberId,
          false
        )
      ) {
        continue;
      }

      const itemStartsAt =
        item?.starts_at ||
        item?.start_at ||
        null;

      const itemEndsAt =
        item?.ends_at ||
        item?.end_at ||
        null;

      if (
        !rangesOverlap(
          startsAt,
          endsAt,
          itemStartsAt,
          itemEndsAt
        )
      ) {
        continue;
      }

      conflicts.push({
        opportunityId:
          String(opportunityId),
        opportunityItemId:
          String(item?.id || ""),
        reference:
          summary?.reference ||
          summary?.number ||
          "",
        jobName:
          summary?.subject ||
          summary?.name ||
          summary?.description ||
          "Current RMS opportunity",
        serviceName:
          item?.name ||
          item?.item?.name ||
          "Assigned service",
        startsAt:
          itemStartsAt,
        endsAt:
          itemEndsAt
      });
    }
  }

  return {
    hasConflict:
      conflicts.length > 0,
    conflicts
  };
}
