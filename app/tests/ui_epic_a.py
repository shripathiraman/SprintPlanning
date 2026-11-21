"""
tests/ui_epic_a.py — TEST ONLY. Browser tests for Epic A · Config (US-01 to US-06).
Run: python3 tests/ui_epic_a.py   (or tests/run-all.sh)
"""
import sys

from uitest import check, run, test

from fixtures import BANDS, att, saved_config  # noqa: F401


def tabs_enabled(app):
    return app.page.evaluate("() => [...document.querySelectorAll('.scp-tab')].slice(1).every(b => !b.disabled)")


def tabs_disabled(app):
    return app.page.evaluate("() => [...document.querySelectorAll('.scp-tab')].slice(1).every(b => b.disabled)")


# ---------------------------------------------------------------- US-01

@test("US-01 AC-1 Success: 'Connected as <name>' and Tabs 1-4 available")
def _(app):
    app.open("ok")
    status = app.text("[data-test=conn-status]")
    check("Connected as Shripathi Raman Radhakrishnan" in status, status)
    check("no API token stored" in status, status)
    check("jira.northwind.example · via Confluence" in status, "names the linked Jira: " + status)
    check(tabs_enabled(app), "tabs 1-4 should be enabled")
    app.page.click("[data-act=test]")            # clicking Test connection again also works
    app.page.wait_for_selector("[data-test=conn-status] >> text=Connected as")


@test("US-01 AC-2 Not authorised: message with the step to authorise, Tabs 1-4 disabled")
def _(app):
    app.open("unauthorised", wait_connected=False)
    app.page.wait_for_selector("[data-test=conn-status] >> text=Not authorised")
    check(app.page.is_visible("[data-test=authorise]"), "authorise link missing")
    href = app.page.get_attribute("[data-test=authorise]", "href")
    check("login-dance/authorize" in href, href)
    check(tabs_disabled(app), "tabs should stay disabled")
    app.page.click(".scp-tab >> text=1 · Sprint Tickets", force=True)
    check(app.state("S.tab") == "config", "a disabled tab must not open")


@test("US-01 AC-3 Link missing: says the link is not configured and whom to contact")
def _(app):
    app.open("nolink", wait_connected=False)
    app.page.wait_for_selector("[data-test=conn-status] >> text=not configured")
    t = app.text("[data-test=conn-status]")
    check("Confluence administrator" in t, t)
    check(tabs_disabled(app), "tabs should stay disabled")


@test("US-01 Jira is found through Confluence's linked servers: no link ID set anywhere")
def _(app):
    app.open("ok")
    check(app.page.evaluate("() => window.SCP.settings.jiraServer") == "", "no server configured")
    check(app.page.evaluate("() => window.SCP.jira.server.id") == "mock-link", "link id discovered")
    check(app.page.evaluate("() => window.SCP.jira.browseUrl('NWD-1')") == "https://jira.northwind.example/browse/NWD-1", "browse URL from the link")


@test("US-01 Proxy wants Jira's full URL: the planner switches path form and connects")
def _(app):
    app.open("absolute")
    check(tabs_enabled(app), "connected with the absolute path form")


@test("US-01 AC-4 Proxy blocked (HTTP 403, not JSON): says so and whom to contact")
def _(app):
    app.open("proxyblocked", wait_connected=False)
    app.page.wait_for_selector("[data-test=conn-status] >> text=refused to pass the call")
    check("Confluence administrator" in app.text("[data-test=conn-status]"), app.text("[data-test=conn-status]"))
    check(tabs_disabled(app), "tabs should stay disabled")


@test("US-01 Jira unreachable: reason shown, tabs disabled")
def _(app):
    app.open("down", wait_connected=False)
    app.page.wait_for_selector("[data-test=conn-status] >> text=could not be reached")
    check(tabs_disabled(app), "tabs should stay disabled")


@test("US-01 Test connection needs no project and does not check one (FR-1)")
def _(app):
    app.open("noperm")                      # no rights on NWD, but the link and the user are fine
    check(tabs_enabled(app), "connection passes without a project check")
    calls = app.page.evaluate("() => window.SCP_MOCK.calls")
    check("/rest/api/2/myself" in calls and not any(c.startswith("/rest/api/2/project") for c in calls), calls)


