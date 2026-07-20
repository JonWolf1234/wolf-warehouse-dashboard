const body = document.querySelector("#usersBody");
const form = document.querySelector("#userForm");
const message = document.querySelector("#formMessage");
const editModal = document.querySelector("#editUserModal");
const editForm = document.querySelector("#editUserForm");
const editMessage = document.querySelector("#editUserMessage");

let usersById = new Map();

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Please sign in.");
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }

  return payload;
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

function readableEmploymentType(value) {
  return value === "full_time" ? "Full time" : "Freelancer";
}

function readableRmsMapping(user) {
  if (
    !user.current_rms_record_id ||
    user.current_rms_record_type === "none"
  ) {
    return "Not mapped";
  }

  return `${
    user.current_rms_record_type === "contact"
      ? "Contact"
      : "Member"
  } #${user.current_rms_record_id}`;
}

function closeEditUser() {
  editModal.hidden = true;
  editMessage.textContent = "";
  editForm.reset();
}

function openEditUser(userId) {
  const user = usersById.get(String(userId));

  if (!user) {
    return;
  }

  document.querySelector("#editUserId").value = user.id;
  document.querySelector("#editFullName").value = user.full_name || "";
  document.querySelector("#editEmail").value = user.email || "";
  document.querySelector("#editEmploymentType").value =
    user.employment_type || "full_time";
  document.querySelector("#editPersonType").value =
    user.person_type ||
    (user.employment_type === "freelancer" ? "freelancer" : "staff");
  document.querySelector("#editRole").value = user.role || "staff";
  document.querySelector("#editStatus").value = user.status || "active";
  document.querySelector("#editCurrentRmsRecordType").value =
    user.current_rms_record_type || "none";
  document.querySelector("#editCurrentRmsRecordId").value =
    user.current_rms_record_id || "";
  document.querySelector("#editCanOpenCurrentRms").checked =
    Boolean(user.can_open_current_rms);
  document.querySelector("#editBreatheEmployeeId").value =
    user.breathe_employee_id || "";
  document.querySelector("#editCanApproveFreelancers").checked =
    Boolean(user.can_approve_freelancers);
  document.querySelector("#editSuitableServiceIds").value =
    Array.isArray(user.suitable_service_ids)
      ? user.suitable_service_ids.join(", ")
      : "";

  editMessage.textContent = "";
  editModal.hidden = false;

  requestAnimationFrame(() => {
    document.querySelector("#editFullName").focus();
  });
}

async function loadUsers() {
  const { users } = await api("/api/admin/users");

  usersById = new Map(
    users.map((user) => [String(user.id), user])
  );

  body.innerHTML = users.map((user) => `
    <tr>
      <td>
        <strong>${escapeHtml(user.full_name)}</strong>
        <small>${escapeHtml(user.email)}</small>
      </td>
      <td>${readableEmploymentType(user.employment_type)}</td>
      <td>${escapeHtml(user.role)}</td>
      <td>
        <strong class="table-primary">
          ${escapeHtml(readableRmsMapping(user))}
        </strong>
        <small>
          ${
            user.can_open_current_rms
              ? "Current RMS login enabled"
              : "No Current RMS login"
          }
        </small>
      </td>
      <td>
        <span class="account-status account-status-${escapeHtml(user.status)}">
          ${escapeHtml(user.status)}
        </span>
      </td>
      <td>
        ${
          user.last_login_at
            ? new Date(user.last_login_at).toLocaleString("en-GB")
            : "Never"
        }
      </td>
      <td>
        <button
          type="button"
          class="secondary-button compact-button edit-user-button"
          data-user-id="${escapeHtml(user.id)}"
        >
          Edit
        </button>
      </td>
    </tr>
  `).join("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = Object.fromEntries(new FormData(form));
  data.canOpenCurrentRms =
    document.querySelector("#canOpenCurrentRms").checked;
  data.canApproveFreelancers =
    document.querySelector("#canApproveFreelancers").checked;
  data.suitableServiceIds =
    document.querySelector("#suitableServiceIds").value;

  message.textContent = "Creating account…";

  try {
    await api("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(data)
    });

    form.reset();
    document.querySelector("#canOpenCurrentRms").checked = false;
    document.querySelector("#canApproveFreelancers").checked = false;
    message.textContent = "Account created.";
    await loadUsers();
  } catch (error) {
    message.textContent = error.message;
  }
});

body.addEventListener("click", (event) => {
  const editButton = event.target.closest(
    ".edit-user-button[data-user-id]"
  );

  if (!editButton) {
    return;
  }

  openEditUser(editButton.dataset.userId);
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const userId = document.querySelector("#editUserId").value;
  const recordType =
    document.querySelector("#editCurrentRmsRecordType").value;
  const recordId =
    document.querySelector("#editCurrentRmsRecordId").value.trim();

  if (recordType !== "none" && !/^\d+$/.test(recordId)) {
    editMessage.textContent =
      "Enter a numeric Current RMS record ID.";
    return;
  }

  editMessage.textContent = "Saving changes…";

  const submitButton = editForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    await api(`/api/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({
        fullName:
          document.querySelector("#editFullName").value.trim(),
        email:
          document.querySelector("#editEmail").value.trim(),
        employmentType:
          document.querySelector("#editEmploymentType").value,
        personType:
          document.querySelector("#editPersonType").value,
        role:
          document.querySelector("#editRole").value,
        status:
          document.querySelector("#editStatus").value,
        currentRmsRecordType:
          recordType,
        currentRmsRecordId:
          recordType === "none" ? "" : recordId,
        canOpenCurrentRms:
          document.querySelector("#editCanOpenCurrentRms").checked,
        breatheEmployeeId:
          document.querySelector("#editBreatheEmployeeId").value.trim(),
        canApproveFreelancers:
          document.querySelector("#editCanApproveFreelancers").checked,
        suitableServiceIds:
          document.querySelector("#editSuitableServiceIds").value.trim()
      })
    });

    closeEditUser();
    await loadUsers();
  } catch (error) {
    editMessage.textContent = error.message;
  } finally {
    submitButton.disabled = false;
  }
});

document.querySelector("#closeEditUser")
  .addEventListener("click", closeEditUser);

document.querySelector("#cancelEditUser")
  .addEventListener("click", closeEditUser);

editModal.addEventListener("click", (event) => {
  if (event.target === editModal) {
    closeEditUser();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !editModal.hidden) {
    closeEditUser();
  }
});

document.querySelector("#logoutButton")
  .addEventListener("click", async () => {
    await api("/api/auth/logout", {
      method: "POST"
    });

    window.location.href = "/login";
  });

loadUsers().catch((error) => {
  body.innerHTML = `
    <tr>
      <td colspan="7">${escapeHtml(error.message)}</td>
    </tr>
  `;
});
