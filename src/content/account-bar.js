// 设置面板顶部账号信息栏：头像、昵称、等级+经验进度、勋章，点击跳个人主页。
// 数据源：api.xiaoheihe.cn/bbs/app/profile/user/profile（不传 userid 时返回当前登录用户）。
  const ACCOUNT_PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
  const ACCOUNT_PROFILE_REFRESH_MS = 30 * 1000;

  function getCachedAccountProfile() {
    return requestLocalSettingsState().then((response) => {
      const cached = response?.ok ? response.values?.[ACCOUNT_PROFILE_STORAGE_KEY] : null;
      if (!cached || !cached.cachedAt) {
        return null;
      }
      return cached;
    });
  }

  function parseAccountProfile(data) {
    const result = data?.result || {};
    const accountDetail = result.account_detail || {};
    const info = result.info || {};
    const levelInfo = accountDetail.level_info || info.level_info || {};
    const medals = Array.isArray(accountDetail.medals)
      ? accountDetail.medals
      : (Array.isArray(info.medals) ? info.medals : []);
    return {
      username: String(accountDetail.username || info.username || "").trim(),
      avatar: String(accountDetail.avatar || info.avatar || "").trim(),
      heyboxId: String(accountDetail.heybox_id || accountDetail.userid || info.heybox_id || "").trim(),
      level: Number(levelInfo.level || 0),
      exp: Number(levelInfo.exp || info.exp || 0),
      maxExp: Number(levelInfo.max_exp || info.max_exp || 0),
      medals: medals.slice(0, 12).map((medal) => ({
        name: String(medal?.name || medal?.medal_name || ""),
        icon: String(medal?.icon || medal?.image || medal?.img || ""),
        url: String(medal?.url || "")
      }))
    };
  }

  async function fetchAccountProfile({ force = false } = {}) {
    if (!force) {
      const cached = await getCachedAccountProfile();
      if (cached && Date.now() - Number(cached.cachedAt || 0) < ACCOUNT_PROFILE_CACHE_TTL_MS) {
        return cached;
      }
    }

    try {
      const response = await fetch(buildProfileApiUrl(), {
        credentials: "include",
        headers: {
          accept: "application/json"
        }
      });
      const data = await response.json();
      if (data?.status !== "ok") {
        throw new Error(data?.message || data?.msg || "账号信息查询失败");
      }
      const profile = parseAccountProfile(data);
      const saved = {
        ...profile,
        cachedAt: Date.now()
      };
      saveLocalSettings({
        [ACCOUNT_PROFILE_STORAGE_KEY]: saved
      });
      return saved;
    } catch (error) {
      const cached = await getCachedAccountProfile();
      if (cached) {
        return cached;
      }
      return {
        username: "",
        avatar: "",
        heyboxId: "",
        level: 0,
        exp: 0,
        maxExp: 0,
        medals: [],
        cachedAt: 0
      };
    }
  }

  function buildAccountProfileUrl(heyboxId) {
    return `https://www.xiaoheihe.cn/app/user/profile/${encodeURIComponent(heyboxId)}`;
  }

  function renderAccountProgress(profile) {
    if (!profile.level) {
      return "";
    }
    const percent = profile.maxExp > 0
      ? Math.max(0, Math.min(100, Math.round((profile.exp / profile.maxExp) * 100)))
      : 0;
    const expText = profile.maxExp > 0 ? `${profile.exp}/${profile.maxExp}` : String(profile.exp);
    return `
      <span class="better-settings__account-level">Lv.${profile.level}</span>
      <span class="better-settings__account-exp" title="经验 ${expText}">
        <span class="better-settings__account-exp-bar">
          <span class="better-settings__account-exp-fill" style="width: ${percent}%"></span>
        </span>
        <span class="better-settings__account-exp-text">${expText}</span>
      </span>
    `;
  }

  function renderAccountMedals(profile) {
    if (!profile.medals.length) {
      return "";
    }
    return `
      <span class="better-settings__account-medals">
        ${profile.medals.map((medal) => `
          <img class="better-settings__account-medal" src="${escapeHtml(medal.icon || medal.url)}" alt="${escapeHtml(medal.name)}" title="${escapeHtml(medal.name)}" loading="lazy">
        `).join("")}
      </span>
    `;
  }

  function renderAccountBar() {
    return `
      <div class="better-settings__account-bar" data-account-bar>
        <a class="better-settings__account-link" href="#" target="_blank" rel="noopener noreferrer" aria-label="查看我的小黑盒主页">
          <span class="better-settings__account-avatar" data-account-avatar></span>
          <span class="better-settings__account-info">
            <span class="better-settings__account-name" data-account-name>加载中…</span>
            <span class="better-settings__account-meta" data-account-meta></span>
            <span class="better-settings__account-medals-row" data-account-medals></span>
          </span>
        </a>
      </div>
    `;
  }

  function fillAccountBar(panel, profile) {
    const bar = panel.querySelector("[data-account-bar]");
    if (!bar) {
      return;
    }
    const link = bar.querySelector(".better-settings__account-link");
    const avatar = bar.querySelector("[data-account-avatar]");
    const name = bar.querySelector("[data-account-name]");
    const meta = bar.querySelector("[data-account-meta]");
    const medalsRow = bar.querySelector("[data-account-medals]");

    if (!profile.username && !profile.heyboxId) {
      link.href = "#";
      avatar.textContent = "";
      avatar.classList.add("is-empty");
      name.textContent = "未登录小黑盒";
      meta.textContent = "";
      medalsRow.innerHTML = "";
      return;
    }

    if (profile.heyboxId) {
      link.href = buildAccountProfileUrl(profile.heyboxId);
    }
    if (profile.avatar) {
      avatar.innerHTML = "";
      const img = document.createElement("img");
      img.src = profile.avatar;
      img.alt = "";
      img.loading = "lazy";
      avatar.appendChild(img);
    } else {
      avatar.textContent = (profile.username || "?")[0]?.toUpperCase() || "";
    }
    avatar.classList.toggle("is-empty", !profile.avatar);
    name.textContent = profile.username || "小黑盒用户";
    meta.innerHTML = renderAccountProgress(profile);
    medalsRow.innerHTML = renderAccountMedals(profile);
  }

  async function mountAccountBar(panel) {
    const bar = panel.querySelector("[data-account-bar]");
    if (!bar) {
      return;
    }

    const render = (profile) => fillAccountBar(panel, profile);

    const cached = await getCachedAccountProfile();
    if (cached && Date.now() - Number(cached.cachedAt || 0) < ACCOUNT_PROFILE_CACHE_TTL_MS) {
      render(cached);
      return;
    }

    render(await fetchAccountProfile());
    const refreshTimer = window.setTimeout(async () => {
      render(await fetchAccountProfile({ force: true }));
    }, ACCOUNT_PROFILE_REFRESH_MS);
    bar.dataset.refreshTimer = String(refreshTimer);
  }

  function clearAccountBarTimers(panel) {
    const bar = panel.querySelector("[data-account-bar]");
    const timer = Number(bar?.dataset.refreshTimer || 0);
    if (timer) {
      window.clearTimeout(timer);
      delete bar.dataset.refreshTimer;
    }
  }
