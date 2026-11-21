"""
tests/ui_epic_f.py — TEST ONLY. Browser tests for Epic F · Save, access and publish (US-20 to US-24).
Run: python3 tests/ui_epic_f.py

US-22 AC-1/AC-2 (who can open the planning page) are Confluence page restrictions, not code:
they are checked on the real Confluence. Here the planner's marker of those restrictions is tested.
"""
import json
import re
import sys

from fixtures import att, last_plan, saved_config
from uitest import check, run, test

TICKETS = "1 · Sprint Tickets"
RESOURCES = "2 · Resources & Leave"
CAPACITY = "3 · Capacity"
CALENDAR = "4 · Planning Calendar"
TABS = [TICKETS, RESOURCES, CAPACITY, CALENDAR]


def leave(app, pid, date):
    app.page.click("[data-focus='leave-%s-%s']" % (pid, date))
    app.settle()


def design_sprint(app, config=None, save=True):
    """Sprint 26 as on the screens, saved: Marc 80% with 7-8 Jan off, Gabriela 19 Jan, Karthik the morning of 21 Jan."""
    a = att("scp-config.json", config or saved_config())
    a.update(att("scp-plan.json", last_plan()))
    app.open("ok", attachments=a)
    app.page.wait_for_function("() => window.SCP.state.jira.sprints.length > 0")
    app.tab(TICKETS)
    app.on_dialog(accept=True)
    app.page.select_option("[data-act=sprint]", "2600")
    app.page.wait_for_selector("[data-test=tickets]")
    app.tab(RESOURCES)
    app.page.fill("[data-act=availability][data-id=marc]", "80")
    app.page.press("[data-act=availability][data-id=marc]", "Tab")
    app.settle()
    for pid, d in [("marc", "2027-01-07"), ("marc", "2027-01-08"), ("gabriela", "2027-01-19"), ("karthik", "2027-01-21"), ("karthik", "2027-01-21")]:
        leave(app, pid, d)
    if save:
        save_plan(app)


def save_plan(app):
    app.page.click("[data-act=save-plan]")
    app.page.wait_for_selector(".scp-notice >> text=Plan saved")
    app.settle()


def publish(app):
    app.page.click("[data-act=publish]")
    app.page.wait_for_selector("[data-test=published-link], .scp-notice--warn, .scp-notice--error", timeout=8000)
    app.settle()


def pages(app):
    return json.loads(app.page.evaluate("() => localStorage.getItem('scp-mock-pages') || '{}'"))


def page_by_title(app, title):
    return [p for p in pages(app).values() if p["title"] == title]


def snapshot(app, page_id):
    return json.loads(pages(app)[page_id]["atts"]["scp-snapshot.json"]["body"])


def open_sprint_page(app, page_id=None):
    app.page.goto(app.base + "/tests/sprint-page.html" + ("?page=" + page_id if page_id else ""))
    app.page.wait_for_selector("[data-test=view-verdict]", timeout=8000)


def badge(app, pid):
    return app.page.inner_text("[data-row='%s'] [data-test=row-load]" % pid)


def card_lane(app, cid):
    return app.page.eval_on_selector("[data-card='%s'][data-part='0']" % cid, "e => e.closest('.scp-lane').dataset.lane")


def set_sprint_state(app, sprint_id, state):
    sprints = app.fixture("sprints")
    for b in sprints:
        for s in sprints[b]:
            if s["id"] == sprint_id:
                s["state"] = state
    app.set_fixture("sprints", sprints)


# ---------------------------------------------------------------- US-20

@test("US-20 AC-1 One save keeps a Tab 1 dropdown choice, Tab 2 leave and a Tab 4 move after a page reload")
def _(app):
    design_sprint(app, save=False)
    app.tab(TICKETS)
    app.page.select_option("[data-act=pick][data-key=PCAP-418][data-role=dev]", "marc")
    app.settle()
    app.tab(CALENDAR)
    app.page.evaluate("() => SCP.tabs.calendar.move('PCAP-441|dev', 'lorenzo', 11.5)")
    app.settle()
    check(app.state("S.planDirty") is True, "unsaved")
    save_plan(app)
    app.reload()
    p = app.state("S.plan")
    t418 = [t for t in p["tickets"] if t["key"] == "PCAP-418"][0]
    check(t418.get("devPick") == "marc", t418)
    check(p["leave"]["marc"] == {"2027-01-07": 1, "2027-01-08": 1} and p["leave"]["karthik"] == {"2027-01-21": "am"}, p["leave"])
    check({"key": "PCAP-441", "role": "dev", "person": "lorenzo", "start": 11.5} in p["cards"], p["cards"])


