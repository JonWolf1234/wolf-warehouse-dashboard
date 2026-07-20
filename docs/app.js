const config = window.WAREHOUSE_CONFIG || {};

const state = {
  jobs: [],
  accessKey: "session",
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


  certificatesButton:
    document.querySelector(
      "#certificatesButton"
    ),

  certificateModal:
    document.querySelector(
      "#certificateModal"
    ),

  certificateUploadForm:
    document.querySelector(
      "#certificateUploadForm"
    ),

  certificateAssetNumber:
    document.querySelector(
      "#certificateAssetNumber"
    ),

  certificateDescription:
    document.querySelector(
      "#certificateDescription"
    ),

  certificateFile:
    document.querySelector(
      "#certificateFile"
    ),

  certificateFileName:
    document.querySelector(
      "#certificateFileName"
    ),

  certificateFilenamePreview:
    document.querySelector(
      "#certificateFilenamePreview"
    ),

  certificateFormMessage:
    document.querySelector(
      "#certificateFormMessage"
    ),

  certificateUploadButton:
    document.querySelector(
      "#certificateUploadButton"
    ),



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
  const normalisedPath =
    String(path || "").startsWith("/")
      ? String(path || "")
      : `/${String(path || "")}`;

  return normalisedPath;
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
        credentials: "same-origin"
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
      window.location.href = "/login";
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

function extractAssetNumbers(value) {
  return [
    ...new Set(
      String(value || "")
        .match(/\b\d{6,8}\b/g) ||
      []
    )
  ];
}

function createCertificateResultItem({
  assetNumber,
  filename,
  found
}) {
  const item =
    document.createElement("div");

  item.className =
    `certificate-result-item ${
      found
        ? "is-found"
        : "is-missing"
    }`;

  const copy =
    document.createElement("div");

  const strong =
    document.createElement("strong");

  strong.textContent =
    assetNumber;

  const detail =
    document.createElement("span");

  detail.textContent =
    found
      ? filename
      : "No certificate found";

  copy.append(
    strong,
    detail
  );

  const status =
    document.createElement("div");

  status.className =
    "certificate-result-status";

  status.textContent =
    found
      ? "Found"
      : "Missing";

  item.append(
    copy,
    status
  );

  return item;
}

function wireJobActions(
  row,
  actionsRow,
  job
) {
  const expandButton =
    row.querySelector(
      ".expand-button"
    );

  const tabs =
    actionsRow.querySelectorAll(
      ".job-action-tab"
    );

  const views =
    actionsRow.querySelectorAll(
      ".job-action-view"
    );

  expandButton.addEventListener(
    "click",
    () => {
      const opening =
        actionsRow.hidden;

      actionsRow.hidden =
        !opening;

      expandButton.classList.toggle(
        "is-open",
        opening
      );

      expandButton.setAttribute(
        "aria-expanded",
        String(opening)
      );
    }
  );

  tabs.forEach((tab) => {
    tab.addEventListener(
      "click",
      () => {
        const selected =
          tab.dataset.actionPanel;

        tabs.forEach(
          (candidate) => {
            candidate.classList.toggle(
              "is-active",
              candidate === tab
            );
          }
        );

        views.forEach(
          (view) => {
            view.classList.toggle(
              "is-active",
              view.dataset.actionView ===
                selected
            );
          }
        );
      }
    );
  });

  /*
   * Warehouse notes are read directly from
   * the Current RMS opportunity custom field.
   */
  const notesInput =
    actionsRow.querySelector(
      ".warehouse-notes-input"
    );

  if (notesInput) {
    notesInput.value =
      job.warehouseNotes || "";
  }

  const serialInput =
    actionsRow.querySelector(
      ".motor-serial-input"
    );

  const findButton =
    actionsRow.querySelector(
      ".find-job-certificates"
    );

  const emptyResults =
    actionsRow.querySelector(
      ".certificate-results-empty"
    );

  const results =
    actionsRow.querySelector(
      ".certificate-results"
    );

  const resultCount =
    actionsRow.querySelector(
      ".certificate-result-count"
    );

  const resultMessage =
    actionsRow.querySelector(
      ".certificate-result-message"
    );

  const resultList =
    actionsRow.querySelector(
      ".certificate-result-list"
    );

  const emailInput =
    actionsRow.querySelector(
      ".certificate-email-input"
    );

  const sendButton =
    actionsRow.querySelector(
      ".send-job-certificates"
    );

  const sendMessage =
    actionsRow.querySelector(
      ".certificate-send-message"
    );

  let foundCertificates = [];

  findButton.addEventListener(
    "click",
    async () => {
      const assetNumbers =
        extractAssetNumbers(
          serialInput.value
        );

      if (!assetNumbers.length) {
        resultMessage.textContent =
          "Enter at least one serial number.";

        emptyResults.hidden =
          true;

        results.hidden =
          false;

        resultCount.textContent =
          "0 of 0 found";

        resultList.replaceChildren();

        return;
      }

      findButton.disabled =
        true;

      findButton.textContent =
        "Searching…";

      resultMessage.textContent =
        "Checking the private certificate library…";

      emptyResults.hidden =
        true;

      results.hidden =
        false;

      resultList.replaceChildren();

      sendButton.disabled =
        true;

      foundCertificates = [];

      try {
        const response =
          await fetch(
            apiUrl(
              "/api/certificates/find"
            ),
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",

                "X-Dashboard-Key":
                  state.accessKey
              },

              body:
                JSON.stringify({
                  assetNumbers
                })
            }
          );

        const payload =
          await response
            .json()
            .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            payload.error ||
            "Certificate search failed."
          );
        }

        foundCertificates =
          Array.isArray(
            payload.found
          )
            ? payload.found
            : [];

        const missing =
          Array.isArray(
            payload.missing
          )
            ? payload.missing
            : [];

        resultCount.textContent =
          `${foundCertificates.length} of ${assetNumbers.length} found`;

        resultMessage.textContent =
          missing.length
            ? `${missing.length} missing`
            : "Complete certificate set";

        const resultItems = [];

        foundCertificates.forEach(
          (certificate) => {
            resultItems.push(
              createCertificateResultItem({
                assetNumber:
                  certificate.assetNumber,

                filename:
                  certificate.filename,

                found: true
              })
            );
          }
        );

        missing.forEach(
          (assetNumber) => {
            resultItems.push(
              createCertificateResultItem({
                assetNumber,
                filename: "",
                found: false
              })
            );
          }
        );

        resultList.replaceChildren(
          ...resultItems
        );

        sendButton.disabled =
          !foundCertificates.length ||
          !emailInput.validity.valid ||
          !emailInput.value.trim();

        sendMessage.textContent =
          foundCertificates.length
            ? "Enter a recipient email address to prepare the certificate email."
            : "No certificates are currently available to send.";

        sendMessage.style.color =
          "var(--muted)";
      } catch (error) {
        console.error(error);

        resultCount.textContent =
          "Search failed";

        resultMessage.textContent =
          error.message ||
          "Certificate search failed.";

        resultList.replaceChildren();

        sendMessage.textContent =
          "The certificate library could not be searched.";

        sendMessage.style.color =
          "var(--red)";
      } finally {
        findButton.disabled =
          false;

        findButton.textContent =
          "Find certificates";
      }
    }
  );

  emailInput.addEventListener(
    "input",
    () => {
      sendButton.disabled =
        !foundCertificates.length ||
        !emailInput.validity.valid ||
        !emailInput.value.trim();
    }
  );

  sendButton.addEventListener(
    "click",
    async () => {
      const recipient =
        emailInput.value.trim();

      const assetNumbers =
        extractAssetNumbers(
          serialInput.value
        );

      if (
        !recipient ||
        !emailInput.validity.valid
      ) {
        sendMessage.textContent =
          "Enter a valid recipient email address.";

        sendMessage.style.color =
          "var(--red)";

        return;
      }

      if (!foundCertificates.length) {
        sendMessage.textContent =
          "Find the certificates before sending.";

        sendMessage.style.color =
          "var(--red)";

        return;
      }

      sendButton.disabled =
        true;

      sendButton.textContent =
        "Sending…";

      sendMessage.textContent =
        "Preparing PDFs and sending the email…";

      sendMessage.style.color =
        "var(--muted)";

      try {
        const response =
          await fetch(
            apiUrl(
              "/api/certificates/send"
            ),
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",

                "X-Dashboard-Key":
                  state.accessKey
              },

              body:
                JSON.stringify({
                  recipient,

                  jobReference:
                    job.reference ||
                    `Job ${job.id}`,

                  assetNumbers
                })
            }
          );

        const payload =
          await response
            .json()
            .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            payload.error ||
            "The certificates could not be sent."
          );
        }

        sendMessage.textContent =
          `Sent ${payload.attached} certificate${
            payload.attached === 1
              ? ""
              : "s"
          } to ${payload.recipient}.`;

        if (
          Array.isArray(
            payload.missing
          ) &&
          payload.missing.length
        ) {
          sendMessage.textContent +=
            ` Missing: ${payload.missing.join(
              ", "
            )}.`;
        }

        sendMessage.style.color =
          "var(--green)";
      } catch (error) {
        console.error(error);

        sendMessage.textContent =
          error.message ||
          "The certificates could not be sent.";

        sendMessage.style.color =
          "var(--red)";
      } finally {
        sendButton.disabled =
          !foundCertificates.length ||
          !emailInput.validity.valid ||
          !emailInput.value.trim();

        sendButton.textContent =
          "Send certificates";
      }
    }
  );
}


