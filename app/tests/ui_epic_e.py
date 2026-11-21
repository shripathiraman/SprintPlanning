"""
tests/ui_epic_e.py — TEST ONLY. Browser tests for Epic E · Tab 4 Planning Calendar
(US-16 to US-19), plus the calendar parts of US-10 AC-4, US-11 AC-2/AC-3 and US-20.
Run: python3 tests/ui_epic_e.py
"""
import sys
import time

from fixtures import att, last_plan, saved_config
from uitest import check, run, test

TICKETS = "1 · Sprint Tickets"
RESOURCES = "2 · Resources & Leave"
CAPACITY = "3 · Capacity"
CALENDAR = "4 · Planning Calendar"


def leave(app, pid, date):
    app.page.click("[data-focus='leave-%s-%s']" % (pid, date))
    app.settle()


def design_sprint(app, config=None):
    """Sprint 26 as on the screens: last plan's people, Marc 80% with 7-8 Jan off, Gabriela 19 Jan, Karthik half of 21 Jan."""
    a = att("scp-config.json", config or saved_config())
    a.update(att("scp-plan.json", last_plan()))
    app.open("ok", attachments=a)
    app.page.wait_for_function("() => window.SCP.state.jira.sprints.length > 0")
    app.tab(TICKETS)
    app.on_dialog(accept=True)
    app.page.select_option("[data-act=sprint]", "2600")
    app.page.wait_for_selector("[data-test=tickets]")
    app.tab(RESOURCES)
    app.page.wait_for_selector("[data-test=resources]")
    app.page.fill("[data-act=availability][data-id=marc]", "80")
    app.page.press("[data-act=availability][data-id=marc]", "Tab")
    app.settle()
    for pid, d in [("marc", "2027-01-07"), ("marc", "2027-01-08"), ("gabriela", "2027-01-19"), ("karthik", "2027-01-21"), ("karthik", "2027-01-21")]:
        leave(app, pid, d)
    app.tab(CALENDAR)
    app.page.wait_for_selector("[data-test=calendar]")


def card(app, cid, part=0):
    return "[data-card='%s'][data-part='%d']" % (cid, part)


def span(app, cid, part=0):
    """Grid columns of a card part as (start, end), 1-based, 10 columns a day."""
    g = app.page.eval_on_selector(card(app, cid, part), "e => getComputedStyle(e).gridColumnStart + '/' + getComputedStyle(e).gridColumnEnd")
    a, b = g.split("/")
    return int(a), int(b)


def lane_of(app, cid):
    return app.page.eval_on_selector(card(app, cid), "e => e.closest('.scp-lane').dataset.lane")


def badge(app, pid):
    return app.page.inner_text("[data-row='%s'] [data-test=row-load]" % pid)


def verdict(app):
    return app.page.get_attribute("[data-test=verdict]", "data-status"), app.text("[data-test=verdict-title]"), app.text("[data-test=verdict-detail]")


def drag(app, cid, person, day):
    """Mouse-drag a card so that its start lands on `day` of `person`'s lane ('' = Unassigned)."""
    box = app.page.locator(card(app, cid)).bounding_box()
    src_lane = app.page.eval_on_selector(card(app, cid), "e => { const r = e.closest('.scp-lane').getBoundingClientRect(); return [r.x, r.width]; }")
    days = app.page.evaluate("() => SCP.calc.planCalendar(SCP.state.plan, SCP.state.config).dates.length")
    start = app.page.evaluate("id => { const c = SCP.calc.planCalendar(SCP.state.plan, SCP.state.config); "
                              "let s = null; c.rows.concat([{cards: c.unassigned}]).forEach(r => r.cards.forEach(k => { if (k.id === id) s = k.s; })); return s; }", cid)
    day_w = src_lane[1] / days
    down_x = box["x"] + 6
    grab_px = down_x - (src_lane[0] + start * day_w)
    y = box["y"] + box["height"] / 2
    tgt = app.page.locator("[data-lane='%s']" % person).bounding_box()
    app.page.mouse.move(down_x, y)
    app.page.mouse.down()
    app.page.mouse.move(down_x + 10, y + 3, steps=3)
    app.page.mouse.move(tgt["x"] + day * day_w + grab_px, tgt["y"] + tgt["height"] / 2, steps=8)
    app.page.mouse.up()
    app.settle()


