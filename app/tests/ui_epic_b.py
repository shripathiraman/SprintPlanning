"""
tests/ui_epic_b.py — TEST ONLY. Browser tests for Epic B · Tab 1 Sprint Tickets (US-07 to US-11).
Run: python3 tests/ui_epic_b.py
"""
import sys

from uitest import check, run, test
from fixtures import att, saved_config

TICKETS = "1 · Sprint Tickets"


def start(app, config=None, **kw):
    """Open the page with a saved Squad Orion config and go to Tab 1."""
    app.open("ok", attachments=att("scp-config.json", config or saved_config()), **kw)
    app.page.wait_for_function("() => window.SCP.state.jira.sprints.length > 0")
    app.tab(TICKETS)


def open_plan(app, sprint="2600", save=False):
    app.page.select_option("[data-act=sprint]", sprint)
    app.settle()
    app.page.click("[data-act=new-plan]")
    app.page.wait_for_selector("[data-test=tickets]")
    app.settle()
    if save:
        app.page.click("[data-act=save-plan]")
        app.page.wait_for_selector(".scp-notice >> text=Plan saved")


def row(app, key):
    return app.page.inner_text("[data-test=tickets] tr[data-key='%s']" % key)


def cell(app, key, col):
    return app.page.inner_text("[data-test=tickets] tr[data-key='%s'] [data-col=%s]" % (key, col)).strip()


def with_issue(app, key, **changes):
    """Change one fixture ticket in the fake Jira."""
    issues = app.fixture("issues")
    for i in issues["2600"]:
        if i["key"] == key:
            i.update(changes)
    app.set_fixture("issues", issues)


# ---------------------------------------------------------------- US-07

@test("US-07 AC-1 The sprint selector lists only future sprints")
def _(app):
    start(app)
    opts = app.page.eval_on_selector("[data-act=sprint]", "s => [...s.options].map(o => o.text)")
    check(opts == ["Choose a future sprint", "Sprint 26 · 4–22 Jan", "Sprint 27 · 25 Jan–12 Feb"], opts)


@test("US-07 AC-2 Header shows name, goal, dates and 15 working days")
def _(app):
    start(app)
    open_plan(app)
    check(app.text("[data-test=plan-title]") == "Sprint 26 · Squad Orion", app.text("[data-test=plan-title]"))
    check(app.text("[data-test=goal]") == "Delivery fee lines live for all store customers", app.text("[data-test=goal]"))
    check(app.text("[data-test=dates]") == "Mon 4 – Fri 22 Jan 2027", app.text("[data-test=dates]"))
    check(app.text("[data-test=working-days]") == "15", app.text("[data-test=working-days]"))


@test("US-07 AC-2 A plan for 3-21 Aug shows 15 working days")
def _(app):
    app.open("ok", attachments=att("scp-config.json", saved_config()))
    sprints = app.fixture("sprints")
    sprints["41"].append({"id": 1800, "name": "Sprint 18", "state": "future", "goal": "Summer release",
                          "startDate": "2026-08-03T09:00:00.000+02:00", "endDate": "2026-08-21T18:00:00.000+02:00"})
    issues = app.fixture("issues")
    issues["1800"] = []
    app.set_fixture("sprints", sprints)
    app.set_fixture("issues", issues)
    app.reload()
    app.page.wait_for_function("() => window.SCP.state.jira.sprints.length > 4")
    app.tab(TICKETS)
    app.page.select_option("[data-act=sprint]", "1800")
    app.settle()
    app.page.click("[data-act=new-plan]")
    app.page.wait_for_selector("[data-test=working-days]")
    check(app.text("[data-test=working-days]") == "15", app.text("[data-test=working-days]"))
    check(app.text("[data-test=dates]") == "Mon 3 – Fri 21 Aug 2026", app.text("[data-test=dates]"))


@test("US-07 AC-3 Starting another plan asks to close the current one first")
def _(app):
    start(app)
    open_plan(app, save=True)
    app.on_dialog(accept=False)
    app.page.select_option("[data-act=sprint]", "2700")
    app.settle(300)
    check(app.dialogs and "Close the Sprint 26 plan" in app.dialogs[0], app.dialogs)
    check(app.state("S.plan.sprint.name") == "Sprint 26", "plan kept when declined")
    check(app.page.eval_on_selector("[data-act=sprint]", "s => s.selectedOptions[0].text").startswith("Sprint 26"), "selector reset")
    app.on_dialog(accept=True)
    app.page.select_option("[data-act=sprint]", "2700")
    app.page.wait_for_selector("[data-test=plan-title] >> text=Sprint 27")
    check(app.state("S.plan.tickets.length") == 1, "Sprint 27 tickets loaded")