@test("US-20 AC-2 Save plan and Publish sit in the same place on Tabs 1 to 4")
def _(app):
    design_sprint(app)
    boxes = []
    for t in TABS:
        app.tab(t)
        s = app.page.locator("[data-act=save-plan]").bounding_box()
        pb = app.page.locator("[data-act=publish]").bounding_box()
        boxes.append((round(s["x"]), round(s["y"]), round(pb["x"]), round(pb["y"])))
    check(len(set(boxes)) == 1, boxes)


@test("US-20 AC-3 Leaving the page with unsaved changes asks for confirmation; after saving it does not")
def _(app):
    design_sprint(app, save=False)
    ask = "() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }"
    check(app.page.evaluate(ask) is True, "asks while unsaved")
    save_plan(app)
    check(app.page.evaluate(ask) is False, "does not ask once saved")


@test("US-20 AC-4 Someone else saved after I opened the plan: I am warned before anything is overwritten")
def _(app):
    design_sprint(app)
    # The PO saves from another browser: the attachment moves to a newer version.
    app.page.evaluate("""() => { const a = JSON.parse(localStorage.getItem('scp-mock-attachments'));
        a['scp-plan.json'].version += 1; a['scp-plan.json'].by = 'Product Owner';
        localStorage.setItem('scp-mock-attachments', JSON.stringify(a)); }""")
    leave(app, "lorenzo", "2027-01-11")
    msgs = []
    app.page.once("dialog", lambda d: (msgs.append(d.message), d.dismiss()))
    app.page.click("[data-act=save-plan]")
    app.settle(300)
    check(msgs and "changed by Product Owner" in msgs[0], msgs)
    check("Not saved" in app.text(".scp-notice") and app.state("S.planDirty") is True, app.text(".scp-notice"))
    check(app.attachment("scp-plan.json")["leave"].get("lorenzo") is None, "PO's version not overwritten")


@test("US-20 AC-5 Saving and publishing never write to Jira: every Jira call is a read")
def _(app):
    design_sprint(app)
    app.tab(CALENDAR)
    app.page.evaluate("() => SCP.tabs.calendar.move('PCAP-427|dev', 'lorenzo', 12)")
    save_plan(app)
    publish(app)
    reqs = app.page.evaluate("() => window.SCP_MOCK.requests")
    jira = [r for r in reqs if r["path"].startswith("jira:")]
    check(jira and all(r["method"] == "GET" for r in jira), [r for r in jira if r["method"] != "GET"])


# ---------------------------------------------------------------- US-21

def start_and_lock(app):
    """A saved Sprint 26 plan; then the sprint starts in Jira and the page is opened again."""
    design_sprint(app)
    set_sprint_state(app, 2600, "active")
    app.reload()
    app.page.wait_for_function("() => SCP.state.plan.sprint.state === 'active'")


@test("US-21 AC-1 Sprint started in Jira: on load every input and drag is disabled, with a banner saying why")
def _(app):
    design_sprint(app)
    app.tab(CALENDAR)
    before = (app.page.get_attribute("[data-test=verdict]", "data-status"), badge(app, "marc"))
    set_sprint_state(app, 2600, "active")
    app.reload()
    app.page.wait_for_function("() => SCP.state.plan.sprint.state === 'active'")
    for t in TABS:
        app.tab(t)
        check("This plan is locked" in app.text("[data-test=locked-banner]"), (t, "banner"))
        live = app.page.eval_on_selector_all(".scp-body input:not([disabled]), .scp-body select:not([disabled]), .scp-body textarea:not([disabled]), "
                                             ".scp-body button:not([disabled]):not([data-ro-ok])", "e => e.map(x => x.outerHTML.slice(0, 80))")
        check(live == [], (t, live))
        check(app.page.is_disabled("[data-act=save-plan]"), (t, "Save plan"))
    check(app.page.is_disabled("[data-act=cal-reload]"), "Reload")
    check(app.page.is_enabled("[data-act=publish]"), "Publish still works")
    app.page.focus("[data-card='PCAP-441|dev'][data-part='0']")
    app.page.keyboard.press("ArrowUp")
    app.settle()
    check(card_lane(app, "PCAP-441|dev") == "marc", "keyboard move refused")
    check(app.page.evaluate("() => SCP.tabs.calendar.move('PCAP-441|dev', 'lorenzo', 12)") is False and card_lane(app, "PCAP-441|dev") == "marc", "move refused")
    check((app.page.get_attribute("[data-test=verdict]", "data-status"), badge(app, "marc")) == before, "same as at start")