@test("US-01 Out of scope: scp-jira.js only ever sends GET (no write to Jira)")
def _(app):
    import os
    src = open(os.path.join(os.path.dirname(__file__), "..", "scp-jira.js")).read()
    check("method:" not in src and "'POST'" not in src and "'PUT'" not in src, "scp-jira.js must not write")
    app.open("ok")


# ---------------------------------------------------------------- US-02

def fetch(app, key):
    app.page.fill("[data-act=project-key]", key)
    app.page.click("[data-act=fetch]")
    app.settle(400)


@test("US-02 AC-1 Type a key, click Fetch from Jira: boards, Team values, issue types and sprints load")
def _(app):
    app.open("ok")
    check(app.page.get_attribute("[data-act=project-key]", "placeholder") == "e.g. NWD", "text field")
    check(app.page.locator("select[data-act=project]").count() == 0, "no project dropdown any more")
    check(app.page.is_disabled("[data-act=fetch]"), "Fetch disabled while the key is empty")
    check(app.page.locator("[data-test=sprints]").count() == 0, "nothing fetched yet")
    fetch(app, "NWD")
    app.page.wait_for_selector("[data-test=sprints]")
    boards = app.page.eval_on_selector("[data-act=board]", "s => [...s.options].map(o => o.text)")
    check(boards == ["NWD Scrum board", "NWD Kanban"], boards)
    check(app.page.eval_on_selector("[data-act=board]", "s => s.selectedOptions[0].text") == "NWD Scrum board", "scrum board pre-selected")
    teams = app.page.eval_on_selector("[data-act=team]", "s => [...s.options].map(o => o.text)")
    check("Squad Orion" in teams and "Squad Vega" in teams, teams)
    types = app.text("[data-test=issuetypes]")
    for t in ["Story", "Bug", "Task", "Sub-task", "Epic"]:
        check(t in types, "missing issue type " + t)
    check("4 sprints" in app.text("[data-test=sprints]"), app.text("[data-test=sprints]"))
    check("NWD \u00b7 Northwind Orders" in app.text("[data-test=project-name]"), "project name shown")


@test("US-02 The key is upper-cased as typed; Enter fetches too")
def _(app):
    app.open("ok")
    app.page.type("[data-act=project-key]", "nwd")
    check(app.page.input_value("[data-act=project-key]") == "NWD", app.page.input_value("[data-act=project-key]"))
    app.page.press("[data-act=project-key]", "Enter")
    app.page.wait_for_selector("[data-test=sprints]")
    check(app.state("S.config.jira.projectKey") == "NWD", "fetched")


@test("US-02 AC-4 Unknown key: 'not found, or you lack Browse Projects', nothing loads")
def _(app):
    app.open("ok")
    fetch(app, "XYZ")
    app.page.wait_for_selector("[data-test=project-error]")
    t = app.text("[data-test=project-error]")
    check("XYZ was not found, or you lack the Browse Projects permission on it" in t, t)
    check(app.state("S.config.jira.projectKey") == "" and app.state("S.jira.boards.length") == 0, "nothing loaded")


@test("US-02 AC-4 No Browse Projects on the key: the same message (Jira cannot tell them apart)")
def _(app):
    app.open("noperm")
    fetch(app, "NWD")
    app.page.wait_for_selector("[data-test=project-error]")
    check("NWD was not found, or you lack the Browse Projects permission" in app.text("[data-test=project-error]"),
          app.text("[data-test=project-error]"))
    check(app.page.locator("[data-test=sprints]").count() == 0, "nothing loaded")


