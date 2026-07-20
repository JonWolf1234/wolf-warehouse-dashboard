const form =
  document.querySelector(
    "#forgotPasswordForm"
  );

const message =
  document.querySelector(
    "#forgotMessage"
  );

form.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    message.textContent =
      "Requesting reset link…";

    try {
      const response =
        await fetch(
          "/api/auth/forgot-password",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify({
              email:
                document.querySelector(
                  "#forgotEmail"
                ).value
            })
          }
        );

      const payload =
        await response
          .json()
          .catch(() => ({}));

      message.textContent =
        payload.message ||
        "If an active account matches that email address, a reset link has been sent.";

      form.querySelector(
        "button"
      ).disabled =
        true;
    } catch {
      message.textContent =
        "If an active account matches that email address, a reset link has been sent.";
    }
  }
);
