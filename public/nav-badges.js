console.log("[Wolf Staff Hub] nav-badges-v2 loaded");

function setNavigationBadge(
  name,
  value
) {
  const count =
    Math.max(
      0,
      Number(value || 0)
    );

  document
    .querySelectorAll(
      `[data-nav-badge="${name}"]`
    )
    .forEach(
      (badge) => {
        badge.hidden =
          count === 0;

        badge.textContent =
          count > 99
            ? "99+"
            : String(count);
      }
    );
}

async function refreshNavigationBadges() {
  try {
    const response =
      await fetch(
        "/api/navigation-badges",
        {
          headers: {
            Accept:
              "application/json"
          }
        }
      );

    if (!response.ok) {
      return;
    }

    const payload =
      await response.json();

    setNavigationBadge(
      "available-work",
      payload.availableWork
    );

    setNavigationBadge(
      "applications",
      payload.applications
    );
  } catch {
    // Badge counts should never block the page.
  }
}

refreshNavigationBadges();

setInterval(
  refreshNavigationBadges,
  60_000
);

window.addEventListener(
  "wolf:refresh-navigation-badges",
  refreshNavigationBadges
);