@test("US-02 AC-5 Key edited after a fetch: stale, Save config blocked until the next fetch")
def _(app):
    app.open("ok", attachments=att("scp-config.json", saved_config()))
    app.page.wait_for_selector("[data-test=sprints]")
    app.page.fill("[data-act=project-key]", "TC316")
    app.page.press("[data-act=project-key]", "Tab")
    app.settle()
    check("Key changed: click Fetch from Jira to load TC316" in app.text("[data-test=project-stale]"), app.text("[data-test=project-card]"))
    check(app.page.is_disabled("[data-act=board]") and app.page.is_disabled("[data-act=team]"), "stale fields locked")
    app.page.click("[data-act=save-config]")
    app.page.wait_for_selector("[data-test=save-errors]")
    check("click Fetch from Jira before saving" in app.text("[data-test=save-errors]"), app.text("[data-test=save-errors]"))
    check(app.attachment("scp-config.json")["jira"]["projectKey"] == "NWD", "nothing overwritten")
    app.page.click("[data-act=fetch]")
    app.page.wait_for_selector("[data-test=issuetypes] >> text=Incident")
    app.settle(300)
    check(app.page.locator("[data-test=project-stale]").count() == 0, "no longer stale")
    check(app.state("S.config.jira.boardId") == 77 and app.state("S.config.jira.issueTypes") == [], "new project's values, reset")
    check(app.state("S.config.jira.team") == "", "team reset")


@test("US-02 AC-6 Page load with a saved key: connection test and fetch run without a click")
def _(app):
    app.open("ok", attachments=att("scp-config.json", saved_config()))
    app.page.wait_for_selector("[data-test=sprints]")
    check(app.page.input_value("[data-act=project-key]") == "NWD", "saved key shown")
    check(app.state("S.config.jira.boardId") == 41 and app.state("S.config.jira.issueTypes") == ["Story", "Bug"], "saved values kept")
    check(app.state("S.config.jira.team") == "Squad Orion", "team kept")


@test("US-02 AC-2 Each sprint shows name, state, start and end date")
def _(app):
    app.open("ok", attachments=att("scp-config.json", saved_config()))
    app.page.wait_for_selector("[data-test=sprints]")
    app.page.click("[data-test=sprints] summary")
    t = app.text("[data-test=sprints]")
    check("1 active · 2 future · 1 closed" in t, t)
    row = app.page.inner_text("[data-test=sprints] tr:has-text('Sprint 26')")
    check("future" in row and "Mon 4 Jan 2027" in row and "Fri 22 Jan 2027" in row, row)
    check("active" in app.page.inner_text("[data-test=sprints] tr:has-text('Sprint 25')"), "Sprint 25 active")
    check("closed" in app.page.inner_text("[data-test=sprints] tr:has-text('Sprint 24')"), "Sprint 24 closed")


@test("US-02 AC-3 (config part) Unticking Bug leaves only the ticked types to plan")
def _(app):
    app.open("ok", attachments=att("scp-config.json", saved_config()))
    app.page.wait_for_selector("[data-test=issuetypes] >> text=Bug")
    app.page.uncheck("[data-act=issuetype][value=Bug]")
    app.settle()
    check(app.state("S.config.jira.issueTypes") == ["Story"], app.state("S.config.jira.issueTypes"))
    # The Tab 1 half of this criterion (no Bug ticket listed) is tested with US-08.


# ---------------------------------------------------------------- US-03

@test("US-03 AC-1 Field picker lists the instance's fields with type and Standard/Custom")
def _(app):
    app.open("ok")
    opts = app.page.eval_on_selector("[data-act=field][data-role=dev]", "s => [...s.options].map(o => o.text)")
    check("Contributor · customfield_10412 · Multi-user picker · Custom" in opts, opts)
    check("Assignee · assignee · User picker · Standard" in opts, opts)
    check("Dev notes · customfield_10500 · Text · Custom" in opts, opts)
    table = app.text("[data-test=field-mapping]")
    check(table.count("Type OK") == 4, "the four same-named fields are mapped automatically:\n" + table)


@test("US-03 AC-2 A text field for Contributor is rejected with the expected type named")
def _(app):
    app.open("ok")
    app.page.select_option("[data-act=field][data-role=dev]", "customfield_10500")
    app.page.wait_for_selector("[data-test=field-reject-dev]")
    msg = app.text("[data-test=field-reject-dev]")
    check("Dev notes is Text" in msg and "expected User picker" in msg, msg)
    check(app.state("S.config.fields.dev.id") == "customfield_10412", "previous mapping is kept")