def move(app, cid, person, start=None):
    """Make a calendar move through the tab's own move function (when the gesture itself is not under test)."""
    app.page.evaluate("([id, p, s]) => SCP.tabs.calendar.move(id, p, s)", [cid, person, start])
    app.settle()


# ---------------------------------------------------------------- US-16

@test("US-16 AC-1 Two cards per ticket: Dev on the Contributor's row, BA on the Backup Assignee's, same key, own colour and tag")
def _(app):
    design_sprint(app)
    check((lane_of(app, "NWD-412|dev"), lane_of(app, "NWD-412|ba")) == ("lorenzo", "gabriela"), "rows")
    d = app.page.inner_text(card(app, "NWD-412|dev"))
    b = app.page.inner_text(card(app, "NWD-412|ba"))
    check(d.split("\n") == ["NWD-412", "DEV · 4.8"] and b.split("\n") == ["NWD-412", "BA · 3.2"], (d, b))
    cd = app.page.get_attribute(card(app, "NWD-412|dev"), "class")
    cb = app.page.get_attribute(card(app, "NWD-412|ba"), "class")
    check("scp-ccard--dev" in cd and "scp-ccard--ba" in cb, (cd, cb))
    check([badge(app, p) for p in ["lorenzo", "marc", "priya", "gabriela", "karthik"]] ==
          ["8.4 / 12.8", "10.8 / 8.8", "9.6 / 11.9", "10.4 / 11.9", "7.6 / 11.5"], "load / net badges")


@test("US-16 AC-2 Marc at 0.68 MD a day: his 7.2 MD card spans 10.6 days on the grid, his load counts 7.2 of it")
def _(app):
    design_sprint(app)
    a, b = span(app, "NWD-421|dev", 0), span(app, "NWD-421|dev", 1)
    check((a, b) == ((1, 31), (51, 127)), (a, b))
    check(((a[1] - a[0]) + (b[1] - b[0])) / 10 == 10.6, "10.6 days")
    check("0.68 MD/day" in app.text("[data-row=marc] [data-test=row-pace]"), "rate")


@test("US-16 AC-3 Cards split around absences and keep their MD: Marc's leave (2.0 + 5.2), Priya's Pongal (2.0 + 1.0)")
def _(app):
    design_sprint(app)
    check(app.page.inner_text(card(app, "NWD-421|dev", 0)).endswith("DEV · 2.0 · 1/2"), "Marc part 1")
    check(app.page.inner_text(card(app, "NWD-421|dev", 1)).endswith("DEV · 5.2 · 2/2"), "Marc part 2")
    check(span(app, "NWD-430|dev", 0) == (57, 81) and span(app, "NWD-430|dev", 1) == (91, 103), "around Pongal (cols 81-90)")
    shade = app.page.inner_text("[data-lane=priya] .scp-shade--hol")
    check(shade == "Pongal", shade)
    check(app.page.locator("[data-lane=lorenzo] .scp-shade--hol").count() == 0, "Luxembourg has no Pongal")
    marc = app.page.eval_on_selector_all("[data-lane=marc] .scp-shade--leave", "e => e.map(x => x.innerText)")
    karthik = app.page.eval_on_selector_all("[data-lane=karthik] .scp-shade--leave", "e => e.map(x => x.innerText)")
    check(marc == ["Full day", "Full day"] and karthik == ["Morning"], (marc, karthik))


