const form =
  document.querySelector(
    "#resetPasswordForm"
  );

const intro =
  document.querySelector(
    "#resetIntro"
  );

const message =
  document.querySelector(
    "#resetMessage"
  );

const token =
  new URLSearchParams(
    window.location.search
  ).get("token") || "";

async function initialise() {
  if (!token) {
    intro.textContent =
      "This reset link is invalid or has expired.";

    return;
  }

  const response =
    await fetch(
      `/api/auth/reset-password/validate?token=${encodeURIComponent(token)}`
    );

  const payload =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    intro.textContent =
      payload.error ||
      "This reset link is invalid or has expired.";

    return;
  }

  intro.textContent =
    "Enter a new password of at least 12 characters.";

  form.hidden =
    false;
}

form.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const newPassword =
      document.querySelector(
        "#resetNewPassword"
      ).value;

    const confirmPassword =
      document.querySelector(
        "#resetConfirmPassword"
      ).value;

    if (newPassword !== confirmPassword) {
      message.textContent =
        "The new passwords do not match.";

      return;
    }

    message.textContent =
      "Saving your new password…";

    const response =
      await fetch(
        "/api/auth/reset-password",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json"
          },
          body: JSON.stringify({
            token,
            newPassword,
            confirmPassword
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
        "The password could not be reset.";

      return;
    }

    message.textContent =
      "Password reset. Redirecting to sign in…";

    form.querySelector(
      "button"
    ).disabled =
      true;

    window.setTimeout(
      () => {
        window.location.href =
          "/login?reset=1";
      },
      900
    );
  }
);

initialise();
