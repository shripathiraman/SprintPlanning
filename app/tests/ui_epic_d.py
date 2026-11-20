"""
tests/ui_epic_d.py — TEST ONLY. Browser tests for Epic D · Tab 3 Capacity (US-15),
plus the end of US-12 AC-3 (a resource with no location blocks Tab 3).
Run: python3 tests/ui_epic_d.py
"""
import sys

from fixtures import att, last_plan, saved_config
from uitest import check, run, test

TICKETS = "1 · Sprint Tickets"
RESOURCES = "2 · Resources & Leave"
CAPACITY = "3 · Capacity"
MINUS = "−"


def start(app, with_last_plan=True, config=None):
    """Saved config (+ saved Sprint 25 plan), New Sprint Planning for Sprint 26, then Tab 2."""
    a = att("scp-config.json", config or saved_config())
    if with_last_plan:
        a.update(att("scp-plan.json", last_plan()))
    app.open("ok", attachments=a)
    app.page.wait_for_function("() => window.SCP.state.jira.sprints.length > 0")
    app.tab(TICKETS)
    if with_last_plan:
        app.on_dialog(accept=True)            # close the Sprint 25 plan first (US-07 AC-3)
        app.page.select_option("[data-act=sprint]", "2600")
    else:
        app.page.select_option("[data-act=sprint]", "2600")
        app.settle()
        app.page.click("[data-act=new-plan]")
    app.page.wait_for_selector("[data-test=tickets]")
    app.tab(RESOURCES)
    app.page.wait_for_selector("[data-test=resources]")


def leave(app, pid, date):
    app.page.click("[data-focus='leave-%s-%s']" % (pid, date))
    app.settle()


def design_sprint(app):
    """Tab 2 as on the Resources & Leave screen: Marc 80% with 7-8 Jan off, Gabriela 19 Jan, Karthik half of 21 Jan."""
    start(app)
    app.page.fill("[data-act=availability][data-id=marc]", "80")
    app.page.press("[data-act=availability][data-id=marc]", "Tab")
    app.settle()
    for pid, d in [("marc", "2027-01-07"), ("marc", "2027-01-08"), ("gabriela", "2027-01-19")]:
        leave(app, pid, d)
    leave(app, "karthik", "2027-01-21")
    leave(app, "karthik", "2027-01-21")       # full day -> morning
    app.tab(CAPACITY)
    app.page.wait_for_selector("[data-test=strip]")


def stat(app, key):
    v = app.page.inner_text("[data-stat=%s] .scp-stat__value" % key)
    n = app.page.inner_text("[data-stat=%s] .scp-stat__note" % key)
    return v, n


def cell(app, pid, col):
    return app.page.inner_text("[data-test=capacity] tr[data-id=%s] [data-col=%s]" % (pid, col)).strip()


def num(s):
    return float(s.replace(MINUS, "-").replace(" MD", "").replace("%", ""))


# ---------------------------------------------------------------- US-15

@test("US-15 AC-1 Gross: 15 working days x 5 resources reads 75.0 MD")
def _(app):
    design_sprint(app)
    check(stat(app, "gross") == ("75.0", "15 days × 5 people"), stat(app, "gross"))
    check(app.page.inner_text("[data-test=capacity-total] [data-col=days]") == "75", "total row days")


@test("US-15 Sprint 26 strip matches the design: -2.0 Pongal, -3.5 leave, -10.4 of 69.5, -2.2 Marc, 56.9 MD")
def _(app):
    design_sprint(app)
    got = [stat(app, k) for k in ["holidays", "leave", "ceremonies", "availability", "net"]]
    check(got == [(MINUS + "2.0", "Pongal · 2 in Chennai"), (MINUS + "3.5", "3 people"),
                  (MINUS + "10.4", "of 69.5 days left"), (MINUS + "2.2", "Marc at 80%"),
                  ("56.9 MD", "Dev 33.5 · BA 23.4")], got)
    check(app.text("[data-test=plan-title]") == "Sprint 26 · Squad Orion", "title")
    check("15 working days · ceremonies 15% · 5 resources in 2 locations" in app.text(".scp-sub"), app.text(".scp-sub"))


