"""
tests/ui_epic_ri.py — browser tests for the Confluence safeguards taken from the
Release Impact admin tool (21 Nov 2026):
  1 XSRF header: both spellings, retried once on 403
  2 the loader stamps each file with its attachment version
  3 the CSS scoped and reset under the root ID as RI's main.css, fonts forced, keeps the page's own styles out
  4 the settings block (scp-settings) in the macro
  5 a file that does not load says why
  6 no Add Attachment permission: Save and Publish are disabled, with a note
  7 questions are asked in an in-page dialog, never a browser pop-up

Run: python3 tests/ui_epic_ri.py
"""
import json
import sys
import urllib.parse

from fixtures import att, last_plan, saved_config
from uitest import check, run, test

TICKETS = "1 · Sprint Tickets"
CALENDAR = "4 · Planning Calendar"
CONFLUENCE = "harness-confluence.html"


def saved(app):
    """A saved Sprint 26 plan (the design sprint), opened on Tab 1."""
    a = att("scp-config.json", saved_config())
    a.update(att("scp-plan.json", last_plan()))      # the Sprint 25 plan, closed when Sprint 26 opens
    app.open("ok", attachments=a)
    app.page.wait_for_function("() => window.SCP.state.jira.sprints.length > 0")
    app.tab(TICKETS)
    app.on_dialog(accept=True)
    app.page.select_option("[data-act=sprint]", "2600")
    app.page.wait_for_selector("[data-test=tickets]")
    app.page.click("[data-act=save-plan]")
    app.page.wait_for_selector(".scp-notice >> text=Plan saved")
    app.page.evaluate("() => { window.SCP_MOCK.requests.length = 0; }")


def posts(app, part):
    return [r for r in app.page.evaluate("() => window.SCP_MOCK.requests") if r["method"] in ("POST", "PUT") and part in r["path"]]


def as_attachments(app, settings=None, wait=True):
    """Re-open the page with the planner's files served as attachments of the page, as on Confluence."""
    q = "" if settings is None else "?settings=" + urllib.parse.quote(settings)
    app.reload(wait_connected=wait, page=CONFLUENCE + q) if wait else app.page.goto(app.base + "/tests/" + CONFLUENCE + q)


# ---- 1. XSRF header ------------------------------------------------------------------

@test("RI-1 A Confluence that wants 'nocheck': the save is retried once with that spelling, and it is remembered")
def _(app):
    saved(app)
    app.page.evaluate("() => localStorage.setItem('scp-mock-xsrf', 'nocheck')")
    app.page.evaluate("() => { window.SCP.state.planDirty = true; window.SCP.app.render(); }")
    app.page.click("[data-act=save-plan]")
    app.page.wait_for_selector(".scp-notice >> text=Plan saved")
    first = posts(app, "/child/attachment")
    check(len(first) == 2, "one refused try and one retry: %s" % first)
    app.page.evaluate("() => { window.SCP.state.planDirty = true; window.SCP.app.render(); }")
    app.page.click("[data-act=save-plan]")
    app.page.wait_for_selector(".scp-notice >> text=Plan saved")
    check(len(posts(app, "/child/attachment")) == 3, "second save sent once: the spelling was remembered")


@test("RI-1 Publish (pages and files) also works on a Confluence that wants 'nocheck'")
def _(app):
    saved(app)
    app.page.evaluate("() => localStorage.setItem('scp-mock-xsrf', 'nocheck')")
    app.page.click("[data-act=publish]")
    app.page.wait_for_selector("[data-test=published-link]", timeout=8000)
    pages = json.loads(app.page.evaluate("() => localStorage.getItem('scp-mock-pages')"))
    check(any(p["title"] == "Sprint 26 - Squad Orion" for p in pages.values()), "sprint page created")