@test("US-07 A new plan shows Unsaved changes; Save plan keeps it after a page reload")
def _(app):
    start(app)
    open_plan(app)
    check(app.page.is_visible("[data-test=unsaved]"), "unsaved marker")
    app.page.click("[data-act=save-plan]")
    app.page.wait_for_selector(".scp-notice >> text=Plan saved")
    check(not app.page.is_visible("[data-test=unsaved]"), "marker cleared")
    check(app.attachment("scp-plan.json")["sprint"]["name"] == "Sprint 26", "saved")
    app.reload()
    app.tab(TICKETS)
    check(app.text("[data-test=plan-title]") == "Sprint 26 · Squad Orion", "plan back after reload")
    check(app.page.locator("[data-test=tickets] tbody tr").count() == 10, "10 tickets")


# ---------------------------------------------------------------- US-08

@test("US-08 AC-1 Each row shows Ticket, Summary, Type, Contributor, Backup Assignee, SP, Total, Dev and BA MD")
def _(app):
    start(app)
    open_plan(app)
    heads = app.page.eval_on_selector_all("[data-test=tickets] thead th", "e => e.map(x => x.innerText)")
    check(heads == ["Ticket", "Summary", "Type", "Contributor (Dev)", "Backup Assignee (BA)", "SP", "Total MD", "Dev MD", "BA MD"], heads)
    r = row(app, "NWD-412").split("\t")
    check([x.strip() for x in r] == ["NWD-412", "Order confirmation email — new fee line", "Story", "Lorenzo", "Gabriela", "5", "8.0", "4.8", "3.2"], r)
    r = [x.strip() for x in row(app, "NWD-421").split("\t")]
    check(r[3:] == ["Marc", "Gabriela", "8", "12.0", "7.2", "4.8"], r)


@test("US-08 AC-2 The 10-ticket fixture's totals match the hand-calculated values")
def _(app):
    start(app)
    open_plan(app)
    tot = [x.strip() for x in app.text("[data-test=totals]").split("\t")]
    # Hand-calculated from the PRD bands at 40/60: SP 31, MD 48.0, Dev 28.8, BA 19.2
    check(tot == ["Total", "10 tickets · 2 flagged", "31", "48.0", "28.8", "19.2"], tot)
    check(app.text("[data-test=ticket-facts]") == "10 · 31 · 48.0", app.text("[data-test=ticket-facts]"))


@test("US-08 AC-3 A ticket key links to that ticket on jira.northwind.example")
def _(app):
    start(app)
    open_plan(app)
    a = app.page.locator("[data-test=tickets] tr[data-key='NWD-412'] a")
    check(a.get_attribute("href") == "https://jira.northwind.example/browse/NWD-412", a.get_attribute("href"))
    check(a.get_attribute("target") == "_blank", "opens in a new tab")


@test("US-02 AC-3 / FR-3 Unticking Bug: no Bug tickets in Tab 1; Task and other squads never load")
def _(app):
    start(app)
    open_plan(app)
    check("NWD-450" not in app.text("[data-test=tickets]") and "NWD-460" not in app.text("[data-test=tickets]"), "Task / Vega filtered")
    check('cf[11200] = "Squad Orion"' in app.page.evaluate("() => window.SCP_MOCK.lastJql"), "team filter in JQL")
    app.tab("Config")
    app.page.uncheck("[data-act=issuetype][value=Bug]")
    app.settle()
    app.tab(TICKETS)
    app.page.click("[data-act=reload]")
    app.page.wait_for_selector("[data-test=changes]")
    t = app.text("[data-test=tickets]")
    check("NWD-427" not in t and "NWD-441" not in t, "Bug tickets still listed")
    check(app.page.locator("[data-test=tickets] tbody tr").count() == 8, "8 stories")
    check('issuetype in ("Story")' in app.page.evaluate("() => window.SCP_MOCK.lastJql"), app.page.evaluate("() => window.SCP_MOCK.lastJql"))


# ---------------------------------------------------------------- US-09

@test("US-09 AC-1 No Story Points: flagged and 0 MD")
def _(app):
    start(app)
    open_plan(app)
    tr = app.page.locator("[data-test=tickets] tr[data-key='NWD-444']")
    check("is-flagged" in tr.get_attribute("class"), "row flagged")
    check([cell(app, "NWD-444", c) for c in ["total", "devmd", "bamd"]] == ["0.0", "0.0", "0.0"], "0 MD")
    check(cell(app, "NWD-444", "sp") == "⚠ —", cell(app, "NWD-444", "sp"))
    # The greyed card in the Unassigned lane is tested with US-16.