@test("US-21 AC-2 A locked plan shows cards, loads and verdict as at sprint start, even when Jira changes later")
def _(app):
    start_and_lock(app)
    issues = app.fixture("issues")
    for i in issues["2600"]:
        if i["key"] == "PCAP-421":
            i["sp"] = 13                                           # grooming after the start
    app.set_fixture("issues", issues)
    app.reload()
    app.tab(CALENDAR)
    check(badge(app, "marc") == "10.8 / 8.8" and app.text("[data-test=dev-fit]") == "28.8 / 33.5 MD", (badge(app, "marc"), app.text("[data-test=dev-fit]")))
    app.page.click("[data-card='PCAP-421|dev'][data-part='0']")
    app.settle()
    check("PCAP-421" in app.text("[data-test=selected]"), "cards can still be looked at")
    app.tab(TICKETS)
    check(app.page.is_enabled("[data-act=sprint]"), "the next sprint can still be picked")


# ---------------------------------------------------------------- US-22

@test("US-22 The marker shows that the planning page is restricted, with who can view it")
def _(app):
    design_sprint(app, save=False)
    m = app.page.locator("[data-test=access]")
    check(m.get_attribute("data-access") == "restricted" and "Restricted · SM & PO only" in m.inner_text(), m.inner_text())
    check("Shripathi R., Product Owner" in m.get_attribute("title"), m.get_attribute("title"))


@test("US-22 An unrestricted planning page is called out: leave and availability would be visible to everyone")
def _(app):
    app.open("ok", attachments=att("scp-config.json", saved_config()))
    app.page.evaluate("() => localStorage.setItem('scp-mock-restrictions', JSON.stringify({ '900001': { user: [], group: [] } }))")
    app.reload()
    app.page.wait_for_selector("[data-test=access]")
    m = app.page.locator("[data-test=access]")
    check(m.get_attribute("data-access") == "open" and "Not restricted" in m.inner_text(), m.inner_text())


# ---------------------------------------------------------------- US-23

@test("US-23 AC-1 First Publish creates 'Sprint 26 - Squad Orion' under a new parent 'Sprint plans - Squad Orion'")
def _(app):
    design_sprint(app)
    check(page_by_title(app, "Sprint plans - Squad Orion") == [], "no parent yet")
    publish(app)
    parent = page_by_title(app, "Sprint plans - Squad Orion")
    sprint = page_by_title(app, "Sprint 26 - Squad Orion")
    check(len(parent) == 1 and len(sprint) == 1, (parent, sprint))
    parent, sprint = parent[0], sprint[0]
    check(parent["parentId"] == "800001", "the parent sits next to the planning page")
    check(sprint["parentId"] == parent["id"], "the sprint page sits under the parent")
    check(sorted(parent["atts"]) == ["scp-view.css", "scp-view.js"] and sorted(sprint["atts"]) == ["scp-snapshot.json"], "files")
    check("ac:name=\"html\"" in sprint["body"] and '"%s"' % parent["id"] in sprint["body"], "macro loads the parent's viewer")
    check("scp-view.js" not in app.attachment_names() if hasattr(app, "attachment_names") else True, "viewer not on the planning page")
    planning = json.loads(app.page.evaluate("() => localStorage.getItem('scp-mock-attachments')"))
    check(not any(n.startswith("scp-view") for n in planning), sorted(planning))
    check(app.attachment("scp-config.json")["publish"] == {"parentId": parent["id"]}, "parent page ID kept in the config")
    check(app.attachment("scp-plan.json")["published"]["pageId"] == sprint["id"], "sprint page ID kept with the plan")
    check(app.page.get_attribute("[data-test=published-link]", "href").endswith("pageId=" + sprint["id"]), "link")