@test("US-13 AC-5 Afternoon off in Tab 2: the Tab 4 card runs through the morning, stops at midday, resumes next morning")
def _(app):
    design_sprint(app)
    app.tab(RESOURCES)
    for _ in range(3):                                            # free -> Full day -> Morning -> Afternoon
        leave(app, "gabriela", "2027-01-13")
    cell = app.page.locator("[data-focus='leave-gabriela-2027-01-13']")
    check(cell.inner_text() == "Afternoon", cell.inner_text())
    total = app.page.inner_text("[data-test=leave-row][data-id=gabriela] [data-test=leave-total]")
    check(total == "1.5", "0.5 + the full day on 19 Jan: " + total)
    app.tab(CALENDAR)
    check(app.page.eval_on_selector_all("[data-lane=gabriela] .scp-shade--leave", "e => e.map(x => x.innerText)") == ["Afternoon", "Full day"], "shades")
    check((span(app, "NWD-421|ba", 0), span(app, "NWD-421|ba", 1)) == ((39, 76), (81, 100)), (span(app, "NWD-421|ba", 0), span(app, "NWD-421|ba", 1)))
    check(app.page.inner_text(card(app, "NWD-421|ba", 0)).endswith("BA \u00b7 3.2 \u00b7 1/2"), app.page.inner_text(card(app, "NWD-421|ba", 0)))
    app.tab(CAPACITY)
    check(app.text("[data-test=capacity] tr[data-id=gabriela] [data-col=leave]") == "Wed 13 Jan (Afternoon) \u00b7 Tue 19 Jan (Full day)",
          app.text("[data-test=capacity] tr[data-id=gabriela] [data-col=leave]"))


@test("US-16 AC-4 Work past the sprint end: Marc's last card sits in the After sprint end zone; he is done Wed 27")
def _(app):
    design_sprint(app)
    check(span(app, "NWD-441|dev")[0] > 150, span(app, "NWD-441|dev"))
    check("done Wed 27" in app.text("[data-row=marc] [data-test=row-pace]"), app.text("[data-row=marc] [data-test=row-pace]"))
    check("done Fri 15" in app.text("[data-row=lorenzo] [data-test=row-pace]"), "Lorenzo")
    days = app.page.eval_on_selector_all(".scp-cal__day.is-after b", "e => e.map(x => x.innerText)")
    check(days == ["25", "26", "27", "28"] and "After sprint end" in app.text(".scp-cal__week--after"), days)


@test("US-16 AC-5 Cards with no person go to the Unassigned lane, the no-SP ticket greyed")
def _(app):
    design_sprint(app)
    check(lane_of(app, "NWD-441|ba") == "" and lane_of(app, "NWD-444|none") == "", "both unassigned")
    check(app.text("[data-row=''] [data-test=row-info]") == "2 cards · 1.2 MD", app.text("[data-row=''] [data-test=row-info]"))
    check("No SP · 0 MD" in app.page.inner_text(card(app, "NWD-444|none")), "grey card text")


@test("US-16 Clicking a card selects its ticket and shows its twin")
def _(app):
    design_sprint(app)
    app.page.click(card(app, "NWD-421|dev"))
    app.settle()
    sel = app.page.eval_on_selector_all(".scp-ccard.is-selected", "e => e.map(x => x.dataset.card + '/' + x.dataset.part)")
    check(sel == ["NWD-421|dev/0", "NWD-421|dev/1", "NWD-421|ba/0"], sel)
    d = app.text("[data-test=selected-detail]")
    check("8 SP → 12.0 MD (Dev 7.2 Marc, split around leave · BA 4.8 Gabriela)" in d, d)


# ---------------------------------------------------------------- US-17