@test("US-03 AC-3 A multi-user picker is accepted for Contributor")
def _(app):
    app.open("ok")
    app.page.select_option("[data-act=field][data-role=dev]", "assignee")
    app.settle()
    app.page.select_option("[data-act=field][data-role=dev]", "customfield_10412")
    app.settle()
    row = app.page.inner_text("[data-test=field-mapping] tr:has-text('Contributor (Dev)')")
    check("Multi-user picker" in row and "Type OK" in row, row)
    check(app.state("S.config.fields.dev.id") == "customfield_10412", "mapped")


@test("US-03 Story Points must be a number, Team a select list")
def _(app):
    app.open("ok")
    app.page.select_option("[data-act=field][data-role=sp]", "customfield_10500")
    app.page.wait_for_selector("[data-test=field-reject-sp]")
    check("expected Number" in app.text("[data-test=field-reject-sp]"), app.text("[data-test=field-reject-sp]"))
    app.page.select_option("[data-act=field][data-role=team]", "assignee")
    app.page.wait_for_selector("[data-test=field-reject-team]")
    check("expected Select list" in app.text("[data-test=field-reject-team]"), "team")


# ---------------------------------------------------------------- US-04

@test("US-04 AC-1 Bands table: SP 2 is '> 1 - 3' and uses 3.0 MD, BA 1.2, Dev 1.8")
def _(app):
    app.open("ok")
    row = app.page.inner_text("[data-test=bands] tbody tr:nth-child(2)")
    check(row.split() == ["2", ">", "1", "–", "3", "3.0", "1.2", "1.8"], row)
    check("cover 1–144" in app.text("[data-test=bands-msg]"), app.text("[data-test=bands-msg]"))


@test("US-04 AC-2 Overlapping bands: save blocked, faulty row marked, nothing saved")
def _(app):
    app.open("ok")
    app.page.click("[data-act=bands-edit]")
    app.page.fill("[data-focus=band-2-lower]", "2")
    app.page.press("[data-focus=band-2-lower]", "Tab")
    app.settle()
    check("Overlaps the band above" in app.text("[data-test=bands]"), app.text("[data-test=bands]"))
    app.page.click("[data-act=save-config]")
    app.page.wait_for_selector("[data-test=save-errors]")
    check(app.attachment("scp-config.json") is None, "nothing must be saved")
    check(app.page.locator("[data-test=band-row].is-invalid").count() == 1, "one row marked")


@test("US-04 AC-2 Descending bands: save blocked")
def _(app):
    app.open("ok")
    app.page.click("[data-act=bands-edit]")
    app.page.fill("[data-focus=band-3-sp]", "2")
    app.page.press("[data-focus=band-3-sp]", "Tab")
    app.settle()
    check("SP must ascend" in app.text("[data-test=bands]"), app.text("[data-test=bands]"))
    app.page.click("[data-act=save-config]")
    app.page.wait_for_selector("[data-test=save-errors]")
    check(app.attachment("scp-config.json") is None, "nothing saved")


@test("US-04 Add band: a 233 SP band can be added and saved")
def _(app):
    app.open("ok")
    app.page.click("[data-act=bands-edit]")
    app.page.click("[data-act=band-add]")
    app.settle()
    app.page.fill("[data-focus=band-11-sp]", "233")
    app.page.fill("[data-focus=band-11-upper]", "130")
    app.page.press("[data-focus=band-11-upper]", "Tab")
    app.page.click("[data-act=bands-edit]")
    app.settle()
    check("cover 1–233" in app.text("[data-test=bands-msg]"), app.text("[data-test=bands-msg]"))
    app.page.fill("[data-act=ceremony]", "15")
    app.page.click("[data-act=save-config]")
    app.page.wait_for_selector(".scp-notice >> text=Config saved")
    check(app.attachment("scp-config.json")["bands"][-1] == {"sp": 233, "lower": 100, "upper": 130}, "saved band")


