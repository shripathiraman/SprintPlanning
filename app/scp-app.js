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

  /**
   * In-page confirmation, as the Release Impact admin tool's confirm modal,
   * instead of the browser's own window.confirm (which a user can switch off
   * for the page, after which every question silently answers No).
   * opts: { title, message (plain text; a blank line starts a new paragraph),
   * ok, cancel }. Resolves true for OK, false for Cancel, Esc or close.
   * Cancel has the focus, so Enter never confirms by accident.
   */
  ui.confirm = function (opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var host = document.createElement('div');
      host.id = 'scp-modal';
      host.className = 'scp';
      var paras = String(opts.message || '').split(/\n\s*\n/).map(function (t) {
        return '<p>' + ui.esc(t.trim()).replace(/\n/g, '<br>') + '</p>';
      }).join('');
      host.innerHTML = '<dialog class="scp-confirm" data-test="confirm" aria-labelledby="scp-confirm-title">' +
        '<h2 class="scp-confirm__title" id="scp-confirm-title">' + ui.esc(opts.title || 'Please confirm') + '</h2>' +
        '<div class="scp-confirm__msg" data-test="confirm-msg">' + paras + '</div>' +
        '<div class="scp-confirm__foot">' +
        '<button type="button" class="scp-btn" data-act="confirm-cancel">' + ui.esc(opts.cancel || 'Cancel') + '</button>' +
        '<button type="button" class="scp-btn scp-btn--primary" data-act="confirm-ok">' + ui.esc(opts.ok || 'OK') + '</button>' +
        '</div></dialog>';
      document.body.appendChild(host);
      var dlg = host.firstChild;
      var done = false;
      function finish(answer) {
        if (done) { return; }
        done = true;
        try { if (dlg.open && dlg.close) { dlg.close(); } } catch (e) { /* already closed */ }
        host.parentNode.removeChild(host);
        resolve(answer);
      }
      dlg.querySelector('[data-act="confirm-ok"]').addEventListener('click', function () { finish(true); });
      dlg.querySelector('[data-act="confirm-cancel"]').addEventListener('click', function () { finish(false); });
      dlg.addEventListener('cancel', function (e) { e.preventDefault(); finish(false); });   // Esc
      if (typeof dlg.showModal === 'function') { dlg.showModal(); } else { dlg.setAttribute('open', ''); }
      dlg.querySelector('[data-act="confirm-cancel"]').focus();
    });
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
    jira: { boards: [], sprints: [], issueTypes: [], fields: [], teams: [], loading: {} },
    tab: 'config',
    planDirty: false,      // plan changed since last Save plan
    saving: false,
    publishing: false,
    canWrite: null,        // may this user add attachments here? true / false / null = Confluence did not say
    access: null,          // view restrictions of this page: { restricted, users, groups } or { error } (FR-28)
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
      }),
      // Page ID of "Sprint plans - <Squad>", set by the first Publish (FR-29).
      publish: { parentId: (c.publish && c.publish.parentId) || null }
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

  /**
   * Once the plan's sprint is active (or closed) in Jira, the plan is the
   * commitment record and cannot be changed (FR-26, US-21).
   */
  app.readOnly = function () {
    var p = state.plan;
    return !!(p && p.sprint && (p.sprint.state === 'active' || p.sprint.state === 'closed'));
  };

  /**
   * The user may not add attachments on this page, so nothing can be saved
   * or published (checked as the Release Impact admin tool does). Unknown
   * (null) counts as allowed: the save itself then gives the answer.
   */
  app.noWrite = function () {
    return state.canWrite === false;
  };

  app.NO_WRITE = 'Read-only - you do not have Add Attachment permission on this page. Ask a page admin for access.';

  app.tabsOpen = function () {
    return app.connected() || app.offline();
  };

  /** Message that blocks a tab, or null (US-05 AC-1). */
  app.gate = function (tabId) {
    if (tabId !== 'capacity' && tabId !== 'calendar') { return null; }
    if (!ui.isNum(state.config.ceremonyPct)) {
      return { msg: 'Team ceremony % is not set. Capacity and the Planning Calendar need it: set it in Config \u2192 Team rules.',
        tab: 'config', label: 'Open Config' };
    }
    // A resource with no location blocks the capacity calculation (FR-15, US-12 AC-3).
    var missing = SCP.tabs.resources && SCP.tabs.resources.missingLocation ? SCP.tabs.resources.missingLocation() : [];
    if (missing.length) {
      return { msg: 'Capacity needs a location for every resource. Set it for ' + missing.map(function (r) { return r.name; }).join(', ') +
        ' in 2 \u00b7 Resources & Leave.', tab: 'resources', label: 'Open Resources & Leave' };
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
      '<div class="scp-topbar">' + accessMarker() +
      (app.noWrite() ? '<span class="scp-nowrite" data-test="no-write" role="status">' + ui.esc(app.NO_WRITE) + '</span>' : '') + '</div>' +
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
        '<p>' + ui.esc(blocked.msg) + '</p>' +
        '<button type="button" class="scp-btn" data-goto="' + blocked.tab + '">' + ui.esc(blocked.label) + '</button></div>';
      body.querySelector('[data-goto]').addEventListener('click', function () { app.setTab(blocked.tab); });
      return;
    }
    if (!tab) {
      app.defaultHead(head);
      body.innerHTML = '<div class="scp-card scp-blocked">This tab is not built yet.</div>';
      return;
    }
    tab.render(head, body);
    if (state.tab !== 'config' && app.readOnly()) { lock(head, body); }
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

  /**
   * Marker at the top of the page: whether this planning page is restricted
   * (FR-28, US-22). It reads the page's own view restrictions; the page itself
   * is restricted in Confluence (page ··· menu > Restrictions), not by the tool.
   */
  function accessMarker() {
    var a = state.access;
    if (!a) { return ''; }
    if (a.error) {
      return '<span class="scp-restricted scp-restricted--unknown" data-test="access" data-access="unknown" title="' + ui.esc(a.error) + '">' +
        'Could not check who can view this page</span>';
    }
    if (a.restricted) {
      var who = a.users.concat(a.groups.map(function (g) { return 'group ' + g; }));
      return '<span class="scp-restricted" data-test="access" data-access="restricted" title="' + ui.esc('Can view: ' + who.join(', ')) + '">' +
        LOCK_ICON + ' Restricted \u00b7 SM &amp; PO only</span>';
    }
    return '<span class="scp-restricted scp-restricted--open" data-test="access" data-access="open">' +
      'Not restricted: everyone who can view this page sees leave and availability. Restrict it to the SM and PO (page \u00b7\u00b7\u00b7 menu \u203a Restrictions).</span>';
  }

  /** Banner and disabled inputs of a locked plan (US-21 AC-1). Viewing stays possible. */
  function lock(head, body) {
    var p = state.plan;
    body.insertAdjacentHTML('afterbegin', '<div class="scp-banner scp-banner--lock" data-test="locked-banner" role="status">' +
      '<b>This plan is locked.</b> ' + ui.esc(p.sprint.name) + (p.sprint.state === 'closed' ? ' has closed' : ' has started') +
      ' in Jira, so this plan is the commitment record and can no longer be changed. Publish still works. ' +
      'To plan the next sprint, pick it in 1 \u00b7 Sprint Tickets.</div>');
    body.querySelectorAll('input, select, textarea, button').forEach(function (el) {
      if (!el.hasAttribute('data-ro-ok')) { el.disabled = true; }
    });
    head.querySelectorAll('[data-act="save-plan"], [data-act="reload"], [data-act="cal-reload"]').forEach(function (el) { el.disabled = true; });
  }

  function publishButton() {
    var why = SCP.publish ? SCP.publish.blocker() : 'Publish is not loaded';
    var p = state.plan;
    var last = p && p.published ? 'Last published ' + ui.fmtWhen(p.published.at) + ' as \u201c' + p.published.title + '\u201d. ' : '';
    return '<button type="button" class="scp-btn scp-btn--primary" data-act="publish"' + (why ? ' disabled' : '') +
      ' title="' + ui.esc(why || last + 'Create or update the read-only sprint page for the team') + '">' +
      (state.publishing ? 'Publishing\u2026' : 'Publish to team') + '</button>';
  }

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
      // The sub line is always there (empty if need be), so Save plan and Publish never move (US-20 AC-2).
      '<div class="scp-sub">' + (opts.sub || '&nbsp;') + '</div></div>' +
      '<div class="scp-head__actions">' + (opts.lead || '') +
      (state.planDirty ? '<span class="scp-unsaved" data-test="unsaved">Unsaved changes</span>' : '') +
      '<button type="button" class="scp-btn" data-act="save-plan"' + (plan && !state.saving && !app.readOnly() && !app.noWrite() ? '' : ' disabled') +
      (app.noWrite() ? ' title="' + ui.esc(app.NO_WRITE) + '"' : '') + '>' +
      (state.saving ? 'Saving\u2026' : 'Save plan') + '</button>' +
      publishButton() +
      '</div>';
    var save = head.querySelector('[data-act="save-plan"]');
    save.addEventListener('click', function () { app.savePlan(false); });
    head.querySelector('[data-act="publish"]').addEventListener('click', function () { SCP.publish.run(); });
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
        return ui.confirm({ title: 'The plan was changed', ok: 'Save anyway',
          message: 'The plan was changed' + who + ' since you opened it.\n\nSave anyway and overwrite that version?' }).then(function (yes) {
          if (yes) { return app.savePlan(true); }
          app.notice('warn', 'Not saved: the plan changed since you opened it. Reload the page to see the latest version (your changes will be lost).');
          return false;
        });
      }
      app.notice('error', 'Could not save the plan: ' + ui.esc(err.message));
      return false;
    });
  };

  /* ------------------------------------------------------------------ */
  /* Start-up                                                            */
  /* ------------------------------------------------------------------ */

  /** May this user add attachments here? Disables Save and Publish when not (as the Release Impact admin tool). */
  app.checkWrite = function () {
    return SCP.store.canWrite().then(function (yes) {
      state.canWrite = yes;
      if (yes === false) { app.render(); }
    });
  };

  /** Read who may view this page and show it at the top (US-22). */
  app.checkAccess = function () {
    return SCP.store.readRestrictions().then(function (a) {
      state.access = a;
    }, function (err) {
      state.access = { error: err.message };
    }).then(function () { app.render(); });
  };

  /**
   * When the page opens, ask Jira whether the plan's sprint has started: an
   * active or closed sprint locks the plan (FR-26, US-21). Nothing is saved;
   * the state is read again on every load.
   */
  app.checkSprintState = function () {
    var p = state.plan;
    if (!p || !p.sprint || !app.connected()) { return Promise.resolve(); }
    return SCP.jira.sprint(p.sprint.id).then(function (s) {
      if (s && s.state && s.state !== p.sprint.state && state.plan === p) {
        p.sprint.state = s.state;
        app.render();
      }
    }, function () { /* keep the saved state; the connection message says what is wrong */ });
  };

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
      app.checkAccess();
      app.checkWrite();
      // Test the Jira connection straight away so Tabs 1-4 open without a click (FR-1).
      return SCP.tabs.config.testConnection().then(function () { return app.checkSprintState(); });
    }).catch(function (err) {
      state.config = state.config || app.normaliseConfig(null);
      app.render();
      app.notice('error', 'Could not read the page attachments: ' + ui.esc(err.message));
    });
  };
}(window.SCP = window.SCP || {}));
