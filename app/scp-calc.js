/*
 * scp-calc.js — Sprint Capacity Planner · Calculation Rules (PRD v0.5)
 *
 * Holds ONLY the formulas of the PRD "Calculation Rules" section:
 * SP -> MD bands, BA/Dev split, working days, office holidays, thresholds,
 * capacity, card length in days and the sprint verdict.
 * No DOM and no network code, so it runs in the browser (window.SCP.calc)
 * and in Node for the automated tests (tests/test-calc.js).
 *
 * Dates are ISO strings "YYYY-MM-DD" and are handled in UTC, so a date never
 * shifts with the viewer's time zone.
 */
(function (root) {
  'use strict';

  var SCP = root.SCP = root.SCP || {};
  var calc = SCP.calc = {};

  /* ------------------------------------------------------------------ */
  /* Numbers                                                             */
  /* ------------------------------------------------------------------ */

  /** Round to 0.1 (half away from zero), tolerant of float noise such as 11.474999. */
  calc.round1 = function (x) {
    var sign = x < 0 ? -1 : 1;
    return sign * Math.round(Math.abs(x) * 10 + 1e-7) / 10;
  };

  /** Format with exactly one decimal, as every MD figure in the PRD is shown. */
  calc.fmt1 = function (x) {
    return calc.round1(x).toFixed(1);
  };

  /* ------------------------------------------------------------------ */
  /* FR-5 · Story Points -> Man-Day bands                                */
  /* ------------------------------------------------------------------ */

  /** Default bands from the PRD table (lower bound exclusive, upper inclusive). */
  calc.DEFAULT_BANDS = [
    { sp: 1, lower: 0, upper: 1 },
    { sp: 2, lower: 1, upper: 3 },
    { sp: 3, lower: 3, upper: 5 },
    { sp: 5, lower: 5, upper: 8 },
    { sp: 8, lower: 8, upper: 12 },
    { sp: 13, lower: 12, upper: 15 },
    { sp: 21, lower: 15, upper: 20 },
    { sp: 34, lower: 20, upper: 40 },
    { sp: 55, lower: 40, upper: 60 },
    { sp: 89, lower: 60, upper: 80 },
    { sp: 144, lower: 80, upper: 100 }
  ];

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /**
   * Check that bands ascend and do not overlap (FR-5, US-04 AC-2).
   * Returns { ok, rows: [message|null per row], message }.
   */
  calc.validateBands = function (bands) {
    var rows = [];
    var ok = true;
    if (!bands || !bands.length) {
      return { ok: false, rows: [], message: 'Add at least one band' };
    }
    bands.forEach(function (b, i) {
      var err = null;
      var prev = bands[i - 1];
      if (!isNum(b.sp) || b.sp <= 0 || !isNum(b.lower) || !isNum(b.upper)) {
        err = 'Fill SP, lower and upper bound';
      } else if (b.lower < 0 || b.upper <= b.lower) {
        err = 'Upper bound must be above lower bound';
      } else if (prev && isNum(prev.sp) && b.sp <= prev.sp) {
        err = 'SP must ascend';
      } else if (prev && isNum(prev.upper) && b.lower < prev.upper) {
        err = 'Overlaps the band above';
      }
      if (err) { ok = false; }
      rows.push(err);
    });
    var msg = ok
      ? 'Bands ascend, don\'t overlap, cover ' + bands[0].sp + '–' + bands[bands.length - 1].sp
      : rows.filter(Boolean).length + ' band row(s) need fixing';
    return { ok: ok, rows: rows, message: msg };
  };

  /**
   * Convert Story Points to Total MD (FR-5, FR-13).
   * The band's upper bound is always used. No SP, or SP with no band, is 0 MD and flagged.
   * Returns { md, flag } where flag is null, 'noSp' or 'outside'.
   */
  calc.spToMd = function (sp, bands) {
    if (sp === null || sp === undefined || sp === '' || !isFinite(Number(sp))) {
      return { md: 0, flag: 'noSp' };
    }
    var n = Number(sp);
    for (var i = 0; i < bands.length; i++) {
      if (bands[i].sp === n) { return { md: bands[i].upper, flag: null }; }
    }
    return { md: 0, flag: 'outside' };
  };

  /* ------------------------------------------------------------------ */
  /* FR-6 · BA / Dev split                                               */
  /* ------------------------------------------------------------------ */

  /** BA MD = Total x BA%, Dev MD = Total - BA MD, both to 0.1 MD. */
  calc.splitMd = function (totalMd, split) {
    var ba = calc.round1(totalMd * split.ba / 100);
    var dev = calc.round1(totalMd - ba);
    return { ba: ba, dev: dev };
  };

  /** Save is blocked unless BA% + Dev% = 100 (FR-6, US-04 AC-3). */
  calc.validateSplit = function (split) {
    var ba = Number(split.ba);
    var dev = Number(split.dev);
    var sum = ba + dev;
    var ok = isNum(ba) && isNum(dev) && ba >= 0 && dev >= 0 && sum === 100;
    return { ok: ok, sum: sum, message: ok ? 'Sum 100%' : 'Sum ' + (isNaN(sum) ? '?' : sum) + '%' };
  };

  /* ------------------------------------------------------------------ */
  /* Dates · FR-7 working week, FR-14 working days                      */
  /* ------------------------------------------------------------------ */

  var DAY_MS = 86400000;
  calc.WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  calc.MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** Default working week Mon-Fri (0 = Sunday ... 6 = Saturday). */
  calc.DEFAULT_WEEK = [1, 2, 3, 4, 5];

  calc.isoToMs = function (iso) {
    var p = iso.split('-');
    return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  };

  calc.msToIso = function (ms) {
    return new Date(ms).toISOString().slice(0, 10);
  };

  calc.addDays = function (iso, n) {
    return calc.msToIso(calc.isoToMs(iso) + n * DAY_MS);
  };

  calc.weekday = function (iso) {
    return new Date(calc.isoToMs(iso)).getUTCDay();
  };

  /** "Thu 14 Jan" */
  calc.fmtDay = function (iso) {
    var d = new Date(calc.isoToMs(iso));
    return calc.WEEKDAY_SHORT[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + calc.MONTH_SHORT[d.getUTCMonth()];
  };

  /**
   * Date part of a Jira sprint date. Jira Data Center returns the server's
   * offset ("2027-01-04T09:00:00.000+01:00"): its date part is the sprint day.
   * A UTC "Z" value is converted to the viewer's local date.
   */
  calc.jiraDate = function (s) {
    if (!s) { return null; }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { return s; }
    if (/[+-]\d{2}:?\d{2}$/.test(s)) { return s.slice(0, 10); }
    var d = new Date(s);
    var mm = String(d.getMonth() + 1);
    var dd = String(d.getDate());
    return d.getFullYear() + '-' + (mm.length < 2 ? '0' + mm : mm) + '-' + (dd.length < 2 ? '0' + dd : dd);
  };

  calc.isWorkingDay = function (iso, week) {
    return week.indexOf(calc.weekday(iso)) !== -1;
  };

  /** Working days from start to end inclusive (FR-14). */
  calc.workingDays = function (startIso, endIso, week) {
    var out = [];
    if (!startIso || !endIso) { return out; }
    for (var ms = calc.isoToMs(startIso), end = calc.isoToMs(endIso); ms <= end; ms += DAY_MS) {
      var iso = calc.msToIso(ms);
      if (calc.isWorkingDay(iso, week)) { out.push(iso); }
    }
    return out;
  };

  /* ------------------------------------------------------------------ */
  /* FR-27 · Location holiday calendars                                  */
  /* ------------------------------------------------------------------ */

  /** A holiday on a non-working day is rejected (Edge Cases, US-06 AC-2). */
  calc.validateHoliday = function (iso, week) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) { return 'Enter a date'; }
    if (!calc.isWorkingDay(iso, week)) {
      return calc.fmtDay(iso) + ' is not a working day (' + calc.WEEKDAY_SHORT[calc.weekday(iso)] +
        '): an office holiday on a weekend does not reduce capacity';
    }
    return null;
  };

  /** ISO dates that are office holidays for one location (yearly calendar only). */
  calc.locationHolidayDates = function (config, locationId) {
    var loc = (config.locations || []).filter(function (l) { return l.id === locationId; })[0];
    return loc ? (loc.holidays || []).map(function (h) { return h.date; }) : [];
  };

  /* ------------------------------------------------------------------ */
  /* FR-7 · Load thresholds                                              */
  /* ------------------------------------------------------------------ */

  calc.DEFAULT_THRESHOLDS = { under: 80, over: 100 };

  calc.validateThresholds = function (t) {
    var ok = isNum(t.under) && isNum(t.over) && t.under > 0 && t.under < t.over;
    return { ok: ok, message: ok ? '' : 'Under-loaded must be below overloaded' };
  };

  /** 'under' below the under-loaded %, 'over' above the overloaded %, else 'ok'. */
  calc.loadClass = function (pct, t) {
    if (pct > t.over) { return 'over'; }
    if (pct < t.under) { return 'under'; }
    return 'ok';
  };

  /** "Mon 4 – Fri 22 Jan 2027" (one month) or "Mon 25 Jan – Fri 12 Feb 2027". */
  calc.fmtRange = function (startIso, endIso) {
    var s = new Date(calc.isoToMs(startIso));
    var e = new Date(calc.isoToMs(endIso));
    var left = calc.WEEKDAY_SHORT[s.getUTCDay()] + ' ' + s.getUTCDate();
    if (s.getUTCMonth() !== e.getUTCMonth()) { left += ' ' + calc.MONTH_SHORT[s.getUTCMonth()]; }
    if (s.getUTCFullYear() !== e.getUTCFullYear()) { left += ' ' + s.getUTCFullYear(); }
    return left + ' – ' + calc.fmtDay(endIso) + ' ' + e.getUTCFullYear();
  };

  /** "4–22 Jan" or "25 Jan–12 Feb" for the sprint selector. */
  calc.fmtShortRange = function (startIso, endIso) {
    var s = new Date(calc.isoToMs(startIso));
    var e = new Date(calc.isoToMs(endIso));
    var left = String(s.getUTCDate());
    if (s.getUTCMonth() !== e.getUTCMonth()) { left += ' ' + calc.MONTH_SHORT[s.getUTCMonth()]; }
    return left + '–' + e.getUTCDate() + ' ' + calc.MONTH_SHORT[e.getUTCMonth()];
  };

  /* ------------------------------------------------------------------ */
  /* FR-11, FR-13, FR-32 · Ticket man-days, flags and planned person     */
  /* ------------------------------------------------------------------ */

  /**
   * Person a ticket half is planned on: the SM's pick if still listed in
   * the field, else the first person listed, else null (Unassigned).
   */
  calc.pickPerson = function (list, pick) {
    if (!list || !list.length) { return null; }
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === pick) { return pick; }
    }
    return list[0].id;
  };

  /**
   * MD per role and flags of one ticket.
   * Only no SP or SP outside the bands make it 0 MD; a missing Dev or BA keeps
   * the full MD and that half goes to Unassigned (FR-13 as aligned in v0.4).
   */
  calc.ticketMd = function (t, config) {
    var r = calc.spToMd(t.sp, config.bands);
    var split = r.md ? calc.splitMd(r.md, config.split) : { ba: 0, dev: 0 };
    var flags = [];
    if (r.flag) { flags.push(r.flag); }
    if (!t.dev || !t.dev.length) { flags.push('noDev'); }
    if (!t.ba || !t.ba.length) { flags.push('noBa'); }
    return {
      total: r.md,
      dev: split.dev,
      ba: split.ba,
      flags: flags,
      devPerson: calc.pickPerson(t.dev, t.devPick),
      baPerson: calc.pickPerson(t.ba, t.baPick)
    };
  };

  /** Totals row of Tab 1 (FR-11). */
  calc.ticketTotals = function (tickets, config) {
    var out = { tickets: tickets.length, flagged: 0, sp: 0, total: 0, dev: 0, ba: 0 };
    tickets.forEach(function (t) {
      var m = calc.ticketMd(t, config);
      if (m.flags.length) { out.flagged++; }
      if (isNum(t.sp)) { out.sp += t.sp; }
      out.total += m.total;
      out.dev += m.dev;
      out.ba += m.ba;
    });
    out.total = calc.round1(out.total);
    out.dev = calc.round1(out.dev);
    out.ba = calc.round1(out.ba);
    return out;
  };

  /* ------------------------------------------------------------------ */
  /* FR-17, FR-18, FR-19, FR-30 · Holidays, leave and net capacity       */
  /* ------------------------------------------------------------------ */

  /** The sprint's working days for a plan, with the config's working week. */
  calc.sprintDays = function (plan, config) {
    if (!plan || !plan.sprint || !plan.sprint.start) { return []; }
    return calc.workingDays(plan.sprint.start, plan.sprint.end, config.workingWeek);
  };

  /**
   * Office holidays in the sprint for one location: the location's yearly
   * calendar plus the plan's one-off holidays chosen for it (FR-17).
   * Returns [{ date, name, source: 'calendar' | 'oneoff' }], one per date.
   */
  calc.sprintHolidays = function (locationId, config, plan) {
    var days = calc.sprintDays(plan, config);
    var out = [];
    var seen = {};
    function add(date, name, source) {
      if (days.indexOf(date) === -1 || seen[date]) { return; }
      seen[date] = true;
      out.push({ date: date, name: name, source: source });
    }
    var loc = (config.locations || []).filter(function (l) { return l.id === locationId; })[0];
    if (loc) { (loc.holidays || []).forEach(function (h) { add(h.date, h.name, 'calendar'); }); }
    ((plan && plan.oneOffs) || []).forEach(function (o) {
      if ((o.locations || []).indexOf(locationId) !== -1) { add(o.date, o.name, 'oneoff'); }
    });
    out.sort(function (a, b) { return a.date.localeCompare(b.date); });
    return out;
  };

  /**
   * Leave of one person on one day (FR-18, FR-30): 'full', 'am' (morning off),
   * 'pm' (afternoon off) or null. Stored as 1, 'am' or 'pm'; a half day saved
   * before PRD v0.7 holds 0.5 and counts as a morning.
   */
  calc.leaveKind = function (plan, resourceId, date) {
    var l = plan && plan.leave && plan.leave[resourceId];
    var v = l ? l[date] : null;
    if (v === 1) { return 'full'; }
    if (v === 'am' || v === 0.5) { return 'am'; }
    if (v === 'pm') { return 'pm'; }
    return null;
  };

  /** Days of leave on one day: 1, 0.5 for either half, or 0. */
  calc.leaveOn = function (plan, resourceId, date) {
    var k = calc.leaveKind(plan, resourceId, date);
    return k === 'full' ? 1 : (k ? 0.5 : 0);
  };

  /** Label of a leave day, as the grid, Tab 3 and Tab 4 show it. */
  calc.LEAVE_LABEL = { full: 'Full day', am: 'Morning', pm: 'Afternoon' };

  /**
   * Net capacity of one resource (FR-19):
   * (working days - office holidays - leave) x (1 - ceremony %) x availability %.
   * Leave on an office-holiday day is not counted twice.
   * ceremonyPct may be null (not set yet): net is then null.
   * Values are unrounded; display them with fmt1.
   */
  calc.resourceCapacity = function (resource, config, plan) {
    var days = calc.sprintDays(plan, config);
    var hols = calc.sprintHolidays(resource.location, config, plan).map(function (h) { return h.date; });
    var leave = 0;
    days.forEach(function (d) {
      if (hols.indexOf(d) === -1) { leave += calc.leaveOn(plan, resource.id, d); }
    });
    var avail = isNum(resource.availability) ? resource.availability : 100;
    var base = days.length - hols.length - leave;
    var cer = isNum(config.ceremonyPct) ? config.ceremonyPct : null;
    var afterCer = cer === null ? null : base * (1 - cer / 100);
    return {
      days: days.length,
      holidays: hols.length,
      holidayDates: hols,
      leave: leave,
      available: base,
      afterCeremonies: afterCer,
      availability: avail,
      net: afterCer === null ? null : afterCer * avail / 100,
      rate: cer === null ? null : (1 - cer / 100) * avail / 100
    };
  };

  /* ------------------------------------------------------------------ */
  /* Tab 3 · Capacity (FR-14, FR-16, FR-19)                              */
  /* ------------------------------------------------------------------ */

  /** Share of a "Both" resource counted toward Dev; the rest is BA (PRD: default 50 / 50). */
  calc.BOTH_DEV_SHARE = 0.5;

  /**
   * Planned MD per person from the tickets: each ticket's Dev MD on its
   * Contributor, BA MD on its Backup Assignee (FR-21), the rest Unassigned.
   * Returns { byPerson: {id: md}, unassigned, total }.
   */
  calc.plannedLoad = function (tickets, config) {
    var out = { byPerson: {}, unassigned: 0, total: 0 };
    function add(id, md) {
      if (!md) { return; }
      if (id) { out.byPerson[id] = (out.byPerson[id] || 0) + md; } else { out.unassigned += md; }
    }
    (tickets || []).forEach(function (t) {
      var m = calc.ticketMd(t, config);
      add(m.devPerson, m.dev);
      add(m.baPerson, m.ba);
      out.total += m.total;
    });
    return out;
  };

  /**
   * Leave of one person as short text: consecutive full days as a range,
   * each marked Full day, Morning or Afternoon, e.g. "Thu 7 – Fri 8 Jan (Full day) · Thu 21 Jan (Morning)". '' if none.
   * Leave on an office holiday is ignored (it is not counted either).
   */
  calc.leaveText = function (plan, resourceId, days, holidayDates) {
    var parts = [];
    var run = null;
    function close() {
      if (!run) { return; }
      if (run.from === run.to) {
        parts.push(calc.fmtDay(run.from) + ' (Full day)');
      } else {
        var a = new Date(calc.isoToMs(run.from));
        var b = new Date(calc.isoToMs(run.to));
        var left = calc.WEEKDAY_SHORT[a.getUTCDay()] + ' ' + a.getUTCDate() +
          (a.getUTCMonth() !== b.getUTCMonth() ? ' ' + calc.MONTH_SHORT[a.getUTCMonth()] : '');
        parts.push(left + ' – ' + calc.fmtDay(run.to) + ' (Full day)');
      }
      run = null;
    }
    days.forEach(function (d) {
      var k = (holidayDates || []).indexOf(d) === -1 ? calc.leaveKind(plan, resourceId, d) : null;
      if (k === 'full') {
        if (run) { run.to = d; } else { run = { from: d, to: d }; }
      } else {
        close();                                   // a free day, holiday or half day ends a run
        if (k) { parts.push(calc.fmtDay(d) + ' (' + calc.LEAVE_LABEL[k] + ')'); }
      }
    });
    close();
    return parts.join(' · ');
  };

  /**
   * Gross-to-net capacity of the plan (FR-16, FR-19, Calculation Rules).
   * rows: one per resource, from calc.resourceCapacity plus leaveText and planned.
   * totals: gross = W x N; holidays, leave and the ceremony and availability
   * deductions in days; net per role ("Both" split by BOTH_DEV_SHARE) and in all.
   * Every figure is unrounded; the screen rounds to one decimal.
   */
  calc.capacitySummary = function (plan, config) {
    var days = calc.sprintDays(plan, config);
    // Planned MD per person follows the calendar: Tab 1 picks, then any calendar move (FR-22).
    var load = { byPerson: {}, unassigned: 0, total: 0 };
    calc.calendarCards(plan, config).forEach(function (k) {
      if (k.person) { load.byPerson[k.person] = (load.byPerson[k.person] || 0) + k.md; } else { load.unassigned += k.md; }
      load.total += k.md;
    });
    var t = { days: days.length, people: 0, gross: 0, holidays: 0, leave: 0, available: 0,
      afterCeremonies: 0, ceremonies: 0, availabilityLoss: 0, net: 0, dev: 0, ba: 0,
      planned: load.total, unassigned: load.unassigned };
    var rows = (plan.resources || []).map(function (r) {
      var c = calc.resourceCapacity(r, config, plan);
      c.resource = r;
      c.leaveText = calc.leaveText(plan, r.id, days, c.holidayDates);
      c.planned = load.byPerson[r.id] || 0;
      c.plannedPct = c.net ? c.planned / c.net * 100 : null;
      t.people++;
      t.holidays += c.holidays;
      t.leave += c.leave;
      t.available += c.available;
      t.afterCeremonies += c.afterCeremonies || 0;
      t.net += c.net || 0;
      var devShare = r.role === 'Dev' ? 1 : r.role === 'BA' ? 0 : calc.BOTH_DEV_SHARE;
      t.dev += (c.net || 0) * devShare;
      t.ba += (c.net || 0) * (1 - devShare);
      return c;
    });
    t.gross = t.days * t.people;
    t.ceremonies = t.available - t.afterCeremonies;
    t.availabilityLoss = t.afterCeremonies - t.net;
    t.plannedPct = t.net ? t.planned / t.net * 100 : null;
    return { rows: rows, totals: t };
  };

  /* ------------------------------------------------------------------ */
  /* Tab 4 · Planning Calendar (FR-20 to FR-24)                          */
  /*                                                                     */
  /* Time is measured in working days from the sprint start: day 0 is    */
  /* the first working day, day W the first working day after the end.   */
  /* A card is drawn in days at its person's net rate (FR-23):           */
  /* days = MD / ((1 - ceremony %) x availability %).                    */
  /* ------------------------------------------------------------------ */

  var EPS = 1e-9;
  calc.UNASSIGNED_GAP = 0.2;      // space between cards in the Unassigned lane, in days
  calc.EMPTY_CARD_DAYS = 2;       // drawn width of a 0 MD card (no SP or SP outside bands)
  calc.MIN_AFTER_DAYS = 4;        // working days always shown in the After sprint end zone

  /** Nearest half day, never before day 0 (FR-22). */
  calc.snapHalf = function (x) {
    return Math.max(0, Math.round(x * 2 + EPS) / 2);
  };

  /** Row finish rounded up to the next half day (FR-23). */
  calc.ceilHalf = function (x) {
    return Math.ceil(x * 2 - EPS) / 2;
  };

  /**
   * Every card of the plan. A ticket with MD gives a Dev card on its Contributor
   * and a BA card on its Backup Assignee (FR-21); a ticket with 0 MD (no SP or SP
   * outside the bands) gives one grey card in Unassigned (FR-13). A calendar move
   * in plan.cards ({ key, role, person, start }) wins over the Tab 1 pick (FR-32).
   * A person who is not a resource of the plan counts as Unassigned.
   */
  calc.calendarCards = function (plan, config) {
    var ids = {};
    (plan.resources || []).forEach(function (r) { ids[r.id] = true; });
    var moves = {};
    (Array.isArray(plan.cards) ? plan.cards : []).forEach(function (c) { moves[c.key + '|' + c.role] = c; });
    var out = [];
    (plan.tickets || []).forEach(function (t, order) {
      var m = calc.ticketMd(t, config);
      if (!m.total) {
        out.push({ id: t.key + '|none', key: t.key, role: 'none', md: 0, person: null, start: null, moved: false,
          order: order, flags: m.flags, ticket: t });
        return;
      }
      [['dev', m.dev, m.devPerson], ['ba', m.ba, m.baPerson]].forEach(function (x) {
        if (!x[1]) { return; }
        var mv = moves[t.key + '|' + x[0]];
        var person = mv ? mv.person : x[2];
        out.push({ id: t.key + '|' + x[0], key: t.key, role: x[0], md: x[1],
          person: person && ids[person] ? person : null,
          start: mv && isNum(mv.start) ? mv.start : null,
          moved: !!mv, order: order, flags: m.flags, ticket: t });
      });
    });
    return out;
  };

  /**
   * Days a person cannot work, as intervals in sprint days: office holidays
   * (full day) and leave (full day, or the morning or afternoon half).
   */
  calc.absences = function (resource, config, plan, days) {
    var out = [];
    var hols = calc.sprintHolidays(resource.location, config, plan);
    days.forEach(function (d, i) {
      var h = hols.filter(function (x) { return x.date === d; })[0];
      if (h) { out.push({ s: i, e: i + 1, kind: 'hol', label: h.name }); return; }
      var k = calc.leaveKind(plan, resource.id, d);
      if (k) {
        // A morning off blocks the first half of the day, an afternoon off the second (FR-23).
        out.push({ s: k === 'pm' ? i + 0.5 : i, e: k === 'am' ? i + 0.5 : i + 1, kind: 'leave', half: k !== 'full', label: calc.LEAVE_LABEL[k] });
      }
    });
    return out;
  };

  /**
   * Lay one card from `start`: it uses free time at `rate` MD a day and skips
   * absences, so it may split into parts (FR-23, US-16 AC-3). With no rate
   * (0% available, or no ceremony %) the card is drawn at 1 MD a day where it
   * starts and marked onAbsence: there is no time it can use.
   */
  calc.flowCard = function (start, md, rate, absences) {
    if (!(rate > EPS)) {
      return { parts: [{ s: start, e: start + Math.max(md, EPS), md: md }], end: start + md, onAbsence: true };
    }
    var t = start;
    var left = md;
    var parts = [];
    var guard = 0;
    while (left > EPS && guard++ < 1000) {
      var inside = absences.filter(function (a) { return a.s <= t + EPS && a.e > t + EPS; })[0];
      if (inside) { t = inside.e; continue; }
      var next = absences.filter(function (a) { return a.s > t + EPS; }).sort(function (a, b) { return a.s - b.s; })[0];
      var limit = next ? next.s : Infinity;
      var room = (limit - t) * rate;
      if (room + EPS >= left) {
        parts.push({ s: t, e: t + left / rate, md: left });
        t += left / rate;
        left = 0;
      } else {
        parts.push({ s: t, e: limit, md: room });
        left -= room;
        t = limit;
      }
    }
    // Shown MD per part add up to the card's MD: the last part takes the remainder.
    var shown = 0;
    parts.forEach(function (p, i) {
      p.shownMd = i === parts.length - 1 ? calc.round1(md - shown) : calc.round1(p.md);
      shown += p.shownMd;
    });
    return { parts: parts, end: t, onAbsence: false };
  };

  /**
   * Lay out one person's row (FR-21, FR-22). Cards moved in the calendar keep
   * their snapped start; auto-placed cards stay packed in ticket order and fill
   * the time before a moved card only when they fit there whole. Any card that
   * would overlap the one before it moves right, so no two cards overlap.
   */
  calc.layoutRow = function (cards, rate, absences) {
    var autos = cards.filter(function (c) { return c.start === null; }).sort(function (a, b) { return a.order - b.order; });
    var fixed = cards.filter(function (c) { return c.start !== null; }).sort(function (a, b) { return a.start - b.start || a.order - b.order; });
    var placed = [];
    var cursor = 0;
    function put(c, at) {
      var f = calc.flowCard(at, c.md, rate, absences);
      placed.push(Object.assign({}, c, { parts: f.parts, s: f.parts[0].s, e: f.end, onAbsence: f.onAbsence }));
      cursor = Math.max(cursor, f.end);
    }
    while (autos.length || fixed.length) {
      if (fixed.length && (!autos.length || calc.flowCard(cursor, autos[0].md, rate, absences).end > fixed[0].start + EPS)) {
        var c = fixed.shift();
        put(c, Math.max(c.start, cursor));
      } else {
        put(autos.shift(), cursor);
      }
    }
    return { cards: placed, end: cursor };
  };

  /** Unassigned lane: cards side by side in ticket order, 1 MD a day, 0 MD cards at a fixed width. */
  calc.layoutUnassigned = function (cards) {
    var x = 0;
    return cards.slice().sort(function (a, b) { return a.order - b.order || (a.role === 'dev' ? -1 : 1); }).map(function (c) {
      var w = c.md > 0 ? c.md : calc.EMPTY_CARD_DAYS;
      var out = Object.assign({}, c, { parts: [{ s: x, e: x + w, md: c.md, shownMd: c.md }], s: x, e: x + w, onAbsence: false });
      x += w + calc.UNASSIGNED_GAP;
      return out;
    });
  };

  /**
   * The whole calendar (FR-20 to FR-24): rows with placed cards, load, net and
   * finish; the Unassigned lane; load and net per role; the verdict; and the
   * dates of every column, sprint days first, then the After sprint end zone.
   */
  calc.planCalendar = function (plan, config) {
    var days = calc.sprintDays(plan, config);
    var W = days.length;
    var cap = calc.capacitySummary(plan, config);
    var cards = calc.calendarCards(plan, config);
    var rows = cap.rows.map(function (c) {
      var r = c.resource;
      var abs = calc.absences(r, config, plan, days);
      var mine = cards.filter(function (k) { return k.person === r.id; });
      var lay = calc.layoutRow(mine, c.rate, abs);
      var load = mine.reduce(function (s, k) { return s + k.md; }, 0);
      var net = c.net || 0;
      var done = lay.cards.length ? calc.ceilHalf(lay.end) : null;
      return {
        resource: r, capacity: c, rate: c.rate, absences: abs, cards: lay.cards, end: lay.end,
        load: load, net: net, pct: net > EPS ? load / net * 100 : (load > EPS ? Infinity : 0),
        done: done, doneIndex: done === null ? null : Math.ceil(done - EPS) - 1,
        onAbsence: lay.cards.some(function (k) { return k.onAbsence; })
      };
    });
    var un = calc.layoutUnassigned(cards.filter(function (k) { return k.person === null; }));
    var roles = { dev: { load: 0, net: cap.totals.dev }, ba: { load: 0, net: cap.totals.ba } };
    cards.forEach(function (k) { if (roles[k.role]) { roles[k.role].load += k.md; } });

    var maxEnd = rows.reduce(function (m, r) { return Math.max(m, r.end); }, 0);
    un.forEach(function (k) { maxEnd = Math.max(maxEnd, k.e); });
    var after = Math.max(calc.MIN_AFTER_DAYS, Math.ceil(maxEnd - EPS) - W);
    var dates = days.slice();
    var d = days.length ? days[days.length - 1] : plan.sprint.end;
    while (dates.length < W + after) {
      d = calc.addDays(d, 1);
      if (calc.isWorkingDay(d, config.workingWeek)) { dates.push(d); }
    }

    var cal = {
      W: W, dates: dates, rows: rows, unassigned: un, roles: roles, capacity: cap,
      planned: cards.reduce(function (s, k) { return s + k.md; }, 0),
      flagged: (plan.tickets || []).map(function (t) { return { key: t.key, flags: calc.ticketMd(t, config).flags }; })
        .filter(function (x) { return x.flags.length; })
    };
    cal.verdict = calc.verdict(cal);
    return cal;
  };

  /**
   * Verdict (FR-24, Calculation Rules): Not feasible when a role's load is above
   * its net; At risk when the roles fit but a person is above 100% or a card
   * sits where its person has no time; Feasible otherwise.
   */
  calc.verdict = function (cal) {
    var gaps = ['dev', 'ba'].map(function (k) {
      return { role: k, load: cal.roles[k].load, net: cal.roles[k].net, gap: cal.roles[k].load - cal.roles[k].net };
    }).filter(function (g) { return g.gap > EPS; }).sort(function (a, b) { return b.gap - a.gap; });
    var over = cal.rows.filter(function (r) { return r.load > EPS && r.pct > 100 + EPS; })
      .sort(function (a, b) { return b.pct - a.pct; });
    var onAbsence = cal.rows.filter(function (r) { return r.onAbsence; });
    var status = gaps.length ? 'notFeasible' : (over.length || onAbsence.length ? 'atRisk' : 'feasible');
    return { status: status, gaps: gaps, over: over, onAbsence: onAbsence };
  };

  /**
   * Overload detail (US-19): for each overloaded person, the cards on their row
   * that run past the sprint end; for each overloaded role, that role's cards
   * past the sprint end or unassigned. Largest first, then latest finish.
   */
  calc.overloadDetail = function (cal) {
    function sort(list) {
      return list.sort(function (a, b) { return b.md - a.md || b.e - a.e; });
    }
    var out = [];
    cal.verdict.over.forEach(function (r) {
      out.push({ kind: 'person', id: r.resource.id, name: r.resource.name, pct: r.pct, load: r.load, net: r.net,
        cards: sort(r.cards.filter(function (k) { return k.e > cal.W + EPS; })) });
    });
    cal.verdict.gaps.forEach(function (g) {
      var list = [];
      cal.rows.forEach(function (r) {
        r.cards.forEach(function (k) { if (k.role === g.role && k.e > cal.W + EPS) { list.push(Object.assign({ who: r.resource.name }, k)); } });
      });
      cal.unassigned.forEach(function (k) { if (k.role === g.role) { list.push(Object.assign({ who: 'Unassigned' }, k)); } });
      out.push({ kind: 'role', id: g.role, name: g.role === 'dev' ? 'Dev' : 'BA', gap: g.gap, load: g.load, net: g.net, cards: sort(list) });
    });
    return out;
  };

  /** The calendar as it would be without one ticket (US-19 AC-2). */
  calc.planWithout = function (plan, config, key) {
    var p = Object.assign({}, plan, {
      tickets: (plan.tickets || []).filter(function (t) { return t.key !== key; }),
      cards: (Array.isArray(plan.cards) ? plan.cards : []).filter(function (c) { return c.key !== key; })
    });
    return calc.planCalendar(p, config);
  };

  /* Node export for the automated tests. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = calc;
  }
}(typeof window !== 'undefined' ? window : globalThis));
