"""
tests/ui_epic_c.py — TEST ONLY. Browser tests for Epic C · Tab 2 Resources & Leave (US-12 to US-14).
Run: python3 tests/ui_epic_c.py
"""
import sys

from fixtures import att, last_plan, saved_config
from uitest import check, run, test

TICKETS = "1 · Sprint Tickets"
RESOURCES = "2 · Resources & Leave"
CAPACITY = "3 · Capacity"


def start(app, with_last_plan=True, config=None, issues_change=None):
    """Saved config (+ a saved Sprint 25 plan), then New Sprint Planning for Sprint 26, then Tab 2."""
    a = att("scp-config.json", config or saved_config())
    if with_last_plan:
        a.update(att("scp-plan.json", last_plan()))
    app.open("ok", attachments=a)
    if issues_change:
        issues = app.fixture("issues")
        issues_change(issues["2600"])
        app.set_fixture("issues", issues)
    app.page.wait_for_function("() => window.SCP.state.jira.sprints.length > 0")
    app.tab(TICKETS)
    if with_last_plan:
        app.on_dialog(accept=True)            # "close the Sprint 25 plan first" (US-07 AC-3)
        app.page.select_option("[data-act=sprint]", "2600")
    else:
        app.page.select_option("[data-act=sprint]", "2600")
        app.settle()
        app.page.click("[data-act=new-plan]")
    app.page.wait_for_selector("[data-test=tickets]")
    app.tab(RESOURCES)
    app.page.wait_for_selector("[data-test=resources]")


def rows(app):
    return app.page.eval_on_selector_all("[data-test=resources] tbody tr[data-id]", """trs => trs.map(tr => ({
        id: tr.dataset.id, name: tr.querySelector('th').childNodes[0].textContent.trim(),
        role: tr.querySelector('[data-act=role]').value,
        loc: tr.querySelector('[data-act=location]').selectedOptions[0].text,
        net: tr.querySelector('[data-net]').textContent, tag: !!tr.querySelector('[data-test=not-in-team]') }))""")


def net(app, pid):
    return app.text("[data-net='%s']" % pid)


def cell(app, pid, date):
    return app.page.locator("[data-focus='leave-%s-%s']" % (pid, date))


def set_value(app, sel, value):
    app.page.fill(sel, value)
    app.page.press(sel, "Tab")
    app.settle()


# ---------------------------------------------------------------- US-12

@test("US-12 AC-1 Pre-filled: each ticket person once, role and location from the last plan")
def _(app):
    start(app)
    r = rows(app)
    check([x["name"] for x in r] == ["Lorenzo", "Marc", "Priya", "Gabriela", "Karthik"], r)
    check([(x["role"], x["loc"]) for x in r] == [("Dev", "Luxembourg"), ("Dev", "Luxembourg"), ("Dev", "Chennai"),
                                                  ("BA", "Luxembourg"), ("BA", "Chennai")], r)
    check(not any(x["tag"] for x in r), "team members are not tagged")
    check(all(t.strip() == "Tickets + team" for t in app.page.eval_on_selector_all(
        "[data-test=resources] tbody tr td:nth-child(2)", "e => e.map(x => x.innerText)")), "source")


@test("US-12 AC-1 First plan (no last plan): roles come from the tickets, locations still to set")
def _(app):
    start(app, with_last_plan=False)
    r = {x["name"]: (x["role"], x["loc"], x["tag"]) for x in rows(app)}
    check(r["Lorenzo"] == ("Dev", "Choose…", False) and r["Karthik"] == ("BA", "Choose…", False), r)
    check(len(r) == 5, "Priya and Marc of PCAP-418 appear once each")


@test("US-12 Team members not on any ticket this sprint still carry over (source Team)")
def _(app):
    def drop_karthik(issues):
        for i in issues:
            i["ba"] = [b for b in i["ba"] if b != "karthik"]
    start(app, issues_change=drop_karthik)
    k = [x for x in rows(app) if x["name"] == "Karthik"]
    check(k and k[0]["loc"] == "Chennai", rows(app))
    check(app.page.inner_text("tr[data-id=karthik] td:nth-child(2)").strip() == "Team", "source Team")