@test("US-17 AC-1 Drag Marc's NWD-427 Dev card to Lorenzo: both loads and the verdict update within 1 second")
def _(app):
    design_sprint(app)
    t0 = time.time()
    drag(app, "NWD-427|dev", "lorenzo", 12)
    took = time.time() - t0
    check(lane_of(app, "NWD-427|dev") == "lorenzo", lane_of(app, "NWD-427|dev"))
    check((badge(app, "marc"), badge(app, "lorenzo")) == ("9.0 / 8.8", "10.2 / 12.8"), (badge(app, "marc"), badge(app, "lorenzo")))
    check("102%" in verdict(app)[2], verdict(app))
    check(took < 1.0 + 0.6, "drag + update took %.2fs (incl. ~0.5s of mouse moves)" % took)
    check(app.state("S.planDirty") is True, "unsaved")


@test("US-17 AC-2 A card dropped at day 11.3 starts at day 11.5; the gap before it stays empty and moves Done")
def _(app):
    design_sprint(app)
    drag(app, "NWD-441|dev", "lorenzo", 11.3)
    check(app.state("S.plan.cards.find(c => c.key === 'NWD-441' && c.role === 'dev').start") == 11.5, app.state("S.plan.cards"))
    check(span(app, "NWD-441|dev")[0] == 116, span(app, "NWD-441|dev"))
    check("done Thu 21" in app.text("[data-row=lorenzo] [data-test=row-pace]"), app.text("[data-row=lorenzo] [data-test=row-pace]"))
    check(app.page.locator(card(app, "NWD-438|dev")).count() == 1 and span(app, "NWD-438|dev") == (93, 100), "auto cards stay packed")


@test("US-17 AC-3 Dropped onto another card: later cards move right and none overlap")
def _(app):
    design_sprint(app)
    drag(app, "NWD-441|dev", "lorenzo", 3.5)
    spans = app.page.eval_on_selector_all("[data-lane=lorenzo] .scp-ccard", "e => e.map(x => [x.dataset.card, getComputedStyle(x).gridColumnStart|0, getComputedStyle(x).gridColumnEnd|0])")
    spans.sort(key=lambda s: s[1])
    check(spans[0][0] == "NWD-441|dev" and spans[0][1] == 36, spans)
    for i in range(1, len(spans)):
        check(spans[i][1] >= spans[i - 1][2], ("overlap", spans))
    check([s[0] for s in spans] == ["NWD-441|dev", "NWD-412|dev", "NWD-433|dev", "NWD-438|dev"], spans)


@test("US-17 AC-4 A Dev card dropped on a BA-only resource asks first; Cancel keeps it, OK moves it")
def _(app):
    design_sprint(app)
    app.on_dialog(accept=False)
    drag(app, "NWD-427|dev", "gabriela", 14)
    app.settle(200)
    msgs = app.dialogs
    check(msgs and "Dev card" in msgs[0] and "Gabriela is BA only" in msgs[0], msgs)
    check(lane_of(app, "NWD-427|dev") == "marc", "Cancel keeps it on Marc")
    app.on_dialog(accept=True)
    drag(app, "NWD-427|dev", "gabriela", 14)
    app.settle(200)
    check(lane_of(app, "NWD-427|dev") == "gabriela", "OK moves it")


@test("US-17 AC-5 Keyboard: arrow keys move a focused card to another person and by half a day, focus stays on it")
def _(app):
    design_sprint(app)
    app.page.focus(card(app, "NWD-441|dev"))
    app.page.keyboard.press("ArrowUp")
    app.settle()
    check(lane_of(app, "NWD-441|dev") == "lorenzo", lane_of(app, "NWD-441|dev"))
    check(app.page.evaluate("() => document.activeElement.dataset.card") == "NWD-441|dev", "focus kept")
    before = app.state("S.plan.cards.find(c => c.key === 'NWD-441').start")
    app.page.keyboard.press("ArrowRight")
    app.settle()
    check(app.state("S.plan.cards.find(c => c.key === 'NWD-441').start") == before + 0.5, (before, app.state("S.plan.cards")))
    app.page.keyboard.press("ArrowDown")
    app.settle()
    check(lane_of(app, "NWD-441|dev") == "marc", "back to Marc")


