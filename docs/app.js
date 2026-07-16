const config = window.WAREHOUSE_CONFIG || {};

const state = {
  jobs: [],
  accessKey:
    sessionStorage.getItem("warehouseAccessKey") ||
    localStorage.getItem("warehouseAccessKey") ||
    "",
  sortKey: "prepAt",
  sortDirection: "asc",
  loading: false,
  refreshTimer: null
};

const elements = {
  screenTitle: document.querySelector("#screenTitle"),
  connectionState: document.querySelector("#connectionState"),
  refreshButton: document.querySelector("#refreshButton"),
  fullscreenButton: document.querySelector("#fullscreenButton"),

  jobsMetric: document.querySelector("#jobsMetric"),
  itemsMetric: document.querySelector("#itemsMetric"),
  preparedMetric: document.querySelector("#preparedMetric"),
  urgentMetric: document.querySelector("#urgentMetric"),

  searchInput: document.querySelector("#searchInput"),
  opportunityTypeFilter: document.querySelector(
    "#opportunityTypeFilter"
  ),
  dateTypeSelect: document.querySelector("#dateTypeSelect"),
  fromDate: document.querySelector("#fromDate"),
  toDate: document.querySelector("#toDate"),

  jobsBody: document.querySelector("#jobsBody"),
  resultSummary: document.querySelector("#resultSummary"),
  lastUpdated: document.querySelector("#lastUpdated"),
  emptyState: document.querySelector("#emptyState"),

  loginOverlay: document.querySelector("#loginOverlay"),
  loginForm: document.querySelector("#loginForm"),
  accessKeyInput: document.querySelector("#accessKeyInput"),
  rememberKey: document.querySelector("#rememberKey"),
  loginError: document.querySelector("#loginError"),

  rowTemplate: document.querySelector("#jobRowTemplate")
};

function pad(number) {
  return String(number).padStart(2, "0");
}

