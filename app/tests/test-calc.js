/*
 * tests/test-calc.js — TEST ONLY. Unit tests of scp-calc.js against the PRD's
 * Calculation Rules and the stories' acceptance criteria.
 * Run: node tests/test-calc.js
 */
'use strict';

var path = require('path');
var calc = require(path.join(__dirname, '..', 'scp-calc.js'));

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS  ' + name);
  } catch (e) {
    failed++;
    console.log('FAIL  ' + name + '\n      ' + e.message);
  }
}

function eq(actual, expected, what) {
  var a = JSON.stringify(actual);
  var b = JSON.stringify(expected);
  if (a !== b) { throw new Error((what ? what + ': ' : '') + 'expected ' + b + ', got ' + a); }
}

var B = calc.DEFAULT_BANDS;
var SPLIT = { ba: 40, dev: 60 };

/* ---------------- US-04 · bands and split ---------------- */

test('US-04 AC-1 SP 2 in band (1,3] counts 3 MD (upper bound)', function () {
  eq(calc.spToMd(2, B), { md: 3, flag: null });
  eq(calc.spToMd(5, B).md, 8, 'PRD: 5 SP in 5-8 MD = 8 MD');
});

test('US-04 PRD band table: every default SP gives the PRD MD, BA and Dev', function () {
  var table = [[1, 1, 0.4, 0.6], [2, 3, 1.2, 1.8], [3, 5, 2.0, 3.0], [5, 8, 3.2, 4.8], [8, 12, 4.8, 7.2],
    [13, 15, 6.0, 9.0], [21, 20, 8.0, 12.0], [34, 40, 16.0, 24.0], [55, 60, 24.0, 36.0],
    [89, 80, 32.0, 48.0], [144, 100, 40.0, 60.0]];
  table.forEach(function (r) {
    var md = calc.spToMd(r[0], B).md;
    eq(md, r[1], 'SP ' + r[0] + ' MD');
    eq(calc.splitMd(md, SPLIT), { ba: r[2], dev: r[3] }, 'SP ' + r[0] + ' split');
  });
});

test('US-04 AC-2 overlapping bands are blocked and the row is marked', function () {
  var bands = [{ sp: 1, lower: 0, upper: 1 }, { sp: 2, lower: 1, upper: 3 }, { sp: 3, lower: 2, upper: 5 }];
  var v = calc.validateBands(bands);
  eq(v.ok, false);
  eq(v.rows, [null, null, 'Overlaps the band above']);
});

test('US-04 AC-2 descending bands are blocked and the row is marked', function () {
  var bands = [{ sp: 1, lower: 0, upper: 1 }, { sp: 5, lower: 5, upper: 8 }, { sp: 3, lower: 8, upper: 10 }];
  var v = calc.validateBands(bands);
  eq(v.ok, false);
  eq(v.rows, [null, null, 'SP must ascend']);
});

test('US-04 default bands are valid and cover 1-144', function () {
  var v = calc.validateBands(B);
  eq(v.ok, true);
  eq(v.message, 'Bands ascend, don\'t overlap, cover 1–144');
});

test('US-04 AC-3 BA 40 + Dev 50 is blocked showing "Sum 90%"', function () {
  var v = calc.validateSplit({ ba: 40, dev: 50 });
  eq(v.ok, false);
  eq(v.message, 'Sum 90%');
  eq(calc.validateSplit({ ba: 40, dev: 60 }).ok, true, '40/60 saves');
});

test('US-04 AC-4 40/60 on a 3 MD ticket gives BA 1.2 and Dev 1.8', function () {
  eq(calc.splitMd(3, SPLIT), { ba: 1.2, dev: 1.8 });
});

test('US-04 Dev is the remainder, so BA + Dev always equal Total (FR-6)', function () {
  [1, 3, 5, 7.5, 8, 12, 0.3].forEach(function (t) {
    [{ ba: 33, dev: 67 }, { ba: 40, dev: 60 }, { ba: 25, dev: 75 }].forEach(function (s) {
      var r = calc.splitMd(t, s);
      eq(calc.round1(r.ba + r.dev), calc.round1(t), t + ' at ' + s.ba + '/' + s.dev);
    });
  });
});

