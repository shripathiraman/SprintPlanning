/*
 * scp-tab-tickets.js — Sprint Capacity Planner · Tab 1 Sprint Tickets (US-07 to US-11)
 *
 * Future-sprint selector and New Sprint Planning (FR-9), sprint header
 * (FR-10), ticket table with MD per role (FR-11), Reload from Jira with the
 * change list (FR-12), flags for incomplete tickets (FR-13) and the person
 * dropdown on multi-person tickets (FR-32). Nothing here writes to Jira.
 */
(function (SCP) {
  'use strict';

  SCP.tabs = SCP.tabs || {};
  var tab = SCP.tabs.tickets = {};
  var ui = SCP.ui = SCP.ui || {};
  var calc = SCP.calc;

  var view = {
    busy: false,          // a Jira call is running
    selected: null        // sprint id picked in the selector before a plan is opened
  };

  function S() { return SCP.state; }
  function cfg() { return SCP.state.config; }
  function plan() { return SCP.state.plan; }

  /* ------------------------------------------------------------------ */
  /* Sprints                                                             */
  /* ------------------------------------------------------------------ */

  function toSprint(s) {
    return {
      id: s.id,
      name: s.name,
      goal: s.goal || '',
      state: s.state,
      start: calc.jiraDate(s.startDate),
      end: calc.jiraDate(s.endDate)
    };
  }

  /** Future sprints only (FR-9, US-07 AC-1). */
  tab.futureSprints = function () {
    return S().jira.sprints.filter(function (s) { return s.state === 'future'; });
  };

  /** What must be set in Config before tickets can load. */
  function missingConfig() {
    var c = cfg();
    var miss = [];
    if (!c.jira.boardId) { miss.push('a project and board'); }
    if (!c.jira.issueTypes.length) { miss.push('at least one issue type to plan'); }
    if (!c.fields.dev || !c.fields.ba || !c.fields.sp || !c.fields.team) { miss.push('the four field mappings'); }
    if (!c.jira.team) { miss.push('the Team (squad)'); }
    return miss;
  }

  /* ------------------------------------------------------------------ */
  /* Open a plan (US-07)                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * New Sprint Planning for a future sprint. One open plan per page: starting
   * another asks to close the current one first (FR-9, US-07 AC-3).
   */
  tab.openPlan = function (sprintId) {
    var s = S().jira.sprints.filter(function (x) { return String(x.id) === String(sprintId); })[0];
    var p = plan();
    if (!s) { return Promise.resolve(false); }
    if (p && String(p.sprint.id) === String(s.id)) { return Promise.resolve(false); }
    if (p && p.status === 'open') {
      var ok = window.confirm('A plan for ' + p.sprint.name + ' is open on this page. One page holds one open plan.\n\n' +
        'Close the ' + p.sprint.name + ' plan and start planning ' + s.name + '?\n' +
        'Its resources, leave and card placements are replaced when you click Save plan.');
      if (!ok) {
        SCP.app.render();
        return Promise.resolve(false);
      }
    }
    var miss = missingConfig();
    if (miss.length) {
      SCP.app.notice('warn', 'Set ' + ui.esc(miss.join(', ')) + ' in Config first.');
      return Promise.resolve(false);
    }
    view.busy = true;
    SCP.app.render();
    var prev = p;
    return SCP.jira.sprintIssues(s.id, cfg()).then(function (issues) {
      S().plan = {
        schemaVersion: 1,
        status: 'open',
        sprint: toSprint(s),
        loadedAt: new Date().toISOString(),
        changesSince: null,
        changes: null,
        tickets: issues.map(function (i) { return SCP.jira.toTicket(i, cfg()); }),
        resources: [],
        leave: {},
        oneOffs: [],
        cards: []
      };
      // Resources pre-filled from the tickets and the last plan's team (US-12 AC-1).
      if (SCP.tabs.resources) { SCP.tabs.resources.sync(S().plan, prev); }
      view.busy = false;
      view.selected = null;
      SCP.app.markDirty();
      SCP.app.render();
      SCP.app.notice('info', 'Plan opened for ' + ui.esc(s.name) + '. Click Save plan to keep it on this page.');
      return true;
    }).catch(function (err) {
      view.busy = false;
      SCP.app.render();
      SCP.app.notice('error', 'Could not load the tickets of ' + ui.esc(s.name) + ': ' + ui.esc(err.message));
      return false;
    });
  };

  /* ------------------------------------------------------------------ */
  /* Reload and change list (US-11)                                      */
  /* ------------------------------------------------------------------ */

  function names(list) {
    return list && list.length ? list.map(function (p) { return p.name; }).join(' & ') : '—';
  }

  function nameOf(list, id) {
    var p = (list || []).filter(function (x) { return x.id === id; })[0];
    return p ? p.name : id;
  }

  /** What changed between the stored load and the fresh one (FR-12). */
  tab.diff = function (oldPlan, sprint, fresh) {
    var out = [];
    var old = {};
    var now = {};
    oldPlan.tickets.forEach(function (t) { old[t.key] = t; });
    fresh.forEach(function (t) { now[t.key] = t; });
    if (oldPlan.sprint.start !== sprint.start) {
      out.push({ kind: 'dates', text: 'Sprint start ' + calc.fmtDay(oldPlan.sprint.start) + ' → ' + calc.fmtDay(sprint.start) });
    }
    if (oldPlan.sprint.end !== sprint.end) {
      out.push({ kind: 'dates', text: 'Sprint end ' + calc.fmtDay(oldPlan.sprint.end) + ' → ' + calc.fmtDay(sprint.end) });
    }
    fresh.forEach(function (t) {
      var o = old[t.key];
      if (!o) { out.push({ kind: 'added', key: t.key, text: '+ ' + t.key + ' added' }); return; }
      if (o.sp !== t.sp) {
        out.push({ kind: 'sp', key: t.key, text: t.key + ' SP ' + (o.sp === null ? '—' : o.sp) + ' → ' + (t.sp === null ? '—' : t.sp) });
      }
      if (names(o.dev) !== names(t.dev)) { out.push({ kind: 'dev', key: t.key, text: t.key + ' Dev ' + names(o.dev) + ' → ' + names(t.dev) }); }
      if (names(o.ba) !== names(t.ba)) { out.push({ kind: 'ba', key: t.key, text: t.key + ' BA ' + names(o.ba) + ' → ' + names(t.ba) }); }
      [['devPick', 'dev', 'Contributor'], ['baPick', 'ba', 'Backup Assignee']].forEach(function (k) {
        var pick = o[k[0]];
        if (pick && t[k[1]].length && !t[k[1]].some(function (p) { return p.id === pick; })) {
          out.push({ kind: 'pick', key: t.key, text: t.key + ' ' + nameOf(o[k[1]], pick) + ' no longer in ' + k[2] + ' → back to ' + t[k[1]][0].name });
        }
      });
    });
    oldPlan.tickets.forEach(function (t) {
      if (!now[t.key]) { out.push({ kind: 'removed', key: t.key, text: '− ' + t.key + ' removed' }); }
    });
    return out;
  };

  /** Reload from Jira (FR-12): refetch the sprint and its tickets, list what changed. */
  tab.reload = function () {
    var p = plan();
    if (!p || !SCP.app.connected() || view.busy) { return Promise.resolve(false); }
    view.busy = true;
    SCP.app.render();
    return Promise.all([SCP.jira.sprint(p.sprint.id), SCP.jira.sprintIssues(p.sprint.id, cfg())]).then(function (r) {
      var sprint = toSprint(r[0]);
      var fresh = r[1].map(function (i) { return SCP.jira.toTicket(i, cfg()); });
      var changes = tab.diff(p, sprint, fresh);
      // Keep the SM's dropdown choices while the person is still listed (FR-32).
      var old = {};
      p.tickets.forEach(function (t) { old[t.key] = t; });
      fresh.forEach(function (t) {
        var o = old[t.key];
        if (!o) { return; }
        if (o.devPick && t.dev.some(function (x) { return x.id === o.devPick; })) { t.devPick = o.devPick; }
        if (o.baPick && t.ba.some(function (x) { return x.id === o.baPick; })) { t.baPick = o.baPick; }
      });
      // A ticket that left the sprint loses its cards (US-11 AC-2).
      var keys = {};
      fresh.forEach(function (t) { keys[t.key] = true; });
      p.cards = (p.cards || []).filter(function (c) { return keys[c.key]; });
      p.changesSince = p.loadedAt;
      p.loadedAt = new Date().toISOString();
      p.changes = changes;
      p.tickets = fresh;
      p.sprint = sprint;
      // People new on the tickets join Tab 2, tagged when outside the team (US-12 AC-2).
      if (SCP.tabs.resources) { SCP.tabs.resources.sync(p, null); }
      if (SCP.tabs.calendar && SCP.tabs.calendar.afterReload) { SCP.tabs.calendar.afterReload(); }
      view.busy = false;
      SCP.app.markDirty();
      SCP.app.render();
      return true;
    }).catch(function (err) {
      view.busy = false;
      SCP.app.render();
      SCP.app.notice('error', 'Reload from Jira failed: ' + ui.esc(err.message) + '. The last loaded data is still shown.');
      return false;
    });
  };

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  var FLAG_LONG = { noSp: 'no Story Points', outside: 'SP outside bands', noDev: 'no Contributor', noBa: 'no Backup Assignee' };
  var FLAG_SHORT = { noSp: 'no Story Points', outside: 'SP outside bands', noDev: 'no Dev', noBa: 'no BA' };

  /** "PCAP-441 no Backup Assignee", "PCAP-444 no Story Points, no Dev, no BA (0 MD)" */
  function flagText(t, m) {
    var dict = m.flags.length === 1 ? FLAG_LONG : FLAG_SHORT;
    return t.key + ' ' + m.flags.map(function (f) { return dict[f]; }).join(', ') + (m.total === 0 ? ' (0 MD)' : '');
  }

  function sprintOptions() {
    var p = plan();
    var list = tab.futureSprints().slice();
    if (p && !list.some(function (s) { return String(s.id) === String(p.sprint.id); })) {
      list.unshift({ id: p.sprint.id, name: p.sprint.name, startDate: p.sprint.start, endDate: p.sprint.end });
    }
    var sel = p ? p.sprint.id : view.selected;
    var html = p ? '' : '<option value="">Choose a future sprint</option>';
    return html + list.map(function (s) {
      var range = s.startDate && s.endDate ? ' · ' + calc.fmtShortRange(calc.jiraDate(s.startDate), calc.jiraDate(s.endDate)) : '';
      return '<option value="' + ui.esc(s.id) + '"' + (String(s.id) === String(sel) ? ' selected' : '') + '>' + ui.esc(s.name + range) + '</option>';
    }).join('');
  }

  function renderHead(head) {
    var p = plan();
    var online = SCP.app.connected();
    var reloadTitle = !online ? 'Jira is not available' : (!p ? 'Open a plan first' : 'Refetch the sprint and list what changed');
    var lead =
      '<label class="scp-inline scp-muted">Future sprint ' +
      '<select class="scp-sprint-select" data-act="sprint" data-focus="sprint"' + (online && !view.busy ? '' : ' disabled') + '>' + sprintOptions() + '</select></label>' +
      (p ? '' : '<button type="button" class="scp-btn scp-btn--primary" data-act="new-plan"' + (view.selected && online && !view.busy ? '' : ' disabled') + '>New Sprint Planning</button>') +
      '<button type="button" class="scp-btn" data-act="reload" data-test="reload" title="' + reloadTitle + '"' +
      (p && online && !view.busy ? '' : ' disabled') + '>↻ ' + (view.busy ? 'Loading…' : 'Reload from Jira') + '</button>';
    SCP.app.planHead(head, { lead: lead });
    head.querySelector('[data-act="sprint"]').addEventListener('change', function (e) {
      var v = e.target.value;
      if (plan()) { tab.openPlan(v); } else { view.selected = v || null; SCP.app.render(); }
    });
    var np = head.querySelector('[data-act="new-plan"]');
    if (np) { np.addEventListener('click', function () { tab.openPlan(view.selected); }); }
    head.querySelector('[data-act="reload"]').addEventListener('click', function () { tab.reload(); });
  }

  function renderFacts(p, totals) {
    var days = calc.workingDays(p.sprint.start, p.sprint.end, cfg().workingWeek).length;
    return '<div class="scp-facts" data-test="facts">' +
      '<div class="scp-fact scp-fact--wide"><div class="scp-fact__label">Sprint goal</div><div class="scp-fact__value" data-test="goal">' + ui.esc(p.sprint.goal || '—') + '</div></div>' +
      '<div class="scp-fact"><div class="scp-fact__label">Dates</div><div class="scp-fact__value" data-test="dates">' + ui.esc(calc.fmtRange(p.sprint.start, p.sprint.end)) + '</div></div>' +
      '<div class="scp-fact"><div class="scp-fact__label">Working days</div><div class="scp-fact__big" data-test="working-days">' + days + '</div></div>' +
      '<div class="scp-fact"><div class="scp-fact__label">Tickets · SP · MD</div><div class="scp-fact__big" data-test="ticket-facts">' +
      totals.tickets + ' · ' + totals.sp + ' · ' + calc.fmt1(totals.total) + '</div></div>' +
      '</div>';
  }

  function renderChanges(p) {
    if (p.changes === null || p.changes === undefined) { return ''; }
    var when = ui.fmtWhen(p.changesSince);
    if (!p.changes.length) {
      return '<div class="scp-panel scp-panel--info" data-test="changes"><b>No changes since last load (' + ui.esc(when) + ')</b></div>';
    }
    return '<div class="scp-panel scp-panel--info" data-test="changes"><b>Changed since last load (' + ui.esc(when) + ')</b>' +
      '<div class="scp-chips scp-chips--small">' + p.changes.map(function (c) {
        return '<span class="scp-change">' + ui.esc(c.text) + '</span>';
      }).join('') + '</div></div>';
  }

  function renderFlags(rows) {
    var flagged = rows.filter(function (r) { return r.m.flags.length; });
    if (!flagged.length) { return ''; }
    return '<div class="scp-panel scp-panel--warn" data-test="flags"><b>' + flagged.length + ' ticket' + (flagged.length === 1 ? '' : 's') +
      ' flagged — fix in Jira, then reload</b><div>' +
      flagged.map(function (r) { return ui.esc(flagText(r.t, r.m)); }).join(' · ') + '</div></div>';
  }

  /** Info note on multi-person tickets (FR-32): counted, not flagged. */
  function renderMulti(rows) {
    var lines = [];
    var count = 0;
    rows.forEach(function (r) {
      [['dev', 'devPerson', 'Contributor'], ['ba', 'baPerson', 'Backup Assignee']].forEach(function (k) {
        var list = r.t[k[0]];
        if (list.length > 1) {
          count++;
          var chosen = nameOf(list, r.m[k[1]]);
          var first = list[0].id === r.m[k[1]];
          lines.push(r.t.key + ' lists ' + list.map(function (x) { return x.name; }).join(' and ') + ' · planned on ' + chosen +
            (first ? ' (first listed)' : ' (your choice)') + ' · change it in the ' + k[2] + ' column');
        }
      });
    });
    if (!count) { return ''; }
    return '<div class="scp-card scp-note" data-test="multi"><b>' + count + ' ticket' + (count === 1 ? ' has' : 's have') +
      ' more than one Contributor or Backup Assignee</b><div class="scp-muted">' + lines.map(ui.esc).join('<br>') + '</div></div>';
  }

  /** Dev / BA cell: name, dropdown when several are listed, or a missing marker. */
  function personCell(t, m, role) {
    var list = t[role];
    var chosen = m[role + 'Person'];
    var moved = SCP.tabs.calendar && SCP.tabs.calendar.movedTo ? SCP.tabs.calendar.movedTo(t.key, role) : null;
    if (!list.length) {
      return '<span class="scp-bad">⚠ Missing' + (m.total > 0 ? ' → Unassigned' : '') + '</span>' +
        (moved ? '<div class="scp-moved">' + ui.esc(moved) + ' · moved in calendar</div>' : '');
    }
    var cell;
    if (list.length > 1) {
      cell = '<select class="scp-person" data-act="pick" data-key="' + ui.esc(t.key) + '" data-role="' + role + '" data-focus="pick-' + ui.esc(t.key) + '-' + role + '"' +
        (S().plan.status === 'open' && !S().readOnly ? '' : ' disabled') + ' aria-label="' + (role === 'dev' ? 'Contributor' : 'Backup Assignee') + ' planned for ' + ui.esc(t.key) + '">' +
        list.map(function (p) {
          return '<option value="' + ui.esc(p.id) + '"' + (p.id === chosen ? ' selected' : '') + '>' + ui.esc(p.name) + '</option>';
        }).join('') + '</select>';
    } else {
      cell = ui.esc(list[0].name);
    }
    if (moved) {
      cell = '<s class="scp-muted">' + (list.length > 1 ? ui.esc(nameOf(list, chosen)) : cell) + '</s> <b>' + ui.esc(moved) + '</b>' +
        '<div class="scp-moved">moved in calendar</div>';
    }
    return cell;
  }

  function spCell(t, m) {
    if (m.flags.indexOf('noSp') !== -1) { return '<span class="scp-bad" title="No Story Points">⚠ —</span>'; }
    if (m.flags.indexOf('outside') !== -1) { return '<span class="scp-bad" title="SP outside bands">⚠ ' + ui.esc(t.sp) + '</span>'; }
    return ui.esc(t.sp);
  }

  function renderTable(rows, totals) {
    var body = rows.map(function (r) {
      var t = r.t;
      var m = r.m;
      return '<tr class="' + (m.flags.length ? 'is-flagged' : '') + '" data-key="' + ui.esc(t.key) + '">' +
        '<td><a href="' + ui.esc(SCP.jira.browseUrl(t.key)) + '" target="_blank" rel="noopener">' + ui.esc(t.key) + '</a></td>' +
        '<td>' + ui.esc(t.summary) + '</td><td>' + ui.esc(t.type) + '</td>' +
        '<td data-col="dev">' + personCell(t, m, 'dev') + '</td><td data-col="ba">' + personCell(t, m, 'ba') + '</td>' +
        '<td class="num" data-col="sp">' + spCell(t, m) + '</td>' +
        '<td class="num" data-col="total"><b>' + calc.fmt1(m.total) + '</b></td>' +
        '<td class="num scp-dev" data-col="devmd">' + calc.fmt1(m.dev) + '</td>' +
        '<td class="num scp-ba" data-col="bamd">' + calc.fmt1(m.ba) + '</td></tr>';
    }).join('');
    return '<div class="scp-card scp-card--flush"><table class="scp-table scp-tickets" data-test="tickets"><thead><tr>' +
      '<th>Ticket</th><th>Summary</th><th>Type</th><th>Contributor (Dev)</th><th>Backup Assignee (BA)</th>' +
      '<th class="num">SP</th><th class="num">Total MD</th><th class="num">Dev MD</th><th class="num">BA MD</th></tr></thead>' +
      '<tbody>' + (body || '<tr><td colspan="9" class="scp-muted">No tickets of the chosen types and team in this sprint.</td></tr>') + '</tbody>' +
      '<tfoot><tr data-test="totals"><th>Total</th><td colspan="4" class="scp-muted">' + totals.tickets + ' tickets · ' + totals.flagged + ' flagged</td>' +
      '<td class="num"><b>' + totals.sp + '</b></td><td class="num"><b>' + calc.fmt1(totals.total) + '</b></td>' +
      '<td class="num scp-dev"><b>' + calc.fmt1(totals.dev) + '</b></td><td class="num scp-ba"><b>' + calc.fmt1(totals.ba) + '</b></td></tr></tfoot>' +
      '</table></div>';
  }

  tab.render = function (head, body) {
    renderHead(head);
    var p = plan();
    if (!p) {
      var miss = missingConfig();
      body.innerHTML = '<div class="scp-card scp-empty" data-test="no-plan"><h2>No plan open</h2><p class="scp-muted">' +
        (miss.length ? 'Set ' + ui.esc(miss.join(', ')) + ' in Config, then ' : '') +
        'pick a future sprint above and click New Sprint Planning.</p></div>';
      return;
    }
    var rows = p.tickets.map(function (t) { return { t: t, m: calc.ticketMd(t, cfg()) }; });
    var totals = calc.ticketTotals(p.tickets, cfg());
    var changes = renderChanges(p);
    var flags = renderFlags(rows);
    body.innerHTML = renderFacts(p, totals) +
      (changes || flags ? '<div class="scp-panels">' + changes + flags + '</div>' : '') +
      renderMulti(rows) + renderTable(rows, totals);
    body.addEventListener('change', function (e) {
      var el = e.target;
      if (el.getAttribute('data-act') !== 'pick') { return; }
      var t = p.tickets.filter(function (x) { return x.key === el.getAttribute('data-key'); })[0];
      t[el.getAttribute('data-role') + 'Pick'] = el.value;
      SCP.app.markDirty();
      setTimeout(function () { SCP.app.render(); }, 0);
    });
  };
}(window.SCP = window.SCP || {}));