@test("US-09 AC-2 No BA: Dev 1.8 MD stays, BA 1.2 MD marked for Unassigned")
def _(app):
    start(app)
    open_plan(app)
    check(cell(app, "NWD-441", "dev") == "Marc", cell(app, "NWD-441", "dev"))
    check(cell(app, "NWD-441", "devmd") == "1.8" and cell(app, "NWD-441", "bamd") == "1.2", "MD kept")
    check("Missing → Unassigned" in cell(app, "NWD-441", "ba"), cell(app, "NWD-441", "ba"))


@test("US-09 AC-3 SP 13 with bands only up to 8: 'SP outside bands' and 0 MD")
def _(app):
    cfg = saved_config(bands=saved_config()["bands"][:5])
    app.open("ok", attachments=att("scp-config.json", cfg))
    with_issue(app, "NWD-421", sp=13)
    app.reload()
    app.page.wait_for_function("() => window.SCP.state.jira.sprints.length > 0")
    app.tab(TICKETS)
    open_plan(app)
    check(cell(app, "NWD-421", "total") == "0.0", cell(app, "NWD-421", "total"))
    check("NWD-421 SP outside bands (0 MD)" in app.text("[data-test=flags]"), app.text("[data-test=flags]"))


@test("US-09 AC-4 The summary states how many tickets are flagged and why")
def _(app):
    start(app)
    open_plan(app)
    t = app.text("[data-test=flags]")
    check("2 tickets flagged — fix in Jira, then reload" in t, t)
    check("NWD-441 no Backup Assignee" in t and "NWD-444 no Story Points, no Dev, no BA (0 MD)" in t, t)


# ---------------------------------------------------------------- US-10

@test("US-10 AC-1 Contributor A and B: dropdown with A selected, ticket planned on A")
def _(app):
    start(app)
    open_plan(app)
    sel = app.page.locator("[data-act=pick][data-key='NWD-418'][data-role=dev]")
    check(sel.eval_on_selector_all("option", "o => o.map(x => x.text)") if False else
          app.page.eval_on_selector("[data-act=pick][data-key='NWD-418']", "s => [...s.options].map(o => o.text)") == ["Priya", "Marc"], "options")
    check(app.page.eval_on_selector("[data-act=pick][data-key='NWD-418']", "s => s.selectedOptions[0].text") == "Priya", "default first")
    t = app.text("[data-test=multi]")
    check("1 ticket has more than one" in t and "NWD-418 lists Priya and Marc · planned on Priya (first listed)" in t, t)
    check(app.page.locator("[data-test=flags] >> text=NWD-418").count() == 0, "not flagged")


@test("US-10 AC-2 Pick B, save, reload: still planned on B")
def _(app):
    start(app)
    open_plan(app)
    app.page.select_option("[data-act=pick][data-key='NWD-418']", "marc")
    app.settle()
    check(app.page.is_visible("[data-test=unsaved]"), "dirty")
    check("planned on Marc (your choice)" in app.text("[data-test=multi]"), app.text("[data-test=multi]"))
    app.page.click("[data-act=save-plan]")
    app.page.wait_for_selector(".scp-notice >> text=Plan saved")
    app.reload()
    app.tab(TICKETS)
    check(app.page.eval_on_selector("[data-act=pick][data-key='NWD-418']", "s => s.selectedOptions[0].text") == "Marc", "kept after reload")
    app.page.click("[data-act=reload]")                       # also survives Reload from Jira
    app.page.wait_for_selector("[data-test=changes]")
    check(app.page.eval_on_selector("[data-act=pick][data-key='NWD-418']", "s => s.selectedOptions[0].text") == "Marc", "kept after Reload")


@test("US-10 AC-3 B removed in Jira: ticket returns to A and Reload lists the change")
def _(app):
    start(app)
    open_plan(app)
    app.page.select_option("[data-act=pick][data-key='NWD-418']", "marc")
    app.settle()
    app.page.click("[data-act=save-plan]")
    app.page.wait_for_selector(".scp-notice >> text=Plan saved")
    with_issue(app, "NWD-418", dev=["priya", "lorenzo"])
    app.page.click("[data-act=reload]")
    app.page.wait_for_selector("[data-test=changes]")
    check(app.page.eval_on_selector("[data-act=pick][data-key='NWD-418']", "s => s.selectedOptions[0].text") == "Priya", "back to A")
    t = app.text("[data-test=changes]")
    check("NWD-418 Marc no longer in Contributor → back to Priya" in t, t)


