const form =
  document.querySelector(
    "#loginForm"
  );

const message =
  document.querySelector(
    "#message"
  );

const params =
  new URLSearchParams(
    window.location.search
  );

if (params.get("reset") === "1") {
  message.textContent =
    "Your password has been reset. You can sign in now.";
}

if (
  params.get("passwordChanged") ===
  "1"
) {
  message.textContent =
    "Your password has been changed. Please sign in again.";
}

form.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    message.textContent =
      "Signing in…";

    const response =
      await fetch(
        "/api/auth/login",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            email:
              document.querySelector(
                "#email"
              ).value,
            password:
              document.querySelector(
                "#password"
              ).value
          })
        }
      );

    const payload =
      await response
        .json()
        .catch(() => ({}));

    if (!response.ok) {
      message.textContent =
        payload.error ||
        "Sign-in failed.";

      return;
    }

    window.location.href =
      "/dashboard";
  }
);
