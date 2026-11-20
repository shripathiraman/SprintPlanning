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

/* ---------------- US-15 · gross-to-net capacity ---------------- */

var S26RES = [
  { id: 'lorenzo', name: 'Lorenzo', role: 'Dev', location: 'lu', availability: 100 },
  { id: 'marc', name: 'Marc', role: 'Dev', location: 'lu', availability: 80 },
  { id: 'priya', name: 'Priya', role: 'Dev', location: 'ch', availability: 100 },
  { id: 'gabriela', name: 'Gabriela', role: 'BA', location: 'lu', availability: 100 },
  { id: 'karthik', name: 'Karthik', role: 'BA', location: 'ch', availability: 100 }];

function s26(extra) {
  var p = JSON.parse(JSON.stringify(S26));
  p.resources = JSON.parse(JSON.stringify(S26RES));
  p.tickets = [];
  return Object.assign(p, extra || {});
}

test('US-15 AC-1 gross = 15 working days x 5 resources = 75 MD', function () {
  var p = s26();
  p.sprint = AUG.sprint;
  p.leave = {};
  eq(calc.capacitySummary(p, CAPCFG).totals.gross, 75);
});

test('US-15 AC-2 worked example in the summary: LU Dev 80%, 2 leave, 1 LU holiday -> 8.2 (8.16)', function () {
  var p = s26({ sprint: AUG.sprint, leave: { marc: { '2026-08-04': 1, '2026-08-05': 1 } } });
  var marc = calc.capacitySummary(p, CAPCFG).rows[1];
  eq([marc.days, marc.holidays, marc.leave, calc.fmt1(marc.net), Math.round(marc.net * 1000) / 1000], [15, 1, 2, '8.2', 8.16]);
});

test('US-15 Sprint 26 strip: 75.0, -2.0, -3.5, -10.4 of 69.5, -2.2, net 56.9 (Dev 33.5, BA 23.4)', function () {
  var t = calc.capacitySummary(s26(), CAPCFG).totals;
  eq([t.gross, t.holidays, t.leave, calc.fmt1(t.available), calc.fmt1(t.ceremonies), calc.fmt1(t.availabilityLoss),
    calc.fmt1(t.net), calc.fmt1(t.dev), calc.fmt1(t.ba), calc.fmt1(t.afterCeremonies)],
  [75, 2, 3.5, '69.5', '10.4', '2.2', '56.9', '33.5', '23.4', '59.1']);
});

test('US-15 AC-3 steps add up: gross - holidays - leave - ceremonies - availability = net, and Dev + BA = net', function () {
  var t = calc.capacitySummary(s26(), CAPCFG).totals;
  eq(Math.abs(t.gross - t.holidays - t.leave - t.ceremonies - t.availabilityLoss - t.net) < 1e-9, true, 'strip');
  eq(Math.abs(t.dev + t.ba - t.net) < 1e-9, true, 'roles');
  calc.capacitySummary(s26(), CAPCFG).rows.forEach(function (c) {
    eq(Math.abs((c.days - c.holidays - c.leave) * 0.85 * c.availability / 100 - c.net) < 1e-9, true, c.resource.id);
  });
});

test('US-15 role Both counts half toward Dev and half toward BA (PRD default 50 / 50)', function () {
  var p = s26();
  p.resources[0].role = 'Both';                                     // Lorenzo 12.75
  var t = calc.capacitySummary(p, CAPCFG).totals;
  eq([calc.fmt1(t.dev), calc.fmt1(t.ba)], ['27.1', '29.8']);       // 33.49 - 6.375, 23.375 + 6.375
});

