/*
 * scp-tab-calendar.js — Sprint Capacity Planner · Tab 4 Planning Calendar (US-16 to US-19)
 *
 * One row per resource and one column per working day, plus an After sprint
 * end zone (FR-20). Every ticket gives a Dev card and a BA card, drawn in days
 * at the person's net rate and split around leave and holidays (FR-21, FR-23).
 * The SM drags a card to another person or day, or moves it with the keyboard;
 * a dropped card snaps to the nearest half day and later cards move right
 * (FR-22). A verdict banner says whether the sprint can be finished (FR-24),
 * and the overload detail lists the tickets behind an overload (US-19).
 *
 * All placement and verdict rules live in SCP.calc (planCalendar); this file
 * only draws them and records moves in plan.cards ({ key, role, person, start }).
 * Moves live only in the plan: nothing is written to Jira.
 */
(function (SCP) {
  'use strict';

  SCP.tabs = SCP.tabs || {};
  var tab = SCP.tabs.calendar = {};
  var ui = SCP.ui = SCP.ui || {};
  var calc = SCP.calc;

  var UNIT = 10;            // grid columns per day: cards are drawn to 0.1 day
  var DRAG_PX = 4;          // pointer travel before a press becomes a drag

  var view = {
    selected: null,         // ticket key whose cards are highlighted (click a card to see its twin)
    without: null,          // ticket key picked in the overload detail (US-19 AC-2)
    drag: null              // pointer drag in progress
  };

  function cfg() { return SCP.state.config; }
  function plan() { return SCP.state.plan; }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  var ROLE_TAG = { dev: 'DEV', ba: 'BA' };

  function locationName(id) {
    var l = (cfg().locations || []).filter(function (x) { return x.id === id; })[0];
    return l ? l.name : '';
  }

  function resourceOf(id) {
    return (plan().resources || []).filter(function (r) { return r.id === id; })[0] || null;
  }

  function personName(t, role, id) {
    var r = resourceOf(id);
    if (r) { return r.name; }
    var p = (t[role] || []).filter(function (x) { return x.id === id; })[0];
    return p ? p.name : id;
  }

  function initials(name) {
    return String(name || '?').replace(/[^A-Za-zÀ-ɏ]/g, '').slice(0, 2).toUpperCase() || '?';
  }

  function dayName(iso) {
    return calc.WEEKDAY_SHORT[new Date(calc.isoToMs(iso)).getUTCDay()];
  }

  function dayNum(iso) {
    return new Date(calc.isoToMs(iso)).getUTCDate();
  }

  /** "Wed 27" for a row header, "Wed 27 Jan" in the banner. */
  function shortDay(iso) { return dayName(iso) + ' ' + dayNum(iso); }

  function pct(n) { return isFinite(n) ? Math.round(n) + '%' : '—'; }

  /** Grid placement of an interval [s, e) in days. */
  function cols(s, e) {
    var a = Math.round(s * UNIT) + 1;
    var b = Math.max(a + 1, Math.round(e * UNIT) + 1);
    return 'grid-column:' + a + ' / ' + b;
  }

  function loadBadge(row) {
    var cls = row.net > 0 ? calc.loadClass(row.pct, cfg().thresholds) : (row.load > 0 ? 'over' : 'ok');
    return '<span class="scp-badge scp-badge--' + cls + '" data-test="row-load" data-load="' + cls + '">' +
      calc.fmt1(row.load) + ' / ' + calc.fmt1(row.net) + '</span>';
  }

  function flagText(flagged) {
    if (!flagged.length) { return ''; }
    var kinds = [];
    var names = { noSp: 'no SP', outside: 'SP outside bands', noDev: 'no Dev', noBa: 'no BA' };
    flagged.forEach(function (f) {
      // A ticket with no SP is also missing people: name the first reason only.
      var k = f.flags[0];
      if (kinds.indexOf(names[k]) === -1) { kinds.push(names[k]); }
    });
    return flagged.length + (flagged.length === 1 ? ' ticket' : ' tickets') + ' flagged in Tab 1 (' + kinds.join(', ') + ')';
  }

  /* ------------------------------------------------------------------ */
  /* Verdict banner and progress (FR-24, US-18)                          */
  /* ------------------------------------------------------------------ */

  function verdictText(cal) {
    var v = cal.verdict;
    var parts = [];
    var title;
    if (v.status === 'notFeasible') {
      var g = v.gaps[0];
      var role = g.role === 'dev' ? 'Dev' : 'BA';
      title = 'Not feasible — ' + role + ' overloaded by ' + calc.fmt1(g.gap) + ' MD';
      var people = cal.rows.filter(function (r) {
        return r.load > r.net + 1e-9 && r.cards.some(function (k) { return k.role === g.role; });
      }).map(function (r) { return r.resource.name + ' +' + calc.fmt1(r.load - r.net); });
      var un = cal.unassigned.filter(function (k) { return k.role === g.role; }).reduce(function (s, k) { return s + k.md; }, 0);
      if (people.length) { parts.push(people.join(', ')); }
      if (un > 0) { parts.push(calc.fmt1(un) + ' MD ' + role + ' unassigned'); }
      if (v.gaps[1]) {
        parts.push((v.gaps[1].role === 'dev' ? 'Dev' : 'BA') + ' also over by ' + calc.fmt1(v.gaps[1].gap) + ' MD');
      }
    } else if (v.status === 'atRisk') {
      if (v.over.length) {
        title = 'At risk — role totals fit, ' + (v.over.length === 1 ? 'one person is' : v.over.length + ' people are') + ' overloaded';
        v.over.forEach(function (r) {
          var t = r.resource.name + ' planned at ' + pct(r.pct) + ' (+' + calc.fmt1(r.load - r.net) + ' MD)';
          var past = r.doneIndex + 1 - cal.W;
          if (past > 0) {
            t += ', finishing ' + past + (past === 1 ? ' day' : ' days') + ' after sprint end (done ' + calc.fmtDay(cal.dates[r.doneIndex]) + ')';
          }
          parts.push(t);
        });
        var roleOf = v.over[0].resource.role;
        var free = cal.rows.filter(function (r) { return r.resource.role === roleOf && r.net - r.load > 0.05; })
          .sort(function (a, b) { return (b.net - b.load) - (a.net - a.load); })[0];
        if (free) { parts.push(free.resource.name + ' has ' + calc.fmt1(free.net - free.load) + ' MD free'); }
      } else {
        title = 'At risk — a card sits where its person has no time';
        parts.push(v.onAbsence.map(function (r) { return r.resource.name; }).join(', ') + ': no working time left in the sprint');
      }
    } else {
      title = 'Feasible — every role and every person fits';
      var last = cal.rows.filter(function (r) { return r.doneIndex !== null; })
        .sort(function (a, b) { return b.doneIndex - a.doneIndex; })[0];
      if (last) { parts.push('All planned work done by ' + calc.fmtDay(cal.dates[last.doneIndex])); }
    }
    var flags = flagText(cal.flagged);
    if (flags) { parts.push(flags); }
    return { title: title, detail: parts.join(' · ') };
  }

  function renderBanner(cal) {
    var v = cal.verdict;
    var t = verdictText(cal);
    var cls = v.status === 'feasible' ? 'ok' : v.status === 'atRisk' ? 'warn' : 'bad';
    var icon = v.status === 'feasible'
      ? '<path d="M20 6 9 17l-5-5"></path>'
      : '<path d="M12 9v4"></path><path d="M12 17h.01"></path><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"></path>';
    function fig(label, role) {
      return '<div class="scp-verdict__fig"><span>' + label + ' load / net</span><b data-test="' + role + '-fit">' +
        calc.fmt1(cal.roles[role].load) + ' / ' + calc.fmt1(cal.roles[role].net) + ' MD</b></div>';
    }
    return '<div class="scp-verdict scp-verdict--' + cls + '" role="status" data-test="verdict" data-status="' + v.status + '">' +
      '<div class="scp-verdict__main"><div class="scp-verdict__icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">' + icon + '</svg></div>' +
      '<div><div class="scp-verdict__title" data-test="verdict-title">' + ui.esc(t.title) + '</div>' +
      '<div class="scp-verdict__detail" data-test="verdict-detail">' + ui.esc(t.detail) + '</div></div></div>' +
      '<div class="scp-verdict__figs">' + fig('Dev', 'dev') + fig('BA', 'ba') + '</div></div>';
  }

  function renderProgress(cal) {
    var net = cal.capacity.totals.net;
    var w = function (md) { return net > 0 ? Math.min(100, md / net * 100) : 0; };
    return '<div class="scp-card scp-progress" data-test="progress"><div class="scp-progress__bar-wrap">' +
      '<div class="scp-progress__text"><span><b>Planned ' + calc.fmt1(cal.planned) + ' MD</b> <span class="scp-muted">· Target (net capacity) ' +
      calc.fmt1(net) + ' MD</span></span><span class="scp-muted">' + (net > 0 ? pct(cal.planned / net * 100) + ' of net capacity' : '') + '</span></div>' +
      '<div class="scp-progress__bar"><div class="scp-progress__dev" style="width:' + w(cal.roles.dev.load).toFixed(1) + '%"></div>' +
      '<div class="scp-progress__ba" style="width:' + w(cal.roles.ba.load).toFixed(1) + '%"></div></div></div>' +
      '<div class="scp-legend scp-legend--cal"><span><i class="scp-sw scp-sw--dev"></i>Dev card</span><span><i class="scp-sw scp-sw--ba"></i>BA card</span>' +
      '<span><i class="scp-sw scp-sw--leave"></i>Leave</span><span><i class="scp-sw scp-sw--hol"></i>Office holiday</span>' +
      '<span>Card width = exact days at the person’s net rate; only each row’s finish is rounded to ½ day · click a card to see its twin · drag, or use the arrow keys, to move it</span></div></div>';
  }

  /* ------------------------------------------------------------------ */
  /* Calendar grid (FR-20, FR-21, FR-23)                                 */
  /* ------------------------------------------------------------------ */

  function renderHeader(cal) {
    var n = cal.dates.length;
    // Week groups over the sprint days (Monday-based), then the After sprint end zone.
    var weeks = [];
    cal.dates.slice(0, cal.W).forEach(function (d, i) {
      var monday = calc.addDays(d, -((new Date(calc.isoToMs(d)).getUTCDay() + 6) % 7));
      var last = weeks[weeks.length - 1];
      if (last && last.monday === monday) { last.to = d; last.count++; } else { weeks.push({ monday: monday, from: d, to: d, count: 1, first: i }); }
    });
    var weekCells = weeks.map(function (w, i) {
      return '<div class="scp-cal__week" style="grid-column: span ' + w.count + '">Week ' + (i + 1) + ' · ' + calc.fmtShortRange(w.from, w.to) + '</div>';
    }).join('') + '<div class="scp-cal__week scp-cal__week--after" style="grid-column: span ' + (n - cal.W) + '">After sprint end</div>';
    var dayCells = cal.dates.map(function (d, i) {
      return '<div class="scp-cal__day' + (i >= cal.W ? ' is-after' : '') + '"><span>' + dayName(d) + '</span><b>' + dayNum(d) + '</b></div>';
    }).join('');

    var today = calc.msToIso(Date.now() - new Date().getTimezoneOffset() * 60000);
    var ti = cal.dates.indexOf(today);
    var todayText = today < plan().sprint.start ? 'before sprint' : (ti >= 0 && ti < cal.W ? 'day ' + (ti + 1) + ' of ' + cal.W : 'after sprint');
    var todayLabel = new Date(calc.isoToMs(today)).getUTCDate() + ' ' + calc.MONTH_SHORT[new Date(calc.isoToMs(today)).getUTCMonth()];

    return '<div class="scp-cal__row scp-cal__head">' +
      '<div class="scp-cal__name scp-cal__name--head"><b>Resource</b><span>load / net capacity</span></div>' +
      '<div class="scp-cal__days"><div class="scp-cal__weeks" style="grid-template-columns:repeat(' + n + ',minmax(0,1fr))">' + weekCells + '</div>' +
      '<div class="scp-cal__daygrid" style="grid-template-columns:repeat(' + n + ',minmax(0,1fr))">' + dayCells + '</div></div></div>' +
      '<div class="scp-cal__row scp-cal__marks">' +
      '<div class="scp-cal__name scp-cal__name--marks" data-test="today">Today ' + todayLabel + ' · ' + todayText + '</div>' +
      '<div class="scp-cal__markgrid" style="grid-template-columns:repeat(' + n + ',minmax(0,1fr))">' +
      '<span class="scp-chip-dark" style="grid-column:1 / span ' + Math.min(6, cal.W) + '">▸ Sprint start · ' + calc.fmtDay(cal.dates[0]).replace(/^\w+ /, '') + '</span>' +
      '<span class="scp-chip-dark scp-chip-dark--end" style="grid-column:' + Math.max(1, cal.W - 5) + ' / span ' + Math.min(6, cal.W) + '">Sprint end · ' +
      calc.fmtDay(cal.dates[cal.W - 1]).replace(/^\w+ /, '') + ' ◂</span></div></div>';
  }

  function cardHtml(k, part, i, total) {
    var t = k.ticket;
    var cls = 'scp-ccard scp-ccard--' + k.role + (view.selected === k.key ? ' is-selected' : '') + (k.onAbsence ? ' is-onabsence' : '');
    var label = k.role === 'none'
      ? (k.flags.indexOf('outside') !== -1 ? 'SP outside bands' : 'No SP') + ' · 0 MD'
      : ROLE_TAG[k.role] + ' · ' + calc.fmt1(total > 1 ? part.shownMd : k.md) + (total > 1 ? ' · ' + (i + 1) + '/' + total : '');
    var focus = 'card-' + k.id + (i ? '-' + i : '');
    var aria = k.key + ' ' + (ROLE_TAG[k.role] || 'no MD') + ' card, ' + calc.fmt1(k.md) + ' MD' + (total > 1 ? ', part ' + (i + 1) + ' of ' + total : '') +
      (k.role === 'none' ? '' : '. Arrow keys move it: left and right by half a day, up and down to another person');
    return '<button type="button" class="' + cls + '" style="' + cols(part.s, part.e) + '" data-card="' + ui.esc(k.id) + '" data-key="' + ui.esc(k.key) +
      '" data-role="' + k.role + '" data-part="' + i + '" data-focus="' + ui.esc(focus) + '"' + (k.role === 'none' ? ' data-fixed="1"' : '') +
      ' aria-label="' + ui.esc(aria) + '" title="' + ui.esc(t.key + ' · ' + (t.summary || '')) + '">' +
      '<span class="scp-ccard__key">' + ui.esc(k.key) + '</span><span class="scp-ccard__sub">' + ui.esc(label) + '</span></button>';
  }

  function laneHtml(cal, lane, cards, absences, extraCls) {
    var n = cal.dates.length;
    var shades = (absences || []).map(function (a) {
      return '<div class="scp-shade scp-shade--' + a.kind + (a.half ? ' scp-shade--half' : '') + '" style="' + cols(a.s, a.e) + '">' + ui.esc(a.label) + '</div>';
    }).join('') + '<div class="scp-shade scp-shade--after" style="' + cols(cal.W, n) + '"></div>';
    var html = cards.map(function (k) {
      return k.parts.map(function (p, i) { return cardHtml(k, p, i, k.parts.length); }).join('');
    }).join('');
    return '<div class="scp-lane' + (extraCls || '') + '" data-lane="' + ui.esc(lane) + '" style="grid-template-columns:repeat(' + (n * UNIT) + ',minmax(0,1fr))">' +
      shades + html + '</div>';
  }

  function renderRows(cal) {
    var rows = cal.rows.map(function (r) {
      var res = r.resource;
      var info = res.role + ' · ' + locationName(res.location);
      var pace = (r.rate === null ? '—' : r.rate.toFixed(2)) + ' MD/day' + (r.doneIndex !== null ? ' · done ' + shortDay(cal.dates[r.doneIndex]) : '');
      return '<div class="scp-cal__row" data-row="' + ui.esc(res.id) + '">' +
        '<div class="scp-cal__name"><span class="scp-avatar scp-avatar--' + (res.role === 'BA' ? 'ba' : 'dev') + '">' + ui.esc(initials(res.name)) + '</span>' +
        '<span class="scp-cal__who"><span class="scp-cal__top"><b>' + ui.esc(res.name) + '</b>' + loadBadge(r) + '</span>' +
        '<span data-test="row-info">' + ui.esc(info) + '</span><span data-test="row-pace">' + ui.esc(pace) + '</span></span></div>' +
        laneHtml(cal, res.id, r.cards, r.absences, r.net > 0 ? '' : ' is-empty') + '</div>';
    }).join('');
    var un = cal.unassigned;
    var unMd = un.reduce(function (s, k) { return s + k.md; }, 0);
    rows += '<div class="scp-cal__row scp-cal__row--un" data-row="">' +
      '<div class="scp-cal__name"><span class="scp-avatar">?</span><span class="scp-cal__who"><b>Unassigned</b><span data-test="row-info">' +
      un.length + (un.length === 1 ? ' card' : ' cards') + ' · ' + calc.fmt1(unMd) + ' MD</span></span></div>' +
      laneHtml(cal, '', un, [], ' scp-lane--un') + '</div>';
    return '<div class="scp-card scp-card--flush"><div class="scp-scroll"><div class="scp-cal" data-test="calendar">' +
      renderHeader(cal) + rows + '</div></div></div>';
  }

  /* ------------------------------------------------------------------ */
  /* Selected ticket and overload detail (US-19)                         */
  /* ------------------------------------------------------------------ */

  function renderSelected(cal) {
    var body;
    var key = view.selected;
    var t = key ? (plan().tickets || []).filter(function (x) { return x.key === key; })[0] : null;
    if (!t) {
      body = '<div class="scp-muted">Click a card to see its ticket and its twin.</div>';
    } else {
      var m = calc.ticketMd(t, cfg());
      var all = [];
      cal.rows.forEach(function (r) { r.cards.forEach(function (k) { if (k.key === key) { all.push({ k: k, row: r }); } }); });
      cal.unassigned.forEach(function (k) { if (k.key === key) { all.push({ k: k, row: null }); } });
      var halves = ['dev', 'ba'].map(function (role) {
        var x = all.filter(function (a) { return a.k.role === role; })[0];
        if (!x) { return null; }
        var who = x.row ? x.row.resource.name : 'unassigned';
        var note = '';
        if (x.k.parts.length > 1) {
          var gap = x.row.absences.filter(function (a) { return a.s >= x.k.parts[0].e - 1e-9 && a.e <= x.k.parts[x.k.parts.length - 1].s + 1e-9; });
          note = ', split around ' + (gap.some(function (a) { return a.kind === 'hol'; }) ? 'a holiday' : 'leave');
        }
        if (x.k.moved) { note += ', moved in calendar'; }
        return (role === 'dev' ? 'Dev ' : 'BA ') + calc.fmt1(x.k.md) + ' ' + who + note;
      }).filter(Boolean);
      var md = m.total ? calc.fmt1(m.total) + ' MD (' + halves.join(' · ') + ')' : '0 MD (' + (m.flags[0] === 'outside' ? 'SP outside bands' : 'no Story Points') + ')';
      body = '<div class="scp-calpanel__key">' + ui.esc(t.key) + '</div><div class="scp-muted" data-test="selected-detail">' +
        ui.esc((t.summary ? t.summary + ' · ' : '') + (t.type ? t.type + ' · ' : '') + (t.sp === null ? 'no SP' : t.sp + ' SP') + ' → ' + md) + '</div>';
    }
    return '<div class="scp-card scp-calpanel" data-test="selected"><div class="scp-calpanel__label">Selected ticket</div>' + body + '</div>';
  }

  var STATUS_NAME = { feasible: 'Feasible', atRisk: 'At risk', notFeasible: 'Not feasible' };

  function renderOverload(cal) {
    var groups = calc.overloadDetail(cal);
    var body;
    if (!groups.length) {
      body = '<div class="scp-muted">No overload: every person and every role fits.</div>';
    } else {
      body = groups.map(function (g) {
        var head = g.kind === 'person'
          ? g.name + ' · ' + calc.fmt1(g.load) + ' / ' + calc.fmt1(g.net) + ' MD (' + pct(g.pct) + ')'
          : g.name + ' role · ' + calc.fmt1(g.load) + ' / ' + calc.fmt1(g.net) + ' MD (+' + calc.fmt1(g.gap) + ')';
        var items = g.cards.map(function (k) {
          var where = k.who === 'Unassigned' ? 'unassigned' : (k.s >= cal.W - 1e-9 ? 'after sprint end' : 'runs past sprint end');
          var on = view.without === k.key;
          return '<li><button type="button" class="scp-link' + (on ? ' is-on' : '') + '" data-act="without" data-key="' + ui.esc(k.key) + '" aria-pressed="' + on + '">' +
            '<b>' + ui.esc(k.key) + ' · ' + ROLE_TAG[k.role] + ' ' + calc.fmt1(k.md) + ' MD</b></button> ' +
            '<span class="scp-muted">' + (k.who && g.kind === 'role' ? ui.esc(k.who) + ' · ' : '') + where + '</span></li>';
        }).join('');
        return '<div class="scp-overload__group" data-group="' + ui.esc(g.id) + '"><div class="scp-overload__head">' + ui.esc(head) + '</div>' +
          (items ? '<ol class="scp-overload__list">' + items + '</ol>' : '<div class="scp-muted">No single card runs past the sprint end.</div>') + '</div>';
      }).join('');
      if (view.without) {
        var w = calc.planWithout(plan(), cfg(), view.without);
        var bits = groups.filter(function (g) { return g.kind === 'person'; }).map(function (g) {
          var r = w.rows.filter(function (x) { return x.resource.id === g.id; })[0];
          return r ? r.resource.name + ' ' + calc.fmt1(r.load) + ' / ' + calc.fmt1(r.net) + ' MD (' + pct(r.pct) + ')' : '';
        }).filter(Boolean);
        groups.filter(function (g) { return g.kind === 'role'; }).forEach(function (g) {
          bits.push(g.name + ' ' + calc.fmt1(w.roles[g.id].load) + ' / ' + calc.fmt1(w.roles[g.id].net) + ' MD');
        });
        body += '<div class="scp-overload__effect" data-test="without">Without ' + ui.esc(view.without) + ': ' + ui.esc(bits.join(' · ')) +
          ' · verdict <b>' + STATUS_NAME[w.verdict.status] + '</b></div>';
      }
    }
    return '<div class="scp-card scp-calpanel" data-test="overload"><div class="scp-calpanel__label">Overload detail</div>' + body + '</div>';
  }

  /* ------------------------------------------------------------------ */
  /* Moves (FR-22, US-17)                                                */
  /* ------------------------------------------------------------------ */

  function findCard(cal, id) {
    var hit = null;
    cal.rows.forEach(function (r) { r.cards.forEach(function (k) { if (k.id === id) { hit = { k: k, row: r }; } }); });
    cal.unassigned.forEach(function (k) { if (k.id === id) { hit = { k: k, row: null }; } });
    return hit;
  }

  /**
   * Move a card to a person (or Unassigned with null) starting at `start` days.
   * A Dev card dropped on a BA-only resource asks first (US-17 AC-4).
   * Returns true when the move was made.
   */
  tab.move = function (id, person, start) {
    var p = plan();
    var cal = calc.planCalendar(p, cfg());
    var hit = findCard(cal, id);
    if (!hit || hit.k.role === 'none') { return false; }
    var k = hit.k;
    var target = person ? resourceOf(person) : null;
    if (person && !target) { return false; }
    if (target && k.role === 'dev' && target.role === 'BA') {
      if (!window.confirm(k.key + ' is a Dev card and ' + target.name + ' is BA only. Move it to ' + target.name + ' anyway?')) { return false; }
    }
    if (!Array.isArray(p.cards)) { p.cards = []; }
    p.cards = p.cards.filter(function (c) { return !(c.key === k.key && c.role === k.role); });
    p.cards.push({ key: k.key, role: k.role, person: person || null, start: person ? calc.snapHalf(start) : null });
    view.without = null;
    SCP.app.markDirty();
    SCP.app.render();
    return true;
  };

  /** Arrow keys on a card: left / right by half a day, up / down to the next row (US-17 AC-5). */
  function keyMove(btn, key) {
    var cal = calc.planCalendar(plan(), cfg());
    var hit = findCard(cal, btn.getAttribute('data-card'));
    if (!hit) { return; }
    var lanes = cal.rows.map(function (r) { return r.resource.id; }).concat(['']);
    var here = hit.row ? hit.row.resource.id : '';
    var start = hit.k.s;
    if (key === 'ArrowLeft' || key === 'ArrowRight') {
      if (!hit.row) { return; }                                   // the Unassigned lane has no days
      start = calc.snapHalf(start) + (key === 'ArrowRight' ? 0.5 : -0.5);
      if (start < 0) { return; }
      tab.move(hit.k.id, here, start);
      return;
    }
    var i = lanes.indexOf(here) + (key === 'ArrowDown' ? 1 : -1);
    if (i < 0 || i >= lanes.length) { return; }
    tab.move(hit.k.id, lanes[i] || null, start);
  }

  /** Lane and day under a viewport point, or null. */
  function laneAt(root, x, y) {
    var lanes = root.querySelectorAll('.scp-lane');
    for (var i = 0; i < lanes.length; i++) {
      var r = lanes[i].getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        var days = SCP.calc.planCalendar(plan(), cfg()).dates.length;
        return { lane: lanes[i], person: lanes[i].getAttribute('data-lane'), day: (x - r.left) / r.width * days, width: r.width / days };
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* Calendar after Reload (US-11 AC-3)                                  */
  /* ------------------------------------------------------------------ */

  /**
   * When the sprint end moves earlier, a card that would now start after the
   * new end goes to Unassigned. Called by Tab 1 after Reload.
   */
  tab.afterReload = function (p, oldSprint) {
    if (!p || !oldSprint || !(p.sprint.end < oldSprint.end)) { return; }
    var cal = calc.planCalendar(p, cfg());
    if (!Array.isArray(p.cards)) { p.cards = []; }
    cal.rows.forEach(function (r) {
      r.cards.forEach(function (k) {
        if (k.s < cal.W - 1e-9) { return; }
        p.cards = p.cards.filter(function (c) { return !(c.key === k.key && c.role === k.role); });
        p.cards.push({ key: k.key, role: k.role, person: null, start: null });
      });
    });
  };

  /** Who a card was moved to in the calendar, for Tab 1 (US-10 AC-4); null when not moved. */
  tab.movedTo = function (key, role) {
    var p = plan();
    if (!p || !Array.isArray(p.cards)) { return null; }
    var mv = p.cards.filter(function (c) { return c.key === key && c.role === role; })[0];
    var t = (p.tickets || []).filter(function (x) { return x.key === key; })[0];
    if (!mv || !t) { return null; }
    var m = calc.ticketMd(t, cfg());
    var pick = role === 'dev' ? m.devPerson : m.baPerson;
    if (mv.person === pick) { return null; }
    return mv.person ? personName(t, role, mv.person) : 'Unassigned';
  };

  /* ------------------------------------------------------------------ */
  /* Tab                                                                 */
  /* ------------------------------------------------------------------ */

  function bind(body) {
    var root = body.querySelector('[data-test="calendar"]');
    body.querySelectorAll('[data-act="without"]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-key');
        view.without = view.without === k ? null : k;
        SCP.app.render();
      });
    });
    if (!root) { return; }
    root.querySelectorAll('.scp-ccard').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if (btn.getAttribute('data-dragged')) { btn.removeAttribute('data-dragged'); e.preventDefault(); return; }
        var k = btn.getAttribute('data-key');
        view.selected = view.selected === k ? null : k;
        SCP.app.render();
      });
      btn.addEventListener('keydown', function (e) {
        if (btn.getAttribute('data-fixed')) { return; }
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(e.key) === -1) { return; }
        e.preventDefault();
        keyMove(btn, e.key);
      });
      if (btn.getAttribute('data-fixed')) { return; }
      btn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) { return; }
        var at = laneAt(root, e.clientX, e.clientY);
        // Days between the card's start and the pointer, so the card's start lands where it is dropped.
        var hit = findCard(calc.planCalendar(plan(), cfg()), btn.getAttribute('data-card'));
        var grab = at && hit ? Math.max(0, at.day - hit.k.s) : 0;
        view.drag = { id: btn.getAttribute('data-card'), x: e.clientX, y: e.clientY, grab: grab, moving: false, btn: btn };
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* not supported */ }
      });
      btn.addEventListener('pointermove', function (e) {
        var d = view.drag;
        if (!d || d.btn !== btn) { return; }
        if (!d.moving && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < DRAG_PX) { return; }
        d.moving = true;
        btn.classList.add('is-dragging');
        root.querySelectorAll('.scp-lane.is-drop').forEach(function (l) { l.classList.remove('is-drop'); });
        var at = laneAt(root, e.clientX, e.clientY);
        var ghost = root.querySelector('.scp-dropmark');
        if (ghost) { ghost.remove(); }
        if (at) {
          at.lane.classList.add('is-drop');
          if (at.person) {
            var s = calc.snapHalf(at.day - d.grab);
            at.lane.insertAdjacentHTML('beforeend', '<div class="scp-dropmark" style="' + cols(s, s + 0.1) + '"></div>');
          }
        }
      });
      btn.addEventListener('pointerup', function (e) {
        var d = view.drag;
        view.drag = null;
        if (!d || d.btn !== btn || !d.moving) { return; }
        btn.setAttribute('data-dragged', '1');                     // the click that follows is not a selection
        btn.classList.remove('is-dragging');
        var at = laneAt(root, e.clientX, e.clientY);
        if (!at) { SCP.app.render(); return; }
        if (!tab.move(d.id, at.person || null, at.day - d.grab)) { SCP.app.render(); }
      });
      btn.addEventListener('pointercancel', function () { view.drag = null; SCP.app.render(); });
    });
  }

  tab.render = function (head, body) {
    var p = plan();
    var loaded = p && p.loadedAt ? '<span class="scp-muted scp-readonly">Loaded from Jira ' + ui.esc(ui.fmtWhen(p.loadedAt)) + '</span>' : '';
    var reload = '<button type="button" class="scp-btn" data-act="cal-reload"' + (p && SCP.app.connected() ? '' : ' disabled') + '>Reload from Jira</button>';
    if (!p) {
      SCP.app.planHead(head, {});
      body.innerHTML = '<div class="scp-card scp-empty" data-test="no-plan"><h2>No plan open</h2>' +
        '<p class="scp-muted">Open a plan in 1 · Sprint Tickets first.</p></div>';
      return;
    }
    if (SCP.tabs.resources && SCP.tabs.resources.sync(p, null)) { SCP.app.markDirty(); }
    var cal = calc.planCalendar(p, cfg());
    SCP.app.planHead(head, {
      lead: loaded + reload,
      sub: ui.esc(calc.fmtRange(p.sprint.start, p.sprint.end) + ' · ' + cal.W + ' working days' + (p.sprint.goal ? ' · Goal: ' + p.sprint.goal : ''))
    });
    head.querySelector('[data-act="cal-reload"]').addEventListener('click', function () {
      if (SCP.tabs.tickets && SCP.tabs.tickets.reload) { SCP.tabs.tickets.reload(); }
    });
    if (view.selected && !(p.tickets || []).some(function (t) { return t.key === view.selected; })) { view.selected = null; }
    if (view.without && !(p.tickets || []).some(function (t) { return t.key === view.without; })) { view.without = null; }
    body.innerHTML = renderBanner(cal) + renderProgress(cal) + renderRows(cal) +
      '<div class="scp-calpanels">' + renderSelected(cal) + renderOverload(cal) + '</div>';
    bind(body);
  };
}(window.SCP = window.SCP || {}));