@test("US-23 AC-2 Publishing again updates the same page: no duplicate, new numbers")
def _(app):
    design_sprint(app)
    publish(app)
    first = page_by_title(app, "Sprint 26 - Squad Orion")[0]
    check(snapshot(app, first["id"])["verdict"]["status"] == "atRisk", "at risk first")
    app.tab(CALENDAR)
    app.page.evaluate("() => SCP.tabs.calendar.move('PCAP-427|dev', 'lorenzo', 12)")
    app.page.evaluate("() => SCP.tabs.calendar.move('PCAP-441|dev', 'lorenzo', 14)")
    save_plan(app)
    publish(app)
    again = page_by_title(app, "Sprint 26 - Squad Orion")
    check(len(again) == 1 and again[0]["id"] == first["id"] and again[0]["version"] == 2, again)
    check(len(page_by_title(app, "Sprint plans - Squad Orion")) == 1, "one parent")
    snap = snapshot(app, first["id"])
    check(snap["verdict"]["status"] == "feasible", snap["verdict"])
    check(pages(app)[first["id"]]["atts"]["scp-snapshot.json"]["version"] == 2, "snapshot updated")


@test("US-23 AC-3 The snapshot holds no leave dates, availability % or holidays per person")
def _(app):
    design_sprint(app)
    publish(app)
    pid = page_by_title(app, "Sprint 26 - Squad Orion")[0]["id"]
    raw = pages(app)[pid]["atts"]["scp-snapshot.json"]["body"]
    snap = json.loads(raw)

    def keys(o):
        if isinstance(o, dict):
            for k, v in o.items():
                yield k
                yield from keys(v)
        elif isinstance(o, list):
            for v in o:
                yield from keys(v)
    found = {k for k in keys(snap) if re.search(r"leave|availab|holiday|absen", k, re.I)}
    check(found == set(), found)
    for leak in ["2027-01-07", "2027-01-08", "2027-01-19", "2027-01-21", "2027-01-14", "Pongal", "Full day", "Morning", "Afternoon"]:
        check(leak not in raw, "snapshot contains " + leak)
    check(sorted(snap["people"][1]) == ["cards", "load", "name", "net", "pct", "role"], sorted(snap["people"][1]))
    check(snap["people"][1]["name"] == "Marc" and snap["people"][1]["net"] == 8.8, snap["people"][1])


@test("US-23 AC-4 A page with the same title not created by this plan is never overwritten")
def _(app):
    design_sprint(app)
    app.page.evaluate("""() => { const P = JSON.parse(localStorage.getItem('scp-mock-pages') || 'null') || {
        '800001': { id: '800001', title: 'Digital Delivery', space: 'DD', parentId: null, body: '', version: 1, atts: {} },
        '900001': { id: '900001', title: 'Sprint planning — Squad Orion', space: 'DD', parentId: '800001', body: '', version: 3, atts: null } };
        P['900777'] = { id: '900777', title: 'Sprint 26 - Squad Orion', space: 'DD', parentId: '800001', body: '<p>Retro notes</p>', version: 4, atts: {} };
        localStorage.setItem('scp-mock-pages', JSON.stringify(P)); }""")
    msgs = []
    app.page.once("dialog", lambda d: (msgs.append(d.message), d.dismiss()))
    publish(app)
    check(msgs and "already exists" in msgs[0] and "Sprint 26 - Squad Orion (plan)" in msgs[0], msgs)
    check("Publish stopped" in app.text(".scp-notice") and "Sprint 26 - Squad Orion" in app.text(".scp-notice"), app.text(".scp-notice"))
    other = pages(app)["900777"]
    check(other["body"] == "<p>Retro notes</p>" and other["version"] == 4 and other["atts"] == {}, "untouched")
    check(page_by_title(app, "Sprint 26 - Squad Orion (plan)") == [], "nothing created")
    app.page.once("dialog", lambda d: d.accept())
    publish(app)
    made = page_by_title(app, "Sprint 26 - Squad Orion (plan)")
    check(len(made) == 1 and pages(app)["900777"]["version"] == 4, made)