test('US-15 leave text: ranges of full days, mornings and afternoons marked, holidays skipped', function () {
  var days = calc.sprintDays(S26, CAPCFG);
  eq(calc.leaveText(S26, 'marc', days, []), 'Thu 7 – Fri 8 Jan (Full day)');
  eq(calc.leaveText(S26, 'gabriela', days, []), 'Tue 19 Jan (Full day)');
  eq(calc.leaveText(S26, 'karthik', days, ['2027-01-14']), 'Thu 21 Jan (Morning)');
  eq(calc.leaveText(S26, 'lorenzo', days, []), '');
  var p = { leave: { x: { '2027-01-08': 1, '2027-01-11': 1, '2027-01-13': 'pm', '2027-01-14': 1, '2027-01-15': 1 } } };
  eq(calc.leaveText(p, 'x', days, ['2027-01-14']), 'Fri 8 – Mon 11 Jan (Full day) · Wed 13 Jan (Afternoon) · Fri 15 Jan (Full day)',
    'a weekend does not break a run; a holiday does');
});

test('US-15 planned load: Dev MD on the Contributor, BA MD on the Backup Assignee, missing half unassigned', function () {
  var tickets = [
    { key: 'A', sp: 3, dev: [{ id: 'marc' }], ba: [{ id: 'gabriela' }] },                       // 5 MD: Dev 3.0, BA 2.0
    { key: 'B', sp: 2, dev: [{ id: 'priya' }, { id: 'marc' }], devPick: 'marc', ba: [] },        // 3 MD: Dev 1.8 on Marc, BA 1.2 unassigned
    { key: 'C', sp: null, dev: [{ id: 'priya' }], ba: [{ id: 'karthik' }] }];                    // no SP: 0 MD
  var l = calc.plannedLoad(tickets, CAPCFG);
  eq([calc.fmt1(l.byPerson.marc), calc.fmt1(l.byPerson.gabriela), calc.fmt1(l.unassigned), l.total, l.byPerson.priya],
    ['4.8', '2.0', '1.2', 8, undefined]);
});

/* ---------------- US-16 to US-19 · Planning Calendar ---------------- */

function tk(key, sp, dev, ba, summary) {
  return { key: key, summary: summary || '', type: 'Story', sp: sp,
    dev: dev ? dev.split('/').map(function (id) { return { id: id, name: id }; }) : [],
    ba: ba ? ba.split('/').map(function (id) { return { id: id, name: id }; }) : [] };
}
/* Sprint 26 after Reload, as in the mock Jira and on the Planning Calendar screen. */
var S26TICKETS = [tk('NWD-412', 5, 'lorenzo', 'gabriela'), tk('NWD-418', 5, 'priya/marc', 'karthik'),
  tk('NWD-421', 8, 'marc', 'gabriela'), tk('NWD-427', 2, 'marc', 'karthik'), tk('NWD-430', 3, 'priya', 'gabriela'),
  tk('NWD-433', 3, 'lorenzo', 'karthik'), tk('NWD-435', 2, 'priya', 'karthik'), tk('NWD-438', 1, 'lorenzo', 'gabriela'),
  tk('NWD-441', 2, 'marc', ''), tk('NWD-444', null, '', '')];

function s26cal(cards) {
  var p = s26({ tickets: JSON.parse(JSON.stringify(S26TICKETS)), cards: cards || [] });
  return calc.planCalendar(p, CAPCFG);
}
function rowOf(cal, id) { return cal.rows.filter(function (r) { return r.resource.id === id; })[0]; }
/* Each card part as "KEY start-end md", in tenths of a day as the screen's grid draws it. */
function geo(row) {
  var out = [];
  row.cards.forEach(function (k) {
    k.parts.forEach(function (p) { out.push(k.key + ' ' + Math.round(p.s * 10) + '-' + Math.round(p.e * 10) + ' ' + calc.fmt1(p.shownMd)); });
  });
  return out;
}

