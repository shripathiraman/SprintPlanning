/*
 * scp-tab-capacity.js — Sprint Capacity Planner · Tab 3 Capacity (US-15)
 *
 * Read-only: shows how gross capacity becomes net capacity per person, per
 * role and for the sprint (FR-14, FR-16, FR-19). Every figure comes from
 * SCP.calc.capacitySummary; every input is edited in Config or Tab 2, so this
 * tab has no field of its own. "Edit resources & leave" opens Tab 2.
 *
 * Planned MD per person is the ticket load from Tab 1 (Dev MD on the
 * Contributor, BA MD on the Backup Assignee); Tab 4 drags will change it.
 */
(function (SCP) {
  'use strict';

  SCP.tabs = SCP.tabs || {};
  var tab = SCP.tabs.capacity = {};
  var ui = SCP.ui = SCP.ui || {};
  var calc = SCP.calc;

  function cfg() { return SCP.state.config; }
  function plan() { return SCP.state.plan; }

  /** "−2" / "−0.5" / "0": a deduction in days, one decimal only when needed. */
  function minusDays(n) {
    if (!n) { return '0'; }
    return '−' + days(n);
  }

  /** "3.5" / "2": a day count, one decimal only when needed. */
  function days(n) {
    var v = calc.round1(n);
    return v % 1 === 0 ? String(v) : calc.fmt1(v);
  }

  function locationName(id) {
    var l = (cfg().locations || []).filter(function (x) { return x.id === id; })[0];
    return l ? l.name : '';
  }

  function roleTag(role) {
    var cls = role === 'Dev' ? 'scp-role--dev' : role === 'BA' ? 'scp-role--ba' : 'scp-role--both';
    return '<span class="scp-role ' + cls + '">' + ui.esc(role || 'Dev') + '</span>';
  }

  /** "8.4 · 66%" coloured by the Config load thresholds (FR-7). */
  function loadBadge(planned, pct) {
    if (pct === null) { return '<span class="scp-muted">—</span>'; }
    var cls = calc.loadClass(pct, cfg().thresholds);
    return '<span class="scp-badge scp-badge--' + cls + '" data-load="' + cls + '">' +
      calc.fmt1(planned) + ' · ' + Math.round(pct) + '%</span>';
  }

  /* ------------------------------------------------------------------ */
  /* Gross-to-net strip                                                  */
  /* ------------------------------------------------------------------ */

  /** "Pongal · 2 in Chennai" for one holiday; "2 holidays · 5 person-days" for several. */
  function holidayNote(sum) {
    var byKey = {};
    var order = [];
    sum.rows.forEach(function (c) {
      calc.sprintHolidays(c.resource.location, cfg(), plan()).forEach(function (h) {
        var k = h.date + '|' + h.name;
        if (!byKey[k]) { byKey[k] = { name: h.name, people: 0, locs: [] }; order.push(k); }
        byKey[k].people++;
        var ln = locationName(c.resource.location);
        if (byKey[k].locs.indexOf(ln) === -1) { byKey[k].locs.push(ln); }
      });
    });
    if (!order.length) { return 'none in this sprint'; }
    if (order.length === 1) {
      var h = byKey[order[0]];
      return h.name + ' · ' + h.people + ' in ' + h.locs.join(', ');
    }
    return order.length + ' holidays · ' + days(sum.totals.holidays) + ' person-days';
  }

  function leaveNote(sum) {
    var n = sum.rows.filter(function (c) { return c.leave > 0; }).length;
    return n ? n + (n === 1 ? ' person' : ' people') : 'none';
  }

  function availabilityNote(sum) {
    var below = sum.rows.filter(function (c) { return c.availability < 100; });
    if (!below.length) { return 'everyone at 100%'; }
    if (below.length > 2) { return below.length + ' people below 100%'; }
    return below.map(function (c) { return c.resource.name + ' at ' + c.availability + '%'; }).join(' · ');
  }

  function stat(key, label, value, note, strong) {
    return '<div class="scp-stat' + (strong ? ' scp-stat--net' : '') + '" data-stat="' + key + '">' +
      '<span class="scp-stat__label">' + ui.esc(label) + '</span>' +
      '<span class="scp-stat__value">' + ui.esc(value) + '</span>' +
      '<span class="scp-stat__note">' + ui.esc(note) + '</span></div>';
  }

  function renderStrip(sum) {
    var t = sum.totals;
    return '<section class="scp-card" data-test="strip"><div class="scp-card__head"><div><h2>Gross to net capacity</h2></div></div>' +
      '<div class="scp-strip">' +
      stat('gross', 'Gross', calc.fmt1(t.gross), t.days + ' days × ' + t.people + (t.people === 1 ? ' person' : ' people')) +
      stat('holidays', 'Office holidays', '−' + calc.fmt1(t.holidays), holidayNote(sum)) +
      stat('leave', 'Personal leave', '−' + calc.fmt1(t.leave), leaveNote(sum)) +
      stat('ceremonies', 'Ceremonies ' + cfg().ceremonyPct + '%', '−' + calc.fmt1(t.ceremonies), 'of ' + calc.fmt1(t.available) + ' days left') +
      stat('availability', 'Availability', '−' + calc.fmt1(t.availabilityLoss), availabilityNote(sum)) +
      stat('net', 'Net capacity', calc.fmt1(t.net) + ' MD', 'Dev ' + calc.fmt1(t.dev) + ' · BA ' + calc.fmt1(t.ba), true) +
      '</div></section>';
  }

  /* ------------------------------------------------------------------ */
  /* Per-resource table                                                  */
  /* ------------------------------------------------------------------ */

  function renderTable(sum) {
    var t = sum.totals;
    var rows = sum.rows.map(function (c) {
      var r = c.resource;
      return '<tr data-id="' + ui.esc(r.id) + '">' +
        '<th scope="row">' + ui.esc(r.name) + '</th>' +
        '<td>' + roleTag(r.role) + '</td>' +
        '<td>' + ui.esc(locationName(r.location)) + '</td>' +
        '<td class="scp-muted" data-col="leave">' + (c.leaveText ? ui.esc(c.leaveText) : '—') + '</td>' +
        '<td class="num" data-col="days">' + c.days + '</td>' +
        '<td class="num" data-col="holidays">' + minusDays(c.holidays) + '</td>' +
        '<td class="num" data-col="minus-leave">' + minusDays(c.leave) + '</td>' +
        '<td class="num" data-col="after">' + c.afterCeremonies.toFixed(2) + '</td>' +
        '<td class="num" data-col="availability">' + c.availability + '%</td>' +
        '<td class="num scp-strong" data-col="net">' + calc.fmt1(c.net) + '</td>' +
        '<td class="num" data-col="planned">' + loadBadge(c.planned, c.plannedPct) + '</td></tr>';
    }).join('');
    return '<div class="scp-card scp-card--flush"><div class="scp-scroll">' +
      '<table class="scp-table scp-captable" data-test="capacity"><thead><tr>' +
      '<th>Resource</th><th>Role</th><th>Location</th><th>Leave</th>' +
      '<th class="num">Days</th><th class="num">− Holiday</th><th class="num">− Leave</th>' +
      '<th class="num">× ' + (100 - cfg().ceremonyPct) + '%</th><th class="num">Availability</th>' +
      '<th class="num">Net MD</th><th class="num">Planned</th>' +
      '</tr></thead><tbody>' + rows + '</tbody><tfoot><tr data-test="capacity-total">' +
      '<th scope="row" colspan="4">Sprint total</th>' +
      '<td class="num" data-col="days">' + t.gross + '</td>' +
      '<td class="num" data-col="holidays">' + days(t.holidays) + '</td>' +
      '<td class="num" data-col="minus-leave">' + days(t.leave) + '</td>' +
      '<td class="num" data-col="after">' + calc.fmt1(t.afterCeremonies) + '</td>' +
      '<td></td>' +
      '<td class="num" data-col="net">' + calc.fmt1(t.net) + '</td>' +
      '<td class="num" data-col="planned">' +
      (t.plannedPct === null ? '—' : calc.fmt1(t.planned) + ' · ' + Math.round(t.plannedPct) + '%') + '</td>' +
      '</tr></tfoot></table></div></div>';
  }

  /** Dev and BA net capacity with the people behind each (FR-19, per role). */
  function renderRoles(sum) {
    function devShare(role) { return role === 'Dev' ? 1 : role === 'BA' ? 0 : calc.BOTH_DEV_SHARE; }
    function card(role, total, share) {
      var names = sum.rows.filter(function (c) { return share(c.resource.role) > 0; }).map(function (c) {
        return ui.esc(c.resource.name) + ' ' + calc.fmt1(c.net * share(c.resource.role));
      }).join(' · ');
      return '<div class="scp-card scp-rolecard" data-role="' + role + '">' +
        '<div class="scp-rolecard__text"><span class="scp-stat__label">' + role + ' net capacity</span>' +
        '<span class="scp-rolecard__value">' + calc.fmt1(total) + ' MD</span></div>' +
        '<span class="scp-muted" data-names>' + (names || 'nobody') + '</span></div>';
    }
    return '<div class="scp-roles">' +
      card('Dev', sum.totals.dev, devShare) +
      card('BA', sum.totals.ba, function (role) { return 1 - devShare(role); }) + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Tab                                                                 */
  /* ------------------------------------------------------------------ */

  tab.render = function (head, body) {
    var p = plan();
    var lead = '<span class="scp-muted scp-readonly">Calculated · read-only</span>' +
      '<button type="button" class="scp-btn" data-act="edit-resources">Edit resources &amp; leave</button>';
    if (!p) {
      SCP.app.planHead(head, { lead: lead });
      body.innerHTML = '<div class="scp-card scp-empty" data-test="no-plan"><h2>No plan open</h2>' +
        '<p class="scp-muted">Open a plan in 1 · Sprint Tickets first.</p></div>';
    } else {
      if (SCP.tabs.resources && SCP.tabs.resources.sync(p, null)) { SCP.app.markDirty(); }
      var sum = calc.capacitySummary(p, cfg());
      var locs = [];
      sum.rows.forEach(function (c) { if (locs.indexOf(c.resource.location) === -1) { locs.push(c.resource.location); } });
      SCP.app.planHead(head, {
        lead: lead,
        sub: ui.esc(sum.totals.days + ' working days · ceremonies ' + cfg().ceremonyPct + '% · ' +
          sum.totals.people + (sum.totals.people === 1 ? ' resource' : ' resources') + ' in ' +
          locs.length + (locs.length === 1 ? ' location' : ' locations'))
      });
      body.innerHTML = sum.rows.length
        ? renderStrip(sum) + renderTable(sum) + renderRoles(sum)
        : '<div class="scp-card scp-empty" data-test="no-resources"><h2>No resources yet</h2>' +
          '<p class="scp-muted">Add the people on this sprint in 2 · Resources &amp; Leave.</p></div>';
    }
    head.querySelector('[data-act="edit-resources"]').addEventListener('click', function () { SCP.app.setTab('resources'); });
  };
}(window.SCP = window.SCP || {}));