@test("US-17 A card dropped on the Unassigned lane leaves its person; the grey no-SP card cannot be dragged")
def _(app):
    design_sprint(app)
    drag(app, "NWD-427|dev", "", 2)
    check(lane_of(app, "NWD-427|dev") == "", "unassigned")
    check(badge(app, "marc") == "9.0 / 8.8", badge(app, "marc"))
    drag(app, "NWD-444|none", "lorenzo", 2)
    check(lane_of(app, "NWD-444|none") == "", "no-SP card stays")


# ---------------------------------------------------------------- US-18

@test("US-18 AC-2 At risk: names Marc, his overrun and his finish date; role figures 28.8 / 33.5 and 19.2 / 23.4")
def _(app):
    design_sprint(app)
    status, title, detail = verdict(app)
    check(status == "atRisk" and title == "At risk — role totals fit, one person is overloaded", (status, title))
    check("Marc planned at 122% (+2.0 MD), finishing 3 days after sprint end (done Wed 27 Jan)" in detail, detail)
    check("Lorenzo has 4.4 MD free" in detail and "2 tickets flagged in Tab 1 (no BA, no SP)" in detail, detail)
    check((app.text("[data-test=dev-fit]"), app.text("[data-test=ba-fit]")) == ("28.8 / 33.5 MD", "19.2 / 23.4 MD"), "figures")
    check("Planned 48.0 MD" in app.text("[data-test=progress]") and "84% of net capacity" in app.text("[data-test=progress]"), "progress")


@test("US-18 AC-1 Feasible once Marc's NWD-427 and NWD-441 Dev cards move to Lorenzo")
def _(app):
    design_sprint(app)
    move(app, "NWD-427|dev", "lorenzo", 12)
    move(app, "NWD-441|dev", "lorenzo", 14)
    status, title, _ = verdict(app)
    check(status == "feasible" and title.startswith("Feasible"), (status, title))
    check("No overload" in app.text("[data-test=overload]"), app.text("[data-test=overload]"))


@test("US-18 AC-3 Not feasible: BA load above BA net names the biggest gap")
def _(app):
    design_sprint(app, config=saved_config(split={"ba": 60, "dev": 40}))
    status, title, detail = verdict(app)
    check(status == "notFeasible" and title == "Not feasible — BA overloaded by 5.4 MD", (status, title))
    check("Gabriela +" in detail, detail)


@test("US-18 AC-4 A card on a person with no time (0% available) makes the verdict at least At risk")
def _(app):
    design_sprint(app)
    move(app, "NWD-427|dev", "lorenzo", 12)
    move(app, "NWD-441|dev", "lorenzo", 14)
    check(verdict(app)[0] == "feasible", "feasible first")
    app.tab(RESOURCES)
    app.page.fill("[data-act=availability][data-id=lorenzo]", "0")
    app.page.press("[data-act=availability][data-id=lorenzo]", "Tab")
    app.settle()
    app.tab(CALENDAR)
    check(verdict(app)[0] in ("atRisk", "notFeasible"), verdict(app))
    check(app.page.locator("[data-lane=lorenzo] .scp-ccard.is-onabsence").count() > 0, "cards marked")


@test("US-05 AC-2 Raising the overloaded threshold to 125% recolours Marc's badge")
def _(app):
    design_sprint(app, config=saved_config(thresholds={"under": 80, "over": 125}))
    check(app.page.get_attribute("[data-row=marc] [data-test=row-load]", "data-load") == "ok", "122% is not over 125%")
    check(verdict(app)[0] == "atRisk", "the verdict still uses 100%")


# ---------------------------------------------------------------- US-19

