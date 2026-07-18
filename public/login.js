const form = document.querySelector("#loginForm");
const message = document.querySelector("#message");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "Signing in…";
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: document.querySelector("#email").value,
      password: document.querySelector("#password").value
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    message.textContent = payload.error || "Sign-in failed.";
    return;
  }
  window.location.href = payload.user.role === "admin" ? "/admin/users" : "/";
});
