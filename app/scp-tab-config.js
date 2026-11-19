/*
 * scp-tab-config.js — Sprint Capacity Planner · Config tab (US-01 to US-06)
 *
 * Jira connection test (FR-1), project / board / team / issue types fetched
 * from Jira (FR-2, FR-3), field mapping with type check (FR-4), SP -> MD bands
 * and BA/Dev split (FR-5, FR-6), working week, ceremony % and load thresholds
 * (FR-7), locations with yearly office holidays (FR-27), Save config (FR-8).
 *
 * Edits change SCP.state.config in place; Save config writes scp-config.json.
 */
(function (SCP) {
  'use strict';

  SCP.tabs = SCP.tabs || {};
  var tab = SCP.tabs.config = {};
  var ui = SCP.ui = SCP.ui || {};   // helpers are filled in by scp-app.js, used at run time
  var calc = SCP.calc;

  /* Local, unsaved UI state of this tab. */
  var view = {
    editBands: false,        // bands table in edit mode
    openLocation: null,      // id of the location whose editor is open
    fieldReject: {},         // role -> rejection message (US-03 AC-2)
    holidayError: {},        // location id -> message (US-06 AC-2)
    saveErrors: null,        // list of messages after a blocked save
    saving: false
  };

  function S() { return SCP.state; }
  function cfg() { return SCP.state.config; }
  function J() { return SCP.state.jira; }

  /** Re-draw after the browser has moved focus (keeps keyboard flow on change events). */
  function redraw() {
    setTimeout(function () { SCP.app.render(); }, 0);
  }

  /* ------------------------------------------------------------------ */
  /* Field types (FR-4)                                                  */
  /* ------------------------------------------------------------------ */

  var ROLES = [
    { key: 'dev', label: 'Contributor (Dev)', match: 'Contributor', expect: 'User picker (single or multi)' },
    { key: 'ba', label: 'Backup Assignee (BA)', match: 'Backup Assignee', expect: 'User picker (single or multi)' },
    { key: 'sp', label: 'Story Points', match: 'Story Points', expect: 'Number' },
    { key: 'team', label: 'Team', match: 'Team', expect: 'Select list' }
  ];

  /** Kind and label of a Jira field from its schema. */
  function fieldType(f) {
    var s = f.schema || {};
    var custom = s.custom || '';
    if (s.type === 'user') { return { kind: 'user', label: 'User picker' }; }
    if (s.type === 'array' && s.items === 'user') { return { kind: 'user', label: 'Multi-user picker' }; }
    if (s.type === 'number') { return { kind: 'number', label: 'Number' }; }
    if (s.type === 'option') { return { kind: 'select', label: 'Select list' }; }
    if (s.type === 'array' && s.items === 'option') { return { kind: 'select', label: 'Multi-select list' }; }
    if (/teams-custom-field-team/.test(custom)) { return { kind: 'select', label: 'Team' }; }
    if (s.type === 'string') { return { kind: 'text', label: 'Text' }; }
    if (!s.type) { return { kind: 'none', label: 'No type' }; }
    return { kind: s.type, label: s.type.charAt(0).toUpperCase() + s.type.slice(1) };
  }

  var EXPECT_KIND = { dev: 'user', ba: 'user', sp: 'number', team: 'select' };

  function typeOk(roleKey, f) {
    return fieldType(f).kind === EXPECT_KIND[roleKey];
  }

  function toMapping(f) {
    var t = fieldType(f);
    return { id: f.id, name: f.name, type: t.label, custom: !!f.custom };
  }

  /** Map each role to the field of the same name when nothing is mapped yet. */
  function autoMapFields() {
    ROLES.forEach(function (r) {
      if (cfg().fields[r.key]) { return; }
      var f = J().fields.filter(function (x) { return x.name === r.match && typeOk(r.key, x); })[0];
      if (f) { cfg().fields[r.key] = toMapping(f); }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Jira loading (US-01, US-02)                                         */
  /* ------------------------------------------------------------------ */

  /** Test connection (US-01). Also called once at page load by scp-app.js. */
  tab.testConnection = function () {
    var st = S();
    st.conn = { status: 'testing', user: '', error: null };
    SCP.app.render();
    return SCP.jira.testConnection(cfg().jira.projectKey).then(function (r) {
      st.conn = { status: 'ok', user: r.user, error: null };
      SCP.app.render();
      return tab.loadJira();
    }, function (err) {
      st.conn = { status: 'error', user: err.user || '', error: err };
      SCP.app.render();
    });
  };

  /** Projects and fields, then the selected project's details. */
  tab.loadJira = function () {
    J().loading.base = true;
    return Promise.all([SCP.jira.projects(), SCP.jira.fields()]).then(function (r) {
      J().projects = (r[0] || []).slice().sort(function (a, b) { return a.key.localeCompare(b.key); });
      J().fields = (r[1] || []).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
      J().loading.base = false;
      autoMapFields();
      SCP.app.render();
      if (cfg().jira.projectKey) { return tab.loadProject(cfg().jira.projectKey, true); }
    }).catch(function (err) {
      J().loading.base = false;
      SCP.app.render();
      SCP.app.notice('error', 'Could not load projects and fields from Jira: ' + ui.esc(err.message));
    });
  };

  /**
   * Boards, issue types, Team values and sprints of a project (US-02 AC-1).
   * keep = true keeps the saved board, issue types and team.
   */
  tab.loadProject = function (key, keep) {
    var jc = cfg().jira;
    var p = J().projects.filter(function (x) { return x.key === key; })[0];
    jc.projectKey = key;
    jc.projectName = p ? p.name : jc.projectName;
    if (!keep) {
      jc.boardId = null;
      jc.boardName = '';
      jc.issueTypes = [];
      jc.team = '';
      J().sprints = [];
    }
    J().loading.project = true;
    SCP.app.render();
    return Promise.all([SCP.jira.boards(key), SCP.jira.project(key), tab.loadTeams()]).then(function (r) {
      J().boards = r[0] || [];
      J().issueTypes = ((r[1] && r[1].issueTypes) || []).map(function (t) {
        return { name: t.name, subtask: !!t.subtask };
      });
      var valid = J().boards.some(function (b) { return b.id === jc.boardId; });
      if (!valid) {
        var board = J().boards.filter(function (b) { return b.type === 'scrum'; })[0] || J().boards[0];
        jc.boardId = board ? board.id : null;
        jc.boardName = board ? board.name : '';
      }
      J().loading.project = false;
      SCP.app.render();
      return jc.boardId ? tab.loadBoard(jc.boardId) : null;
    }).catch(function (err) {
      J().loading.project = false;
      SCP.app.render();
      SCP.app.notice('error', 'Could not load project ' + ui.esc(key) + ' from Jira: ' + ui.esc(err.message));
    });
  };

  /** Sprints of the board (US-02 AC-2). */
  tab.loadBoard = function (boardId) {
    J().loading.sprints = true;
    return SCP.jira.sprints(boardId).then(function (sprints) {
      J().sprints = sprints;
      J().loading.sprints = false;
      SCP.app.render();
    }).catch(function (err) {
      J().loading.sprints = false;
      SCP.app.render();
      SCP.app.notice('error', 'Could not load sprints: ' + ui.esc(err.message));
    });
  };

  /** Values of the mapped Team field. */
  tab.loadTeams = function () {
    var f = cfg().fields.team;
    if (!f) { J().teams = []; return Promise.resolve([]); }
    return SCP.jira.teamValues(f.id).then(function (teams) {
      J().teams = teams;
      return teams;
    });
  };

  /* ------------------------------------------------------------------ */
  /* Validation and save (FR-8)                                          */
  /* ------------------------------------------------------------------ */

  function holidayErrors(loc) {
    var errs = [];
    (loc.holidays || []).forEach(function (h) {
      var e = calc.validateHoliday(h.date, cfg().workingWeek);
      if (e) { errs.push(loc.name + ': ' + e); }
    });
    return errs;
  }

  /** Every reason Save config is blocked. */
  tab.validate = function () {
    var c = cfg();
    var errors = [];
    var b = calc.validateBands(c.bands);
    if (!b.ok) { errors.push('Story Points bands: ' + b.message); }
    var s = calc.validateSplit(c.split);
    if (!s.ok) { errors.push('BA / Dev split: ' + s.message + ', must be 100%'); }
    var t = calc.validateThresholds(c.thresholds);
    if (!t.ok) { errors.push('Load thresholds: ' + t.message); }
    if (!c.workingWeek.length) { errors.push('Working week: pick at least one day'); }
    ROLES.forEach(function (r) {
      var m = c.fields[r.key];
      var f = m && J().fields.filter(function (x) { return x.id === m.id; })[0];
      if (f && !typeOk(r.key, f)) { errors.push(r.label + ': ' + m.name + ' is ' + fieldType(f).label + ', expected ' + r.expect); }
    });
    (c.locations || []).forEach(function (l) {
      if (!String(l.name || '').trim()) { errors.push('A location has no name'); }
      errors = errors.concat(holidayErrors(l));
    });
    return errors;
  };

  tab.save = function (force) {
    var errors = tab.validate();
    view.saveErrors = errors.length ? errors : null;
    if (errors.length) {
      SCP.app.render();
      SCP.app.notice('error', 'Save blocked: ' + errors.length + ' item(s) to fix, listed below.');
      return Promise.resolve(false);
    }
    view.saving = true;
    SCP.app.render();
    var meta = S().configMeta;
    return SCP.store.save('scp-config.json', cfg(), meta ? meta.version : 0, { force: force, comment: 'Config saved' })
      .then(function (newMeta) {
        S().configMeta = newMeta;
        view.saving = false;
        SCP.app.render();
        SCP.app.notice('ok', 'Config saved.');
        return true;
      }, function (err) {
        view.saving = false;
        if (err.conflict) {
          var who = err.current ? ' by ' + (err.current.by || 'someone') + ' on ' + ui.fmtWhen(err.current.when) : '';
          SCP.app.render();
          if (window.confirm('The config was changed' + who + ' since you opened this page.\n\nOverwrite it with your version?')) {
            return tab.save(true);
          }
          SCP.app.notice('warn', 'Not saved: the config changed since you opened it. Reload the page to see the latest version.');
          return false;
        }
        SCP.app.render();
        SCP.app.notice('error', 'Could not save the config: ' + ui.esc(err.message));
        return false;
      });
  };

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  function renderHead(head) {
    var meta = S().configMeta;
    var sub = meta
      ? 'Saved as scp-config.json on this page · last changed by ' + ui.esc(meta.by) + ' on ' + ui.esc(ui.fmtWhen(meta.when))
      : 'Not saved yet · defaults shown until you click Save config';
    head.innerHTML =
      '<div class="scp-head__text">' +
      '<div class="scp-eyebrow">Sprint Capacity Planner</div>' +
      '<h1 class="scp-title">Configuration' + (cfg().jira.team ? ' · ' + ui.esc(cfg().jira.team) : '') + '</h1>' +
      '<div class="scp-sub" data-test="config-saved">' + sub + '</div>' +
      '</div>' +
      '<div class="scp-head__actions">' +
      '<button type="button" class="scp-btn scp-btn--primary" data-act="save-config"' + (view.saving ? ' disabled' : '') + '>' +
      (view.saving ? 'Saving…' : 'Save config') + '</button></div>';
    head.querySelector('[data-act="save-config"]').addEventListener('click', function () { tab.save(false); });
  }

  /* --- US-01 Jira connection --------------------------------------- */

  function connectionMessage(conn) {
    var e = conn.error;
    var key = cfg().jira.projectKey;
    if (conn.status === 'testing') {
      return { cls: 'neutral', title: 'Testing the connection…', detail: '' };
    }
    if (conn.status === 'ok') {
      return { cls: 'ok', title: 'Connected as ' + ui.esc(conn.user), detail: 'jira.group.bank · via Confluence application link · no API token stored' };
    }
    if (conn.status === 'idle' || !e) {
      return { cls: 'neutral', title: 'Not tested yet', detail: 'Tabs 1–4 open once the connection test passes.' };
    }
    if (e.kind === 'notAuthorised') {
      return {
        cls: 'error', title: 'Not authorised: Confluence may not read Jira for you yet',
        detail: (e.authUrl
          ? '<a href="' + ui.esc(e.authUrl) + '" target="_blank" rel="noopener" data-test="authorise">Authorise access to jira.group.bank</a>, approve, then click Test connection again.'
          : 'Authorise the jira.group.bank application link for your account (any Jira macro on a Confluence page offers "Login & approve"), then click Test connection again.')
      };
    }
    if (e.kind === 'noPermission') {
      return {
        cls: 'error', title: 'Missing permission: Browse Projects on ' + ui.esc(e.projectKey || key),
        detail: (e.user ? 'Connected as ' + ui.esc(e.user) + ', but ' : '') + 'you need the <b>Browse Projects</b> permission on ' +
          ui.esc(e.projectKey || key) + '. Ask the Jira project administrator to grant it.'
      };
    }
    if (e.kind === 'noLink') {
      return {
        cls: 'error', title: 'The Confluence–Jira application link is not configured',
        detail: 'This page cannot reach jira.group.bank. Contact your Confluence administrator to set up the application link (and its ID in this page’s macro).'
      };
    }
    if (e.kind === 'unreachable') {
      return { cls: 'error', title: 'Jira could not be reached', detail: ui.esc(e.message) + '. Try again in a few minutes.' };
    }
    return { cls: 'error', title: 'Connection failed', detail: ui.esc(e.message) };
  }

  function renderConnection() {
    var m = connectionMessage(S().conn);
    return '<section class="scp-card">' +
      '<div class="scp-card__head"><h2>Jira connection</h2>' +
      '<button type="button" class="scp-btn" data-act="test"' + (S().conn.status === 'testing' ? ' disabled' : '') + '>Test connection</button></div>' +
      '<div class="scp-status scp-status--' + m.cls + '" data-test="conn-status" role="status">' +
      '<span class="scp-status__icon" aria-hidden="true"></span><div>' +
      '<div class="scp-status__title">' + m.title + '</div>' +
      (m.detail ? '<div class="scp-status__detail">' + m.detail + '</div>' : '') +
      '</div></div></section>';
  }

  /* --- US-02 Project & team ---------------------------------------- */

  function options(list, selected, valueOf, labelOf, placeholder) {
    var html = placeholder ? '<option value="">' + ui.esc(placeholder) + '</option>' : '';
    return html + list.map(function (x) {
      var v = String(valueOf(x));
      return '<option value="' + ui.esc(v) + '"' + (v === String(selected) ? ' selected' : '') + '>' + ui.esc(labelOf(x)) + '</option>';
    }).join('');
  }

  function renderSprints() {
    var sp = J().sprints;
    if (J().loading.sprints) { return '<div class="scp-muted">Loading sprints…</div>'; }
    if (!cfg().jira.boardId) { return ''; }
    var count = { active: 0, future: 0, closed: 0 };
    sp.forEach(function (s) { count[s.state] = (count[s.state] || 0) + 1; });
    var rows = sp.map(function (s) {
      return '<tr><td>' + ui.esc(s.name) + '</td><td><span class="scp-pill scp-pill--' + ui.esc(s.state) + '">' + ui.esc(s.state) + '</span></td>' +
        '<td>' + (s.startDate ? calc.fmtDay(calc.jiraDate(s.startDate)) + ' ' + calc.jiraDate(s.startDate).slice(0, 4) : '—') + '</td>' +
        '<td>' + (s.endDate ? calc.fmtDay(calc.jiraDate(s.endDate)) + ' ' + calc.jiraDate(s.endDate).slice(0, 4) : '—') + '</td></tr>';
    }).join('');
    return '<details class="scp-sprints" data-test="sprints"><summary>' + sp.length + ' sprints on this board · ' +
      count.active + ' active · ' + count.future + ' future · ' + count.closed + ' closed</summary>' +
      '<table class="scp-table scp-table--compact"><thead><tr><th>Sprint</th><th>State</th><th>Start</th><th>End</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></details>';
  }

  function renderProject() {
    var jc = cfg().jira;
    var on = SCP.app.connected();
    var dis = on ? '' : ' disabled';
    var projects = J().projects.length ? J().projects : (jc.projectKey ? [{ key: jc.projectKey, name: jc.projectName }] : []);
    var boards = J().boards.length ? J().boards : (jc.boardId ? [{ id: jc.boardId, name: jc.boardName }] : []);
    var teams = J().teams.slice();
    if (jc.team && teams.indexOf(jc.team) === -1) { teams.unshift(jc.team); }
    var types = J().issueTypes.length ? J().issueTypes : jc.issueTypes.map(function (n) { return { name: n }; });
    var chips = types.map(function (t) {
      var checked = jc.issueTypes.indexOf(t.name) !== -1;
      return '<label class="scp-chip' + (checked ? ' is-on' : '') + '"><input type="checkbox" data-act="issuetype" value="' +
        ui.esc(t.name) + '"' + (checked ? ' checked' : '') + dis + '> ' + ui.esc(t.name) + '</label>';
    }).join('');
    return '<section class="scp-card">' +
      '<div class="scp-card__head"><h2>Project &amp; team</h2>' +
      (J().loading.project ? '<span class="scp-muted">Loading from Jira…</span>' : '') + '</div>' +
      '<div class="scp-grid3">' +
      '<label class="scp-field"><span>Project</span><select data-act="project" data-focus="project"' + dis + '>' +
      options(projects, jc.projectKey, function (p) { return p.key; }, function (p) { return p.key + ' · ' + p.name; }, 'Choose a project') + '</select></label>' +
      '<label class="scp-field"><span>Board</span><select data-act="board" data-focus="board"' + dis + '>' +
      options(boards, jc.boardId, function (b) { return b.id; }, function (b) { return b.name; }, boards.length ? '' : 'No board') + '</select></label>' +
      '<label class="scp-field"><span>Team (squad)</span><select data-act="team" data-focus="team"' + dis + '>' +
      options(teams, jc.team, function (t) { return t; }, function (t) { return t; },
        cfg().fields.team ? 'Choose a team' : 'Map the Team field first') + '</select></label>' +
      '</div>' +
      '<div class="scp-field"><span>Issue types to plan</span><div class="scp-chips" data-test="issuetypes">' +
      (chips || '<span class="scp-muted">Select a project to load its issue types</span>') + '</div></div>' +
      renderSprints() +
      '</section>';
  }

  /* --- US-03 Field mapping ----------------------------------------- */

  function renderFields() {
    var fields = J().fields;
    var rows = ROLES.map(function (r) {
      var m = cfg().fields[r.key];
      var f = m && fields.filter(function (x) { return x.id === m.id; })[0];
      var picker;
      if (fields.length) {
        picker = '<select data-act="field" data-role="' + r.key + '" data-focus="field-' + r.key + '" aria-label="Jira field for ' + ui.esc(r.label) + '">' +
          '<option value="">— choose a field —</option>' +
          fields.map(function (x) {
            var t = fieldType(x);
            return '<option value="' + ui.esc(x.id) + '"' + (m && m.id === x.id ? ' selected' : '') + '>' +
              ui.esc(x.name + ' · ' + x.id + ' · ' + t.label + ' · ' + (x.custom ? 'Custom' : 'Standard')) + '</option>';
          }).join('') + '</select>';
      } else {
        picker = m ? ui.esc(m.name) + ' <span class="scp-muted">' + ui.esc(m.id) + '</span>' : '<span class="scp-muted">Connect to list fields</span>';
      }
      var type = f ? fieldType(f).label : (m ? m.type : '');
      var kind = f ? f.custom : (m ? m.custom : null);
      var check;
      if (view.fieldReject[r.key]) {
        check = '<span class="scp-bad" data-test="field-reject-' + r.key + '">✕ ' + ui.esc(view.fieldReject[r.key]) + '</span>';
      } else if (!m) {
        check = '<span class="scp-muted">Not mapped</span>';
      } else if (f && !typeOk(r.key, f)) {
        check = '<span class="scp-bad">✕ Expected ' + ui.esc(r.expect) + '</span>';
      } else {
        check = '<span class="scp-good">✓ Type OK</span>';
      }
      return '<tr><th scope="row">' + ui.esc(r.label) + '</th><td>' + picker + '</td><td>' + ui.esc(type) + '</td>' +
        '<td>' + (kind === null ? '' : '<span class="scp-tag">' + (kind ? 'Custom' : 'Standard') + '</span>') + '</td>' +
        '<td>' + check + '</td></tr>';
    }).join('');
    return '<section class="scp-card"><div class="scp-card__head"><h2>Field mapping</h2></div>' +
      '<table class="scp-table" data-test="field-mapping"><thead><tr><th>Planner role</th><th>Jira field</th><th>Type</th><th>Kind</th><th>Check</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></section>';
  }

  /* --- US-04 / US-05 Team rules ------------------------------------ */

  function splitLine() {
    var c = cfg();
    var v = calc.validateSplit(c.split);
    if (!v.ok) { return '<span class="scp-bad" data-test="split-msg">' + ui.esc(v.message) + ' — BA + Dev must be 100%</span>'; }
    var ex = calc.splitMd(3, c.split);
    return '<span class="scp-good" data-test="split-msg">Sum 100% ✓ · 3 MD ticket = BA ' + calc.fmt1(ex.ba) + ' + Dev ' + calc.fmt1(ex.dev) + '</span>';
  }

  function renderRules() {
    var c = cfg();
    var week = [1, 2, 3, 4, 5, 6, 0].map(function (d) {
      var on = c.workingWeek.indexOf(d) !== -1;
      return '<button type="button" class="scp-day' + (on ? ' is-on' : '') + '" data-act="weekday" data-day="' + d + '" data-focus="day-' + d + '" aria-pressed="' + on + '">' +
        calc.WEEKDAY_SHORT[d] + '</button>';
    }).join('');
    var t = c.thresholds;
    var tv = calc.validateThresholds(t);
    var ceremonyMissing = !ui.isNum(c.ceremonyPct);
    return '<section class="scp-card"><div class="scp-card__head"><h2>Team rules</h2></div>' +
      '<div class="scp-grid2">' +
      '<div><div class="scp-label">BA / Dev split</div>' +
      '<div class="scp-inline">BA <input class="scp-input scp-input--num" type="number" min="0" max="100" data-act="split" data-key="ba" data-focus="split-ba" value="' + ui.esc(c.split.ba) + '" aria-label="BA %"> %' +
      ' Dev <input class="scp-input scp-input--num" type="number" min="0" max="100" data-act="split" data-key="dev" data-focus="split-dev" value="' + ui.esc(c.split.dev) + '" aria-label="Dev %"> %</div>' +
      '<div class="scp-hint" id="scp-split-line">' + splitLine() + '</div></div>' +
      '<div><div class="scp-label">Working week</div><div class="scp-week" data-test="week">' + week + '</div></div>' +
      '<div><div class="scp-label">Team ceremony % (required)</div>' +
      '<div class="scp-inline"><input class="scp-input scp-input--num' + (ceremonyMissing ? ' is-invalid' : '') + '" type="number" min="0" max="99" step="0.5" data-act="ceremony" data-focus="ceremony" value="' +
      (ceremonyMissing ? '' : ui.esc(c.ceremonyPct)) + '" aria-label="Team ceremony %"> % of every working day</div>' +
      (ceremonyMissing ? '<div class="scp-hint scp-bad" data-test="ceremony-msg">Required: Capacity and Planning Calendar stay blocked until it is set</div>' : '') + '</div>' +
      '<div><div class="scp-label">Load thresholds</div><div class="scp-thresholds">' +
      '<span class="scp-badge scp-badge--under">Under-loaded &lt; <input class="scp-input scp-input--tiny" type="number" data-act="threshold" data-key="under" data-focus="th-under" value="' + ui.esc(t.under) + '" aria-label="Under-loaded below %">%</span>' +
      '<span class="scp-badge scp-badge--ok" data-test="ok-band">OK ' + ui.esc(t.under) + '–' + ui.esc(t.over) + '%</span>' +
      '<span class="scp-badge scp-badge--over">Overloaded &gt; <input class="scp-input scp-input--tiny" type="number" data-act="threshold" data-key="over" data-focus="th-over" value="' + ui.esc(t.over) + '" aria-label="Overloaded above %">%</span>' +
      '</div>' + (tv.ok ? '' : '<div class="scp-hint scp-bad">' + ui.esc(tv.message) + '</div>') + '</div>' +
      '</div></section>';
  }

  /* --- US-04 Bands -------------------------------------------------- */

  function bandLabel(b) {
    return b.lower === 0 ? 'up to ' + b.upper : '> ' + b.lower + ' – ' + b.upper;
  }

  function renderBands() {
    var c = cfg();
    var v = calc.validateBands(c.bands);
    var rows = c.bands.map(function (b, i) {
      var err = v.rows[i];
      var md = ui.isNum(b.upper) ? b.upper : 0;
      var sp = calc.splitMd(md, c.split);
      if (view.editBands) {
        return '<tr class="' + (err ? 'is-invalid' : '') + '" data-test="band-row">' +
          '<td><input class="scp-input scp-input--tiny" type="number" data-act="band" data-i="' + i + '" data-key="sp" data-focus="band-' + i + '-sp" value="' + ui.esc(b.sp) + '" aria-label="SP"></td>' +
          '<td>&gt; <input class="scp-input scp-input--tiny" type="number" step="0.5" data-act="band" data-i="' + i + '" data-key="lower" data-focus="band-' + i + '-lower" value="' + ui.esc(b.lower) + '" aria-label="MD lower bound (exclusive)">' +
          ' – <input class="scp-input scp-input--tiny" type="number" step="0.5" data-act="band" data-i="' + i + '" data-key="upper" data-focus="band-' + i + '-upper" value="' + ui.esc(b.upper) + '" aria-label="MD upper bound (inclusive)"></td>' +
          '<td class="num">' + calc.fmt1(md) + '</td>' +
          '<td class="num">' + (err ? '<span class="scp-bad" data-test="band-error">' + ui.esc(err) + '</span>' : '') + '</td>' +
          '<td class="num"><button type="button" class="scp-btn scp-btn--icon" data-act="band-del" data-i="' + i + '" aria-label="Remove band ' + ui.esc(b.sp) + '">−</button></td></tr>';
      }
      return '<tr class="' + (err ? 'is-invalid' : '') + '" data-test="band-row"><td><b>' + ui.esc(b.sp) + '</b></td><td>' + ui.esc(bandLabel(b)) +
        (err ? ' <span class="scp-bad" data-test="band-error">' + ui.esc(err) + '</span>' : '') + '</td>' +
        '<td class="num"><b>' + calc.fmt1(md) + '</b></td><td class="num scp-ba">' + calc.fmt1(sp.ba) + '</td><td class="num scp-dev">' + calc.fmt1(sp.dev) + '</td></tr>';
    }).join('');
    var head = view.editBands
      ? '<tr><th>SP</th><th>MD band</th><th class="num">MD used</th><th class="num"></th><th class="num"></th></tr>'
      : '<tr><th>SP</th><th>MD band</th><th class="num">MD used</th><th class="num">BA ' + ui.esc(c.split.ba) + '%</th><th class="num">Dev ' + ui.esc(c.split.dev) + '%</th></tr>';
    return '<section class="scp-card">' +
      '<div class="scp-card__head"><h2>Story Points → Man-Days</h2><span class="scp-muted">Upper bound is used ' +
      '<button type="button" class="scp-link" data-act="bands-edit">' + (view.editBands ? 'Done' : 'Edit') + '</button></span></div>' +
      '<table class="scp-table" data-test="bands"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>' +
      (view.editBands ? '<button type="button" class="scp-link" data-act="band-add">+ Add band</button>' : '') +
      '<div class="scp-hint ' + (v.ok ? 'scp-good' : 'scp-bad') + '" data-test="bands-msg">' + ui.esc(v.message) + (v.ok ? ' ✓' : '') + '</div>' +
      '</section>';
  }

  /* --- US-06 Locations ---------------------------------------------- */

  function resourcesAt(locId) {
    var plan = S().plan;
    return plan && plan.resources ? plan.resources.filter(function (r) { return r.location === locId; }).length : 0;
  }

  function inSprintChip(loc) {
    var plan = S().plan;
    if (!plan || !plan.sprint || !plan.sprint.start) { return ''; }
    var days = calc.workingDays(plan.sprint.start, plan.sprint.end, cfg().workingWeek);
    var hits = (loc.holidays || []).filter(function (h) { return days.indexOf(h.date) !== -1; });
    if (!hits.length) { return '<span class="scp-muted">In ' + ui.esc(plan.sprint.name) + ': none</span>'; }
    return '<span class="scp-chip-hol">In ' + ui.esc(plan.sprint.name) + ': ' +
      hits.map(function (h) { return ui.esc(calc.fmtDay(h.date) + ' · ' + h.name); }).join(', ') + '</span>';
  }

  function years(loc) {
    var ys = {};
    (loc.holidays || []).forEach(function (h) { ys[h.date.slice(0, 4)] = true; });
    var list = Object.keys(ys).sort();
    return list.length ? list.join(', ') + ' calendar loaded' : 'no holidays yet';
  }

  function renderLocationEditor(loc) {
    var hol = (loc.holidays || []).slice().sort(function (a, b) { return a.date.localeCompare(b.date); });
    var rows = hol.map(function (h) {
      var err = calc.validateHoliday(h.date, cfg().workingWeek);
      return '<tr class="' + (err ? 'is-invalid' : '') + '"><td>' + ui.esc(calc.fmtDay(h.date)) + ' ' + h.date.slice(0, 4) + '</td><td>' + ui.esc(h.name) +
        (err ? ' <span class="scp-bad">' + ui.esc(err) + '</span>' : '') + '</td>' +
        '<td class="num"><button type="button" class="scp-btn scp-btn--icon" data-act="hol-del" data-loc="' + ui.esc(loc.id) + '" data-date="' + ui.esc(h.date) + '" aria-label="Remove ' + ui.esc(h.name) + '">−</button></td></tr>';
    }).join('');
    return '<div class="scp-loc__editor" data-test="loc-editor">' +
      '<div class="scp-inline"><label class="scp-field scp-field--inline"><span>Name</span><input class="scp-input" data-act="loc-name" data-loc="' + ui.esc(loc.id) + '" data-focus="loc-name-' + ui.esc(loc.id) + '" value="' + ui.esc(loc.name) + '"></label>' +
      '<button type="button" class="scp-link scp-link--danger" data-act="loc-del" data-loc="' + ui.esc(loc.id) + '">Delete location</button></div>' +
      '<table class="scp-table scp-table--compact"><thead><tr><th>Date</th><th>Office holiday</th><th></th></tr></thead><tbody>' +
      (rows || '<tr><td colspan="3" class="scp-muted">No holidays yet</td></tr>') + '</tbody></table>' +
      '<div class="scp-inline scp-addhol">' +
      '<input class="scp-input" type="date" data-hol-date="' + ui.esc(loc.id) + '" aria-label="Holiday date">' +
      '<input class="scp-input" placeholder="Holiday name" data-hol-name="' + ui.esc(loc.id) + '" aria-label="Holiday name">' +
      '<button type="button" class="scp-btn" data-act="hol-add" data-loc="' + ui.esc(loc.id) + '">Add holiday</button></div>' +
      (view.holidayError[loc.id] ? '<div class="scp-hint scp-bad" data-test="hol-error">' + ui.esc(view.holidayError[loc.id]) + '</div>' : '') +
      '</div>';
  }

  function renderLocations() {
    var locs = cfg().locations;
    var list = locs.map(function (l) {
      var open = view.openLocation === l.id;
      var n = resourcesAt(l.id);
      return '<div class="scp-loc' + (open ? ' is-open' : '') + '" data-test="location">' +
        '<button type="button" class="scp-loc__row" data-act="loc-open" data-loc="' + ui.esc(l.id) + '" aria-expanded="' + open + '">' +
        '<span><b>' + ui.esc(l.name || 'New location') + '</b><br><span class="scp-muted">' + n + ' resource' + (n === 1 ? '' : 's') + ' · ' + ui.esc(years(l)) + '</span></span>' +
        inSprintChip(l) + '</button>' +
        (open ? renderLocationEditor(l) : '') + '</div>';
    }).join('');
    return '<section class="scp-card">' +
      '<div class="scp-card__head"><h2>Locations &amp; office holidays</h2><button type="button" class="scp-btn" data-act="loc-add">Add location</button></div>' +
      (list || '<div class="scp-muted">No locations yet. Add one per office (e.g. Luxembourg, Chennai) with its holidays for the year.</div>') +
      '</section>';
  }

  /* --- Body ---------------------------------------------------------- */

  function renderErrors() {
    if (!view.saveErrors) { return ''; }
    return '<div class="scp-card scp-errors" data-test="save-errors"><b>Save blocked</b><ul>' +
      view.saveErrors.map(function (e) { return '<li>' + ui.esc(e) + '</li>'; }).join('') + '</ul></div>';
  }

  tab.render = function (head, body) {
    renderHead(head);
    body.innerHTML = renderErrors() +
      '<div class="scp-cols">' +
      '<div class="scp-col">' + renderConnection() + renderProject() + renderFields() + renderRules() + '</div>' +
      '<div class="scp-col">' + renderBands() + renderLocations() + '</div>' +
      '</div>';
    bind(body);
  };

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  function findLoc(id) {
    return cfg().locations.filter(function (l) { return l.id === id; })[0];
  }

  /** After an edit: clear an old "save blocked" list so it never shows stale messages. */
  function edited() {
    if (view.saveErrors) { view.saveErrors = tab.validate(); if (!view.saveErrors.length) { view.saveErrors = null; } }
  }

  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) { return; }
    var act = el.getAttribute('data-act');
    var c = cfg();
    if (act === 'test') {
      tab.testConnection();
    } else if (act === 'weekday') {
      var d = Number(el.getAttribute('data-day'));
      var i = c.workingWeek.indexOf(d);
      if (i === -1) { c.workingWeek.push(d); c.workingWeek.sort(); } else { c.workingWeek.splice(i, 1); }
      edited(); redraw();
    } else if (act === 'bands-edit') {
      view.editBands = !view.editBands; redraw();
    } else if (act === 'band-add') {
      var last = c.bands[c.bands.length - 1];
      c.bands.push({ sp: null, lower: last ? last.upper : 0, upper: null });
      edited(); redraw();
    } else if (act === 'band-del') {
      c.bands.splice(Number(el.getAttribute('data-i')), 1);
      edited(); redraw();
    } else if (act === 'loc-add') {
      var id = 'loc-' + Date.now().toString(36);
      c.locations.push({ id: id, name: '', holidays: [] });
      view.openLocation = id;
      redraw();
    } else if (act === 'loc-open') {
      var lid = el.getAttribute('data-loc');
      view.openLocation = view.openLocation === lid ? null : lid;
      redraw();
    } else if (act === 'loc-del') {
      var dl = findLoc(el.getAttribute('data-loc'));
      var used = resourcesAt(dl.id);
      if (used && !window.confirm(dl.name + ' is the location of ' + used + ' resource(s) in the open plan. Delete it anyway?')) { return; }
      c.locations = c.locations.filter(function (l) { return l !== dl; });
      edited(); redraw();
    } else if (act === 'hol-add') {
      addHoliday(el.getAttribute('data-loc'));
    } else if (act === 'hol-del') {
      var hl = findLoc(el.getAttribute('data-loc'));
      var date = el.getAttribute('data-date');
      hl.holidays = hl.holidays.filter(function (h) { return h.date !== date; });
      edited(); redraw();
    }
  }

  /** Add a yearly office holiday; a non-working day is rejected (US-06 AC-2). */
  function addHoliday(locId) {
    var root = SCP.state.root;
    var loc = findLoc(locId);
    var date = root.querySelector('[data-hol-date="' + locId + '"]').value;
    var name = root.querySelector('[data-hol-name="' + locId + '"]').value.trim();
    var err = calc.validateHoliday(date, cfg().workingWeek);
    if (!err && !name) { err = 'Enter the holiday name'; }
    if (!err && loc.holidays.some(function (h) { return h.date === date; })) { err = calc.fmtDay(date) + ' is already a holiday here'; }
    view.holidayError[locId] = err;
    if (!err) { loc.holidays.push({ date: date, name: name }); edited(); }
    redraw();
  }

  function onChange(e) {
    var el = e.target;
    var act = el.getAttribute('data-act');
    var c = cfg();
    if (act === 'project') {
      if (el.value) { tab.loadProject(el.value, false); }
    } else if (act === 'board') {
      var b = J().boards.filter(function (x) { return String(x.id) === el.value; })[0];
      c.jira.boardId = b ? b.id : null;
      c.jira.boardName = b ? b.name : '';
      J().sprints = [];
      redraw();
      if (b) { tab.loadBoard(b.id); }
    } else if (act === 'team') {
      c.jira.team = el.value; redraw();
    } else if (act === 'issuetype') {
      var list = c.jira.issueTypes.filter(function (n) { return n !== el.value; });
      if (el.checked) { list.push(el.value); }
      c.jira.issueTypes = list;
      redraw();
    } else if (act === 'field') {
      onFieldPicked(el);
    } else if (act === 'split' || act === 'ceremony' || act === 'threshold' || act === 'band' || act === 'loc-name') {
      onInput(e);
      edited();
      redraw();
    }
  }

  /** Field picker: the wrong type is rejected and the previous mapping kept (US-03 AC-2). */
  function onFieldPicked(el) {
    var role = el.getAttribute('data-role');
    var r = ROLES.filter(function (x) { return x.key === role; })[0];
    var f = J().fields.filter(function (x) { return x.id === el.value; })[0];
    if (!f) {
      cfg().fields[role] = null;
      view.fieldReject[role] = null;
    } else if (!typeOk(role, f)) {
      view.fieldReject[role] = 'Rejected: ' + f.name + ' is ' + fieldType(f).label + '; expected ' + r.expect;
    } else {
      cfg().fields[role] = toMapping(f);
      view.fieldReject[role] = null;
      if (role === 'team') {
        cfg().jira.team = '';
        tab.loadTeams().then(function () { SCP.app.render(); });
      }
    }
    redraw();
  }

  /** Live typing: update the config and the small derived lines without re-drawing. */
  function onInput(e) {
    var el = e.target;
    var act = el.getAttribute('data-act');
    var c = cfg();
    if (act === 'split') {
      c.split[el.getAttribute('data-key')] = ui.num(el.value);
      var line = SCP.state.root.querySelector('#scp-split-line');
      if (line) { line.innerHTML = splitLine(); }
    } else if (act === 'ceremony') {
      c.ceremonyPct = ui.num(el.value);
    } else if (act === 'threshold') {
      c.thresholds[el.getAttribute('data-key')] = ui.num(el.value);
    } else if (act === 'band') {
      c.bands[Number(el.getAttribute('data-i'))][el.getAttribute('data-key')] = ui.num(el.value);
    } else if (act === 'loc-name') {
      findLoc(el.getAttribute('data-loc')).name = el.value;
    }
  }

  function bind(body) {
    body.addEventListener('click', onClick);
    body.addEventListener('change', onChange);
    body.addEventListener('input', onInput);
  }
}(window.SCP = window.SCP || {}));