@test("US-15 Per-resource rows match the design: days, holiday, leave, x 85%, availability, net, leave dates")
def _(app):
    design_sprint(app)
    cols = ["days", "holidays", "minus-leave", "after", "availability", "net", "leave"]
    want = {
        "lorenzo": ["15", "0", "0", "12.75", "100%", "12.8", "—"],
        "marc": ["15", "0", MINUS + "2", "11.05", "80%", "8.8", "Thu 7 – Fri 8 Jan (Full day)"],
        "priya": ["15", MINUS + "1", "0", "11.90", "100%", "11.9", "—"],
        "gabriela": ["15", "0", MINUS + "1", "11.90", "100%", "11.9", "Tue 19 Jan (Full day)"],
        "karthik": ["15", MINUS + "1", MINUS + "0.5", "11.47", "100%", "11.5", "Thu 21 Jan (Morning)"],
    }
    for pid, w in want.items():
        got = [cell(app, pid, c) for c in cols]
        check(got == w, (pid, got))
    tot = [app.page.inner_text("[data-test=capacity-total] [data-col=%s]" % c) for c in ["holidays", "minus-leave", "after", "net"]]
    check(tot == ["2", "3.5", "59.1", "56.9"], tot)
    check(app.page.inner_text(".scp-captable thead").count("× 85%") == 1, "ceremony column named from Config")


@test("US-15 AC-2 Worked example: Luxembourg Dev at 80%, 2 days' leave, 1 Luxembourg holiday, 15% -> 8.2 MD")
def _(app):
    design_sprint(app)
    app.tab(RESOURCES)
    app.page.fill("[data-oneoff-date]", "2027-01-22")
    app.page.fill("[data-oneoff-name]", "Office closure")
    app.page.check("[data-oneoff-loc][value=lu]")
    app.page.click("[data-act=oneoff-add]")
    app.settle()
    app.tab(CAPACITY)
    got = [cell(app, "marc", c) for c in ["days", "holidays", "minus-leave", "availability", "net"]]
    check(got == ["15", MINUS + "1", MINUS + "2", "80%", "8.2"], got)        # (15 - 1 - 2) x 0.85 x 0.8 = 8.16
    check(stat(app, "holidays")[1] == "2 holidays · 5 person-days", stat(app, "holidays"))


@test("US-15 AC-3 Steps add up per person, per role and for the sprint")
def _(app):
    design_sprint(app)
    ids = app.page.eval_on_selector_all("[data-test=capacity] tbody tr", "e => e.map(r => r.dataset.id)")
    total = 0.0
    for pid in ids:
        d, h, l, a = (num(cell(app, pid, c)) for c in ["days", "holidays", "minus-leave", "availability"])
        net = (d + h + l) * 0.85 * a / 100
        check(abs(net - num(cell(app, pid, "net"))) <= 0.0501, (pid, net))   # shown to one decimal
        check(abs((d + h + l) * 0.85 - num(cell(app, pid, "after"))) <= 0.005, (pid, "x 85%"))
        total += net
    v = {k: num(stat(app, k)[0]) for k in ["gross", "holidays", "leave", "ceremonies", "availability", "net"]}
    check(abs(v["gross"] + v["holidays"] + v["leave"] + v["ceremonies"] + v["availability"] - v["net"]) <= 0.1, v)
    check(abs(total - v["net"]) <= 0.0501, (total, v["net"]))
    dev = num(app.page.inner_text("[data-role=Dev] .scp-rolecard__value"))
    ba = num(app.page.inner_text("[data-role=BA] .scp-rolecard__value"))
    check((dev, ba) == (33.5, 23.4) and abs(dev + ba - v["net"]) <= 0.1, (dev, ba))
    check(app.page.inner_text("[data-role=Dev] [data-names]") == "Lorenzo 12.8 · Marc 8.8 · Priya 11.9", "Dev names")
    check(app.page.inner_text("[data-role=BA] [data-names]") == "Gabriela 11.9 · Karthik 11.5", "BA names")