test('FR-13 no SP and SP outside the bands give 0 MD with their flag', function () {
  eq(calc.spToMd(null, B), { md: 0, flag: 'noSp' });
  eq(calc.spToMd('', B), { md: 0, flag: 'noSp' });
  var upTo8 = B.slice(0, 5);
  eq(calc.spToMd(13, upTo8), { md: 0, flag: 'outside' });
});

/* ---------------- US-05 · week, thresholds ---------------- */

test('FR-10/FR-14 3-21 Aug 2026 has 15 working days (Mon-Fri)', function () {
  eq(calc.workingDays('2026-08-03', '2026-08-21', calc.DEFAULT_WEEK).length, 15);
});

test('FR-14 sprint 4-22 Jan 2027 has 15 working days, first Mon 4, last Fri 22', function () {
  var d = calc.workingDays('2027-01-04', '2027-01-22', calc.DEFAULT_WEEK);
  eq([d.length, d[0], d[14]], [15, '2027-01-04', '2027-01-22']);
});

test('FR-14 working days across a month boundary (28 Jan - 10 Feb 2027 = 10)', function () {
  eq(calc.workingDays('2027-01-28', '2027-02-10', calc.DEFAULT_WEEK).length, 10);
});

test('FR-14 a Sun-Thu working week changes the count', function () {
  eq(calc.workingDays('2027-01-03', '2027-01-09', [0, 1, 2, 3, 4]).length, 5);
});

test('US-05 AC-2 load colour follows the thresholds (overloaded 100% -> 110%)', function () {
  eq(calc.loadClass(105, { under: 80, over: 100 }), 'over');
  eq(calc.loadClass(105, { under: 80, over: 110 }), 'ok');
  eq(calc.loadClass(66, { under: 80, over: 100 }), 'under');
  eq(calc.loadClass(100, { under: 80, over: 100 }), 'ok', '100% is not overloaded');
});

test('US-05 thresholds must keep under-loaded below overloaded', function () {
  eq(calc.validateThresholds({ under: 80, over: 100 }).ok, true);
  eq(calc.validateThresholds({ under: 100, over: 90 }).ok, false);
});

/* ---------------- US-06 · holidays ---------------- */

test('US-06 AC-2 a holiday on a Saturday is rejected with a message', function () {
  var msg = calc.validateHoliday('2027-01-09', calc.DEFAULT_WEEK);
  if (!msg || msg.indexOf('not a working day') === -1) { throw new Error('no rejection: ' + msg); }
  eq(calc.validateHoliday('2027-01-14', calc.DEFAULT_WEEK), null, 'Thu 14 Jan accepted');
});

test('US-06 AC-1 a holiday belongs to its own location only', function () {
  var cfg = { locations: [
    { id: 'lu', name: 'Luxembourg', holidays: [{ date: '2027-06-23', name: 'National Day' }] },
    { id: 'ch', name: 'Chennai', holidays: [{ date: '2027-01-14', name: 'Pongal' }] }] };
  eq(calc.locationHolidayDates(cfg, 'ch'), ['2027-01-14']);
  eq(calc.locationHolidayDates(cfg, 'lu').indexOf('2027-01-14'), -1);
});

/* ---------------- helpers ---------------- */

test('round1 is tolerant of float noise (8.16 -> 8.2, 11.475 -> 11.5)', function () {
  eq(calc.round1(8.16), 8.2);
  eq(calc.round1(11.475), 11.5);
  eq(calc.round1(12.75), 12.8);
});

test('jiraDate keeps the server-local date of an offset timestamp', function () {
  eq(calc.jiraDate('2027-01-04T09:00:00.000+01:00'), '2027-01-04');
  eq(calc.jiraDate('2027-01-22T18:00:00.000+0100'), '2027-01-22');
});

/* ---------------- US-08 / US-09 / US-10 · tickets ---------------- */

var CFG = { bands: B, split: SPLIT };
function P(id) { return { id: id, name: id }; }

