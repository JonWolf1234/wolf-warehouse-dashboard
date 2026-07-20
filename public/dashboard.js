const nav = document.querySelector("#mainNav");
const jobCards = document.querySelector("#jobCards");
const jobsMessage = document.querySelector("#jobsMessage");
const refreshButton = document.querySelector("#refreshJobs");
const listView = document.querySelector("#listView");
const calendarView = document.querySelector("#calendarView");
const listViewButton = document.querySelector("#listViewButton");
const calendarViewButton = document.querySelector("#calendarViewButton");
const calendarGrid = document.querySelector("#calendarGrid");
const calendarMonthLabel = document.querySelector("#calendarMonthLabel");
const calendarDetailTitle = document.querySelector("#calendarDetailTitle");
const calendarDetailIntro = document.querySelector("#calendarDetailIntro");
const calendarDetailContent = document.querySelector("#calendarDetailContent");

let currentUser = null;
let currentJobs = [];
let calendarDate = new Date();
let selectedCalendarDate = null;

function greetingForTime() {
  const hour = new Date().getHours();

  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function daysUntil(value) {
  if (!value) return null;

  const target = new Date(value);

  if (Number.isNaN(target.getTime())) {
    return null;
  }

  return Math.ceil(
    (target.getTime() - Date.now()) /
    86_400_000
  );
}

function nextCallMessage(jobs) {
  const calls = jobs
    .map((job) => job.callAt || job.loadAt || job.prepAt)
    .filter(Boolean)
    .map((value) => ({
      value,
      time: new Date(value).getTime()
    }))
    .filter((item) =>
      Number.isFinite(item.time) &&
      item.time >= Date.now()
    )
    .sort((a, b) => a.time - b.time);

  if (!calls.length) {
    return "You have no upcoming calls currently scheduled.";
  }

  const next = calls[0];
  const days = daysUntil(next.value);

  if (days === 0) {
    return `Your next call is today at ${formatTime(next.value)}.`;
  }

  if (days === 1) {
    return `Your next call is tomorrow at ${formatTime(next.value)}.`;
  }

  return `Your next call is in ${days} days.`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>'"]/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]
  );
}

function formatDate(value, options = {}) {
  if (!value) return "Not set";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-GB", {
    weekday: options.weekday ?? "short",
    day: "numeric",
    month: "short",
    year: options.year ? "numeric" : undefined,
    hour: options.time === false ? undefined : "2-digit",
    minute: options.time === false ? undefined : "2-digit"
  }).format(date);
}