@test("US-19 AC-1 Overload detail: Marc's cards past the sprint end, largest first")
def _(app):
    design_sprint(app)
    head = app.text("[data-test=overload] .scp-overload__head")
    items = app.page.eval_on_selector_all("[data-test=overload] li", "e => e.map(x => x.innerText)")
    check(head == "Marc · 10.8 / 8.8 MD (122%)", head)
    check(items == ["NWD-441 · DEV 1.8 MD after sprint end", "NWD-427 · DEV 1.8 MD runs past sprint end"], items)


@test("US-19 AC-2 Selecting a ticket in the list shows the verdict without it")
def _(app):
    design_sprint(app)
    app.page.click("[data-act=without][data-key=NWD-441]")
    app.settle()
    w = app.text("[data-test=without]")
    check(w == "Without NWD-441: Marc 9.0 / 8.8 MD (102%) · verdict At risk", w)
    app.page.click("[data-act=without][data-key=NWD-441]")
    app.settle()
    check(app.page.locator("[data-test=without]").count() == 0, "click again to clear")


# ---------------------------------------------------------------- with other tabs

@test("US-10 AC-4 After a drag, Tab 1 shows the new person marked 'moved in calendar'; Tab 3 Planned follows")
def _(app):
    design_sprint(app)
    drag(app, "NWD-427|dev", "lorenzo", 12)
    app.tab(TICKETS)
    row = app.text("[data-test=tickets] tr[data-key='NWD-427']")
    check("Lorenzo" in row and "moved in calendar" in row, row)
    app.tab(CAPACITY)
    check(app.text("[data-test=capacity] tr[data-id=marc] [data-col=planned]").startswith("9.0"), "Tab 3")


@test("US-20 Calendar moves are saved with Save plan and survive a page reload")
def _(app):
    design_sprint(app)
    drag(app, "NWD-441|dev", "lorenzo", 11.3)
    app.page.click("[data-act=save-plan]")
    app.page.wait_for_selector(".scp-notice >> text=Plan saved")
    saved = app.attachment("scp-plan.json")
    check({"key": "NWD-441", "role": "dev", "person": "lorenzo", "start": 11.5} in saved["cards"], saved["cards"])
    app.reload()
    app.tab(CALENDAR)
    check(lane_of(app, "NWD-441|dev") == "lorenzo" and span(app, "NWD-441|dev")[0] == 116, "kept after reload")


@test("US-11 AC-2/AC-3 Reload: a removed ticket loses its cards; an earlier sprint end sends cards beyond it to Unassigned")
def _(app):
    design_sprint(app)
    move(app, "NWD-433|dev", "priya", 13)
    sprints = app.fixture("sprints")
    for b in sprints:
        for s in sprints[b]:
            if s["id"] == 2600:
                s["endDate"] = "2027-01-19T18:00:00.000+01:00"          # 12 working days instead of 15
    app.set_fixture("sprints", sprints)
    issues = app.fixture("issues")
    issues["2600"] = [i for i in issues["2600"] if i["key"] != "NWD-433"]
    app.set_fixture("issues", issues)
    app.tab(TICKETS)
    app.page.click("[data-act=reload]")
    app.page.wait_for_selector("[data-test=changes]")
    check(not any(c["key"] == "NWD-433" for c in app.state("S.plan.cards")), "NWD-433 move deleted")
    app.tab(CALENDAR)
    check(app.page.locator("[data-card^='NWD-433']").count() == 0, "no NWD-433 cards")
    check(lane_of(app, "NWD-441|dev") == "", "Marc's NWD-441 started after the new end: now Unassigned")
    check(lane_of(app, "NWD-412|dev") == "lorenzo", "cards before the end stay")


@test("US-16 No plan open: Tab 4 says so")
def _(app):
    app.open("ok", attachments=att("scp-config.json", saved_config()))
    app.tab(CALENDAR)
    check(app.page.locator("[data-test=no-plan]").count() == 1, app.text(".scp-body"))


if __name__ == "__main__":
    sys.exit(1 if run(sys.argv[1] if len(sys.argv) > 1 else None) else 0)
