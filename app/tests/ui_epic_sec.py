"""
tests/ui_epic_sec.py — security tests (21 Nov 2026): text that comes from Jira, from
Confluence or from the user is shown as text and never runs as code (DOM XSS).

Every value below is shown somewhere in the planner or on the published page and
reaches the screen through innerHTML, so each one must go through ui.esc. The
attack strings run code only if a value is NOT escaped; the test fails if any did.

Run: python3 tests/ui_epic_sec.py
"""
import json
import sys

from fixtures import att, last_plan, saved_config
from uitest import check, run, test

# Each one sets window.__xss when it runs: in text, in an attribute, in a URL.
P = '<img src=x onerror="window.__xss=(window.__xss||0)+1">'
Q = '"><svg onload="window.__xss=(window.__xss||0)+1">'
EVIL = P + Q


def hostile_jira(app):
    """Attack strings in every Jira value the planner shows."""
    fx = {name: app.fixture(name) for name in ("myself", "users", "sprints", "boards", "project", "teams", "issues", "fields")}
    fx["myself"]["displayName"] = "Shripathi " + EVIL
    fx["users"] = {k: v + EVIL for k, v in fx["users"].items()}
    for s in fx["sprints"]["41"]:
        if s["id"] in (2600, 2700):
            s["goal"] = "Goal " + EVIL
            s["name"] = s["name"] + EVIL
    fx["boards"]["NWD"][0]["name"] = "NWD Scrum board" + EVIL
    fx["project"]["NWD"]["name"] = "Northwind Orders" + EVIL
    fx["teams"]["cf[11200]"].append("Squad " + EVIL)
    for i in fx["issues"]["2600"]:
        i["summary"] = i["summary"] + EVIL
    for f in fx["fields"]:
        if f["id"] == "customfield_10500":
            f["name"] = "Dev notes" + EVIL
    for name, value in fx.items():
        app.set_fixture(name, value)


def xss_count(app):
    return app.page.evaluate("() => window.__xss || 0")


@test("SEC-1 Hostile text from Jira, Confluence and the user is shown as text on every tab, in dialogs and on the published page")
def _(app):
    cfg = saved_config()
    cfg["locations"][0]["name"] = "Luxembourg" + EVIL
    cfg["locations"][0]["holidays"][0]["name"] = "National Day" + EVIL
    cfg["locations"][1]["holidays"][0]["name"] = "Pongal" + EVIL
    a = att("scp-config.json", cfg, by="PO " + EVIL)
    a.update(att("scp-plan.json", last_plan(), by="PO " + EVIL))
    app.open("ok", attachments=a, wait_connected=False)
    hostile_jira(app)
    app.page.evaluate("v => localStorage.setItem('scp-mock-user', v)", "Tester " + EVIL)
    app.reload()
    app.page.wait_for_function("() => window.SCP.state.jira.sprints.length > 0")
    for label in ("Config",):
        app.tab(label)
    # Open the Sprint 26 plan (a dialog shows the old plan's sprint name)
    app.tab("1 · Sprint Tickets")
    app.on_dialog(accept=True)
    app.page.select_option("[data-act=sprint]", "2600")
    app.page.wait_for_selector("[data-test=tickets]")
    # A note typed by the user
    app.tab("2 · Resources & Leave")
    app.page.fill("[data-act=note][data-id=marc]", "Support " + EVIL)
    app.page.press("[data-act=note][data-id=marc]", "Tab")
    app.settle()
    for label in ("3 · Capacity", "4 · Planning Calendar", "1 · Sprint Tickets", "Config"):
        app.tab(label)
        app.settle(200)
    app.tab("4 · Planning Calendar")
    app.page.click("[data-card]")              # selected-ticket panel
    app.settle(200)
    app.page.click("[data-act=save-plan]")
    app.page.wait_for_selector(".scp-notice >> text=Plan saved")
    # A dialog that quotes Jira text: move a Dev card onto a BA-only person
    app.on_dialog(accept=False)
    app.page.evaluate("() => SCP.tabs.calendar.move('NWD-427|dev', 'gabriela', 14)")
    app.settle(300)
    check(app.dialogs, "the Dev-to-BA question was asked")
    check(xss_count(app) == 0, "code ran in the planner %d time(s)" % xss_count(app))
    check(app.page.query_selector("#scp-root img[src=x], #scp-root svg[onload]") is None, "an injected element reached the planner")
    # Publish, then open the published page
    app.page.click("[data-act=publish]")
    app.page.wait_for_selector("[data-test=published-link]", timeout=8000)
    check(xss_count(app) == 0, "code ran while publishing")
    app.page.goto(app.base + "/tests/sprint-page.html")
    app.page.wait_for_selector("[data-test=view-verdict]")
    app.settle(300)
    check(xss_count(app) == 0, "code ran on the published page %d time(s)" % xss_count(app))
    check(app.page.query_selector("#scp-view img[src=x], #scp-view svg[onload]") is None, "an injected element reached the published page")
    check("Goal <img" in app.text("#scp-view"), "the goal is shown as text")