@test("US-23 The parent is found by its stored ID after a rename; a deleted parent is re-created only after asking")
def _(app):
    design_sprint(app)
    publish(app)
    parent = page_by_title(app, "Sprint plans - Squad Orion")[0]
    app.page.evaluate("""id => { const P = JSON.parse(localStorage.getItem('scp-mock-pages'));
        P[id].title = 'Orion sprint plans (archive)'; localStorage.setItem('scp-mock-pages', JSON.stringify(P)); }""", parent["id"])
    publish(app)
    check(page_by_title(app, "Sprint plans - Squad Orion") == [] and len(pages(app)) == 4, "no second parent after a rename")
    app.page.evaluate("""id => { const P = JSON.parse(localStorage.getItem('scp-mock-pages'));
        Object.keys(P).forEach(k => { if (k === id || P[k].parentId === id) delete P[k]; });
        localStorage.setItem('scp-mock-pages', JSON.stringify(P)); }""", parent["id"])
    msgs = []
    app.page.once("dialog", lambda d: (msgs.append(d.message), d.accept()))
    publish(app)
    check(msgs and "was deleted" in msgs[0], msgs)
    check(len(page_by_title(app, "Sprint plans - Squad Orion")) == 1 and len(page_by_title(app, "Sprint 26 - Squad Orion")) == 1, "re-created")


@test("US-23 Publish waits for a saved plan and a Team, and says why")
def _(app):
    design_sprint(app, save=False)
    b = app.page.locator("[data-act=publish]")
    check(b.is_disabled() and "Save the plan first" in b.get_attribute("title"), b.get_attribute("title"))
    save_plan(app)
    check(app.page.is_enabled("[data-act=publish]"), "enabled once saved")
    cfg = saved_config()
    cfg["jira"]["team"] = ""
    app.page.evaluate("() => { SCP.state.config.jira.team = ''; SCP.app.render(); }")
    check("Team (squad)" in app.page.get_attribute("[data-act=publish]", "title"), "no team")


# ---------------------------------------------------------------- US-24

@test("US-24 AC-1 The published page shows each person's tickets, load and net capacity, as on the design")
def _(app):
    design_sprint(app)
    publish(app)
    open_sprint_page(app)
    check(app.text("[data-test=page-title]") == "Sprint 26 - Squad Orion", app.text("[data-test=page-title]"))
    v = app.page.locator("[data-test=view-verdict]")
    check(v.get_attribute("data-status") == "atRisk" and "48.0 MD" in v.inner_text() and "56.9 MD" in v.inner_text() and "10 · 31" in v.inner_text(), v.inner_text())
    marc = app.page.inner_text(".scpv-row[data-person=Marc]")
    check("PCAP-421 · 7.2" in marc and "PCAP-441 · 1.8" in marc and "10.8 / 8.8 · 122%" in marc, marc)
    un = app.page.inner_text(".scpv-row[data-person='']")
    check("PCAP-441 · 1.2" in un and "PCAP-444 · no SP" in un and "1.2 MD" in un, un)
    check("Mon 4 – Fri 22 Jan 2027 · 15 working days" in app.text("[data-test=view-sub]"), app.text("[data-test=view-sub]"))
    check("Snapshot published by Shripathi Raman Radhakrishnan" in app.text("[data-test=view-published]"), app.text("[data-test=view-published]"))


@test("US-24 AC-2 No leave dates or availability % appear anywhere on the published page")
def _(app):
    design_sprint(app)
    publish(app)
    open_sprint_page(app)
    body = app.text(".scpv")
    for leak in ["Thu 7", "Fri 8", "Tue 19", "Thu 21", "Pongal", "Full day", "Morning", "Afternoon", "80%", "Leave days"]:
        check(leak not in body, "page shows " + leak)
    check("Leave dates, availability and personal holidays stay on the restricted planning page" in body, "note")


@test("US-24 A sprint page whose snapshot is missing says so instead of failing silently")
def _(app):
    design_sprint(app)
    publish(app)
    pid = page_by_title(app, "Sprint 26 - Squad Orion")[0]["id"]
    app.page.evaluate("""id => { const P = JSON.parse(localStorage.getItem('scp-mock-pages')); P[id].atts = {};
        localStorage.setItem('scp-mock-pages', JSON.stringify(P)); }""", pid)
    app.page.goto(app.base + "/tests/sprint-page.html?page=" + pid)
    app.page.wait_for_selector(".scpv-error")
    check("scp-snapshot.json is not attached" in app.text(".scpv-error"), app.text(".scpv-error"))


if __name__ == "__main__":
    sys.exit(1 if run(sys.argv[1] if len(sys.argv) > 1 else None) else 0)
