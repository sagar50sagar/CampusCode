(function () {
  const THEME_KEY = "theme";

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (_) {
      return null;
    }
  }

  function setStoredTheme(value) {
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch (_) {}
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    const wantsDark =
      theme === "dark" ||
      (theme !== "light" &&
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    root.classList.toggle("dark", wantsDark);
    updateThemeIcons(wantsDark);
  }

  function updateThemeIcons(isDark) {
    const selectors = [
      "#themeToggleBtn i",
      "#headerThemeBtn i",
      "#themeBtn i",
      "#themeIcon",
      "#t-icon i",
    ];
    selectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((icon) => {
        if (!icon.classList) return;
        icon.classList.remove("fa-moon", "fa-sun");
        icon.classList.add(isDark ? "fa-sun" : "fa-moon");
      });
    });
  }

  function toggleTheme() {
    const isDark = document.documentElement.classList.contains("dark");
    const next = isDark ? "light" : "dark";
    setStoredTheme(next);
    applyTheme(next);
  }

  window.applyTheme = function (theme) {
    if (!theme || theme === "system") {
      setStoredTheme("system");
      applyTheme("system");
      return;
    }
    setStoredTheme(theme);
    applyTheme(theme);
  };

  window.toggleTheme = toggleTheme;

  document.addEventListener("DOMContentLoaded", function () {
    applyTheme(getStoredTheme() || "system");

    const clickSelectors = [
      "#themeToggleBtn",
      "#headerThemeBtn",
      "#themeBtn",
      "#themeIcon",
      "#t-icon",
    ];
    document.addEventListener(
      "click",
      function (e) {
        const target = e.target;
        if (!target) return;
        const shouldToggle = clickSelectors.some((sel) => {
          const node = document.querySelector(sel);
          return node && (node === target || node.contains(target));
        });
        if (shouldToggle) {
          e.preventDefault();
          toggleTheme();
        }
      },
      true
    );
  });
})();
