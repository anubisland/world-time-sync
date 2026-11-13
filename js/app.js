(function () {
  'use strict';

  const STORAGE_KEY = 'anubisland_world_time_state_v2';

  function detectDeviceCityId() {
    try {
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return window.TimeEngine.findCityByTimezone(localTz).id;
    } catch {
      return 'cairo';
    }
  }

  const detectedRefId = detectDeviceCityId();

  const defaultState = {
    lang: 'ar',
    theme: 'light',
    font: "'Cairo', sans-serif",
    fontSize: '16px',
    use24h: false,
    mode: 'live', // 'live' | 'custom'
    activeView: 'converter', // 'converter' | 'planner'
    refCityId: detectedRefId,
    targetCityIds: ['cairo', 'riyadh', 'dubai', 'london', 'newyork', 'tokyo'].filter(
      (id) => id !== detectedRefId
    ),
    customUtcMs: Date.now()
  };

  let state = loadState();
  let deferredInstallPrompt = null;
  let liveTimer = null;

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...defaultState };
      const parsed = JSON.parse(raw);
      return {
        ...defaultState,
        ...parsed,
        targetCityIds: Array.isArray(parsed.targetCityIds)
          ? parsed.targetCityIds
          : defaultState.targetCityIds
      };
    } catch {
      return { ...defaultState };
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors
    }
  }

  function getCity(id) {
    return (
      window.WORLD_CITIES.find((c) => c.id === id) || window.WORLD_CITIES[0]
    );
  }

  function t() {
    return window.I18N_DATA[state.lang] || window.I18N_DATA.ar;
  }

  function getActiveUtcDate() {
    return state.mode === 'live' ? new Date() : new Date(state.customUtcMs);
  }

  // DOM Elements
  const el = {
    html: document.documentElement,
    btnInstallPWA: document.getElementById('btnInstallPWA'),
    fontSelect: document.getElementById('fontSelect'),
    fontSizeSelect: document.getElementById('fontSizeSelect'),
    btnLang: document.getElementById('btnLang'),
    btnTheme: document.getElementById('btnTheme'),
    navPills: document.querySelectorAll('.nav-pill'),
    views: {
      converter: document.getElementById('view-converter'),
      planner: document.getElementById('view-planner')
    },
    btnModeLive: document.getElementById('btnModeLive'),
    btnModeCustom: document.getElementById('btnModeCustom'),
    btnToggleFormat: document.getElementById('btnToggleFormat'),
    formatLabel: document.getElementById('formatLabel'),
    btnCopySummary: document.getElementById('btnCopySummary'),

    refSearchInput: document.getElementById('refSearchInput'),
    refSearchDropdown: document.getElementById('refSearchDropdown'),
    btnUseMyTz: document.getElementById('btnUseMyTz'),
    refCityTitle: document.getElementById('refCityTitle'),
    refClockBig: document.getElementById('refClockBig'),
    refDateLine: document.getElementById('refDateLine'),
    refBadges: document.getElementById('refBadges'),
    refDateInput: document.getElementById('refDateInput'),
    refTimeInput: document.getElementById('refTimeInput'),
    timeSlider: document.getElementById('timeSlider'),
    btnResetNow: document.getElementById('btnResetNow'),

    targetSearchInput: document.getElementById('targetSearchInput'),
    targetSearchDropdown: document.getElementById('targetSearchDropdown'),
    btnClearTargets: document.getElementById('btnClearTargets'),
    presetChips: document.querySelectorAll('.preset-chip'),
    targetsCountBadge: document.getElementById('targetsCountBadge'),
    targetCardsGrid: document.getElementById('targetCardsGrid'),
    emptyTargetsBox: document.getElementById('emptyTargetsBox'),

    goldenHoursBanner: document.getElementById('goldenHoursBanner'),
    plannerMatrixTable: document.getElementById('plannerMatrixTable'),
    toast: document.getElementById('toast')
  };

  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    clearTimeout(showToast._tid);
    showToast._tid = setTimeout(() => {
      el.toast.classList.add('hidden');
    }, 2600);
  }

  function applyThemeAndPrefs() {
    el.html.setAttribute('data-theme', state.theme);
    el.html.setAttribute('lang', state.lang);
    el.html.setAttribute('dir', state.lang === 'ar' ? 'rtl' : 'ltr');
    el.html.style.setProperty('--font-family', state.font);
    el.html.style.setProperty('--font-size-base', state.fontSize);

    el.fontSelect.value = state.font;
    el.fontSizeSelect.value = state.fontSize;
    el.btnTheme.textContent = state.theme === 'dark' ? '☀️' : '🌙';

    const dict = t();
    el.btnLang.textContent = dict.langBtn;

    document.querySelectorAll('[data-i18n]').forEach((node) => {
      const key = node.getAttribute('data-i18n');
      if (dict[key]) node.textContent = dict[key];
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
      const key = node.getAttribute('data-i18n-placeholder');
      if (dict[key]) node.setAttribute('placeholder', dict[key]);
    });

    el.formatLabel.textContent = state.use24h ? dict.format24 : dict.format12;
    el.btnModeLive.classList.toggle('active', state.mode === 'live');
    el.btnModeCustom.classList.toggle('active', state.mode === 'custom');

    el.navPills.forEach((pill) => {
      pill.classList.toggle(
        'active',
        pill.getAttribute('data-view') === state.activeView
      );
    });
    Object.entries(el.views).forEach(([key, section]) => {
      section.classList.toggle('hidden', key !== state.activeView);
    });
  }

  function cityLabel(city) {
    return state.lang === 'ar'
      ? `${city.nameAr}، ${city.countryAr}`
      : `${city.nameEn}, ${city.countryEn}`;
  }

  function phaseLabel(phase) {
    const dict = t();
    const map = {
      dawn: dict.phaseDawn,
      morning: dict.phaseMorning,
      afternoon: dict.phaseAfternoon,
      evening: dict.phaseEvening,
      night: dict.phaseNight
    };
    return map[phase] || dict.phaseMorning;
  }

  function statusLabel(status) {
    const dict = t();
    const map = {
      work: dict.statusWork,
      awake: dict.statusAwake,
      sleep: dict.statusSleep
    };
    return map[status] || dict.statusAwake;
  }

  function renderReferenceHero(utcDate) {
    const refCity = getCity(state.refCityId);
    const dict = t();
    const info = window.TimeEngine.formatCityInstant(
      utcDate,
      refCity.tz,
      refCity.tz,
      state.lang,
      state.use24h
    );

    el.refCityTitle.textContent = `${refCity.flag} ${cityLabel(refCity)}`;
    el.refClockBig.textContent =
      state.mode === 'live' ? info.timeWithSecStr : info.timeStr;
    el.refDateLine.textContent = info.dateStr;

    const badges = [
      `<span class="glass-pill">${info.utcOffsetLabel}</span>`,
      `<span class="glass-pill">${refCity.tz}</span>`,
      `<span class="glass-pill">${phaseLabel(info.phase)}</span>`,
      `<span class="glass-pill">${statusLabel(info.status)}</span>`
    ];
    if (info.dst) {
      badges.push(`<span class="glass-pill">☀️ ${dict.dstActive}</span>`);
    }
    el.refBadges.innerHTML = badges.join('');

    // Sync inputs without fighting user typing
    if (document.activeElement !== el.refDateInput) {
      el.refDateInput.value = info.isoDate;
    }
    if (document.activeElement !== el.refTimeInput) {
      el.refTimeInput.value = info.isoTime;
    }
    if (document.activeElement !== el.timeSlider) {
      const mins = info.wall.hour * 60 + info.wall.minute;
      el.timeSlider.value = Math.floor(mins / 15) * 15;
    }
  }

  function renderTargetCards(utcDate) {
    const refCity = getCity(state.refCityId);
    const dict = t();
    const targets = state.targetCityIds
      .map(getCity)
      .filter((c, idx, arr) => arr.findIndex((x) => x.id === c.id) === idx);

    el.targetsCountBadge.textContent = targets.length;

    if (targets.length === 0) {
      el.targetCardsGrid.innerHTML = '';
      el.emptyTargetsBox.classList.remove('hidden');
      return;
    }

    el.emptyTargetsBox.classList.add('hidden');

    el.targetCardsGrid.innerHTML = targets
      .map((city, index) => {
        const info = window.TimeEngine.formatCityInstant(
          utcDate,
          city.tz,
          refCity.tz,
          state.lang,
          state.use24h
        );
        const shortDiff = window.TimeEngine.formatShortDiffBadge(info.diffMins);
        const diffSentence = window.TimeEngine.formatDiffText(
          info.diffMins,
          dict
        );

        let dayShiftLabel = dict.daySame;
        let shiftClass = '';
        if (info.dayShift > 0) {
          dayShiftLabel = dict.dayNext;
          shiftClass = 'shifted';
        } else if (info.dayShift < 0) {
          dayShiftLabel = dict.dayPrev;
          shiftClass = 'shifted';
        }

        const cName = state.lang === 'ar' ? city.nameAr : city.nameEn;
        const cCountry = state.lang === 'ar' ? city.countryAr : city.countryEn;

        return `
        <article class="city-card theme-${city.theme}" data-city-id="${city.id}">
          <div class="city-card-top">
            <div class="city-card-title">
              <span class="city-flag">${city.flag}</span>
              <div>
                <div class="city-name">${cName}</div>
                <div class="city-country">${cCountry}</div>
              </div>
            </div>
            <span class="diff-pill" title="${diffSentence}">${shortDiff}</span>
          </div>

          <div class="city-card-time-row">
            <div class="city-time-big">${state.mode === 'live' ? info.timeWithSecStr : info.timeStr}</div>
            <span class="day-shift-badge ${shiftClass}">${dayShiftLabel}</span>
          </div>

          <div class="city-date-text">${info.dateStr}</div>

          <div class="city-meta-pills">
            <span class="meta-chip">${info.utcOffsetLabel}</span>
            <span class="meta-chip">${phaseLabel(info.phase)}</span>
            <span class="meta-chip">${statusLabel(info.status)}</span>
            <span class="meta-chip">${diffSentence}</span>
            ${info.dst ? `<span class="meta-chip">☀️ DST</span>` : ''}
          </div>

          <div class="city-card-actions">
            <button type="button" class="card-action-btn" data-action="set-ref" data-id="${city.id}">📍 ${dict.setAsRefBtn}</button>
            <button type="button" class="card-action-btn" data-action="copy" data-id="${city.id}">📋 ${dict.copyCityBtn}</button>
            ${index > 0 ? `<button type="button" class="card-action-btn" data-action="up" data-id="${city.id}">⬆️</button>` : ''}
            ${index < targets.length - 1 ? `<button type="button" class="card-action-btn" data-action="down" data-id="${city.id}">⬇️</button>` : ''}
            <button type="button" class="card-action-btn" data-action="remove" data-id="${city.id}">✕ ${dict.removeCityBtn}</button>
          </div>
        </article>`;
      })
      .join('');
  }

  function renderPlannerMatrix(utcDate) {
    if (state.activeView !== 'planner') return;
    const dict = t();
    const refCity = getCity(state.refCityId);
    const refWall = window.TimeEngine.extractWallParts(utcDate, refCity.tz);
    const allCities = [
      refCity,
      ...state.targetCityIds
        .filter((id) => id !== refCity.id)
        .map(getCity)
    ];

    const goldenCols = [];

    // Precompute 24 hourly instants starting from 00:00 of refCity's current date
    const hourInstants = [];
    for (let h = 0; h < 24; h++) {
      const hUtc = window.TimeEngine.wallTimeToUtcDate(
        refWall.year,
        refWall.month,
        refWall.day,
        h,
        0,
        0,
        refCity.tz
      );
      hourInstants.push(hUtc);

      const allWork = allCities.every((city) => {
        const w = window.TimeEngine.extractWallParts(hUtc, city.tz);
        return window.TimeEngine.formatCityInstant(
          hUtc,
          city.tz,
          refCity.tz,
          state.lang,
          state.use24h
        ).status === 'work';
      });
      if (allWork) goldenCols.push(h);
    }

    if (goldenCols.length > 0) {
      const formattedHours = goldenCols
        .map((h) => `${String(h).padStart(2, '0')}:00`)
        .join(' • ');
      el.goldenHoursBanner.innerHTML = `✨ <strong>${dict.goldenHoursFound}</strong> ${formattedHours} (${state.lang === 'ar' ? refCity.nameAr : refCity.nameEn})`;
    } else {
      el.goldenHoursBanner.textContent = dict.noGoldenHours;
    }

    let html = '<tbody>';
    allCities.forEach((city, rowIdx) => {
      const cName = state.lang === 'ar' ? city.nameAr : city.nameEn;
      html += `<tr><td class="matrix-city-cell">${city.flag} ${cName} ${rowIdx === 0 ? '📍' : ''}</td>`;
      for (let h = 0; h < 24; h++) {
        const hUtc = hourInstants[h];
        const w = window.TimeEngine.extractWallParts(hUtc, city.tz);
        const status =
          w.hour >= 9 && w.hour < 17
            ? 'work'
            : w.hour >= 7 && w.hour < 23
            ? 'awake'
            : 'sleep';
        const isGolden = goldenCols.includes(h);
        const isSelected = h === refWall.hour;
        const classes = [
          'matrix-hour-cell',
          `cell-${status}`,
          isGolden ? 'col-golden' : '',
          isSelected ? 'col-selected' : ''
        ]
          .filter(Boolean)
          .join(' ');
        const displayH = state.use24h
          ? String(w.hour).padStart(2, '0')
          : `${w.hour % 12 || 12}${w.hour < 12 ? (state.lang === 'ar' ? 'ص' : 'a') : state.lang === 'ar' ? 'م' : 'p'}`;
        html += `<td class="${classes}" data-hour="${h}" title="${dict.clickHourHint}">${displayH}</td>`;
      }
      html += '</tr>';
    });
    html += '</tbody>';
    el.plannerMatrixTable.innerHTML = html;
  }

  function renderAll() {
    const utcDate = getActiveUtcDate();
    renderReferenceHero(utcDate);
    renderTargetCards(utcDate);
    renderPlannerMatrix(utcDate);
  }

  function startOrStopLiveLoop() {
    clearInterval(liveTimer);
    if (state.mode === 'live') {
      liveTimer = setInterval(renderAll, 1000);
    }
  }

  function switchToCustomFromInputs(year, month, day, hour, minute) {
    const refCity = getCity(state.refCityId);
    const utc = window.TimeEngine.wallTimeToUtcDate(
      year,
      month,
      day,
      hour,
      minute,
      0,
      refCity.tz
    );
    state.mode = 'custom';
    state.customUtcMs = utc.getTime();
    saveState();
    applyThemeAndPrefs();
    startOrStopLiveLoop();
    renderAll();
  }

  function handleDateOrTimeChange() {
    const dateVal = el.refDateInput.value;
    const timeVal = el.refTimeInput.value;
    if (!dateVal || !timeVal) return;
    const [y, m, d] = dateVal.split('-').map(Number);
    const [hh, mm] = timeVal.split(':').map(Number);
    switchToCustomFromInputs(y, m, d, hh, mm);
  }

  function filterCities(query) {
    const q = query.trim().toLowerCase();
    const utcNow = getActiveUtcDate();
    if (!q) return window.WORLD_CITIES.slice(0, 14);
    return window.WORLD_CITIES.filter((c) => {
      const off = window.TimeEngine.formatUtcOffset(
        window.TimeEngine.getOffsetMinutes(utcNow, c.tz)
      ).toLowerCase();
      return (
        c.nameAr.includes(q) ||
        c.nameEn.toLowerCase().includes(q) ||
        c.countryAr.includes(q) ||
        c.countryEn.toLowerCase().includes(q) ||
        c.tz.toLowerCase().includes(q) ||
        off.includes(q)
      );
    }).slice(0, 18);
  }

  function renderSearchDropdown(dropdownEl, results, onSelect) {
    const utcNow = getActiveUtcDate();
    if (results.length === 0) {
      dropdownEl.classList.add('hidden');
      return;
    }
    dropdownEl.innerHTML = results
      .map((c) => {
        const off = window.TimeEngine.formatUtcOffset(
          window.TimeEngine.getOffsetMinutes(utcNow, c.tz)
        );
        const main = state.lang === 'ar' ? `${c.nameAr} (${c.countryAr})` : `${c.nameEn} (${c.countryEn})`;
        return `
          <div class="dropdown-item" data-id="${c.id}">
            <div class="dropdown-item-main"><span>${c.flag}</span><span>${main}</span></div>
            <div class="dropdown-item-sub">${off}</div>
          </div>
        `;
      })
      .join('');
    dropdownEl.classList.remove('hidden');

    dropdownEl.querySelectorAll('.dropdown-item').forEach((item) => {
      item.addEventListener('click', () => {
        onSelect(item.getAttribute('data-id'));
        dropdownEl.classList.add('hidden');
      });
    });
  }

  function setupEventListeners() {
    el.btnLang.addEventListener('click', () => {
      state.lang = state.lang === 'ar' ? 'en' : 'ar';
      saveState();
      applyThemeAndPrefs();
      renderAll();
    });

    el.btnTheme.addEventListener('click', () => {
      state.theme = state.theme === 'light' ? 'dark' : 'light';
      saveState();
      applyThemeAndPrefs();
    });

    el.fontSelect.addEventListener('change', (e) => {
      state.font = e.target.value;
      saveState();
      applyThemeAndPrefs();
    });

    el.fontSizeSelect.addEventListener('change', (e) => {
      state.fontSize = e.target.value;
      saveState();
      applyThemeAndPrefs();
    });

    el.navPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        state.activeView = pill.getAttribute('data-view');
        saveState();
        applyThemeAndPrefs();
        renderAll();
      });
    });

    el.btnModeLive.addEventListener('click', () => {
      state.mode = 'live';
      saveState();
      applyThemeAndPrefs();
      startOrStopLiveLoop();
      renderAll();
    });

    el.btnModeCustom.addEventListener('click', () => {
      if (state.mode !== 'custom') {
        state.customUtcMs = Date.now();
        state.mode = 'custom';
        saveState();
        applyThemeAndPrefs();
        startOrStopLiveLoop();
        renderAll();
      }
    });

    el.btnResetNow.addEventListener('click', () => {
      state.mode = 'live';
      saveState();
      applyThemeAndPrefs();
      startOrStopLiveLoop();
      renderAll();
    });

    el.btnToggleFormat.addEventListener('click', () => {
      state.use24h = !state.use24h;
      saveState();
      applyThemeAndPrefs();
      renderAll();
    });

    el.refDateInput.addEventListener('change', handleDateOrTimeChange);
    el.refTimeInput.addEventListener('change', handleDateOrTimeChange);

    el.timeSlider.addEventListener('input', (e) => {
      const totalMins = parseInt(e.target.value, 10);
      const hh = Math.floor(totalMins / 60);
      const mm = totalMins % 60;
      const refCity = getCity(state.refCityId);
      const wall = window.TimeEngine.extractWallParts(
        getActiveUtcDate(),
        refCity.tz
      );
      switchToCustomFromInputs(wall.year, wall.month, wall.day, hh, mm);
    });

    el.btnUseMyTz.addEventListener('click', () => {
      const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const matched = window.TimeEngine.findCityByTimezone(localTz);
      state.refCityId = matched.id;
      saveState();
      renderAll();
    });

    // Search Reference City
    el.refSearchInput.addEventListener('input', (e) => {
      renderSearchDropdown(
        el.refSearchDropdown,
        filterCities(e.target.value),
        (id) => {
          state.refCityId = id;
          el.refSearchInput.value = '';
          saveState();
          renderAll();
        }
      );
    });
    el.refSearchInput.addEventListener('focus', () => {
      renderSearchDropdown(
        el.refSearchDropdown,
        filterCities(el.refSearchInput.value),
        (id) => {
          state.refCityId = id;
          el.refSearchInput.value = '';
          saveState();
          renderAll();
        }
      );
    });

    // Search Target City
    el.targetSearchInput.addEventListener('input', (e) => {
      renderSearchDropdown(
        el.targetSearchDropdown,
        filterCities(e.target.value),
        (id) => {
          if (!state.targetCityIds.includes(id)) {
            state.targetCityIds.push(id);
            saveState();
            renderAll();
          }
          el.targetSearchInput.value = '';
        }
      );
    });
    el.targetSearchInput.addEventListener('focus', () => {
      renderSearchDropdown(
        el.targetSearchDropdown,
        filterCities(el.targetSearchInput.value),
        (id) => {
          if (!state.targetCityIds.includes(id)) {
            state.targetCityIds.push(id);
            saveState();
            renderAll();
          }
          el.targetSearchInput.value = '';
        }
      );
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.ref-city-switcher')) {
        el.refSearchDropdown.classList.add('hidden');
      }
      if (!e.target.closest('.add-city-row')) {
        el.targetSearchDropdown.classList.add('hidden');
      }
    });

    // Presets & Clear
    el.presetChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        const key = chip.getAttribute('data-preset');
        const list = window.CITY_PRESETS[key];
        if (list) {
          state.targetCityIds = list.filter((id) => id !== state.refCityId);
          saveState();
          renderAll();
        }
      });
    });

    el.btnClearTargets.addEventListener('click', () => {
      state.targetCityIds = [];
      saveState();
      renderAll();
    });

    // Card Actions Delegation
    el.targetCardsGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');

      if (action === 'remove') {
        state.targetCityIds = state.targetCityIds.filter((x) => x !== id);
        saveState();
        renderAll();
      } else if (action === 'set-ref') {
        const oldRef = state.refCityId;
        state.refCityId = id;
        state.targetCityIds = state.targetCityIds
          .filter((x) => x !== id)
          .concat(oldRef !== id ? [oldRef] : []);
        saveState();
        renderAll();
      } else if (action === 'up') {
        const idx = state.targetCityIds.indexOf(id);
        if (idx > 0) {
          [state.targetCityIds[idx - 1], state.targetCityIds[idx]] = [
            state.targetCityIds[idx],
            state.targetCityIds[idx - 1]
          ];
          saveState();
          renderAll();
        }
      } else if (action === 'down') {
        const idx = state.targetCityIds.indexOf(id);
        if (idx >= 0 && idx < state.targetCityIds.length - 1) {
          [state.targetCityIds[idx + 1], state.targetCityIds[idx]] = [
            state.targetCityIds[idx],
            state.targetCityIds[idx + 1]
          ];
          saveState();
          renderAll();
        }
      } else if (action === 'copy') {
        const city = getCity(id);
        const refCity = getCity(state.refCityId);
        const info = window.TimeEngine.formatCityInstant(
          getActiveUtcDate(),
          city.tz,
          refCity.tz,
          state.lang,
          state.use24h
        );
        const text = `${city.flag} ${cityLabel(city)}: ${info.timeStr} (${info.dateStr} | ${info.utcOffsetLabel})`;
        navigator.clipboard?.writeText(text);
        showToast(t().cityCopiedToast);
      }
    });

    // Matrix Click-to-Apply Hour
    el.plannerMatrixTable.addEventListener('click', (e) => {
      const cell = e.target.closest('.matrix-hour-cell');
      if (!cell) return;
      const hour = parseInt(cell.getAttribute('data-hour'), 10);
      const refCity = getCity(state.refCityId);
      const wall = window.TimeEngine.extractWallParts(
        getActiveUtcDate(),
        refCity.tz
      );
      switchToCustomFromInputs(wall.year, wall.month, wall.day, hour, 0);
      showToast(
        state.lang === 'ar'
          ? `تم ضبط التوقيت على ${String(hour).padStart(2, '0')}:00`
          : `Time set to ${String(hour).padStart(2, '0')}:00`
      );
    });

    // Copy Full Summary
    el.btnCopySummary.addEventListener('click', () => {
      const utcDate = getActiveUtcDate();
      const refCity = getCity(state.refCityId);
      const refInfo = window.TimeEngine.formatCityInstant(
        utcDate,
        refCity.tz,
        refCity.tz,
        state.lang,
        state.use24h
      );

      const lines = [
        `🕒 ${t().appTitle} — AnubisLand`,
        `📍 ${cityLabel(refCity)}: ${refInfo.timeStr} | ${refInfo.dateStr} (${refInfo.utcOffsetLabel})`,
        '────────────────────'
      ];

      state.targetCityIds.map(getCity).forEach((c) => {
        const info = window.TimeEngine.formatCityInstant(
          utcDate,
          c.tz,
          refCity.tz,
          state.lang,
          state.use24h
        );
        lines.push(
          `${c.flag} ${cityLabel(c)}: ${info.timeStr} | ${info.dateStr} (${window.TimeEngine.formatShortDiffBadge(info.diffMins)})`
        );
      });

      navigator.clipboard?.writeText(lines.join('\n'));
      showToast(t().copiedToast);
    });

    // PWA Install Prompt
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      el.btnInstallPWA.classList.remove('hidden');
    });

    el.btnInstallPWA.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      el.btnInstallPWA.classList.add('hidden');
    });
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  function init() {
    applyThemeAndPrefs();
    setupEventListeners();
    renderAll();
    startOrStopLiveLoop();
    registerServiceWorker();
  }

  init();
})();
