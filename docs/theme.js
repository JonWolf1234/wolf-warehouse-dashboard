(() => {
  const root = document.documentElement;
  const toggle = document.querySelector("#themeToggle");
  const icon = document.querySelector("#themeIcon");
  const label = document.querySelector("#themeLabel");
  const metaThemeColour = document.querySelector("#themeColorMeta");

  if (!toggle || !icon || !label) {
    return;
  }

  function currentTheme() {
    return root.dataset.theme === "light" ? "light" : "dark";
  }

  function updateButton(theme) {
    const isDark = theme === "dark";

    icon.textContent = isDark ? "☀" : "☾";
    label.textContent = isDark ? "Light mode" : "Dark mode";
    toggle.setAttribute("aria-pressed", String(!isDark));
    toggle.setAttribute(
      "aria-label",
      isDark ? "Switch to light mode" : "Switch to dark mode"
    );

    if (metaThemeColour) {
      metaThemeColour.setAttribute("content", "#0b0d0f");
    }
  }

  function applyTheme(theme, save = true) {
    const safeTheme = theme === "light" ? "light" : "dark";

    root.dataset.theme = safeTheme;
    updateButton(safeTheme);

    if (save) {
      localStorage.setItem("warehouseTheme", safeTheme);
    }
  }

  updateButton(currentTheme());

  toggle.addEventListener("click", () => {
    applyTheme(currentTheme() === "dark" ? "light" : "dark");
  });
})();
