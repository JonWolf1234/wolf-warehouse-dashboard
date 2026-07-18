const body = document.querySelector("#usersBody");
const form = document.querySelector("#userForm");
const message = document.querySelector("#formMessage");

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  if (response.status === 401) { window.location.href = "/login"; throw new Error("Please sign in."); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
}

async function loadUsers() {
  const { users } = await api("/api/admin/users");
  body.innerHTML = users.map(user => `<tr><td><strong>${escapeHtml(user.full_name)}</strong><small>${escapeHtml(user.email)}</small></td><td>${user.employment_type === "full_time" ? "Full time" : "Freelancer"}</td><td>${escapeHtml(user.role)}</td><td>${escapeHtml(user.status)}</td><td>${user.last_login_at ? new Date(user.last_login_at).toLocaleString("en-GB") : "Never"}</td><td><select data-user-id="${user.id}"><option value="active" ${user.status === "active" ? "selected" : ""}>Active</option><option value="suspended" ${user.status === "suspended" ? "selected" : ""}>Suspended</option><option value="archived" ${user.status === "archived" ? "selected" : ""}>Archived</option></select></td></tr>`).join("");
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  message.textContent = "Creating account…";
  try {
    await api("/api/admin/users", { method: "POST", body: JSON.stringify(data) });
    form.reset(); message.textContent = "Account created."; await loadUsers();
  } catch (error) { message.textContent = error.message; }
});

body.addEventListener("change", async event => {
  const select = event.target.closest("select[data-user-id]");
  if (!select) return;
  await api(`/api/admin/users/${select.dataset.userId}/status`, { method: "PATCH", body: JSON.stringify({ status: select.value }) });
});

document.querySelector("#logoutButton").addEventListener("click", async () => { await api("/api/auth/logout", { method: "POST" }); window.location.href = "/login"; });
loadUsers().catch(error => { body.innerHTML = `<tr><td colspan="6">${escapeHtml(error.message)}</td></tr>`; });
