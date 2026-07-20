const grid = document.querySelector("#openWorkGrid");
const message = document.querySelector("#openWorkMessage");
const modal = document.querySelector("#publicationModal");
const form = document.querySelector("#publicationForm");
const picker = document.querySelector("#freelancerPicker");
const publicationMessage = document.querySelector("#publicationMessage");

let positions = [];
let freelancers = [];
let activeFilter = "review";
let activeSearch = "";
let activePosition = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function formatDateTime(value) {
  if (!value) return "Not set";

  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function datetimeLocalValue(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset =
    date.getTimezoneOffset() * 60_000;

  return new Date(
    date.getTime() - offset
  )
    .toISOString()
    .slice(0, 16);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const payload =
    await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload.error || "Request failed."
    );
  }

  return payload;
}

function publicationStatus(position) {
  return position.publication?.status || "draft";
}

function positionSearchText(
  position
) {
  return [
    position.name,
    position.reference,
    position.customer,
    position.serviceName,
    position.publication?.freelancer_note,
    position.publication?.admin_note
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isReturnedVacancy(position) {
  return Boolean(
    position.publication &&
    position.publication.status === "draft" &&
    position.publication.auto_closed === false &&
    position.publication.published_at
  );
}

function matchesFilter(position) {
  const status =
    publicationStatus(position);

  if (
    activeSearch &&
    !positionSearchText(position)
      .includes(activeSearch)
  ) {
    return false;
  }

  if (activeFilter === "all") {
    return true;
  }

  if (activeFilter === "review") {
    return (
      status === "draft" &&
      !isReturnedVacancy(position)
    );
  }

  if (activeFilter === "published") {
    return status === "published";
  }

  if (activeFilter === "returned") {
    return isReturnedVacancy(position);
  }

  if (activeFilter === "filled") {
    return (
      status === "closed" &&
      position.publication?.auto_closed === true
    );
  }

  return (
    status === "ignored" ||
    (
      status === "closed" &&
      position.publication?.auto_closed !== true
    )
  );
}

function updateMetrics() {
  document.querySelector(
    "#openMetric"
  ).textContent =
    String(
      positions.reduce(
        (total, position) =>
          total +
          Number(
            position.openPositions || 0
          ),
        0
      )
    );

  document.querySelector(
    "#draftMetric"
  ).textContent =
    String(
      positions.filter(
        (position) =>
          publicationStatus(position) === "draft"
      ).length
    );

  document.querySelector(
    "#publishedMetric"
  ).textContent =
    String(
      positions.filter(
        (position) =>
          publicationStatus(position) === "published"
      ).length
    );

  document.querySelector(
    "#applicationsMetric"
  ).textContent =
    String(
      positions.reduce(
        (total, position) =>
          total +
          Number(
            position.applicationCounts?.pending || 0
          ),
        0
      )
    );

  document.querySelector(
    "#closedMetric"
  ).textContent =
    String(
      positions.filter(
        (position) =>
          ["ignored", "closed"].includes(
            publicationStatus(position)
          )
      ).length
    );
}

function statusLabel(status) {
  if (status === "published") return "Published";
  if (status === "ignored") return "Ignored";
  if (status === "closed") return "Closed";
  return "Awaiting review";
}

function render() {
  const shown =
    positions.filter(matchesFilter);

  grid.replaceChildren();

  if (!shown.length) {
    grid.innerHTML = `
      <article class="empty-state-card">
        <h3>No positions in this section</h3>
        <p class="muted">
          Refresh Current RMS or choose another filter.
        </p>
      </article>
    `;
    return;
  }

  grid.innerHTML = shown.map((position) => {
    const publication = position.publication;
    const status = publicationStatus(position);
    const excludedCount =
      publication?.excludedUserIds?.length || 0;
    const includedCount =
      publication?.includedUserIds?.length || 0;

    return `
      <article class="open-work-admin-card">
        <div class="available-work-topline">
          <div class="publication-badge-row">
            <span class="publication-badge publication-${escapeHtml(status)}">
              ${statusLabel(status)}
            </span>

            ${
              isReturnedVacancy(position)
                ? '<span class="publication-badge publication-returned">Returned vacancy</span>'
                : ""
            }

            ${
              status === "closed" &&
              publication?.auto_closed === true
                ? '<span class="publication-badge publication-filled">Filled in Current RMS</span>'
                : ""
            }
          </div>

          <span class="muted">${escapeHtml(position.reference || "")}</span>
        </div>

        <h3>${escapeHtml(position.name)}</h3>
        <p class="available-work-customer">
          ${escapeHtml(position.customer || "")}
        </p>

        <div class="available-work-role">
          ${escapeHtml(position.serviceName)}
        </div>

        <dl class="available-work-meta">
          <div><dt>Call</dt><dd>${escapeHtml(formatDateTime(position.startsAt))}</dd></div>
          <div><dt>Finish</dt><dd>${escapeHtml(formatDateTime(position.endsAt))}</dd></div>
          <div><dt>Positions</dt><dd>${Number(position.openPositions || 0)} open</dd></div>
        </dl>

        ${
          publication?.freelancer_note
            ? `<p class="publication-note"><strong>Freelancer note:</strong> ${escapeHtml(publication.freelancer_note)}</p>`
            : ""
        }

        <div class="publication-summary">
          <span>
            ${Number(position.applicationCounts?.pending || 0)} pending application${Number(position.applicationCounts?.pending || 0) === 1 ? "" : "s"}
          </span>

          ${
            status === "published"
              ? `
                <span>
                  ${
                    publication.audience_mode === "selected"
                      ? `${includedCount} selected freelancer${includedCount === 1 ? "" : "s"}`
                      : `All suitable freelancers · ${excludedCount} excluded`
                  }
                </span>
                <span>
                  ${
                    publication.application_deadline
                      ? `Deadline ${escapeHtml(formatDateTime(publication.application_deadline))}`
                      : "No application deadline"
                  }
                </span>
              `
              : "<span>Not visible to freelancers</span>"
          }
        </div>

        <div class="review-actions">
          ${
            status === "published"
              ? `
                <button
                  class="secondary-button quick-unpublish-button"
                  data-item-id="${escapeHtml(position.opportunityItemId)}"
                  type="button"
                >
                  Unpublish
                </button>
              `
              : ""
          }

          <button
            class="edit-publication-button"
            data-item-id="${escapeHtml(position.opportunityItemId)}"
            type="button"
          >
            ${
              status === "draft"
                ? "Review & publish"
                : "Edit publication"
            }
          </button>
        </div>
      </article>
    `;
  }).join("");
}

function audienceSelection() {
  const selected =
    new Set(
      (
        document.querySelector(
          "#publicationAudience"
        ).value === "selected"
          ? activePosition?.publication?.includedUserIds
          : activePosition?.publication?.excludedUserIds
      ) || []
    );

  return selected;
}

function renderFreelancerPicker(search = "") {
  const audience =
    document.querySelector(
      "#publicationAudience"
    ).value;

  const selected =
    new Set(
      audience === "selected"
        ? activePosition?.publication?.includedUserIds || []
        : activePosition?.publication?.excludedUserIds || []
    );

  const term =
    search.trim().toLowerCase();

  picker.innerHTML =
    freelancers
      .filter((freelancer) =>
        !term ||
        freelancer.full_name
          .toLowerCase()
          .includes(term) ||
        freelancer.email
          .toLowerCase()
          .includes(term)
      )
      .map((freelancer) => `
        <label class="freelancer-picker-row">
          <input
            type="checkbox"
            value="${escapeHtml(freelancer.id)}"
            ${selected.has(String(freelancer.id)) ? "checked" : ""}
          >
          <span>
            <strong>${escapeHtml(freelancer.full_name)}</strong>
            <small>${escapeHtml(freelancer.email)}</small>
          </span>
        </label>
      `)
      .join("");

  document.querySelector(
    "#audienceHeading"
  ).textContent =
    audience === "selected"
      ? "Select who can see this position"
      : "Exclude individual freelancers";

  document.querySelector(
    "#audienceHelp"
  ).textContent =
    audience === "selected"
      ? "Only the freelancers ticked below will see this position, provided their service profile is suitable."
      : "All suitable freelancers will see this position except anyone ticked below.";
}

function openModal(itemId) {
  activePosition =
    positions.find(
      (position) =>
        String(position.opportunityItemId) ===
        String(itemId)
    );

  if (!activePosition) return;

  const publication =
    activePosition.publication || {};

  document.querySelector(
    "#publicationItemId"
  ).value =
    activePosition.opportunityItemId;

  document.querySelector(
    "#publicationTitle"
  ).textContent =
    publication.status === "published"
      ? "Edit published position"
      : "Review open position";

  document.querySelector(
    "#publicationSubtitle"
  ).textContent =
    `${activePosition.name} · ${activePosition.serviceName}`;

  document.querySelector(
    "#publicationStatus"
  ).value =
    publication.status || "published";

  document.querySelector(
    "#publicationAudience"
  ).value =
    publication.audience_mode ||
    "all_suitable";

  document.querySelector(
    "#publicationDeadline"
  ).value =
    datetimeLocalValue(
      publication.application_deadline
    );

  document.querySelector(
    "#publicationFreelancerNote"
  ).value =
    publication.freelancer_note || "";

  document.querySelector(
    "#publicationAdminNote"
  ).value =
    publication.admin_note || "";

  publicationMessage.textContent = "";
  document.querySelector("#freelancerSearch").value = "";
  renderFreelancerPicker();
  modal.hidden = false;
}

function closeModal() {
  modal.hidden = true;
  activePosition = null;
  form.reset();
}

async function savePublication(statusOverride = null) {
  if (!activePosition) return;

  const audienceMode =
    document.querySelector(
      "#publicationAudience"
    ).value;

  const selectedUserIds =
    [...picker.querySelectorAll(
      'input[type="checkbox"]:checked'
    )].map((input) => input.value);

  const payload = {
    status:
      statusOverride ||
      document.querySelector(
        "#publicationStatus"
      ).value,
    audienceMode,
    applicationDeadline:
      document.querySelector(
        "#publicationDeadline"
      ).value || null,
    freelancerNote:
      document.querySelector(
        "#publicationFreelancerNote"
      ).value,
    adminNote:
      document.querySelector(
        "#publicationAdminNote"
      ).value,
    excludedUserIds:
      audienceMode === "all_suitable"
        ? selectedUserIds
        : [],
    includedUserIds:
      audienceMode === "selected"
        ? selectedUserIds
        : []
  };

  await request(
    `/api/open-work-admin/${activePosition.opportunityItemId}/publication`,
    {
      method: "PUT",
      body: JSON.stringify(payload)
    }
  );
}


async function load() {
  message.textContent =
    "Loading Current RMS open positions…";

  try {
    const payload =
      await request(
        "/api/open-work-admin"
      );

    positions =
      payload.positions || [];

    freelancers =
      payload.freelancers || [];

    updateMetrics();
    render();

    message.textContent =
      `${positions.length} open or previously reviewed position${positions.length === 1 ? "" : "s"} shown.`;
  } catch (error) {
    message.textContent =
      error.message;
  }
}

grid.addEventListener("click", async (event) => {
  const editButton =
    event.target.closest(
      ".edit-publication-button"
    );

  if (editButton) {
    openModal(editButton.dataset.itemId);
    return;
  }

  const unpublishButton =
    event.target.closest(
      ".quick-unpublish-button"
    );

  if (unpublishButton) {
    activePosition =
      positions.find(
        (position) =>
          String(position.opportunityItemId) ===
          String(unpublishButton.dataset.itemId)
      );

    try {
      unpublishButton.disabled = true;
      await savePublication("draft");
      activePosition = null;
      await load();
    } catch (error) {
      window.alert(error.message);
      unpublishButton.disabled = false;
    }
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  publicationMessage.textContent =
    "Saving publication…";

  const submit =
    form.querySelector(
      'button[type="submit"]'
    );

  submit.disabled = true;

  try {
    await savePublication();
    closeModal();
    await load();
  } catch (error) {
    publicationMessage.textContent =
      error.message;
  } finally {
    submit.disabled = false;
  }
});

document.querySelector(
  "#publicationAudience"
).addEventListener(
  "change",
  () => renderFreelancerPicker()
);

document.querySelector(
  "#freelancerSearch"
).addEventListener(
  "input",
  (event) =>
    renderFreelancerPicker(
      event.target.value
    )
);

document.querySelectorAll(
  ".view-toggle-button[data-filter]"
).forEach((button) => {
  button.addEventListener(
    "click",
    () => {
      activeFilter =
        button.dataset.filter;

      document.querySelectorAll(
        ".view-toggle-button[data-filter]"
      ).forEach((item) =>
        item.classList.toggle(
          "is-active",
          item === button
        )
      );

      render();
    }
  );
});

document.querySelector(
  "#closePublicationModal"
).addEventListener(
  "click",
  closeModal
);

document.querySelector(
  "#cancelPublication"
).addEventListener(
  "click",
  closeModal
);

modal.addEventListener(
  "click",
  (event) => {
    if (event.target === modal) {
      closeModal();
    }
  }
);

document.querySelector(
  "#refreshOpenWork"
).addEventListener(
  "click",
  load
);

document.querySelector(
  "#logoutButton"
).addEventListener(
  "click",
  async () => {
    await fetch(
      "/api/auth/logout",
      {
        method: "POST"
      }
    );

    window.location.href =
      "/login";
  }
);

load();


document.querySelector(
  "#openWorkSearch"
).addEventListener(
  "input",
  (event) => {
    activeSearch =
      event.target.value
        .trim()
        .toLowerCase();

    render();
  }
);