function formatTime(value) {
  if (!value) return "Not set";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatDay(value) {
  return formatDate(value, {
    weekday: "long",
    time: false
  });
}

function localDateKey(value) {
  const date =
    value instanceof Date
      ? value
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function buildNav(user) {
  const links = [
    '<a href="/dashboard">My dashboard</a>'
  ];

  if (
    ["admin", "scheduler", "viewer"].includes(user.role)
  ) {
    links.push(
      '<a href="/warehouse/">Warehouse</a>'
    );
  }

  if (user.role === "admin") {
    links.push(
      '<a href="/admin/users">Admin</a>',
      '<a href="/admin/settings">Settings</a>'
    );
  }

  links.push(
    '<a href="/account">My account</a>'
  );

  if (user.personType === "freelancer") {
    links.push(
      '<a href="/available-work">Available work</a>'
    );
  }

  if (
    user.role === "admin" ||
    user.canApproveFreelancers
  ) {
    links.push(
      '<a href="/open-work-admin">Publish work</a>'
    );

    links.push(
      '<a href="/freelancer-applications">Applications</a>'
    );
  }

  links.push(
    '<button class="link-button" id="logoutButton" type="button">Log out</button>'
  );

  nav.innerHTML = links.join("");

  document
    .querySelector("#logoutButton")
    .addEventListener("click", async () => {
      await fetch("/api/auth/logout", {
        method: "POST"
      });

      window.location.href = "/login";
    });
}

function shiftMarkup(assignment) {
  const start = assignment.startsAt;
  const finish = assignment.endsAt;

  return `
    <div class="shift-row">
      <div class="shift-role">
        ${escapeHtml(assignment.name || "Assigned service")}
      </div>
      <div class="shift-date">
        ${escapeHtml(formatDay(start))}
      </div>
      <div class="shift-time">
        <strong>${escapeHtml(formatTime(start))}</strong>
        &nbsp;–&nbsp;
        <strong>${escapeHtml(formatTime(finish))}</strong>
      </div>
    </div>
  `;
}

function jobActionsMarkup(job) {
  if (
    !job.currentRmsUrl ||
    !currentUser?.canOpenCurrentRms
  ) {
    return "";
  }

  return `
    <a
      class="job-card-link"
      href="${escapeHtml(job.currentRmsUrl)}"
      target="_blank"
      rel="noreferrer"
    >
      Open in Current RMS
    </a>
  `;
}

function updateSummary(jobs) {
  const welcomeSummary =
    document.querySelector("#welcomeSummary");

  const jobCountText =
    `${jobs.length} upcoming job${jobs.length === 1 ? "" : "s"}`;

  welcomeSummary.innerHTML = `
    You have
    <strong>${escapeHtml(jobCountText)}</strong>.
    ${escapeHtml(nextCallMessage(jobs))}
  `;

  const totalShifts = jobs.reduce(
    (sum, job) =>
      sum +
      (
        Array.isArray(job.assignments)
          ? job.assignments.length
          : 0
      ),
    0
  );

  document.querySelector("#jobsMetric").textContent =
    String(jobs.length);

  document.querySelector("#shiftsMetric").textContent =
    String(totalShifts);

  document.querySelector("#nextCallMetric").textContent =
    jobs[0]?.callAt
      ? formatDate(jobs[0].callAt, {
          weekday: "short"
        })
      : "—";
}

function updateNextAssignment(jobs) {
  if (!jobs.length) {
    document.querySelector("#nextJobTitle").textContent =
      "No upcoming assignments";

    document.querySelector("#nextJobText").textContent =
      "Your next confirmed shift will appear here.";

    document.querySelector("#nextJobMeta").replaceChildren();

    return;
  }

  const first = jobs[0];

  document.querySelector("#nextJobTitle").textContent =
    first.name || "Your next assignment";

  document.querySelector("#nextJobText").textContent =
    first.assignedRole || "Assignment confirmed";

  document.querySelector("#nextJobMeta").innerHTML = `
    <span class="hero-chip">
      Call ${escapeHtml(
        formatDate(first.callAt || first.loadAt || first.prepAt)
      )}
    </span>
    <span class="hero-chip">
      Finish ${escapeHtml(
        formatDate(first.finishAt || first.returnAt)
      )}
    </span>
    ${
      first.reference
        ? `<span class="hero-chip">${escapeHtml(first.reference)}</span>`
        : ""
    }
  `;
}

function renderList(jobs) {
  jobCards.replaceChildren();

  if (!jobs.length) {
    const empty = document.createElement("article");
    empty.className = "empty-state-card";
    empty.innerHTML = `
      <h3>No upcoming assignments</h3>
      <p class="muted">
        Your confirmed jobs and shifts will appear here as soon as they are assigned in Current RMS.
      </p>
    `;

    jobCards.append(empty);
    return;
  }

  for (const job of jobs) {
    const assignments =
      Array.isArray(job.assignments)
        ? job.assignments
        : [];

    const article = document.createElement("article");
    article.className = "job-card";

    article.innerHTML = `
      <div class="job-card-header">
        <div class="job-card-title">
          <span class="status-pill">
            ${escapeHtml(job.status || "Scheduled")}
          </span>
          <h3>${escapeHtml(job.name || "Unnamed job")}</h3>
          <p>
            ${escapeHtml(job.reference || "")}
            ${
              job.customer
                ? ` · ${escapeHtml(job.customer)}`
                : ""
            }
          </p>
          ${
            job.assignedRole
              ? `<div class="job-card-role">${escapeHtml(job.assignedRole)}</div>`
              : ""
          }
        </div>

        ${jobActionsMarkup(job)}
      </div>

      <div class="job-summary-strip">
        <div class="job-summary-item">
          <span>First call</span>
          <strong>${escapeHtml(
            formatDate(job.callAt || job.loadAt || job.prepAt)
          )}</strong>
        </div>
        <div class="job-summary-item">
          <span>Final finish</span>
          <strong>${escapeHtml(
            formatDate(job.finishAt || job.returnAt)
          )}</strong>
        </div>
        <div class="job-summary-item">
          <span>Assigned shifts</span>
          <strong>${assignments.length}</strong>
        </div>
      </div>

      <div class="shift-list">
        <div class="shift-list-heading">
          <h4>Shift details</h4>
          <span class="shift-count">
            ${assignments.length} shift${assignments.length === 1 ? "" : "s"}
          </span>
        </div>
        ${
          assignments.length
            ? assignments.map(shiftMarkup).join("")
            : `
              <div class="shift-row">
                <div class="shift-role">Assignment confirmed</div>
                <div class="shift-date">
                  ${escapeHtml(
                    formatDay(job.callAt || job.showAt || job.deliverAt)
                  )}
                </div>
                <div class="shift-time">
                  <strong>${escapeHtml(
                    formatTime(job.callAt || job.showAt || job.deliverAt)
                  )}</strong>
                </div>
              </div>
            `
        }
      </div>
    `;

    jobCards.append(article);
  }
}

function calendarEntriesByDate(jobs) {
  const entries = new Map();

  for (const job of jobs) {
    const assignments =
      Array.isArray(job.assignments) &&
      job.assignments.length
        ? job.assignments
        : [{
            name: job.assignedRole || "Assignment confirmed",
            startsAt: job.callAt || job.showAt || job.deliverAt,
            endsAt: job.finishAt || job.returnAt
          }];

    for (const assignment of assignments) {
      const key = localDateKey(assignment.startsAt);

      if (!key) continue;

      const dayEntries = entries.get(key) || [];

      dayEntries.push({
        job,
        assignment
      });

      entries.set(key, dayEntries);
    }
  }

  for (const dayEntries of entries.values()) {
    dayEntries.sort((a, b) =>
      new Date(a.assignment.startsAt) -
      new Date(b.assignment.startsAt)
    );
  }

  return entries;
}

function calendarTooltipMarkup(entries) {
  return entries
    .slice(0, 3)
    .map(({ job, assignment }) => `
      <div class="calendar-tooltip-entry">
        <strong>${escapeHtml(job.name || "Unnamed job")}</strong>
        <span>${escapeHtml(assignment.name || "Assigned service")}</span>
        <span>
          ${escapeHtml(formatTime(assignment.startsAt))}
          –
          ${escapeHtml(formatTime(assignment.endsAt))}
        </span>
      </div>
    `)
    .join("");
}

function renderCalendarDetail(dateKey, entries) {
  const date = new Date(`${dateKey}T12:00:00`);

  calendarDetailTitle.textContent =
    new Intl.DateTimeFormat("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(date);

  if (!entries.length) {
    calendarDetailIntro.textContent =
      "You have no assigned shifts on this date.";

    calendarDetailContent.replaceChildren();
    return;
  }

  calendarDetailIntro.textContent =
    `${entries.length} assigned shift${entries.length === 1 ? "" : "s"}.`;

  calendarDetailContent.innerHTML =
    entries.map(({ job, assignment }) => `
      <article class="calendar-detail-card">
        <div class="calendar-detail-card-heading">
          <div>
            <span class="status-pill">
              ${escapeHtml(job.status || "Scheduled")}
            </span>
            <h4>${escapeHtml(job.name || "Unnamed job")}</h4>
            <p>
              ${escapeHtml(job.reference || "")}
              ${
                job.customer
                  ? ` · ${escapeHtml(job.customer)}`
                  : ""
              }
            </p>
          </div>
          ${jobActionsMarkup(job)}
        </div>

        <dl class="calendar-detail-meta">
          <div>
            <dt>Role</dt>
            <dd>${escapeHtml(assignment.name || job.assignedRole || "Assigned service")}</dd>
          </div>
          <div>
            <dt>Call</dt>
            <dd>${escapeHtml(formatTime(assignment.startsAt))}</dd>
          </div>
          <div>
            <dt>Finish</dt>
            <dd>${escapeHtml(formatTime(assignment.endsAt))}</dd>
          </div>
        </dl>
      </article>
    `).join("");
}

function renderCalendar() {
  const entriesByDate =
    calendarEntriesByDate(currentJobs);

  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();

  calendarMonthLabel.textContent =
    new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric"
    }).format(new Date(year, month, 1));

  calendarGrid.replaceChildren();

  const firstDay = new Date(year, month, 1);
  const mondayIndex = (firstDay.getDay() + 6) % 7;
  const daysInMonth =
    new Date(year, month + 1, 0).getDate();

  const todayKey =
    localDateKey(new Date());

  for (let index = 0; index < mondayIndex; index += 1) {
    const spacer =
      document.createElement("div");

    spacer.className =
      "calendar-day calendar-day-empty";

    spacer.setAttribute("aria-hidden", "true");
    calendarGrid.append(spacer);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(year, month, day);
    const dateKey = localDateKey(date);
    const entries = entriesByDate.get(dateKey) || [];

    const button = document.createElement("button");
    button.type = "button";
    button.className = "calendar-day";
    button.dataset.date = dateKey;

    if (entries.length) {
      button.classList.add("has-shifts");
    }

    if (dateKey === todayKey) {
      button.classList.add("is-today");
    }

    if (dateKey === selectedCalendarDate) {
      button.classList.add("is-selected");
    }

    button.setAttribute(
      "aria-label",
      `${day} ${calendarMonthLabel.textContent}${
        entries.length
          ? `, ${entries.length} assigned shift${entries.length === 1 ? "" : "s"}`
          : ""
      }`
    );

    button.innerHTML = `
      <span class="calendar-day-number">${day}</span>

      <span class="calendar-day-events">
        ${
          entries.slice(0, 2).map(({ job, assignment }) => `
            <span class="calendar-event-pill">
              <strong>${escapeHtml(formatTime(assignment.startsAt))}</strong>
              ${escapeHtml(job.name || "Job")}
            </span>
          `).join("")
        }

        ${
          entries.length > 2
            ? `<span class="calendar-more">+${entries.length - 2} more</span>`
            : ""
        }
      </span>

      ${
        entries.length
          ? `
            <span class="calendar-tooltip" role="tooltip">
              ${calendarTooltipMarkup(entries)}
            </span>
          `
          : ""
      }
    `;

    button.addEventListener("click", () => {
      selectedCalendarDate = dateKey;
      renderCalendar();
      renderCalendarDetail(dateKey, entries);
    });

    calendarGrid.append(button);
  }

  if (
    selectedCalendarDate &&
    selectedCalendarDate.startsWith(
      `${year}-${String(month + 1).padStart(2, "0")}`
    )
  ) {
    renderCalendarDetail(
      selectedCalendarDate,
      entriesByDate.get(selectedCalendarDate) || []
    );
  } else {
    const firstPopulatedDate =
      [...entriesByDate.keys()]
        .filter((key) =>
          key.startsWith(
            `${year}-${String(month + 1).padStart(2, "0")}`
          )
        )
        .sort()[0];

    if (firstPopulatedDate) {
      selectedCalendarDate = firstPopulatedDate;
      renderCalendar();
      return;
    }

    selectedCalendarDate = null;
    calendarDetailTitle.textContent =
      calendarMonthLabel.textContent;
    calendarDetailIntro.textContent =
      "You have no assigned shifts in this month.";
    calendarDetailContent.replaceChildren();
  }
}

function setScheduleView(view) {
  const calendarSelected =
    view === "calendar";

  listView.hidden =
    calendarSelected;

  calendarView.hidden =
    !calendarSelected;

  listViewButton.classList.toggle(
    "is-active",
    !calendarSelected
  );

  calendarViewButton.classList.toggle(
    "is-active",
    calendarSelected
  );

  listViewButton.setAttribute(
    "aria-pressed",
    String(!calendarSelected)
  );

  calendarViewButton.setAttribute(
    "aria-pressed",
    String(calendarSelected)
  );

  localStorage.setItem(
    "wolfScheduleView",
    calendarSelected
      ? "calendar"
      : "list"
  );

  if (calendarSelected) {
    renderCalendar();
  }
}

function renderJobs(jobs) {
  currentJobs = jobs;
  updateSummary(jobs);
  updateNextAssignment(jobs);
  renderList(jobs);

  jobsMessage.textContent =
    jobs.length
      ? `${jobs.length} assigned job${jobs.length === 1 ? "" : "s"} found.`
      : currentUser.currentRmsRecordId
        ? "No assigned jobs were found in this date range."
        : "Your account has not yet been mapped to a Current RMS record.";

  if (jobs.length) {
    const nextShift = jobs
      .flatMap((job) =>
        (job.assignments || []).map((assignment) => ({
          startsAt: assignment.startsAt,
          job
        }))
      )
      .filter((entry) => entry.startsAt)
      .sort((a, b) =>
        new Date(a.startsAt) - new Date(b.startsAt)
      )[0];

    const start =
      nextShift?.startsAt ||
      jobs[0].callAt ||
      jobs[0].showAt;

    if (start) {
      const date = new Date(start);
      calendarDate =
        new Date(
          date.getFullYear(),
          date.getMonth(),
          1
        );
    }
  }

  if (!calendarView.hidden) {
    renderCalendar();
  }
}

async function loadJobs() {
  jobsMessage.textContent =
    "Loading Current RMS assignments…";

  document.querySelector(
    "#welcomeSummary"
  ).textContent =
    "Checking your upcoming schedule…";

  refreshButton.disabled = true;
  refreshButton.textContent = "Refreshing…";

  try {
    const response = await fetch(
      "/api/me/jobs",
      {
        credentials: "same-origin"
      }
    );

    const payload =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      jobsMessage.textContent =
        payload.error ||
        "Could not load your jobs.";

      return;
    }

    renderJobs(
      Array.isArray(payload.jobs)
        ? payload.jobs
        : []
    );
  } catch (error) {
    console.error(error);
    jobsMessage.textContent =
      "Could not load your jobs.";
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent =
      "Refresh schedule";
  }
}