function renderRow(job) {
  const fragment =
    elements.rowTemplate.content
      .cloneNode(true);

  const row =
    fragment.querySelector(
      ".job-row"
    );

  const actionsRow =
    fragment.querySelector(
      ".job-actions-row"
    );

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

  actionsRow
    .querySelectorAll(
      ".action-job-reference"
    )
    .forEach((element) => {
      element.textContent =
        job.reference ||
        `Job ${job.id}`;
    });

  wireJobActions(
    row,
    actionsRow,
    job
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

function userIsBusy() {
  const certificateModalOpen =
    elements.certificateModal &&
    !elements.certificateModal.hidden;

  const actionPanelOpen =
    document.querySelector(
      ".job-actions-row:not([hidden])"
    );

  const activeElement =
    document.activeElement;

  const editingField =
    activeElement &&
    (
      activeElement.matches(
        "input, textarea, select"
      ) ||
      activeElement.closest(
        ".job-actions-panel, .certificate-modal"
      )
    );

  return Boolean(
    certificateModalOpen ||
    actionPanelOpen ||
    editingField
  );
}

function scheduleRefresh() {
  clearInterval(
    state.refreshTimer
  );

  const seconds = Math.max(
    120,
    Number(
      config.refreshSeconds ||
      300
    )
  );

  state.refreshTimer =
    setInterval(
      () => {
        if (
          state.loading ||
          userIsBusy()
        ) {
          return;
        }

        fetchJobs();
      },
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

function cleanCertificateDescription(value) {
  return String(value || "")
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ");
}

function updateCertificateFilenamePreview() {
  const assetNumber =
    elements.certificateAssetNumber.value
      .trim()
      .replace(/\s+/g, "");

  const description =
    cleanCertificateDescription(
      elements.certificateDescription.value
    ) ||
    "motor certificate";

  elements.certificateFilenamePreview.textContent =
    `${assetNumber || "Asset number"} ${description}.pdf`;
}

function openCertificateModal() {
  elements.certificateUploadForm.reset();

  elements.certificateDescription.value =
    "motor certificate";

  elements.certificateFileName.textContent =
    "No file selected";

  elements.certificateFormMessage.textContent =
    "";

  elements.certificateFormMessage.className =
    "certificate-form-message";

  elements.certificateModal.hidden =
    false;

  updateCertificateFilenamePreview();

  requestAnimationFrame(() => {
    elements.certificateAssetNumber.focus();
  });
}

function closeCertificateModal() {
  elements.certificateModal.hidden =
    true;
}

async function uploadCertificate(event) {
  event.preventDefault();

  const assetNumber =
    elements.certificateAssetNumber.value
      .trim();

  const description =
    elements.certificateDescription.value
      .trim();

  const file =
    elements.certificateFile.files?.[0];

  if (!assetNumber || !description || !file) {
    elements.certificateFormMessage.textContent =
      "Enter an asset number, description and choose a PDF.";

    elements.certificateFormMessage.className =
      "certificate-form-message is-error";

    return;
  }

  const formData =
    new FormData();

  formData.append(
    "assetNumber",
    assetNumber
  );

  formData.append(
    "description",
    description
  );

  formData.append(
    "certificate",
    file
  );

  elements.certificateUploadButton.disabled =
    true;

  elements.certificateUploadButton.textContent =
    "Uploading…";

  elements.certificateFormMessage.textContent =
    "Uploading certificate to the private library…";

  elements.certificateFormMessage.className =
    "certificate-form-message";

  try {
    const response = await fetch(
      apiUrl("/api/certificates/upload"),
      {
        method: "POST",

        credentials: "same-origin",

        body:
          formData
      }
    );

    const payload =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        payload.error ||
        `Upload failed with status ${response.status}.`
      );
    }

    elements.certificateFormMessage.textContent =
      `Uploaded ${payload.certificate?.filename || "certificate"}.`;

    elements.certificateFormMessage.className =
      "certificate-form-message is-success";

    elements.certificateUploadForm.reset();

    elements.certificateDescription.value =
      "motor certificate";

    elements.certificateFileName.textContent =
      "No file selected";

    updateCertificateFilenamePreview();
  } catch (error) {
    console.error(error);

    elements.certificateFormMessage.textContent =
      error.message ||
      "The certificate could not be uploaded.";

    elements.certificateFormMessage.className =
      "certificate-form-message is-error";
  } finally {
    elements.certificateUploadButton.disabled =
      false;

    elements.certificateUploadButton.textContent =
      "Upload certificate";
  }
}


function wireEvents() {

  elements.certificatesButton.addEventListener(
    "click",
    openCertificateModal
  );

  document
    .querySelectorAll(
      "[data-certificate-close]"
    )
    .forEach((button) => {
      button.addEventListener(
        "click",
        closeCertificateModal
      );
    });

  elements.certificateAssetNumber.addEventListener(
    "input",
    updateCertificateFilenamePreview
  );

  elements.certificateDescription.addEventListener(
    "input",
    updateCertificateFilenamePreview
  );

  elements.certificateFile.addEventListener(
    "change",
    () => {
      const file =
        elements.certificateFile.files?.[0];

      elements.certificateFileName.textContent =
        file
          ? file.name
          : "No file selected";
    }
  );

  elements.certificateUploadForm.addEventListener(
    "submit",
    uploadCertificate
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key === "Escape" &&
        !elements.certificateModal.hidden
      ) {
        closeCertificateModal();
      }
    }
  );


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
    elements.loginOverlay.hidden = true;

    fetchJobs();
  } else {
    elements.loginOverlay.hidden = true;

    elements.accessKeyInput.focus();
  }
}

initialise();