@test("RI-1 When both spellings are refused, the save fails with a clear message and nothing is written")
def _(app):
    saved(app)
    app.page.evaluate("() => localStorage.setItem('scp-mock-xsrf', 'something-else')")
    before = app.attachment("scp-plan.json")
    app.page.evaluate("() => { window.SCP.state.planDirty = true; window.SCP.app.render(); }")
    app.page.click("[data-act=save-plan]")
    app.page.wait_for_selector(".scp-notice >> text=Could not save the plan")
    check("403" in app.text(".scp-notice"), app.text(".scp-notice"))
    check(len(posts(app, "/child/attachment")) == 2, "two tries, no more")
    check(app.attachment("scp-plan.json") == before, "nothing written")


# ---- 2. Versions on file addresses ----------------------------------------------------

@test("RI-2 Each planner file is loaded from the page with its attachment version in the address")
def _(app):
    app.open("ok")
    app.page.evaluate("""() => localStorage.setItem('scp-mock-code', JSON.stringify({ 'scp-app.js': 7, 'scp-planner.css': 3 }))""")
    as_attachments(app)
    urls = app.page.evaluate("() => window.SCP.loader.urls")
    check(len(urls) == 11, urls)
    check("/download/attachments/900001/scp-app.js?api=v2&v=7" in urls, urls)
    check("/download/attachments/900001/scp-planner.css?api=v2&v=3" in urls, urls)
    check("/download/attachments/900001/scp-calc.js?api=v2&v=1" in urls, urls)
    check("Connected as" in app.text("[data-test=conn-status]"), "the planner started")


@test("RI-2 A new version of a file gets a new address, so the browser fetches it instead of using its cache")
def _(app):
    app.open("ok")
    as_attachments(app)
    first = app.page.evaluate("() => window.SCP.loader.urls.filter(u => u.indexOf('scp-calc.js') !== -1)[0]")
    app.page.evaluate("""() => localStorage.setItem('scp-mock-code', JSON.stringify({ 'scp-calc.js': 2 }))""")
    as_attachments(app)
    second = app.page.evaluate("() => window.SCP.loader.urls.filter(u => u.indexOf('scp-calc.js') !== -1)[0]")
    check(first.endswith("&v=1") and second.endswith("&v=2"), (first, second))


# ---- 3. CSS reset -----------------------------------------------------------------------

# Confluence puts a macro inside <div id="main-content" class="wiki-content">. Page rules of rising strength:
CONFLUENCE_RULES = {
    "element": "table{border:5px solid red} th{background:red;padding:20px} td{padding:20px;border-top:6px solid red} a{color:red} p{margin:30px}"
               " input,select{height:70px;border:5px solid red} h1{font-size:44px;color:red;margin-top:40px} button{background:yellow;height:60px}",
    "class": ".wiki-content table{border:5px solid red} .wiki-content th{background:red;padding:20px} .wiki-content td{padding:20px}"
             " .wiki-content a{color:red} .wiki-content input,.wiki-content select{height:70px;border:5px solid red}"
             " .wiki-content h1{font-size:44px;color:red} .wiki-content button{background:yellow;height:60px}",
    "id": "#main-content table{border:5px solid red} #main-content th{background:red;padding:20px} #main-content td{padding:20px}"
          " #main-content a{color:red} #main-content input,#main-content select{height:70px;border:5px solid red}"
          " #main-content h1{font-size:44px;color:red} #main-content button{background:yellow;height:60px}",
    "fonts !important": "body, input, select, button, th, td, h1, a { font-family: Georgia, serif !important; }",
}

WRAP = """() => { const m = document.getElementById('macro'); const w = document.createElement('div');
    w.id = 'main-content'; w.className = 'wiki-content'; m.parentNode.insertBefore(w, m); w.appendChild(m); }"""


def looks(app, root="#scp-root"):
    return app.page.evaluate("""root => {
        const out = {};
        const pick = (name, sel, props) => { const el = document.querySelector(root + ' ' + sel);
            out[name] = el ? props.map(p => getComputedStyle(el).getPropertyValue(p)).join('|') : 'missing'; };
        pick('h1', 'h1', ['font-size', 'color', 'margin-top', 'font-family']);
        pick('input', 'input', ['height', 'border-top-width', 'font-size', 'font-family']);
        pick('select', 'select', ['height', 'border-top-width', 'font-family']);
        pick('th', 'th', ['background-color', 'padding-top', 'font-family']);
        pick('td', 'td', ['border-top-width', 'padding-top']);
        pick('button', 'button.scp-btn', ['background-color', 'height', 'font-family']);
        return out;
    }""", root)