async function initialise() {
  const response =
    await fetch("/api/auth/me");

  const payload =
    await response.json();

  if (!payload.user) {
    window.location.href = "/login";
    return;
  }

  currentUser = payload.user;
  buildNav(currentUser);

  const firstName =
    String(
      currentUser.fullName || "there"
    )
      .trim()
      .split(" ")[0];

  document.querySelector(
    "#welcomeTitle"
  ).textContent =
    `${greetingForTime()}, ${firstName}.`;

  document.querySelector(
    "#welcomeText"
  ).textContent =
    currentUser.personType === "freelancer"
      ? "Your confirmed bookings, future availability and compliance documents will live here."
      : "Your upcoming jobs, shifts and employment information are all brought together here.";

  document.querySelector(
    "#personTypePill"
  ).textContent =
    currentUser.personType === "freelancer"
      ? "Freelancer"
      : "Staff";

  document.querySelector(
    "#dashboardEyebrow"
  ).textContent =
    currentUser.personType === "freelancer"
      ? "Freelancer portal"
      : "Employee portal";

  document.querySelector(
    "#roleValue"
  ).textContent =
    currentUser.role;

  document.querySelector(
    "#statusValue"
  ).textContent =
    currentUser.status;

  document.querySelector(
    "#rmsMapping"
  ).textContent =
    currentUser.currentRmsRecordId
      ? `${currentUser.currentRmsRecordType} #${currentUser.currentRmsRecordId}`
      : "Not mapped";

  document.querySelector(
    "#mappingSummary"
  ).textContent =
    currentUser.currentRmsRecordId
      ? "Connected to Current RMS"
      : "Current RMS mapping required";

  const storedView =
    localStorage.getItem(
      "wolfScheduleView"
    );

  setScheduleView(
    storedView === "calendar"
      ? "calendar"
      : "list"
  );

  await loadJobs();
}

listViewButton.addEventListener(
  "click",
  () => setScheduleView("list")
);

calendarViewButton.addEventListener(
  "click",
  () => setScheduleView("calendar")
);

document.querySelector(
  "#previousMonth"
).addEventListener(
  "click",
  () => {
    calendarDate =
      new Date(
        calendarDate.getFullYear(),
        calendarDate.getMonth() - 1,
        1
      );

    selectedCalendarDate = null;
    renderCalendar();
  }
);

document.querySelector(
  "#nextMonth"
).addEventListener(
  "click",
  () => {
    calendarDate =
      new Date(
        calendarDate.getFullYear(),
        calendarDate.getMonth() + 1,
        1
      );

    selectedCalendarDate = null;
    renderCalendar();
  }
);

refreshButton.addEventListener(
  "click",
  loadJobs
);

initialise();