test('US-08 ticket MD per role: 8 SP -> 12.0 / Dev 7.2 / BA 4.8', function () {
  var m = calc.ticketMd({ sp: 8, dev: [P('marc')], ba: [P('gabriela')] }, CFG);
  eq([m.total, m.dev, m.ba, m.flags], [12, 7.2, 4.8, []]);
});

test('US-09 AC-2 no BA keeps full MD, BA half has no person (Unassigned)', function () {
  var m = calc.ticketMd({ sp: 2, dev: [P('marc')], ba: [] }, CFG);
  eq([m.dev, m.ba, m.devPerson, m.baPerson, m.flags], [1.8, 1.2, 'marc', null, ['noBa']]);
});

test('US-09 AC-1 no SP: 0 MD and flagged, people still read', function () {
  var m = calc.ticketMd({ sp: null, dev: [], ba: [] }, CFG);
  eq([m.total, m.dev, m.ba, m.flags], [0, 0, 0, ['noSp', 'noDev', 'noBa']]);
});

test('US-10 AC-1/AC-3 default is the first listed; a pick no longer listed falls back to it', function () {
  var list = [P('priya'), P('marc')];
  eq(calc.pickPerson(list, undefined), 'priya');
  eq(calc.pickPerson(list, 'marc'), 'marc');
  eq(calc.pickPerson([P('priya')], 'marc'), 'priya');
  eq(calc.pickPerson([], 'marc'), null);
});

test('US-08 AC-2 totals of the 10-ticket fixture: 31 SP, 48.0, Dev 28.8, BA 19.2, 2 flagged', function () {
  var D = [P('d')], A = [P('a')];
  var t = [[5, D, A], [5, D, A], [8, D, A], [2, D, A], [3, D, A], [3, D, A], [2, D, A], [1, D, A], [2, D, []], [null, [], []]]
    .map(function (x) { return { sp: x[0], dev: x[1], ba: x[2] }; });
  eq(calc.ticketTotals(t, CFG), { tickets: 10, flagged: 2, sp: 31, total: 48, dev: 28.8, ba: 19.2 });
});

test('FR-10 date labels: "Mon 4 – Fri 22 Jan 2027" and "25 Jan–12 Feb"', function () {
  eq(calc.fmtRange('2027-01-04', '2027-01-22'), 'Mon 4 – Fri 22 Jan 2027');
  eq(calc.fmtRange('2027-01-25', '2027-02-12'), 'Mon 25 Jan – Fri 12 Feb 2027');
  eq(calc.fmtShortRange('2027-01-25', '2027-02-12'), '25 Jan–12 Feb');
});

/* ---------------- US-12 / US-13 / US-14 · holidays, leave, net ---------------- */

var CAPCFG = {
  workingWeek: calc.DEFAULT_WEEK, ceremonyPct: 15, bands: B, split: SPLIT,
  locations: [
    { id: 'lu', name: 'Luxembourg', holidays: [{ date: '2026-08-14', name: 'LU holiday' }] },
    { id: 'ch', name: 'Chennai', holidays: [{ date: '2027-01-14', name: 'Pongal' }] }]
};
var AUG = { sprint: { start: '2026-08-03', end: '2026-08-21' }, leave: {}, oneOffs: [] };
var S26 = { sprint: { start: '2027-01-04', end: '2027-01-22' }, oneOffs: [],
  leave: { marc: { '2027-01-07': 1, '2027-01-08': 1 }, gabriela: { '2027-01-19': 1 }, karthik: { '2027-01-21': 0.5 } } };

test('FR-18 / US-15 worked example: LU Dev 80%, 2 leave, 1 LU holiday, 15% = 8.16 (8.2)', function () {
  var plan = JSON.parse(JSON.stringify(AUG));
  plan.leave.marc = { '2026-08-04': 1, '2026-08-05': 1 };
  var c = calc.resourceCapacity({ id: 'marc', location: 'lu', availability: 80 }, CAPCFG, plan);
  eq([c.days, c.holidays, c.leave], [15, 1, 2]);
  eq(calc.round1(c.net), 8.2);
  eq(Math.round(c.net * 1000) / 1000, 8.16);
});