@test("US-12 AC-2 Someone outside the team gets a 'not in team' tag; Confirm keeps them")
def _(app):
    def add_chloe(issues):
        for i in issues:
            if i["key"] == "PCAP-438":
                i["ba"] = ["chloe"]
    start(app, issues_change=add_chloe)
    chloe = [x for x in rows(app) if x["name"] == "Chloe"]
    check(chloe and chloe[0]["tag"], rows(app))
    app.page.click("[data-act=confirm][data-id=chloe]")
    app.settle()
    check(not [x for x in rows(app) if x["name"] == "Chloe"][0]["tag"], "tag cleared")
    check("chloe" in app.state("S.plan.team"), "joined the team")


@test("US-12 AC-2 Remove a 'not in team' person: gone, and not re-added by Reload")
def _(app):
    def add_chloe(issues):
        for i in issues:
            if i["key"] == "PCAP-438":
                i["ba"] = ["chloe"]
    start(app, issues_change=add_chloe)
    app.page.click("[data-test=not-in-team] ~ [data-act=remove][data-id=chloe]")
    app.settle()
    check("Chloe" not in [x["name"] for x in rows(app)], "removed")
    app.tab(TICKETS)
    app.page.click("[data-act=reload]")
    app.page.wait_for_selector("[data-test=changes]")
    app.tab(RESOURCES)
    check("Chloe" not in [x["name"] for x in rows(app)], "stays removed after Reload")


@test("US-12 AC-2 A person new on the tickets after Reload joins Tab 2 with the tag")
def _(app):
    start(app)
    issues = app.fixture("issues")
    for i in issues["2600"]:
        if i["key"] == "PCAP-433":
            i["dev"] = ["chloe"]
    app.set_fixture("issues", issues)
    app.tab(TICKETS)
    app.page.click("[data-act=reload]")
    app.page.wait_for_selector("[data-test=changes]")
    app.tab(RESOURCES)
    chloe = [x for x in rows(app) if x["name"] == "Chloe"]
    check(chloe and chloe[0]["tag"] and chloe[0]["role"] == "Dev", rows(app))


@test("US-12 AC-3 A resource with no location blocks Tab 3 until one is set")
def _(app):
    start(app, with_last_plan=False)
    check("Set a location for Lorenzo" in app.text("[data-test=location-missing]"), app.text("[data-test=resources]"))
    app.tab(CAPACITY)
    t = app.text("[data-test=blocked]")
    check("location for every resource" in t and "Lorenzo" in t and "Karthik" in t, t)
    app.page.click("[data-goto=resources]")
    app.settle()
    check(app.state("S.tab") == "resources", "button opens Tab 2")
    for pid, loc in [("lorenzo", "lu"), ("marc", "lu"), ("priya", "ch"), ("gabriela", "lu"), ("karthik", "ch")]:
        app.page.select_option("[data-act=location][data-id=%s]" % pid, loc)
        app.settle()
    check(app.page.locator("[data-test=location-missing]").count() == 0, "message gone")
    app.tab(CAPACITY)
    check(app.page.locator("[data-test=blocked]").count() == 0, "Tab 3 no longer blocked")


@test("US-12 AC-4 Marc set to 80%: his net MD updates on the row while typing")
def _(app):
    start(app)
    check(net(app, "marc") == "12.8", net(app, "marc"))
    app.page.fill("[data-act=availability][data-id=marc]", "80")      # input event only, no blur
    check(net(app, "marc") == "10.2", net(app, "marc"))                # 15 x 0.85 x 0.8
    check(app.state("S.plan.resources.find(r => r.id === 'marc').availability") == 80, "stored")