function localDateString(date) {
  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1
  )}-${pad(date.getDate())}`;
}

function setDefaultDates() {
  const today = new Date();
  const to = new Date(today);

  to.setDate(
    to.getDate() +
      Number(config.defaultDaysAhead || 30)
  );

  elements.fromDate.value =
    localDateString(today);

  elements.toDate.value =
    localDateString(to);
}

function apiUrl(path) {
  const base = String(
    config.apiBaseUrl || ""
  ).replace(/\/$/, "");

  return `${base}${path}`;
}

function setConnection(type, text) {
  elements.connectionState.classList.toggle(
    "is-live",
    type === "live"
  );

  elements.connectionState.classList.toggle(
    "is-error",
    type === "error"
  );

  const label = elements.connectionState.querySelector(
    "span:last-child"
  );

  if (label) {
    label.textContent = text;
  }
}

function setLoading(loading) {
  state.loading = loading;

  elements.refreshButton.disabled = loading;

  elements.refreshButton.textContent = loading
    ? "Loading…"
    : "Refresh";
}

async function fetchJobs({
  closeLoginOnSuccess = false
} = {}) {
  if (
    !state.accessKey ||
    state.loading
  ) {
    return;
  }

  setLoading(true);
  setConnection("loading", "Updating…");

  elements.loginError.textContent = "";

  try {
    const params = new URLSearchParams({
      from: elements.fromDate.value,
      to: elements.toDate.value
    });

    const response = await fetch(
      apiUrl(`/api/jobs?${params}`),
      {
        headers: {
          "X-Dashboard-Key":
            state.accessKey
        }
      }
    );

    const payload = await response
      .json()
      .catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        payload.error ||
          `The API returned ${response.status}.`
      );

      error.status = response.status;

      throw error;
    }

    state.jobs = Array.isArray(payload.jobs)
      ? payload.jobs
      : [];

    setConnection(
      "live",
      payload.mode === "mock"
        ? "Connected · demo data"
        : "Connected · Current RMS"
    );

    elements.lastUpdated.textContent =
      `Updated ${formatUpdatedTime(
        payload.updatedAt
      )}${payload.cached ? " · cached" : ""}`;

    render();

    if (closeLoginOnSuccess) {
      elements.loginOverlay.hidden = true;
    }
  } catch (error) {
    console.error(error);

    setConnection(
      "error",
      "Connection problem"
    );

    if (error.status === 401) {
      elements.loginOverlay.hidden = false;

      elements.loginError.textContent =
        "That passphrase was not accepted.";

      sessionStorage.removeItem(
        "warehouseAccessKey"
      );

      localStorage.removeItem(
        "warehouseAccessKey"
      );

      state.accessKey = "";
    } else {
      elements.resultSummary.textContent =
        error.message ||
        "The jobs could not be loaded.";

      if (!elements.loginOverlay.hidden) {
        elements.loginError.textContent =
          error.message;
      }
    }
  } finally {
    setLoading(false);
  }
}

function formatUpdatedTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "just now";
  }

  return new Intl.DateTimeFormat(
    "en-GB",
    {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }
  ).format(date);
}

function dateValue(job, key) {
  if (key === "all") {
    return [
      job.prepAt,
      job.prepEndsAt,
      job.loadAt,
      job.loadEndsAt,
      job.deliverAt,
      job.showAt,
      job.returnAt,
      job.returnEndsAt
    ].filter(Boolean);
  }

  return job[key]
    ? [job[key]]
    : [];
}

function withinSelectedDates(job) {
  const selectedType =
    elements.dateTypeSelect.value;

  const values = dateValue(
    job,
    selectedType
  )
    .map(
      (value) =>
        new Date(value).getTime()
    )
    .filter(Number.isFinite);

  if (!values.length) {
    return false;
  }

  const from = new Date(
    `${elements.fromDate.value}T00:00:00`
  ).getTime();

  const to = new Date(
    `${elements.toDate.value}T23:59:59`
  ).getTime();

  /*
   * When filtering by one specific date field,
   * test that exact date against the chosen range.
   */
  if (selectedType !== "all") {
    return values.some(
      (time) =>
        time >= from &&
        time <= to
    );
  }

  /*
   * For "Any job date", treat the job dates as one
   * overall period. This keeps ongoing jobs visible.
   */
  const jobStartsAt =
    Math.min(...values);

  const jobEndsAt =
    Math.max(...values);

  return (
    jobStartsAt <= to &&
    jobEndsAt >= from
  );
}

function normaliseStatusValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function matchesOpportunityType(job) {
  const selected =
    elements.opportunityTypeFilter?.value ||
    "orders";

  const state = normaliseStatusValue(
    job.opportunityState ||
    job.stateName ||
    job.state
  );

  const status = normaliseStatusValue(
    job.opportunityStatus ||
    job.statusName ||
    job.status
  );

  if (selected === "all") {
    return true;
  }

  if (selected === "orders") {
    const isOrder =
      state === "order" ||
      state.includes("confirmed order") ||
      state.includes("order");

    const isBookedOut =
      status.includes("booked out") ||
      status.includes("bookedout");

    return isOrder && !isBookedOut;
  }

  if (selected === "quotes") {
    return (
      state.includes("quote") ||
      state.includes("quotation")
    );
  }

  if (selected === "provisional") {
    return (
      state.includes("provisional") ||
      status.includes("provisional")
    );
  }

  if (selected === "booked-out") {
    return (
      status.includes("booked out") ||
      status.includes("bookedout") ||
      state.includes("booked out")
    );
  }

  return true;
}

function matchesSearch(job) {
  const query =
    elements.searchInput.value
      .trim()
      .toLowerCase();

  if (!query) {
    return true;
  }

  return [
    job.reference,
    job.number,
    job.name,
    job.customer,
    job.opportunityStatus,
    job.statusName,
    job.status,
    job.stateName,
    job.state,
    job.type
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function hoursUntil(value) {
  if (!value) {
    return Infinity;
  }

  return (
    new Date(value).getTime() -
    Date.now()
  ) / 3_600_000;
}

function jobPresentation(job) {
  const unknown =
    job.prepDataQuality ===
      "unavailable" &&
    Number(job.totalItems) > 0;

  const complete =
    Number(job.preparedPercent) >=
      100 &&
    Number(job.totalItems) > 0;

  const started =
    Number(job.preparedItems) > 0;

  const loadHours = hoursUntil(
    job.loadAt ||
      job.prepAt
  );

  const urgent =
    !complete &&
    loadHours <= 24;

  if (unknown) {
    return {
      label: "Check mapping",
      className: "mapping",
      rowClass: "is-mapping",
      rank: 2
    };
  }

  if (complete) {
    return {
      label: "Ready",
      className: "ready",
      rowClass: "is-ready",
      rank: 5
    };
  }

  if (urgent) {
    return {
      label: "Urgent",
      className: "urgent",
      rowClass: "is-urgent",
      rank: 1
    };
  }

  if (started) {
    return {
      label: "In progress",
      className: "progress",
      rowClass: "is-progress",
      rank: 3
    };
  }

  return {
    label: "Not started",
    className: "waiting",
    rowClass: "is-waiting",
    rank: 4
  };
}

function sortedFilteredJobs() {
  const jobs = state.jobs
    .filter(withinSelectedDates)
    .filter(matchesSearch)
    .filter(matchesOpportunityType)
    .map((job) => ({
      ...job,
      statusRank:
        jobPresentation(job).rank
    }));

  const multiplier =
    state.sortDirection === "asc"
      ? 1
      : -1;

  return jobs.sort((a, b) => {
    const left =
      a[state.sortKey];

    const right =
      b[state.sortKey];

    if (
      [
        "prepAt",
        "loadAt",
        "returnAt"
      ].includes(state.sortKey)
    ) {
      return (
        new Date(
          left || "2999-12-31"
        ).getTime() -
        new Date(
          right || "2999-12-31"
        ).getTime()
      ) * multiplier;
    }

    if (
      typeof left === "number" ||
      typeof right === "number"
    ) {
      return (
        Number(left || 0) -
        Number(right || 0)
      ) * multiplier;
    }

    return String(left || "")
      .localeCompare(
        String(right || ""),
        "en-GB",
        {
          numeric: true
        }
      ) * multiplier;
  });
}

function formatQuantity(value) {
  return new Intl.NumberFormat(
    "en-GB",
    {
      maximumFractionDigits: 2
    }
  ).format(
    Number(value || 0)
  );
}

function formatDateCell(value) {
  if (!value) {
    return {
      date: "—",
      time: "Not set"
    };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {
      date: "—",
      time: "Not set"
    };
  }

  return {
    date: new Intl.DateTimeFormat(
      "en-GB",
      {
        weekday: "short",
        day: "numeric",
        month: "short"
      }
    ).format(date),

    time: new Intl.DateTimeFormat(
      "en-GB",
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    ).format(date)
  };
}

function fillDateCell(cell, value) {
  const formatted =
    formatDateCell(value);

  cell.replaceChildren();

  const strong =
    document.createElement("strong");

  strong.textContent =
    formatted.date;

  const span =
    document.createElement("span");

  span.textContent =
    formatted.time;

  cell.append(
    strong,
    span
  );
}

function renderRow(job) {
  const fragment =
    elements.rowTemplate.content
      .cloneNode(true);

  const row =
    fragment.querySelector("tr");

  const presentation =
    jobPresentation(job);

  row.classList.add(
    presentation.rowClass
  );

  const status =
    row.querySelector(
      ".status-pill"
    );

  status.textContent =
    presentation.label;

  status.classList.add(
    presentation.className
  );

  const link =
    row.querySelector(
      ".job-link"
    );

  if (job.currentRmsUrl) {
    link.href =
      job.currentRmsUrl;
  } else {
    link.removeAttribute(
      "href"
    );
  }

  row.querySelector(
    ".job-reference"
  ).textContent =
    job.reference ||
    `Job ${job.id}`;

  row.querySelector(
    ".job-name"
  ).textContent =
    job.name ||
    "Unnamed job";

  row.querySelector(
    ".client-cell"
  ).textContent =
    job.customer ||
    "—";

  row.querySelector(
    ".items-cell"
  ).textContent =
    formatQuantity(
      job.totalItems
    );

  const preparedStrong =
    row.querySelector(
      ".prepared-copy strong"
    );

  const preparedSpan =
    row.querySelector(
      ".prepared-copy span"
    );

  const progress =
    row.querySelector(
      ".progress-track span"
    );

  if (
    job.prepDataQuality ===
      "unavailable" &&
    Number(job.totalItems) > 0
  ) {
    preparedStrong.textContent =
      "—";

    preparedSpan.textContent =
      "Prep field not detected";

    progress.style.width =
      "0%";
  } else {
    const percentage = Math.max(
      0,
      Math.min(
        100,
        Number(
          job.preparedPercent || 0
        )
      )
    );

    preparedStrong.textContent =
      `${formatQuantity(
        job.preparedItems
      )} / ${formatQuantity(
        job.totalItems
      )}`;

    preparedSpan.textContent =
      `${percentage}%`;

    progress.style.width =
      `${percentage}%`;
  }

  fillDateCell(
    row.querySelector(
      ".prep-cell"
    ),
    job.prepAt
  );

  fillDateCell(
    row.querySelector(
      ".load-cell"
    ),
    job.loadAt
  );

  fillDateCell(
    row.querySelector(
      ".return-cell"
    ),
    job.returnAt
  );

  return fragment;
}

function renderSortButtons() {
  document
    .querySelectorAll(
      "[data-sort]"
    )
    .forEach((button) => {
      const active =
        button.dataset.sort ===
        state.sortKey;

      button.classList.toggle(
        "is-active",
        active
      );

      button.dataset.direction =
        active
          ? state.sortDirection ===
            "asc"
            ? "↑"
            : "↓"
          : "";
    });
}

function render() {
  const jobs =
    sortedFilteredJobs();

  elements.jobsBody.replaceChildren(
    ...jobs.map(renderRow)
  );

  elements.emptyState.hidden =
    jobs.length !== 0;

  const totalItems =
    jobs.reduce(
      (sum, job) =>
        sum +
        Number(
          job.totalItems || 0
        ),
      0
    );

  const preparedItems =
    jobs.reduce(
      (sum, job) =>
        sum +
        Number(
          job.preparedItems || 0
        ),
      0
    );

  const urgentJobs =
    jobs.filter(
      (job) =>
        jobPresentation(job).label ===
        "Urgent"
    ).length;

  elements.jobsMetric.textContent =
    formatQuantity(jobs.length);

  elements.itemsMetric.textContent =
    formatQuantity(totalItems);

  elements.preparedMetric.textContent =
    formatQuantity(
      preparedItems
    );

  elements.urgentMetric.textContent =
    formatQuantity(
      urgentJobs
    );

  elements.resultSummary.textContent =
    `${jobs.length} job${
      jobs.length === 1
        ? ""
        : "s"
    } shown · sorted by ${sortLabel(
      state.sortKey
    )}`;

  renderSortButtons();
}

function sortLabel(key) {
  return {
    statusRank: "status",
    reference: "job number",
    customer: "client",
    totalItems: "item count",
    preparedPercent:
      "prepared percentage",
    prepAt: "prep date",
    loadAt: "load-out date",
    returnAt: "due-back date"
  }[key] || key;
}

function debounce(
  callback,
  delay = 180
) {
  let timer;

  return (...args) => {
    clearTimeout(timer);

    timer = setTimeout(
      () => callback(...args),
      delay
    );
  };
}

function setQuickRange(value) {
  const today = new Date();
  const to = new Date(today);

  if (value === "today") {
    elements.fromDate.value =
      localDateString(today);

    elements.toDate.value =
      localDateString(today);
  } else {
    to.setDate(
      to.getDate() +
        Number(value)
    );

    elements.fromDate.value =
      localDateString(today);

    elements.toDate.value =
      localDateString(to);
  }

  fetchJobs();
}

function scheduleRefresh() {
  clearInterval(
    state.refreshTimer
  );

  const seconds = Math.max(
    30,
    Number(
      config.refreshSeconds ||
      60
    )
  );

  state.refreshTimer =
    setInterval(
      () => fetchJobs(),
      seconds * 1000
    );
}

function saveAccessKey(
  value,
  remember
) {
  sessionStorage.removeItem(
    "warehouseAccessKey"
  );

  localStorage.removeItem(
    "warehouseAccessKey"
  );

  const storage = remember
    ? localStorage
    : sessionStorage;

  storage.setItem(
    "warehouseAccessKey",
    value
  );

  state.accessKey = value;
}

function wireEvents() {
  elements.loginForm.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      const value =
        elements.accessKeyInput.value
          .trim();

      if (!value) {
        return;
      }

      saveAccessKey(
        value,
        elements.rememberKey.checked
      );

      await fetchJobs({
        closeLoginOnSuccess: true
      });
    }
  );

  elements.refreshButton.addEventListener(
    "click",
    () => fetchJobs()
  );

  elements.searchInput.addEventListener(
    "input",
    debounce(render)
  );

  elements.opportunityTypeFilter?.addEventListener(
    "change",
    render
  );

  elements.dateTypeSelect.addEventListener(
    "change",
    render
  );

  elements.fromDate.addEventListener(
    "change",
    () => fetchJobs()
  );

  elements.toDate.addEventListener(
    "change",
    () => fetchJobs()
  );

  document
    .querySelectorAll(
      "[data-range]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () =>
          setQuickRange(
            button.dataset.range
          )
      );
    });

  document
    .querySelectorAll(
      "[data-sort]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          const key =
            button.dataset.sort;

          if (
            state.sortKey === key
          ) {
            state.sortDirection =
              state.sortDirection ===
                "asc"
                ? "desc"
                : "asc";
          } else {
            state.sortKey = key;

            state.sortDirection =
              [
                "totalItems",
                "preparedPercent"
              ].includes(key)
                ? "desc"
                : "asc";
          }

          render();
        }
      );
    });

  elements.fullscreenButton.addEventListener(
    "click",
    async () => {
      if (
        !document.fullscreenElement
      ) {
        await document
          .documentElement
          .requestFullscreen();
      } else {
        await document
          .exitFullscreen();
      }
    }
  );
}

function initialise() {
  document.title =
    `${config.companyName || "WOLF"} · ` +
    `${
      config.screenTitle ||
      "Warehouse Schedule"
    }`;

  elements.screenTitle.textContent =
    config.screenTitle ||
    "Warehouse Schedule";

  /*
   * Orders Only is the default unless the HTML
   * explicitly supplies another selected value.
   */
  if (
    elements.opportunityTypeFilter &&
    !elements.opportunityTypeFilter.value
  ) {
    elements.opportunityTypeFilter.value =
      "orders";
  }

  setDefaultDates();
  wireEvents();
  scheduleRefresh();

  if (state.accessKey) {
    elements.loginOverlay.hidden =
      true;

    fetchJobs();
  } else {
    elements.loginOverlay.hidden =
      false;

    elements.accessKeyInput.focus();
  }
}

initialise();