test('FR-17 one LU holiday, 3 LU + 2 Chennai resources, 15 days = 72 MD before ceremonies', function () {
  var people = [['a', 'lu'], ['b', 'lu'], ['c', 'lu'], ['d', 'ch'], ['e', 'ch']];
  var sum = people.reduce(function (s, p) {
    return s + calc.resourceCapacity({ id: p[0], location: p[1], availability: 100 }, CAPCFG, AUG).available;
  }, 0);
  eq(sum, 72);
});

test('US-06 AC-1 / FR-27 Pongal reduces only Chennai resources', function () {
  eq(calc.resourceCapacity({ id: 'priya', location: 'ch' }, CAPCFG, S26).holidays, 1);
  eq(calc.resourceCapacity({ id: 'lorenzo', location: 'lu' }, CAPCFG, S26).holidays, 0);
});

test('US-13 AC-3 Marc: 2 full days leave, 80%, 15% ceremonies -> leave 2.0, net 8.8', function () {
  var c = calc.resourceCapacity({ id: 'marc', location: 'lu', availability: 80 }, CAPCFG, S26);
  eq([c.leave, calc.fmt1(c.net)], [2, '8.8']);
});

test('Sprint 26 design numbers: 12.8 / 8.8 / 11.9 / 11.9 / 11.5, total 56.9, rate 0.68 and 0.85', function () {
  var R = [['lorenzo', 'lu', 100], ['marc', 'lu', 80], ['priya', 'ch', 100], ['gabriela', 'lu', 100], ['karthik', 'ch', 100]];
  var nets = R.map(function (r) { return calc.resourceCapacity({ id: r[0], location: r[1], availability: r[2] }, CAPCFG, S26); });
  eq(nets.map(function (c) { return calc.fmt1(c.net); }), ['12.8', '8.8', '11.9', '11.9', '11.5']);
  eq(calc.fmt1(nets.reduce(function (s, c) { return s + c.net; }, 0)), '56.9');
  eq([Math.round(nets[1].rate * 100) / 100, nets[0].rate], [0.68, 0.85]);
});

test('US-13 leave on an office-holiday day is not counted twice', function () {
  var plan = JSON.parse(JSON.stringify(S26));
  plan.leave.priya = { '2027-01-14': 1 };
  var c = calc.resourceCapacity({ id: 'priya', location: 'ch' }, CAPCFG, plan);
  eq([c.holidays, c.leave, c.available], [1, 0, 14]);
});

test('US-14 AC-2 a Luxembourg one-off holiday reduces only Luxembourg resources', function () {
  var plan = JSON.parse(JSON.stringify(S26));
  plan.oneOffs = [{ date: '2027-01-22', name: 'Office closure', locations: ['lu'] }];
  var hl = calc.sprintHolidays('lu', CAPCFG, plan);
  eq(hl, [{ date: '2027-01-22', name: 'Office closure', source: 'oneoff' }]);
  eq(calc.resourceCapacity({ id: 'lorenzo', location: 'lu' }, CAPCFG, plan).holidays, 1);
  eq(calc.resourceCapacity({ id: 'priya', location: 'ch' }, CAPCFG, plan).holidays, 1, 'only Pongal');
});

test('US-14 holidays outside the sprint are ignored; calendar and one-off on one day count once', function () {
  var plan = JSON.parse(JSON.stringify(S26));
  plan.oneOffs = [{ date: '2027-01-14', name: 'Closure', locations: ['ch'] }, { date: '2027-02-01', name: 'Later', locations: ['ch'] }];
  eq(calc.sprintHolidays('ch', CAPCFG, plan).map(function (h) { return h.date + ' ' + h.source; }), ['2027-01-14 calendar']);
});

test('US-05 AC-1 no ceremony % -> net is not computed (null)', function () {
  var cfg = JSON.parse(JSON.stringify(CAPCFG));
  cfg.ceremonyPct = null;
  var c = calc.resourceCapacity({ id: 'lorenzo', location: 'lu' }, cfg, S26);
  eq([c.available, c.net], [15, null]);
});

test('US-12 a resource with no location has no office holidays', function () {
  eq(calc.resourceCapacity({ id: 'x', location: null }, CAPCFG, S26).holidays, 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
