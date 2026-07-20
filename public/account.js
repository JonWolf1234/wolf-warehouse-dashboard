const form =
  document.querySelector(
    "#changePasswordForm"
  );

const message =
  document.querySelector(
    "#changePasswordMessage"
  );

async function jsonRequest(
  path,
  options = {}
) {
  const response =
    await fetch(path, {
      ...options,
      headers: {
        "Content-Type":
          "application/json",
        ...(options.headers || {})
      }
    });

  const payload =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload.error ||
      "Request failed."
    );
  }

  return payload;
}

async function initialise() {
  const response =
    await fetch(
      "/api/auth/me"
    );

  const payload =
    await response.json();

  if (!payload.user) {
    window.location.href =
      "/login";

    return;
  }

  const user =
    payload.user;

  document.querySelector(
    "#accountName"
  ).textContent =
    user.fullName || "—";

  document.querySelector(
    "#accountEmail"
  ).textContent =
    user.email || "—";

  document.querySelector(
    "#accountPersonType"
  ).textContent =
    user.personType || "—";

  document.querySelector(
    "#accountRole"
  ).textContent =
    user.role || "—";

  document.querySelector(
    "#accountRms"
  ).textContent =
    user.currentRmsRecordId
      ? `${user.currentRmsRecordType} #${user.currentRmsRecordId}`
      : "Not mapped";
}

form.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const currentPassword =
      document.querySelector(
        "#currentPassword"
      ).value;

    const newPassword =
      document.querySelector(
        "#newPassword"
      ).value;

    const confirmPassword =
      document.querySelector(
        "#confirmPassword"
      ).value;

    if (newPassword !== confirmPassword) {
      message.textContent =
        "The new passwords do not match.";

      return;
    }

    message.textContent =
      "Changing password…";

    try {
      await jsonRequest(
        "/api/auth/change-password",
        {
          method: "POST",
          body: JSON.stringify({
            currentPassword,
            newPassword,
            confirmPassword
          })
        }
      );

      message.textContent =
        "Password changed. Redirecting to sign in…";

      window.setTimeout(
        () => {
          window.location.href =
            "/login?passwordChanged=1";
        },
        800
      );
    } catch (error) {
      message.textContent =
        error.message;
    }
  }
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

initialise();