def with_rules(app, css):
    app.page.evaluate("css => { const s = document.createElement('style'); s.id = 'page-rules'; s.textContent = css; document.head.appendChild(s); }", css)
    app.settle()
    got = looks(app)
    app.page.evaluate("() => document.getElementById('page-rules').remove()")
    return got


@test("RI-3 Inside Confluence's #main-content.wiki-content, page rules (element, class, ID, !important fonts) do not change the planner")
def _(app):
    saved(app)
    app.tab("2 · Resources & Leave")
    app.page.evaluate(WRAP)
    clean = looks(app)
    check("missing" not in clean.values(), clean)
    for name, css in CONFLUENCE_RULES.items():
        got = with_rules(app, css)
        check(got == clean, "%s rules changed the planner: %s" % (name, {k: (clean[k], got[k]) for k in clean if clean[k] != got[k]}))
    app.page.add_style_tag(content="body { background: #eee; }")
    check(app.page.evaluate("() => getComputedStyle(document.body).backgroundColor") == "rgb(238, 238, 238)", "the rest of the page is not touched")


@test("RI-3 The published sprint page is protected the same way, fonts included")
def _(app):
    saved(app)
    app.page.click("[data-act=publish]")
    app.page.wait_for_selector("[data-test=published-link]", timeout=8000)
    app.page.goto(app.base + "/tests/sprint-page.html")
    app.page.wait_for_selector("[data-test=view-verdict]")
    probe = "() => { const el = document.querySelector('#scp-view [data-test=view-verdict]'); const cs = getComputedStyle(el); return [cs.marginTop, cs.color, cs.fontSize, cs.fontFamily].join('|'); }"
    clean = app.page.evaluate(probe)
    app.page.add_style_tag(content="#main-content div, .wiki-content div, div { margin: 25px; color: red; font-size: 30px; font-family: Georgia, serif !important; }")
    check(app.page.evaluate(probe) == clean, "viewer changed by the page's styles")


# ---- 4. Settings block ------------------------------------------------------------------

@test("RI-4 The settings block is read: jiraServer picks the named Jira link")
def _(app):
    app.open("ok")
    as_attachments(app, settings='{ "jiraServer": "jira.northwind.example", "page": "" }')
    check(app.page.evaluate("() => window.SCP.settings.jiraServer") == "jira.northwind.example", "setting read")
    as_attachments(app, settings='{ "jiraServer": "jira.other.example", "page": "" }', wait=False)
    app.page.wait_for_selector("[data-test=conn-status] >> text=No Jira link called", timeout=8000)


@test("RI-4 A typo in the settings block stops the planner with a message that says what to fix")
def _(app):
    app.open("ok")
    as_attachments(app, settings='{ "jiraServer": "", "page": "", }', wait=False)
    app.page.wait_for_selector("[data-test=load-error]", timeout=8000)
    msg = app.text("[data-test=load-error]")
    check("not valid JSON" in msg and "comma after the last item" in msg, msg)


@test("RI-4 page names another page that holds the files: by id, by address, or by space and title")
def _(app):
    app.open("ok")
    for setting, pid in (('"800001"', "800001"), ('"https://wiki.example/pages/viewpage.action?pageId=800001"', "800001"),
                         ('"/display/DD/Digital+Delivery"', "800001")):
        as_attachments(app, settings='{ "jiraServer": "", "page": %s }' % setting)
        urls = app.page.evaluate("() => window.SCP.loader.urls")
        check(all(("/download/attachments/%s/" % pid) in u for u in urls), (setting, urls[:2]))
        check(app.page.evaluate("() => window.SCP.store.pageId()") == "900001", "the plan stays on this page")
    as_attachments(app, settings='{ "jiraServer": "", "page": "not a page" }', wait=False)
    app.page.wait_for_selector("[data-test=load-error]", timeout=8000)
    check("not a page id or a Confluence page address" in app.text("[data-test=load-error]"), app.text("[data-test=load-error]"))