@test("US-04 AC-3 BA 40 + Dev 50: save blocked showing 'Sum 90%'")
def _(app):
    app.open("ok")
    app.page.fill("[data-focus=split-dev]", "50")
    app.settle()
    check("Sum 90%" in app.text("[data-test=split-msg]"), app.text("[data-test=split-msg]"))
    app.page.click("[data-act=save-config]")
    app.page.wait_for_selector("[data-test=save-errors]")
    check("Sum 90%" in app.text("[data-test=save-errors]"), app.text("[data-test=save-errors]"))
    check(app.attachment("scp-config.json") is None, "nothing saved")


@test("US-04 AC-4 40/60: '3 MD ticket = BA 1.2 + Dev 1.8'")
def _(app):
    app.open("ok")
    check("3 MD ticket = BA 1.2 + Dev 1.8" in app.text("[data-test=split-msg]"), app.text("[data-test=split-msg]"))


# ---------------------------------------------------------------- US-05

@test("US-05 AC-1 Ceremony % empty: Tabs 3 and 4 blocked with a message pointing to Config")
def _(app):
    app.open("ok")
    check("Required" in app.text("[data-test=ceremony-msg]"), "required hint")
    for label in ["3 · Capacity", "4 · Planning Calendar"]:
        app.tab(label)
        t = app.text("[data-test=blocked]")
        check("ceremony %" in t and "Config" in t, t)
    app.page.click("[data-goto=config]")
    app.settle()
    check(app.state("S.tab") == "config", "Open Config goes to Config")
    app.page.fill("[data-act=ceremony]", "15")
    app.page.press("[data-act=ceremony]", "Tab")
    app.settle()
    app.tab("3 · Capacity")
    check(app.page.locator("[data-test=blocked]").count() == 0, "no longer blocked")


@test("US-05 AC-2 (config part) Overloaded 100% -> 110% changes the OK band to 80-110%")
def _(app):
    app.open("ok")
    app.page.fill("[data-focus=th-over]", "110")
    app.page.press("[data-focus=th-over]", "Tab")
    app.settle()
    check("OK 80–110%" in app.text("[data-test=ok-band]"), app.text("[data-test=ok-band]"))
    check(app.state("S.config.thresholds.over") == 110, "threshold in config")
    # Row badges recolouring in Tab 4 is tested with US-16; the colour rule is unit-tested.


@test("US-05 AC-3 Save config, reload: values persist and show last editor and date")
def _(app):
    app.open("ok", user="Shripathi R.")
    app.page.fill("[data-act=ceremony]", "15")
    app.page.fill("[data-focus=th-over]", "110")
    app.page.press("[data-focus=th-over]", "Tab")
    app.page.click("[data-act=weekday][data-day='6']")       # add Saturday
    app.settle()
    fetch(app, "NWD")
    app.page.wait_for_selector("[data-test=sprints]")
    app.page.select_option("[data-act=team]", "Squad Orion")
    app.page.check("[data-act=issuetype][value=Story]")
    app.settle()
    app.page.click("[data-act=save-config]")
    app.page.wait_for_selector(".scp-notice >> text=Config saved")
    app.reload()
    check(app.state("S.config.ceremonyPct") == 15, "ceremony")
    check(app.state("S.config.thresholds.over") == 110, "threshold")
    check(app.state("S.config.workingWeek") == [1, 2, 3, 4, 5, 6], app.state("S.config.workingWeek"))
    check(app.state("S.config.jira.team") == "Squad Orion", "team")
    check(app.page.input_value("[data-act=ceremony]") == "15", "ceremony shown")
    sub = app.text("[data-test=config-saved]")
    check("last changed by Shripathi R. on" in sub and "scp-config.json" in sub, sub)
    check("Configuration · Squad Orion" in app.text(".scp-title"), app.text(".scp-title"))


