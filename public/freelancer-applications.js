const list = document.querySelector("#applicationList");
const message = document.querySelector("#applicationsMessage");
const refresh = document.querySelector("#refreshApplications");

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
  if (!value) return "Not set";
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
  if (!response.ok) {
    const error =
      new Error(
        payload.error ||
        "Request failed."
      );

    error.payload =
      payload;

    throw error;
  }

  return payload;
}

function render(applications) {
  list.replaceChildren();

  if (!applications.length) {
    list.innerHTML = `
      <article class="empty-state-card">
        <h3>No applications to review</h3>
        <p class="muted">New freelancer applications will appear here.</p>
      </article>
    `;
    return;
  }

  list.innerHTML = applications.map((item) => `
    <article class="application-card">
      <div class="application-card-heading">
        <div>
          <span class="application-state application-${escapeHtml(item.status)}">
            ${escapeHtml(item.status)}
          </span>
          <h3>${escapeHtml(item.job_name)}</h3>
          <p>${escapeHtml(item.job_reference || "")} ${item.customer_name ? `· ${escapeHtml(item.customer_name)}` : ""}</p>
        </div>
        <div class="application-person">
          <strong>${escapeHtml(item.freelancer_name)}</strong>
          <span>${escapeHtml(item.freelancer_email)}</span>
          <small>${escapeHtml(item.current_rms_record_type || "none")} #${escapeHtml(item.current_rms_record_id || "not mapped")}</small>
        </div>
      </div>

      <dl class="available-work-meta">
        <div><dt>Position</dt><dd>${escapeHtml(item.service_name)}</dd></div>
        <div><dt>Call</dt><dd>${escapeHtml(dateTime(item.starts_at))}</dd></div>
        <div><dt>Finish</dt><dd>${escapeHtml(dateTime(item.ends_at))}</dd></div>
      </dl>

      ${
        item.message
          ? `<p class="application-note">${escapeHtml(item.message)}</p>`
          : ""
      }

      ${
        item.status === "pending"
          ? `
            <div class="review-actions">
              <button class="secondary-button decline-button" data-id="${escapeHtml(item.id)}" type="button">Decline</button>
              <button class="accept-button" data-id="${escapeHtml(item.id)}" type="button">Accept freelancer</button>
            </div>
          `
          : `
            <div class="application-result-row">
              <p class="muted">
                ${
                  item.status === "accepted" &&
                item.status !== "historical"
                    ? `${
  item.current_rms_sync_status === "synced"
    ? "Accepted · Current RMS synced successfully"
    : item.current_rms_sync_status === "failed"
      ? "Needs attention · Unable to synchronise with Current RMS"
      : "Accepted"
}${item.current_rms_allocation_id ? ` · Allocation ${escapeHtml(item.current_rms_allocation_id)}` : ""}${item.sync_error ? ` · ${escapeHtml(item.sync_error)}` : ""}`
                    : `Declined${item.decline_reason ? ` · ${escapeHtml(item.decline_reason)}` : ""}`
                }
              </p>

              ${
                item.status === "accepted"
                  ? `
                    <button
                      type="button"
                      class="secondary-button compact-button allocation-details-button"
                      data-id="${escapeHtml(item.id)}"
                    >
                      Allocation details
                    </button>
                  `
                  : ""
              }
            </div>

            <div
              class="allocation-diagnostic"
              id="allocation-diagnostic-${escapeHtml(item.id)}"
              hidden
            ></div>
          `
      }
    </article>
  `).join("");
}


