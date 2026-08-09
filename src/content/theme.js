// 明暗主题：跟随系统 / 亮色 / 暗色。
// 方案 C：全站 filter 反转 + 定向修复图片/视频/表情，暗色规则见 layout-style.js。
  const THEME_VALUES = ["auto", "light", "dark"];

  const THEME_LABELS = {
    auto: "跟随系统",
    light: "亮色",
    dark: "暗色"
  };

  function normalizeTheme(value) {
    return THEME_VALUES.includes(value) ? value : "auto";
  }

  let currentTheme = "auto";

  function getSystemDarkPreference() {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches === true;
  }

  function resolveTheme(theme) {
    const normalized = normalizeTheme(theme);
    if (normalized === "auto") {
      return getSystemDarkPreference() ? "dark" : "light";
    }
    return normalized;
  }

  function applyTheme(theme) {
    const resolved = resolveTheme(theme);
    if (resolved === "dark") {
      document.documentElement.dataset.betterTheme = "dark";
    } else {
      delete document.documentElement.dataset.betterTheme;
    }
  }

  function readStoredTheme() {
    return requestLocalSettingsState().then((response) => {
      if (!response?.ok) {
        currentTheme = "auto";
        return currentTheme;
      }
      currentTheme = normalizeTheme(response.values?.[THEME_STORAGE_KEY]);
      return currentTheme;
    });
  }

  function saveTheme(theme) {
    currentTheme = normalizeTheme(theme);
    saveLocalSettings({
      [THEME_STORAGE_KEY]: currentTheme
    });
    return Promise.resolve(currentTheme);
  }

  function initTheme() {
    readStoredTheme().then((theme) => {
      applyTheme(theme);
    });
    window.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => {
      readStoredTheme().then((theme) => {
        if (normalizeTheme(theme) === "auto") {
          applyTheme("auto");
        }
      });
    });
  }

  function renderThemeSettingsContent() {
    return `
      <div class="better-settings__section better-settings__theme-section">
        <div class="better-settings__section-title">外观</div>
        <div class="better-settings__theme-options" role="radiogroup" aria-label="明暗模式">
          ${THEME_VALUES.map((value) => {
            const label = THEME_LABELS[value];
            const active = currentTheme === value;
            return `
              <button class="better-settings__theme-option${active ? " is-active" : ""}" type="button" role="radio" aria-checked="${active ? "true" : "false"}" data-theme-option="${value}">
                <span class="better-settings__theme-swatch better-settings__theme-swatch--${value}" aria-hidden="true"></span>
                ${label}
              </button>
            `;
          }).join("")}
        </div>
        <div class="better-settings__desc">暗色模式使用滤镜方案，图片、视频和表情会保持原始颜色。</div>
      </div>
    `;
  }

  function bindThemeSettings(panel) {
    panel.querySelectorAll(".better-settings__theme-option").forEach((button) => {
      button.addEventListener("click", () => {
        const theme = normalizeTheme(button.dataset.themeOption);
        saveTheme(theme).then(() => applyTheme(theme));
        panel.querySelectorAll(".better-settings__theme-option").forEach((item) => {
          const isActive = item === button;
          item.classList.toggle("is-active", isActive);
          item.setAttribute("aria-checked", String(isActive));
        });
      });
    });
  }