test('US-16 AC-1 two cards per ticket: Dev on the Contributor, BA on the Backup Assignee; 0 MD ticket one grey card', function () {
  var cards = calc.calendarCards(s26({ tickets: S26TICKETS }), CAPCFG);
  var c412 = cards.filter(function (k) { return k.key === 'NWD-412'; });
  eq(c412.map(function (k) { return k.role + ' ' + k.person + ' ' + k.md; }), ['dev lorenzo 4.8', 'ba gabriela 3.2']);
  eq(cards.filter(function (k) { return k.key === 'NWD-444'; }).map(function (k) { return k.role + ' ' + k.person + ' ' + k.md; }), ['none null 0']);
});

test('US-16 Sprint 26 rows match the design grid: Lorenzo, Priya (split around Pongal), Gabriela (split around leave)', function () {
  var cal = s26cal();
  eq(geo(rowOf(cal, 'lorenzo')), ['NWD-412 0-56 4.8', 'NWD-433 56-92 3.0', 'NWD-438 92-99 0.6']);
  eq(geo(rowOf(cal, 'priya')), ['NWD-418 0-56 4.8', 'NWD-430 56-80 2.0', 'NWD-430 90-102 1.0', 'NWD-435 102-123 1.8']);
  eq(geo(rowOf(cal, 'gabriela')), ['NWD-412 0-38 3.2', 'NWD-421 38-94 4.8', 'NWD-430 94-110 1.4', 'NWD-430 120-128 0.6', 'NWD-438 128-132 0.4']);
  eq(geo(rowOf(cal, 'karthik')), ['NWD-418 0-38 3.2', 'NWD-427 38-52 1.2', 'NWD-433 52-75 2.0', 'NWD-435 75-80 0.4', 'NWD-435 90-99 0.8']);
});

test('US-16 AC-2/AC-3 Marc at 0.68 MD a day: 7.2 MD card split around leave (2.0 + 5.2), 10.6 days of work, load counts MD', function () {
  var marc = rowOf(s26cal(), 'marc');
  eq(geo(marc), ['NWD-421 0-30 2.0', 'NWD-421 50-126 5.2', 'NWD-427 126-152 1.8', 'NWD-441 152-179 1.8']);
  var c421 = marc.cards[0];
  var workDays = c421.parts.reduce(function (s, p) { return s + p.e - p.s; }, 0);
  eq([calc.fmt1(workDays), c421.md, calc.fmt1(marc.load)], ['10.6', 7.2, '10.8']);
});

test('US-16 AC-4 past sprint end: Marc done at 18.0 days = Wed 27 Jan, 3 days after the sprint; zone shows 4 days', function () {
  var cal = s26cal();
  var marc = rowOf(cal, 'marc');
  eq([marc.done, cal.dates[marc.doneIndex], marc.doneIndex + 1 - cal.W], [18, '2027-01-27', 3]);
  eq([cal.W, cal.dates.length, cal.dates[15], cal.dates[18]], [15, 19, '2027-01-25', '2027-01-28']);
  eq(['lorenzo', 'priya', 'gabriela', 'karthik'].map(function (id) { var r = rowOf(cal, id); return r.done + ' ' + cal.dates[r.doneIndex]; }),
    ['10 2027-01-15', '12.5 2027-01-20', '13.5 2027-01-21', '10 2027-01-15'], 'done Fri 15, Wed 20, Thu 21, Fri 15');
});

test('US-16 AC-5 Unassigned: NWD-441 BA (no BA named) and NWD-444 (no SP) side by side', function () {
  var un = s26cal().unassigned;
  eq(un.map(function (k) { return k.key + ' ' + k.role + ' ' + Math.round(k.s * 10) + '-' + Math.round(k.e * 10); }),
    ['NWD-441 ba 0-12', 'NWD-444 none 14-34']);
});

