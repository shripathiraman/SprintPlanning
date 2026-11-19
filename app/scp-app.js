/*
 * scp-app.js — Sprint Capacity Planner · start-up, page frame and tab switching
 *
 * Loaded last by scp-macro.html. Owns SCP.state, draws the page frame
 * (restricted marker, header, tabs) and hands the header and body to the
 * active tab's render function. Also holds the small UI helpers (SCP.ui)
 * shared by every tab.
 */
(function (SCP) {
  'use strict';

  var app = SCP.app = {};
  var ui = SCP.ui = SCP.ui || {};
  SCP.tabs = SCP.tabs || {};

  /* ------------------------------------------------------------------ */
  /* UI helpers                                                          */
  /* ------------------------------------------------------------------ */

  /** Escape text for HTML. */
  ui.esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /** "19 Nov 2026, 18:55" from an ISO timestamp, in the viewer's time zone. */
  ui.fmtWhen = function (iso) {
    if (!iso) { return ''; }
    var d = new Date(iso);
    if (isNaN(d.getTime())) { return ''; }
    var hh = String(d.getHours()).padStart(2, '0');
    var mm = String(d.getMinutes()).padStart(2, '0');
    return d.getDate() + ' ' + SCP.calc.MONTH_SHORT[d.getMonth()] + ' ' + d.getFullYear() + ', ' + hh + ':' + mm;
  };

  ui.isNum = function (v) {
    return typeof v === 'number' && isFinite(v);
  };

  /** Number from an input value, or null when empty / not a number. */
  ui.num = function (v) {
    if (v === '' || v === null || v === undefined) { return null; }
    var n = Number(v);
    return isFinite(n) ? n : null;
  };

  var LOCK_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="4.5" width="11" height="8" rx="1.5" fill="none" stroke="currentColor"/></svg>';

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */

  var TABS = [
    { id: 'config', label: 'Config' },
    { id: 'tickets', label: '1 · Sprint Tickets' },
    { id: 'resources', label: '2 · Resources & Leave' },
    { id: 'capacity', label: '3 · Capacity' },
    { id: 'calendar', label: '4 · Planning Calendar' }
  ];
  app.TABS = TABS;

  var state = SCP.state = {
    config: null,          // scp-config.json content (edited in place by the Config tab)
    configMeta: null,      // { id, version, by, when } of the attachment, null if never saved
    plan: null,            // scp-plan.json content, null if no plan yet
    planMeta: null,
    conn: { status: 'idle', user: '', error: null },
    jira: { projects: [], boards: [], sprints: [], issueTypes: [], fields: [], teams: [], loading: {} },
    tab: 'config',
    planDirty: false,      // plan changed since last Save plan
    saving: false,
    root: null
  };

  /** Config with every key present; defaults follow the PRD (FR-5 to FR-7). */
  app.normaliseConfig = function (c) {
    var calc = SCP.calc;
    c = c || {};
    return {
      schemaVersion: 1,
      jira: Object.assign({ projectKey: '', projectName: '', boardId: null, boardName: '', team: '', issueTypes: [] }, c.jira || {}),
      fields: Object.assign({ dev: null, ba: null, sp: null, team: null }, c.fields || {}),
      bands: (c.bands && c.bands.length ? c.bands : calc.DEFAULT_BANDS).map(function (b) { return Object.assign({}, b); }),
      split: Object.assign({ ba: 40, dev: 60 }, c.split || {}),
      workingWeek: (c.workingWeek || calc.DEFAULT_WEEK).slice(),
      ceremonyPct: ui.isNum(c.ceremonyPct) ? c.ceremonyPct : null,
      thresholds: Object.assign({}, calc.DEFAULT_THRESHOLDS, c.thresholds || {}),
      locations: (c.locations || []).map(function (l) {
        return { id: l.id, name: l.name, holidays: (l.holidays || []).map(function (h) { return Object.assign({}, h); }) };
      })
    };
  };

  /* ------------------------------------------------------------------ */
  /* Notices (one line under the tabs)                                   */
  /* ------------------------------------------------------------------ */

  /** Show a notice under the tabs. kind: 'ok' | 'warn' | 'error' | 'info'. */
  app.notice = function (kind, html) {
    var el = state.root && state.root.querySelector('.scp-notice');
    if (!el) { return; }
    el.className = 'scp-notice' + (html ? ' scp-notice--' + kind : '');
    el.innerHTML = html || '';
  };

  /* ------------------------------------------------------------------ */
  /* Frame and tabs                                                      */
  /* ------------------------------------------------------------------ */

  app.connected = function () {
    return state.conn.status === 'ok';
  };

  /**
   * Tabs 1-4 open once the connection test passes (FR-1). When Jira cannot be
   * reached but a plan was loaded before, they stay open on the last loaded
   * data with a banner and Reload disabled (US-11 AC-4, Edge Cases).
   */
  app.offline = function () {
    return state.conn.status === 'error' && !!(state.plan && state.plan.loadedAt);
  };

  app.tabsOpen = function () {
    return app.connected() || app.offline();
  };

  /** Message that blocks a tab, or null (US-05 AC-1). */
  app.gate = function (tabId) {
    if ((tabId === 'capacity' || tabId === 'calendar') && !ui.isNum(state.config.ceremonyPct)) {
      return 'Team ceremony % is not set. Capacity and the Planning Calendar need it: set it in Config → Team rules.';
    }
    return null;
  };

  app.setTab = function (id) {
    if (id !== 'config' && !app.tabsOpen()) { return; }
    state.tab = id;
    app.notice('', '');
    app.render();
  };

  /** Default header used when a tab draws nothing of its own. */
  app.defaultHead = function (head) {
    var team = state.config.jira.team || 'Squad';
    head.innerHTML =
      '<div class="scp-head__text"><div class="scp-eyebrow">Sprint Capacity Planner</div>' +
      '<h1 class="scp-title">' + ui.esc(team) + '</h1></div>';
  };

  app.render = function () {
    var root = state.root;
    if (!root) { return; }
    if (!state.config) {
      root.innerHTML = '<div class="scp-loading">Loading Sprint Capacity Planner…</div>';
      return;
    }
    // Remember which field had focus so a re-draw does not break keyboard use.
    var active = document.activeElement;
    var focusKey = active && root.contains(active) ? active.getAttribute('data-focus') : null;

    var connected = app.tabsOpen();
    var nav = TABS.map(function (t) {
      var disabled = t.id !== 'config' && !connected;
      return '<button type="button" class="scp-tab' + (state.tab === t.id ? ' is-active' : '') + '" data-tab="' + t.id + '"' +
        (disabled ? ' disabled title="Open after the Jira connection test passes"' : '') +
        ' data-focus="tab-' + t.id + '" role="tab" aria-selected="' + (state.tab === t.id) + '">' + ui.esc(t.label) + '</button>';
    }).join('');

    var noticeEl = root.querySelector('.scp-notice');
    var notice = noticeEl ? noticeEl.outerHTML : '<div class="scp-notice"></div>';

    root.innerHTML =
      '<div class="scp-topbar"><span class="scp-restricted">' + LOCK_ICON + ' Restricted · SM &amp; PO only</span></div>' +
      '<div class="scp-wrap">' +
      '<header class="scp-head"></header>' +
      '<nav class="scp-tabs" role="tablist">' + nav + '</nav>' +
      notice +
      '<main class="scp-body"></main>' +
      '</div>';

    root.querySelectorAll('.scp-tab').forEach(function (b) {
      b.addEventListener('click', function () { app.setTab(b.getAttribute('data-tab')); });
    });

    var head = root.querySelector('.scp-head');
    var body = root.querySelector('.scp-body');
    var tab = SCP.tabs[state.tab];
    var blocked = app.gate(state.tab);

    if (blocked) {
      app.defaultHead(head);
      body.innerHTML = '<div class="scp-card scp-blocked" data-test="blocked">' +
        '<p>' + ui.esc(blocked) + '</p>' +
        '<button type="button" class="scp-btn" data-goto="config">Open Config</button></div>';
      body.querySelector('[data-goto]').addEventListener('click', function () { app.setTab('config'); });
      return;
    }
    if (!tab) {
      app.defaultHead(head);
      body.innerHTML = '<div class="scp-card scp-blocked">This tab is not built yet.</div>';
      return;
    }
    tab.render(head, body);
    if (state.tab !== 'config' && app.offline()) {
      var e = state.conn.error;
      body.insertAdjacentHTML('afterbegin', '<div class="scp-banner scp-banner--warn" data-test="offline-banner" role="status">' +
        '<b>Jira is not available</b> (' + ui.esc(e && e.message) + '): showing the data last loaded from Jira on ' +
        ui.esc(ui.fmtWhen(state.plan.loadedAt)) + '. Reload from Jira is disabled until the connection test in Config passes.</div>');
    }
    if (focusKey) {
      var again = root.querySelector('[data-focus="' + focusKey + '"]');
      if (again) {
        again.focus();
        // Select the content as Tab does, so typing replaces it instead of appending.
        if (again.tagName === 'INPUT' && typeof again.select === 'function') { again.select(); }
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Plan header and Save plan (FR-25)                                   */
  /* ------------------------------------------------------------------ */

  /** Something in the plan changed and is not saved yet. */
  app.markDirty = function () {
    state.planDirty = true;
  };

  /**
   * Header shared by Tabs 1-4: title, optional sub line, the tab's own
   * controls (opts.lead), then Save plan and Publish in the same place on
   * every tab (US-20 AC-2).
   */
  app.planHead = function (head, opts) {
    opts = opts || {};
    var plan = state.plan;
    var team = state.config.jira.team;
    var title = plan ? plan.sprint.name + (team ? ' \u00b7 ' + team : '') : 'Sprint planning' + (team ? ' \u00b7 ' + team : '');
    head.innerHTML =
      '<div class="scp-head__text"><div class="scp-eyebrow">Sprint Capacity Planner</div>' +
      '<h1 class="scp-title" data-test="plan-title">' + ui.esc(title) + '</h1>' +
      (opts.sub ? '<div class="scp-sub">' + opts.sub + '</div>' : '') + '</div>' +
      '<div class="scp-head__actions">' + (opts.lead || '') +
      (state.planDirty ? '<span class="scp-unsaved" data-test="unsaved">Unsaved changes</span>' : '') +
      '<button type="button" class="scp-btn" data-act="save-plan"' + (plan && !state.saving ? '' : ' disabled') + '>' +
      (state.saving ? 'Saving\u2026' : 'Save plan') + '</button>' +
      '<button type="button" class="scp-btn scp-btn--primary" data-act="publish" disabled title="Publish to team is built with US-23">Publish to team</button>' +
      '</div>';
    var save = head.querySelector('[data-act="save-plan"]');
    save.addEventListener('click', function () { app.savePlan(false); });
  };

  /** Save plan: one save for Tabs 1-4, with the concurrent-edit check (FR-25). */
  app.savePlan = function (force) {
    if (!state.plan) { return Promise.resolve(false); }
    state.saving = true;
    app.render();
    var expected = state.planMeta ? state.planMeta.version : 0;
    return SCP.store.save('scp-plan.json', state.plan, expected, { force: force, comment: 'Plan saved' }).then(function (meta) {
      state.planMeta = meta;
      state.planDirty = false;
      state.saving = false;
      app.render();
      app.notice('ok', 'Plan saved.');
      return true;
    }, function (err) {
      state.saving = false;
      app.render();
      if (err.conflict) {
        var who = err.current ? ' by ' + (err.current.by || 'someone') + ' on ' + ui.fmtWhen(err.current.when) : '';
        if (window.confirm('The plan was changed' + who + ' since you opened it.\n\nSave anyway and overwrite that version?')) {
          return app.savePlan(true);
        }
        app.notice('warn', 'Not saved: the plan changed since you opened it. Reload the page to see the latest version (your changes will be lost).');
        return false;
      }
      app.notice('error', 'Could not save the plan: ' + ui.esc(err.message));
      return false;
    });
  };

  /* ------------------------------------------------------------------ */
  /* Start-up                                                            */
  /* ------------------------------------------------------------------ */

  app.start = function (root) {
    state.root = root;
    // Leaving the page with unsaved plan changes asks for confirmation (FR-25, US-20 AC-3).
    window.addEventListener('beforeunload', function (e) {
      if (state.planDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    root.classList.add('scp');
    app.render();
    return SCP.store.load('scp-config.json').then(function (cfg) {
      state.config = app.normaliseConfig(cfg.data);
      state.configMeta = cfg.meta;
      return SCP.store.load('scp-plan.json').catch(function () { return { data: null, meta: null }; });
    }).then(function (plan) {
      state.plan = plan.data;
      state.planMeta = plan.meta;
      app.render();
      // Test the Jira connection straight away so Tabs 1-4 open without a click (FR-1).
      return SCP.tabs.config.testConnection();
    }).catch(function (err) {
      state.config = state.config || app.normaliseConfig(null);
      app.render();
      app.notice('error', 'Could not read the page attachments: ' + ui.esc(err.message));
    });
  };
}(window.SCP = window.SCP || {}));