@test("SEC-1 The attack strings do run when inserted unescaped, so the test above can fail")
def _(app):
    app.open("ok")
    app.page.evaluate("p => { const d = document.createElement('div'); d.innerHTML = p; document.body.appendChild(d); }", EVIL)
    app.settle(300)
    check(xss_count(app) >= 1, "the payload did not run unescaped: the test would prove nothing")


def publish_saved(app):
    a = att("scp-config.json", saved_config())
    a.update(att("scp-plan.json", last_plan()))
    app.open("ok", attachments=a)
    app.page.wait_for_function("() => window.SCP.state.jira.sprints.length > 0")
    app.tab("1 · Sprint Tickets")
    app.on_dialog(accept=True)
    app.page.select_option("[data-act=sprint]", "2600")
    app.page.wait_for_selector("[data-test=tickets]")
    app.page.click("[data-act=save-plan]")
    app.page.wait_for_selector(".scp-notice >> text=Plan saved")
    app.page.click("[data-act=publish]")
    app.page.wait_for_selector("[data-test=published-link]", timeout=8000)
    pages = json.loads(app.page.evaluate("() => localStorage.getItem('scp-mock-pages')"))
    sprint = [p for p in pages.values() if p["title"] == "Sprint 26 - Squad Orion"][0]
    return pages, sprint


@test("SEC-2 The sprint page loads its viewer by address with the attachment version, never as text run as code")
def _(app):
    pages, sprint = publish_saved(app)
    body = sprint["body"]
    check("js.src = url('scp-view.js'" in body and "ver['scp-view.js']" in body, "viewer loaded by src with its version")
    check("textContent = f[1]" not in body and "eval(" not in body and "new Function" not in body, "no code run from text")
    app.page.goto(app.base + "/tests/sprint-page.html")
    app.page.wait_for_selector("[data-test=view-verdict]")
    check("At risk" in app.text("[data-test=view-verdict]") or app.text("[data-test=view-verdict]"), "viewer ran")


@test("SEC-2 A viewer file missing on the parent page shows a message instead of a blank page")
def _(app):
    pages, sprint = publish_saved(app)
    parent = pages[sprint["parentId"]]
    del parent["atts"]["scp-view.js"]
    app.page.evaluate("p => localStorage.setItem('scp-mock-pages', JSON.stringify(p))", pages)
    app.page.goto(app.base + "/tests/sprint-page.html")
    app.page.wait_for_selector("#scp-view >> text=could not be loaded", timeout=8000)
    check("Publish the plan again" in app.text("#scp-view"), app.text("#scp-view"))
    app.errors.clear()


@test("SEC-3 A javascript: address from Jira never becomes a link: the Allow access link falls back to #")
def _(app):
    app.open("unauthorised", wait_connected=False)
    app.page.evaluate("() => localStorage.setItem('scp-mock-auth-uri', 'javascript:window.__xss=1')")
    app.reload(wait_connected=False)
    app.page.wait_for_selector("[data-test=authorise]")
    check(app.page.get_attribute("[data-test=authorise]", "href") == "#", app.page.get_attribute("[data-test=authorise]", "href"))
    app.page.evaluate("() => localStorage.removeItem('scp-mock-auth-uri')")
    app.reload(wait_connected=False)
    app.page.wait_for_selector("[data-test=authorise]")
    check(app.page.get_attribute("[data-test=authorise]", "href").startswith("https://"), "a real address is kept")


if __name__ == "__main__":
    sys.exit(run(sys.argv[1] if len(sys.argv) > 1 else None))