test('US-18 AC-2 At risk: roles fit (Dev 28.8 / 33.5, BA 19.2 / 23.4) but Marc is at 122%', function () {
  var cal = s26cal();
  var v = cal.verdict;
  eq([v.status, calc.fmt1(cal.roles.dev.load), calc.fmt1(cal.roles.dev.net), calc.fmt1(cal.roles.ba.load), calc.fmt1(cal.roles.ba.net)],
    ['atRisk', '28.8', '33.5', '19.2', '23.4']);
  eq(v.over.map(function (r) { return r.resource.id + ' ' + Math.round(r.pct) + ' +' + calc.fmt1(r.load - r.net); }), ['marc 122 +2.0']);
  eq([calc.fmt1(cal.planned), cal.flagged.map(function (f) { return f.key + ':' + f.flags.join(','); })],
    ['48.0', ['NWD-441:noBa', 'NWD-444:noSp,noDev,noBa']]);
});

test('US-17 AC-1 / US-18 AC-1 moving Marc\'s NWD-427 then NWD-441 Dev cards to Lorenzo: 102% then Feasible', function () {
  var one = s26cal([{ key: 'NWD-427', role: 'dev', person: 'lorenzo', start: null }]);
  eq([calc.fmt1(rowOf(one, 'marc').load), Math.round(rowOf(one, 'marc').pct), calc.fmt1(rowOf(one, 'lorenzo').load), one.verdict.status],
    ['9.0', 102, '10.2', 'atRisk']);
  var two = s26cal([{ key: 'NWD-427', role: 'dev', person: 'lorenzo', start: null }, { key: 'NWD-441', role: 'dev', person: 'lorenzo', start: null }]);
  eq([Math.round(rowOf(two, 'marc').pct), two.verdict.status], [81, 'feasible']);
});

test('US-17 AC-2 a card dropped at day 3.3 starts at day 3.5; the gap before it stays empty', function () {
  eq([calc.snapHalf(3.3), calc.snapHalf(3.24), calc.snapHalf(-1)], [3.5, 3, 0]);
  var cal = s26cal([{ key: 'NWD-441', role: 'dev', person: 'lorenzo', start: calc.snapHalf(11.3) }]);
  var lo = rowOf(cal, 'lorenzo');
  eq(geo(lo), ['NWD-412 0-56 4.8', 'NWD-433 56-92 3.0', 'NWD-438 92-99 0.6', 'NWD-441 115-136 1.8']);
  eq(lo.done, 14, 'the gap moves the Done date');
});

test('US-17 AC-3 dropped onto another card: later cards move right, none overlap', function () {
  var cal = s26cal([{ key: 'NWD-441', role: 'dev', person: 'lorenzo', start: 3.5 }]);
  eq(geo(rowOf(cal, 'lorenzo')), ['NWD-441 35-56 1.8', 'NWD-412 56-113 4.8', 'NWD-433 113-148 3.0', 'NWD-438 148-155 0.6']);
  var two = s26cal([{ key: 'NWD-441', role: 'dev', person: 'lorenzo', start: 3.5 }, { key: 'NWD-427', role: 'dev', person: 'lorenzo', start: 4 }]);
  var g = rowOf(two, 'lorenzo').cards.map(function (k) { return [k.key, Math.round(k.s * 10), Math.round(k.e * 10)]; });
  eq(g.slice(0, 2), [['NWD-441', 35, 56], ['NWD-427', 56, 77]], 'the later card moves right of the earlier one');
  for (var i = 1; i < g.length; i++) { eq(g[i][1] >= g[i - 1][2], true, 'no overlap at ' + g[i][0]); }
});

test('US-18 AC-3 Not feasible: BA load above BA net names the biggest gap', function () {
  var cfg = JSON.parse(JSON.stringify(CAPCFG));
  cfg.split = { ba: 60, dev: 40 };                                   // BA 28.8 MD > BA net 23.4
  var p = s26({ tickets: S26TICKETS, cards: [] });
  var v = calc.planCalendar(p, cfg).verdict;
  eq([v.status, v.gaps[0].role, calc.fmt1(v.gaps[0].gap)], ['notFeasible', 'ba', '5.4']);
});