@test("US-12 Role, note, add and remove a resource")
def _(app):
    start(app)
    app.page.select_option("[data-act=role][data-id=priya]", "Both")
    app.settle()
    set_value(app, "[data-act=note][data-id=marc]", "L2 support rota (20%)")
    app.page.fill("[data-add-name]", "Nadia")
    app.page.click("[data-act=add]")
    app.settle()
    r = {x["name"]: x for x in rows(app)}
    check(r["Priya"]["role"] == "Both" and "Nadia" in r and r["Nadia"]["loc"] == "Choose…", r)
    check(app.page.input_value("[data-act=note][data-id=marc]") == "L2 support rota (20%)", "note kept")
    app.page.click("[data-act=add]")                                    # empty name refused
    app.settle()
    check("Enter the name" in app.text("[data-test=add-error]"), "empty name")
    nid = app.state("S.plan.resources.find(r => r.name === 'Nadia').id")
    app.page.click("tr[data-id='%s'] [data-act=remove]" % nid)
    app.settle()
    check("Nadia" not in [x["name"] for x in rows(app)], "removed")


# ---------------------------------------------------------------- US-13

@test("US-13 AC-1 Clicking a working day cycles free, full day, half day, free")
def _(app):
    start(app)
    c = cell(app, "lorenzo", "2027-01-04")
    states = []
    for _ in range(3):
        c.click()
        app.settle()
        c = cell(app, "lorenzo", "2027-01-04")
        states.append(c.get_attribute("aria-label").split(": ")[1])
    check(states == ["full day leave", "half day leave", "working"], states)
    check(app.state("S.plan.leave.lorenzo || {}") == {}, "nothing stored when free")


@test("US-13 AC-2 An office-holiday day for that person's location cannot be changed")
def _(app):
    start(app)
    hol = app.page.locator("[data-test=leave-row][data-id=priya] button.is-hol")
    check(hol.count() == 1 and hol.is_disabled(), "Pongal locked for Priya")
    hol.click(force=True)
    app.settle()
    check(app.state("S.plan.leave.priya || {}") == {}, "no leave stored")
    check(cell(app, "lorenzo", "2027-01-14").is_enabled(), "Luxembourg people can take leave that day")


@test("US-13 AC-3 Marc with two full days: leave total 2.0, net 8.8 MD (80%, 15% ceremonies)")
def _(app):
    start(app)
    set_value(app, "[data-act=availability][data-id=marc]", "80")
    for d in ["2027-01-07", "2027-01-08"]:
        cell(app, "marc", d).click()
        app.settle()
    total = app.page.inner_text("[data-test=leave-row][data-id=marc] [data-test=leave-total]")
    check(total == "2.0" and net(app, "marc") == "8.8", (total, net(app, "marc")))


@test("US-13 AC-4 Keyboard: Tab to a day and press Enter cycles it")
def _(app):
    start(app)
    cell(app, "gabriela", "2027-01-19").focus()
    app.page.keyboard.press("Enter")
    app.settle()
    check(app.state("S.plan.leave.gabriela") == {"2027-01-19": 1}, app.state("S.plan.leave.gabriela"))
    check(app.page.evaluate("() => document.activeElement.dataset.focus") == "leave-gabriela-2027-01-19", "focus kept")
    app.page.keyboard.press("Enter")
    app.settle()
    check(app.state("S.plan.leave.gabriela") == {"2027-01-19": 0.5}, "half day")
    app.page.keyboard.press("Tab")
    check(app.page.evaluate("() => document.activeElement.dataset.focus") == "leave-gabriela-2027-01-20", "Tab moves to the next day")


@test("US-13 Leave, resources and one-offs are saved with Save plan and survive a page reload")
def _(app):
    start(app)
    set_value(app, "[data-act=availability][data-id=marc]", "80")
    cell(app, "marc", "2027-01-07").click()
    app.settle()
    app.page.click("[data-act=save-plan]")
    app.page.wait_for_selector(".scp-notice >> text=Plan saved")
    saved = app.attachment("scp-plan.json")
    check(saved["leave"]["marc"] == {"2027-01-07": 1}, saved["leave"])
    app.reload()
    app.tab(RESOURCES)
    check(net(app, "marc") == "9.5", net(app, "marc"))                 # 14 x 0.85 x 0.8 = 9.52