function diagnosticMarkup(
  payload
) {
  const diagnostic =
    payload.diagnostic || {};

  const stockLevel =
    diagnostic.selectedStockLevel;

  const attempts =
    Array.isArray(
      diagnostic.lookupAttempts
    )
      ? diagnostic.lookupAttempts
      : [];

  return `
    <div class="allocation-diagnostic-heading">
      <div>
        <p class="eyebrow eyebrow-tight">
          Current RMS allocation diagnostic
        </p>
        <h4>
          ${
            diagnostic.ready
              ? "Resource mapping resolved"
              : "Resource mapping needs attention"
          }
        </h4>
      </div>

      <span class="application-state ${
        diagnostic.ready
          ? "application-accepted"
          : "application-pending"
      }">
        ${
          diagnostic.ready
            ? "Ready to test"
            : "Not ready"
        }
      </span>
    </div>

    ${
      diagnostic.reason
        ? `<p class="allocation-warning">${escapeHtml(diagnostic.reason)}</p>`
        : ""
    }

    <dl class="allocation-diagnostic-grid">
      <div>
        <dt>Opportunity item</dt>
        <dd>${escapeHtml(diagnostic.opportunityItem?.id || "Not resolved")}</dd>
      </div>
      <div>
        <dt>Service ID</dt>
        <dd>${escapeHtml(diagnostic.opportunityItem?.serviceId || "Not resolved")}</dd>
      </div>
      <div>
        <dt>Member ID</dt>
        <dd>${escapeHtml(diagnostic.member?.id || "Not resolved")}</dd>
      </div>
      <div>
        <dt>Resource stock level</dt>
        <dd>${escapeHtml(stockLevel?.id || "Not resolved")}</dd>
      </div>
      <div>
        <dt>Existing matching allocation</dt>
        <dd>${diagnostic.matchingExistingAssets?.length || 0}</dd>
      </div>
      <div>
        <dt>Live vacancy</dt>
        <dd>${diagnostic.liveAvailability?.available ? "Available" : "Unavailable"}</dd>
      </div>
    </dl>

    <details class="allocation-technical-details">
      <summary>Technical details</summary>
      <pre>${escapeHtml(JSON.stringify({
        preparedAllocation:
          diagnostic.preparedAllocation,
        resourceStockLevels:
          diagnostic.resourceStockLevels,
        existingItemAssets:
          diagnostic.existingItemAssets,
        lookupAttempts:
          attempts
      }, null, 2))}</pre>
    </details>

    <div class="allocation-diagnostic-actions">
      ${
        diagnostic.ready &&
        payload.application?.canAllocate
          ? `
            <button
              type="button"
              class="allocate-current-rms-button"
              data-id="${escapeHtml(payload.application?.id || "")}"
            >
              Allocate in Current RMS
            </button>
          `
          : ""
      }

      <button
        type="button"
        class="secondary-button compact-button inspect-member-button"
        data-id="${escapeHtml(payload.application?.id || "")}"
      >
        Inspect Current RMS member
      </button>
    </div>

    <div
      class="member-diagnostic-results"
      id="member-diagnostic-${escapeHtml(payload.application?.id || "")}"
      hidden
    ></div>

    <p class="muted allocation-write-note">
      No Current RMS data was changed. Real allocation writes remain ${
        diagnostic.writeEnabled
          ? "enabled. Use Allocate in Current RMS only on the test opportunity until the first write is verified."
          : "disabled."
      }
    </p>
  `;
}


function memberDiagnosticMarkup(
  payload
) {
  const diagnostic =
    payload.diagnostic || {};

  const candidates =
    Array.isArray(
      diagnostic.candidates
    )
      ? diagnostic.candidates
      : [];

  const probes =
    Array.isArray(
      diagnostic.probes
    )
      ? diagnostic.probes
      : [];

  return `
    <div class="member-diagnostic-heading">
      <div>
        <p class="eyebrow eyebrow-tight">
          Current RMS member inspection
        </p>
        <h4>
          ${
            candidates.length
              ? `${candidates.length} possible resource record${candidates.length === 1 ? "" : "s"} found`
              : "No resource record resolved"
          }
        </h4>
      </div>
    </div>

    ${
      candidates.length
        ? `
          <div class="member-candidate-list">
            ${candidates.map((candidate) => `
              <article class="member-candidate-card">
                <strong>
                  ${
                    candidate.name
                      ? escapeHtml(candidate.name)
                      : `Record ${escapeHtml(candidate.id || "unknown")}`
                  }
                </strong>
                <span>ID ${escapeHtml(candidate.id || "—")}</span>
                <span>Member ${escapeHtml(candidate.member_id || "—")}</span>
                <span>Service ${escapeHtml(candidate.item_id || candidate.stock_item_id || "—")}</span>
                <span>Source ${escapeHtml(candidate.sourcePath || "—")}</span>
              </article>
            `).join("")}
          </div>
        `
        : `
          <p class="allocation-warning">
            The authenticated API did not expose a matching resource or stock-level record through the tested routes.
          </p>
        `
    }

    <details class="allocation-technical-details">
      <summary>Member and API probe details</summary>
      <pre>${escapeHtml(JSON.stringify({
        member:
          diagnostic.member,
        candidates,
        probes
      }, null, 2))}</pre>
    </details>
  `;
}