# ---------------------------------------------------------------- US-11

@test("US-11 AC-1 SP changed and a ticket removed: both listed with the last-loaded time")
def _(app):
    start(app)
    open_plan(app, save=True)
    first_load = app.state("S.plan.loadedAt")
    issues = app.fixture("issues")
    issues["2600"] = [i for i in issues["2600"] if i["key"] != "NWD-438"]
    for i in issues["2600"]:
        if i["key"] == "NWD-421":
            i["sp"] = 5
        if i["key"] == "NWD-427":
            i["ba"] = ["gabriela"]
    issues["2600"].append({"key": "NWD-446", "summary": "New late ticket", "type": "Story", "team": "Squad Orion",
                           "sp": 1, "dev": ["priya"], "ba": ["karthik"]})
    app.set_fixture("issues", issues)
    app.page.click("[data-act=reload]")
    app.page.wait_for_selector("[data-test=changes]")
    t = app.text("[data-test=changes]")
    when = app.page.evaluate("iso => window.SCP.ui.fmtWhen(iso)", first_load)
    check("Changed since last load (" + when + ")" in t, t)
    for c in ["NWD-421 SP 8 → 5", "− NWD-438 removed", "+ NWD-446 added", "NWD-427 BA Karthik → Gabriela"]:
        check(c in t, "missing change '%s' in: %s" % (c, t))
    check(app.page.is_visible("[data-test=unsaved]"), "reload result needs Save plan")


@test("US-11 AC-1 Reload with nothing changed says so")
def _(app):
    start(app)
    open_plan(app)
    app.page.click("[data-act=reload]")
    app.page.wait_for_selector("[data-test=changes]")
    check("No changes since last load" in app.text("[data-test=changes]"), app.text("[data-test=changes]"))


@test("US-11 AC-2 A ticket that left the sprint has its cards deleted from the plan")
def _(app):
    start(app)
    open_plan(app)
    app.page.evaluate("""() => { window.SCP.state.plan.cards = [
        { key: 'NWD-438', role: 'dev', person: 'lorenzo' }, { key: 'NWD-412', role: 'dev', person: 'lorenzo' }]; }""")
    issues = app.fixture("issues")
    issues["2600"] = [i for i in issues["2600"] if i["key"] != "NWD-438"]
    app.set_fixture("issues", issues)
    app.page.click("[data-act=reload]")
    app.page.wait_for_selector("[data-test=changes]")
    check(app.state("S.plan.cards.map(c => c.key)") == ["NWD-412"], app.state("S.plan.cards"))
    check("NWD-438" not in app.text("[data-test=tickets]"), "row gone")


@test("US-11 AC-3 (Tab 1 part) Sprint end moved earlier: change listed, working days recalculated")
def _(app):
    start(app)
    open_plan(app)
    sprints = app.fixture("sprints")
    for s in sprints["41"]:
        if s["id"] == 2600:
            s["endDate"] = "2027-01-20T18:00:00.000+01:00"
    app.set_fixture("sprints", sprints)
    app.page.click("[data-act=reload]")
    app.page.wait_for_selector("[data-test=changes]")
    check("Sprint end Fri 22 Jan → Wed 20 Jan" in app.text("[data-test=changes]"), app.text("[data-test=changes]"))
    check(app.text("[data-test=working-days]") == "13", app.text("[data-test=working-days]"))
    # Capacity recalculation and cards beyond the new end moving to Unassigned are tested with US-15 / US-16.


@test("US-11 AC-4 Jira unreachable at page load: last data visible with a banner, Reload disabled")
def _(app):
    start(app)
    open_plan(app, save=True)
    app.page.evaluate("() => localStorage.setItem('scp-mock-scenario', 'down')")
    app.reload(wait_connected=False)
    app.page.wait_for_selector("[data-test=conn-status] >> text=could not be reached")
    app.tab(TICKETS)
    check(app.page.locator("[data-test=tickets] tbody tr").count() == 10, "last data visible")
    banner = app.text("[data-test=offline-banner]")
    check("Jira is not available" in banner and "last loaded" in banner, banner)
    check(app.page.is_disabled("[data-act=reload]"), "Reload disabled")


@test("US-11 Reload is disabled before a plan is open")
def _(app):
    start(app)
    check(app.page.is_disabled("[data-act=reload]"), "no plan, no reload")
    check(app.page.is_visible("[data-test=no-plan]"), "empty state")


if __name__ == "__main__":
    sys.exit(1 if run(sys.argv[1] if len(sys.argv) > 1 else None) else 0)