@test("US-15 AC-4 Read-only: no inputs on Tab 3, and 'Edit resources & leave' opens Tab 2")
def _(app):
    design_sprint(app)
    n = app.page.locator(".scp-body input, .scp-body select, .scp-body textarea, .scp-body [contenteditable]").count()
    check(n == 0, "%d editable fields on Tab 3" % n)
    check("Calculated · read-only" in app.text(".scp-head"), "read-only marker")
    app.page.click("[data-act=edit-resources]")
    app.settle()
    check(app.state("S.tab") == "resources", app.state("S.tab"))


@test("US-15 Planned load per person from the tickets, coloured by the Config thresholds")
def _(app):
    design_sprint(app)
    got = {pid: (cell(app, pid, "planned"),
                 app.page.get_attribute("tr[data-id=%s] [data-load]" % pid, "data-load"))
           for pid in ["lorenzo", "marc", "priya", "gabriela", "karthik"]}
    check(got == {"lorenzo": ("8.4 · 66%", "under"), "marc": ("10.8 · 122%", "over"),
                  "priya": ("9.6 · 81%", "ok"), "gabriela": ("10.4 · 87%", "ok"),
                  "karthik": ("7.6 · 66%", "under")}, got)
    check(app.page.inner_text("[data-test=capacity-total] [data-col=planned]") == "48.0 · 84%",
          "sprint total includes the 1.2 MD unassigned BA half of PCAP-441")


@test("US-15 Changes in Tab 2 recalculate Tab 3 straight away")
def _(app):
    design_sprint(app)
    app.tab(RESOURCES)
    leave(app, "lorenzo", "2027-01-11")
    app.tab(CAPACITY)
    check(cell(app, "lorenzo", "net") == "11.9" and stat(app, "net")[0] == "56.0 MD", (cell(app, "lorenzo", "net"), stat(app, "net")))
    check(app.state("S.planDirty") is True, "unsaved marker on")


@test("US-15 Role Both counts half toward Dev and half toward BA")
def _(app):
    design_sprint(app)
    app.tab(RESOURCES)
    app.page.select_option("[data-act=role][data-id=lorenzo]", "Both")
    app.settle()
    app.tab(CAPACITY)
    dev = app.page.inner_text("[data-role=Dev] .scp-rolecard__value")
    ba = app.page.inner_text("[data-role=BA] .scp-rolecard__value")
    check((dev, ba) == ("27.1 MD", "29.8 MD"), (dev, ba))
    check("Lorenzo 6.4" in app.page.inner_text("[data-role=BA] [data-names]"), "Lorenzo's half in BA")


@test("US-12 AC-3 / US-15 Tab 3 is blocked until every resource has a location, then shows capacity")
def _(app):
    start(app, with_last_plan=False)
    app.tab(CAPACITY)
    check(app.page.locator("[data-test=blocked]").count() == 1, "blocked")
    for pid, loc in [("lorenzo", "lu"), ("marc", "lu"), ("priya", "ch"), ("gabriela", "lu"), ("karthik", "ch")]:
        app.tab(RESOURCES)
        app.page.select_option("[data-act=location][data-id=%s]" % pid, loc)
        app.settle()
    app.tab(CAPACITY)
    check(app.page.locator("[data-test=strip]").count() == 1 and stat(app, "net")[0] == "62.1 MD", stat(app, "net"))   # 3 x 12.75 + 2 x 11.9


@test("US-05 AC-1 / US-15 Tab 3 is blocked while the ceremony % is not set")
def _(app):
    start(app, config=saved_config(ceremonyPct=None))
    app.tab(CAPACITY)
    check("ceremony %" in app.text("[data-test=blocked]"), app.text("[data-test=blocked]"))


@test("US-15 No plan open: Tab 3 says so")
def _(app):
    app.open("ok", attachments=att("scp-config.json", saved_config()))
    app.tab(CAPACITY)
    check(app.page.locator("[data-test=no-plan]").count() == 1, app.text(".scp-body"))


if __name__ == "__main__":
    sys.exit(1 if run(sys.argv[1] if len(sys.argv) > 1 else None) else 0)
