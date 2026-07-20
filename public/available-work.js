const grid = document.querySelector("#availableWorkGrid");
const message = document.querySelector("#workMessage");
const refresh = document.querySelector("#refreshWork");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);
}

function dateTime(value) {
  if (!value) return "Time to be confirmed";
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function applicationControls(item) {
  const application = item.application;

  if (!application) {
    return `
      <button
        type="button"
        class="apply-button"
        data-item-id="${escapeHtml(item.opportunityItemId)}"
      >
        I’m available
      </button>
    `;
  }

  if (application.status === "pending") {
    return `
      <span class="application-state application-pending">Awaiting approval</span>
      <button
        type="button"
        class="secondary-button compact-button withdraw-button"
        data-application-id="${escapeHtml(application.id)}"
      >
        Withdraw
      </button>
    `;
  }

  if (application.status === "accepted") {
    return `
      <span class="application-state application-accepted">Accepted</span>
      ${
        application.current_rms_sync_status === "pending"
          ? '<small class="muted">Current RMS allocation pending</small>'
          : ""
      }
    `;
  }

  return `
    <span class="application-state application-declined">Declined</span>
    ${
      application.decline_reason
        ? `<small class="muted">${escapeHtml(application.decline_reason)}</small>`
        : ""
    }
  `;
}

function render(work) {
  grid.replaceChildren();

  if (!work.length) {
    grid.innerHTML = `
      <article class="empty-state-card">
        <h3>No suitable open positions</h3>
        <p class="muted">
          New opportunities will appear here when Current RMS contains an unfilled service position that matches your profile.
        </p>
      </article>
    `;
    return;
  }

  grid.innerHTML = work.map((item) => `
    <article class="available-work-card">
      <div class="available-work-topline">
        <span class="status-pill">${item.openPositions} open</span>
        <span class="muted">${escapeHtml(item.reference || "")}</span>
      </div>
      <h3>${escapeHtml(item.name)}</h3>
      <p class="available-work-customer">${escapeHtml(item.customer || "")}</p>
      <div class="available-work-role">${escapeHtml(item.serviceName)}</div>

      ${
        item.freelancerNote
          ? `<p class="publication-note">${escapeHtml(item.freelancerNote)}</p>`
          : ""
      }

      <dl class="available-work-meta">
        <div><dt>Call</dt><dd>${escapeHtml(dateTime(item.startsAt))}</dd></div>
        <div><dt>Finish</dt><dd>${escapeHtml(dateTime(item.endsAt))}</dd></div>
        <div><dt>Positions</dt><dd>${item.openPositions} available</dd></div>
        ${
          item.applicationDeadline
            ? `<div><dt>Apply by</dt><dd>${escapeHtml(dateTime(item.applicationDeadline))}</dd></div>`
            : ""
        }
      </dl>

      <div class="available-work-actions">
        ${applicationControls(item)}
      </div>
    </article>
  `).join("");
}

async function load() {
  message.textContent = "Loading available work…";
  refresh.disabled = true;

  try {
    const payload = await request("/api/available-work");
    render(payload.work || []);
    message.textContent = payload.suitabilityConfigured
      ? `${payload.work.length} suitable open position${payload.work.length === 1 ? "" : "s"} found.`
      : `${payload.work.length} open position${payload.work.length === 1 ? "" : "s"} found. Your account has no service filter yet.`;
  } catch (error) {
    message.textContent = error.message;
  } finally {
    refresh.disabled = false;
  }
}

grid.addEventListener("click", async (event) => {
  const apply = event.target.closest(".apply-button");
  const withdraw = event.target.closest(".withdraw-button");

  try {
    if (apply) {
      apply.disabled = true;
      await request(
        `/api/available-work/${apply.dataset.itemId}/apply`,
        {
          method: "POST",
          body: JSON.stringify({})
        }
      );
      await load();
    }

    if (withdraw) {
      withdraw.disabled = true;
      await request(
        `/api/available-work/applications/${withdraw.dataset.applicationId}/withdraw`,
        { method: "PATCH" }
      );
      await load();
    }
  } catch (error) {
    window.alert(error.message);
    await load();
  }
});

refresh.addEventListener("click", load);

document.querySelector("#logoutButton").addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login";
});

load();