test('US-18 AC-4 a card where its person has no time (0% available) makes the verdict at least At risk', function () {
  var p = s26({ tickets: [tk('NWD-1', 1, 'lorenzo', 'gabriela')], cards: [] });
  eq(calc.planCalendar(p, CAPCFG).verdict.status, 'feasible');
  p.resources[0].availability = 0;
  var cal = calc.planCalendar(p, CAPCFG);
  eq([cal.verdict.status, rowOf(cal, 'lorenzo').onAbsence], ['atRisk', true]);
});

test('US-19 AC-1/AC-2 overload detail lists Marc\'s cards past the sprint end, largest first; without NWD-441 Marc is at 102%', function () {
  var cal = s26cal();
  var d = calc.overloadDetail(cal);
  eq(d.map(function (x) { return x.name + ': ' + x.cards.map(function (k) { return k.key + ' ' + k.role + ' ' + k.md; }).join(', '); }),
    ['Marc: NWD-441 dev 1.8, NWD-427 dev 1.8']);
  var w = calc.planWithout(s26({ tickets: S26TICKETS, cards: [] }), CAPCFG, 'NWD-441');
  eq([Math.round(rowOf(w, 'marc').pct), w.verdict.status], [102, 'atRisk']);
});

test('US-15 planned load follows calendar moves; a person who is not a resource counts as Unassigned', function () {
  var p = s26({ tickets: S26TICKETS, cards: [{ key: 'NWD-427', role: 'dev', person: 'lorenzo', start: null }] });
  var rows = calc.capacitySummary(p, CAPCFG).rows;
  eq([calc.fmt1(rows[0].planned), calc.fmt1(rows[1].planned)], ['10.2', '9.0']);
  p.cards = [{ key: 'NWD-427', role: 'dev', person: 'nobody', start: null }];
  eq(calc.calendarCards(p, CAPCFG).filter(function (k) { return k.id === 'NWD-427|dev'; })[0].person, null);
});

/* ---------------- US-13 v0.4 · morning or afternoon off ---------------- */

test('US-13 leave kinds: full day, morning, afternoon; a 0.5 saved before v0.7 counts as a morning', function () {
  var p = { leave: { x: { a: 1, b: 'am', c: 'pm', d: 0.5 } } };
  eq(['a', 'b', 'c', 'd', 'e'].map(function (d) { return calc.leaveKind(p, 'x', d) + ' ' + calc.leaveOn(p, 'x', d); }),
    ['full 1', 'am 0.5', 'pm 0.5', 'am 0.5', 'null 0']);
});

test('US-13 AC-5 afternoon off: Gabriela\'s card runs through the morning of Wed 13, stops at midday, resumes next morning', function () {
  var p = s26({ tickets: S26TICKETS, cards: [], leave: { gabriela: { '2027-01-13': 'pm' } } });
  var cal = calc.planCalendar(p, CAPCFG);
  var g = rowOf(cal, 'gabriela');
  var abs = g.absences.map(function (a) { return a.s + '-' + a.e + ' ' + a.label; });
  eq(abs, ['7.5-8 Afternoon']);
  eq(geo(g).slice(0, 3), ['NWD-412 0-38 3.2', 'NWD-421 38-75 3.2', 'NWD-421 80-99 1.6']);
  eq([rowOf(cal, 'gabriela').capacity.leave, calc.fmt1(rowOf(cal, 'gabriela').net)], [0.5, '12.3']);
  var am = calc.planCalendar(s26({ tickets: S26TICKETS, cards: [], leave: { gabriela: { '2027-01-13': 'am' } } }), CAPCFG);
  eq([rowOf(am, 'gabriela').absences[0].s, rowOf(am, 'gabriela').absences[0].e, rowOf(am, 'gabriela').capacity.leave], [7, 7.5, 0.5],
    'a morning off blocks the first half and counts the same 0.5');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