# ---------------------------------------------------------------- US-14

@test("US-14 AC-1 Pongal: date, name, Chennai, Location calendar, -2.0 days")
def _(app):
    start(app)
    r = [x.strip() for x in app.page.inner_text("[data-test=holiday-row]").split("\t")]
    check(r[:5] == ["Thu 14 Jan", "Pongal", "Chennai · Priya, Karthik", "Location calendar", "−2.0 days"], r)


@test("US-14 AC-2 One-off closure for Luxembourg only: only Luxembourg people lose the day, source One-off")
def _(app):
    start(app)
    app.page.fill("[data-oneoff-date]", "2027-01-22")
    app.page.fill("[data-oneoff-name]", "Office closure")
    app.page.check("[data-oneoff-loc][value=lu]")
    app.page.click("[data-act=oneoff-add]")
    app.settle()
    one = [x.strip() for x in app.page.locator("[data-test=holiday-row]").nth(1).inner_text().split("\t")]
    check(one[:5] == ["Fri 22 Jan", "Office closure", "Luxembourg · Lorenzo, Marc, Gabriela", "One-off", "−3.0 days"], one)
    check(net(app, "lorenzo") == "11.9" and net(app, "priya") == "11.9", (net(app, "lorenzo"), net(app, "priya")))
    check(cell(app, "lorenzo", "2027-01-22").count() == 0, "Lorenzo's 22 Jan is a locked holiday")
    check(cell(app, "priya", "2027-01-22").is_enabled(), "Chennai unaffected")
    app.page.click("[data-act=oneoff-del]")
    app.settle()
    check(app.page.locator("[data-test=holiday-row]").count() == 1 and net(app, "lorenzo") == "12.8", "removed again")


@test("US-14 One-off refused: outside the sprint, on a weekend, without a location")
def _(app):
    start(app)
    for date, name, loc, msg in [("2027-02-03", "Late", True, "outside this sprint"),
                                 ("2027-01-09", "Saturday", True, "not a working day"),
                                 ("2027-01-15", "No place", False, "at least one location")]:
        app.page.fill("[data-oneoff-date]", date)
        app.page.fill("[data-oneoff-name]", name)
        if loc:
            app.page.check("[data-oneoff-loc][value=ch]")
        app.page.click("[data-act=oneoff-add]")
        app.settle()
        check(msg in app.text("[data-test=oneoff-error]"), (date, app.text("[data-test=oneoff-error]")))
    check(app.state("S.plan.oneOffs.length") == 0, "nothing added")


@test("US-14 AC-3 The link opens Config at the locations section")
def _(app):
    start(app)
    app.page.set_viewport_size({"width": 1440, "height": 600})     # small window, so the page must scroll
    app.page.click("[data-act=edit-calendars]")
    app.settle(300)
    check(app.state("S.tab") == "config", "Config open")
    check(app.page.evaluate("() => document.activeElement.id") == "scp-locations", "locations card focused")
    top = app.page.evaluate("() => document.getElementById('scp-locations').getBoundingClientRect().top")
    check(0 <= top < 100, "scrolled to the locations card: top=%s" % top)


@test("US-12/13 Removing a person also removes their leave")
def _(app):
    start(app)
    cell(app, "karthik", "2027-01-21").click()
    app.settle()
    app.page.click("tr[data-id=karthik] [data-act=remove]")
    app.settle()
    check(app.state("S.plan.leave.karthik === undefined"), "leave deleted with the person")


if __name__ == "__main__":
    sys.exit(1 if run(sys.argv[1] if len(sys.argv) > 1 else None) else 0)
