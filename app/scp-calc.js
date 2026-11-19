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

  /* Node export for the automated tests. */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = calc;
  }
}(typeof window !== 'undefined' ? window : globalThis));