# ---- 5. Load errors ---------------------------------------------------------------------

@test("RI-5 A file missing on the page: the message names it, shows HTTP 404 and says to attach it")
def _(app):
    app.open("ok")
    app.serve("missing:scp-tab-calendar.js")
    as_attachments(app, wait=False)
    app.page.wait_for_selector("[data-test=load-error] >> text=NOT loaded", timeout=8000)
    msg = app.text("[data-test=load-error]")
    check("scp-tab-calendar.js was NOT loaded" in msg and "HTTP 404" in msg and "not attached to page 900001" in msg, msg)


@test("RI-5 A Confluence that will not serve attachments as code: the message shows the Content-Type and nosniff")
def _(app):
    app.open("ok")
    app.serve("nosniff")
    as_attachments(app, wait=False)
    app.page.wait_for_selector("[data-test=load-error] >> text=NOT loaded", timeout=8000)
    msg = app.text("[data-test=load-error]")
    check("scp-calc.js was NOT loaded" in msg and "application/octet-stream" in msg and "nosniff" in msg, msg)
    check("will not serve attachments as code" in msg, msg)
    app.errors.clear()   # the browser's own refusal is the point of this test


# ---- 6. No write permission -------------------------------------------------------------

@test("RI-6 No Add Attachment permission: a note says so, Save config, Save plan and Publish are disabled")
def _(app):
    a = att("scp-config.json", saved_config())
    a.update(att("scp-plan.json", last_plan()))
    app.open("ok", attachments=a)
    app.page.evaluate("() => localStorage.setItem('scp-mock-operations', 'view')")
    app.reload()
    app.page.wait_for_selector("[data-test=no-write]")
    check("do not have Add Attachment permission" in app.text("[data-test=no-write]"), app.text("[data-test=no-write]"))
    check(app.page.is_disabled("[data-act=save-config]"), "Save config disabled")
    app.tab(TICKETS)
    check(app.page.is_disabled("[data-act=save-plan]") and app.page.is_disabled("[data-act=publish]"), "Save plan and Publish disabled")
    check("Add Attachment" in app.page.get_attribute("[data-act=publish]", "title"), "Publish says why")


@test("RI-6 When Confluence does not say, the buttons stay enabled and the save itself answers")
def _(app):
    a = att("scp-config.json", saved_config())
    app.open("ok", attachments=a)
    app.page.evaluate("() => localStorage.setItem('scp-mock-operations', 'none')")
    app.reload()
    app.settle(300)
    check(app.page.query_selector("[data-test=no-write]") is None, "no note")
    check(not app.page.is_disabled("[data-act=save-config]"), "Save config enabled")


# ---- 7. In-page dialog ------------------------------------------------------------------

@test("RI-7 Questions open an in-page dialog: Cancel has the focus, and Esc answers Cancel")
def _(app):
    saved(app)
    app.page.select_option("[data-act=sprint]", "2700")
    app.page.wait_for_selector("dialog[data-test=confirm][open]")
    check("Close the Sprint 26 plan" in app.text("[data-test=confirm-msg]"), app.text("[data-test=confirm-msg]"))
    check(app.page.evaluate("() => document.activeElement.getAttribute('data-act')") == "confirm-cancel", "Cancel focused")
    app.page.keyboard.press("Escape")
    app.page.wait_for_selector("dialog[data-test=confirm]", state="detached")
    check(app.state("S.plan.sprint.name") == "Sprint 26", "plan kept")


@test("RI-7 OK in the dialog carries on: the location still in use is deleted")
def _(app):
    saved(app)
    app.tab("Config")
    n = app.state("S.config.locations.length")
    app.page.click("[data-act=loc-open][data-loc=lu]")
    app.on_dialog(accept=True)
    app.page.click("[data-act=loc-del][data-loc=lu]")
    app.settle(300)
    check(app.dialogs and "Luxembourg is the location of" in app.dialogs[0], app.dialogs)
    check(app.state("S.config.locations.length") == n - 1, "deleted after OK")


if __name__ == "__main__":
    sys.exit(run(sys.argv[1] if len(sys.argv) > 1 else None))