async function load() {
  message.textContent = "Loading applications…";
  refresh.disabled = true;

  try {
    const payload = await request("/api/freelancer-applications");
    render(payload.applications || []);
    message.textContent =
      `${payload.applications.length} application${payload.applications.length === 1 ? "" : "s"} shown.` +
      (payload.allocationWritesEnabled
        ? " Current RMS write mode is enabled, but the exact allocation request still needs confirmation."
        : " Accepted applications are marked as pending Current RMS allocation.");
  } catch (error) {
    message.textContent = error.message;
  } finally {
    refresh.disabled = false;
  }
}

list.addEventListener("click", async (event) => {
  const accept = event.target.closest(".accept-button");
  const decline = event.target.closest(".decline-button");

  try {
    if (accept) {
      const originalText =
        accept.textContent;

      accept.disabled = true;
      accept.textContent =
        "Checking Current RMS…";

      message.textContent =
        "Checking that the position is still available in Current RMS…";

      try {
        const payload = await request(
          `/api/freelancer-applications/${accept.dataset.id}/review`,
          {
            method: "PATCH",
            body: JSON.stringify({ decision: "accept" })
          }
        );

        message.textContent =
          "Freelancer accepted.";

        if (payload.currentRmsMessage) {
          window.alert(
            payload.currentRmsMessage
          );
        }

        await load();
      } finally {
        accept.disabled = false;
        accept.textContent =
          originalText;
      }
    }


    const allocationDetails =
      event.target.closest(
        ".allocation-details-button"
      );

    if (allocationDetails) {
      const panel =
        document.querySelector(
          `#allocation-diagnostic-${allocationDetails.dataset.id}`
        );

      if (!panel) {
        return;
      }

      if (!panel.hidden) {
        panel.hidden = true;
        allocationDetails.textContent =
          "Allocation details";
        return;
      }

      allocationDetails.disabled =
        true;
      allocationDetails.textContent =
        "Checking mapping…";

      try {
        const payload =
          await request(
            `/api/freelancer-applications/${allocationDetails.dataset.id}/allocation-diagnostic`
          );

        panel.innerHTML =
          diagnosticMarkup(
            payload
          );

        panel.hidden =
          false;

        allocationDetails.textContent =
          "Hide details";
      } finally {
        allocationDetails.disabled =
          false;
      }
    }



    const allocateCurrentRms =
      event.target.closest(
        ".allocate-current-rms-button"
      );

    if (allocateCurrentRms) {
      const confirmed =
        window.confirm(
          "This will make a live allocation in Current RMS. Continue?"
        );

      if (!confirmed) {
        return;
      }

      allocateCurrentRms.disabled =
        true;
      allocateCurrentRms.textContent =
        "Allocating & verifying…";

      try {
        const payload =
          await request(
            `/api/freelancer-applications/${allocateCurrentRms.dataset.id}/allocate-current-rms`,
            {
              method: "POST",
              body: JSON.stringify({})
            }
          );

        window.alert(
          payload.alreadySynced
            ? "This freelancer was already synced to Current RMS."
            : "Freelancer allocated and verified in Current RMS."
        );

        await load();
      } finally {
        allocateCurrentRms.disabled =
          false;
        allocateCurrentRms.textContent =
          "Allocate in Current RMS";
      }
    }

    const inspectMember =
      event.target.closest(
        ".inspect-member-button"
      );

    if (inspectMember) {
      const panel =
        document.querySelector(
          `#member-diagnostic-${inspectMember.dataset.id}`
        );

      if (!panel) {
        return;
      }

      if (!panel.hidden) {
        panel.hidden = true;
        inspectMember.textContent =
          "Inspect Current RMS member";
        return;
      }

      inspectMember.disabled =
        true;
      inspectMember.textContent =
        "Inspecting member…";

      try {
        const payload =
          await request(
            `/api/freelancer-applications/${inspectMember.dataset.id}/member-diagnostic`
          );

        panel.innerHTML =
          memberDiagnosticMarkup(
            payload
          );

        panel.hidden =
          false;

        inspectMember.textContent =
          "Hide member inspection";
      } finally {
        inspectMember.disabled =
          false;
      }
    }

    if (decline) {
      const reason = window.prompt("Optional reason for declining:") || "";
      decline.disabled = true;
      await request(
        `/api/freelancer-applications/${decline.dataset.id}/review`,
        {
          method: "PATCH",
          body: JSON.stringify({
            decision: "decline",
            reason
          })
        }
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