@test("US-05 Concurrent save: warned before overwriting someone else's config")
def _(app):
    app.open("ok", attachments=att("scp-config.json", saved_config()))
    # The PO saves after we opened the page:
    app.page.evaluate("""() => { const a = JSON.parse(localStorage.getItem('scp-mock-attachments'));
        a['scp-config.json'].version = 2; a['scp-config.json'].by = 'Product Owner';
        localStorage.setItem('scp-mock-attachments', JSON.stringify(a)); }""")
    app.on_dialog(accept=False)
    app.page.click("[data-act=save-config]")
    app.page.wait_for_selector(".scp-notice >> text=Not saved")
    check(app.dialogs and "Product Owner" in app.dialogs[0], app.dialogs)
    app.on_dialog(accept=True)
    app.page.click("[data-act=save-config]")
    app.page.wait_for_selector(".scp-notice >> text=Config saved")


# ---------------------------------------------------------------- US-06

@test("US-06 Add locations with yearly holidays; saved with the config")
def _(app):
    app.open("ok")
    app.page.click("[data-act=loc-add]")
    app.settle()
    app.page.fill("[data-act=loc-name]", "Chennai")
    app.page.press("[data-act=loc-name]", "Tab")
    app.settle()
    loc = app.state("S.config.locations[0].id")
    app.page.fill("[data-hol-date='%s']" % loc, "2027-01-14")
    app.page.fill("[data-hol-name='%s']" % loc, "Pongal")
    app.page.click("[data-act=hol-add]")
    app.settle()
    check("Thu 14 Jan 2027" in app.text("[data-test=loc-editor]") and "Pongal" in app.text("[data-test=loc-editor]"), "listed")
    check("2027 calendar loaded" in app.text("[data-test=location]"), app.text("[data-test=location]"))
    app.page.fill("[data-act=ceremony]", "15")
    app.page.click("[data-act=save-config]")
    app.page.wait_for_selector(".scp-notice >> text=Config saved")
    saved = app.attachment("scp-config.json")["locations"][0]
    check(saved["name"] == "Chennai" and saved["holidays"] == [{"date": "2027-01-14", "name": "Pongal"}], saved)


@test("US-06 AC-2 A holiday on a Saturday is rejected with a message")
def _(app):
    app.open("ok", attachments=att("scp-config.json", saved_config()))
    app.page.click("[data-act=loc-open][data-loc=ch]")
    app.settle()
    app.page.fill("[data-hol-date=ch]", "2027-01-16")
    app.page.fill("[data-hol-name=ch]", "Saturday party")
    app.page.click("[data-act=hol-add]")
    app.page.wait_for_selector("[data-test=hol-error]")
    check("not a working day" in app.text("[data-test=hol-error]"), app.text("[data-test=hol-error]"))
    check(len(app.state("S.config.locations[1].holidays")) == 1, "not added")


@test("US-06 AC-2 Removing Thursday from the week blocks save of a Thursday holiday")
def _(app):
    app.open("ok", attachments=att("scp-config.json", saved_config()))
    app.page.click("[data-act=weekday][data-day='4']")
    app.settle()
    app.page.click("[data-act=save-config]")
    app.page.wait_for_selector("[data-test=save-errors]")
    check("Chennai" in app.text("[data-test=save-errors]") and "not a working day" in app.text("[data-test=save-errors]"),
          app.text("[data-test=save-errors]"))


@test("US-06 AC-1/AC-3 Each calendar is kept per location and shown for the open sprint")
def _(app):
    plan = {"sprint": {"id": 2600, "name": "Sprint 26", "start": "2027-01-04", "end": "2027-01-22"},
            "resources": [{"name": "Priya", "location": "ch"}, {"name": "Karthik", "location": "ch"},
                          {"name": "Lorenzo", "location": "lu"}, {"name": "Marc", "location": "lu"}, {"name": "Gabriela", "location": "lu"}]}
    a = att("scp-config.json", saved_config())
    a.update(att("scp-plan.json", plan))
    app.open("ok", attachments=a)
    locs = app.page.locator("[data-test=location]")
    lu, ch = locs.nth(0).inner_text(), locs.nth(1).inner_text()
    check("3 resources" in lu and "In Sprint 26: none" in lu, lu)
    check("2 resources" in ch and "In Sprint 26: Thu 14 Jan · Pongal" in ch, ch)


if __name__ == "__main__":
    sys.exit(1 if run(sys.argv[1] if len(sys.argv) > 1 else None) else 0)
