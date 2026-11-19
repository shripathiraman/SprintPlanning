"""
tests/uitest.py — TEST ONLY. Tiny browser-test framework for the planner.

Starts a local web server on the app folder, opens tests/harness.html in
headless Chrome (Playwright) with the fake Jira/Confluence of mock-env.js,
and runs test functions registered with @test("US-xx AC-y ...").

Needs: pip install playwright  (uses the installed Chrome, no download)
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
import traceback

from playwright.sync_api import sync_playwright

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get("SCP_CHROME", "/usr/bin/google-chrome")
_TESTS = []


def test(name):
    """Register a browser test."""
    def wrap(fn):
        _TESTS.append((name, fn))
        return fn
    return wrap


class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP_DIR, **kw)

    def log_message(self, *a):
        pass


def _serve():
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Quiet)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


class App:
    """One browser page on the harness, with helpers."""

    def __init__(self, browser, base):
        self.browser = browser
        self.base = base
        self.ctx = browser.new_context(viewport={"width": 1440, "height": 1200})
        self.page = self.ctx.new_page()
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.dialogs = []

    def open(self, scenario="ok", attachments=None, fixtures=None, user=None, wait_connected=True):
        """Fresh start: clear the fake Confluence, set the scenario, open the page."""
        self.page.goto(self.base + "/tests/blank.html")
        self.page.evaluate(
            """([sc, att, fix, user]) => {
                localStorage.clear();
                localStorage.setItem('scp-mock-scenario', sc);
                if (att) localStorage.setItem('scp-mock-attachments', JSON.stringify(att));
                if (fix) localStorage.setItem('scp-mock-fixture-overrides', JSON.stringify(fix));
                if (user) localStorage.setItem('scp-mock-user', user);
            }""",
            [scenario, attachments, fixtures, user],
        )
        self.reload(wait_connected)
        return self

    def reload(self, wait_connected=True):
        self.page.goto(self.base + "/tests/harness.html")
        self.page.wait_for_selector("[data-test=conn-status]", timeout=8000)
        if wait_connected:
            self.page.wait_for_selector("[data-test=conn-status] >> text=Connected as", timeout=8000)
        self.settle()

    def settle(self, ms=150):
        self.page.wait_for_timeout(ms)

    def text(self, sel="body"):
        return self.page.inner_text(sel)

    def tab(self, label):
        self.page.click(".scp-tab >> text=" + label)
        self.settle()

    def state(self, expr):
        """Evaluate an expression against window.SCP.state."""
        return self.page.evaluate("() => { const S = window.SCP.state; return (" + expr + "); }")

    def attachment(self, name):
        raw = self.page.evaluate("() => localStorage.getItem('scp-mock-attachments')")
        att = json.loads(raw or "{}").get(name)
        return json.loads(att["body"]) if att else None

    def fixture(self, name):
        """Current fake-Jira fixture part (deep copy), e.g. 'issues'."""
        return self.page.evaluate("n => JSON.parse(JSON.stringify(window.SCP_MOCK.fixtures[n]))", name)

    def set_fixture(self, name, value):
        """Change the fake Jira from now on (survives page reloads)."""
        self.page.evaluate("""([n, v]) => { const o = JSON.parse(localStorage.getItem('scp-mock-fixture-overrides') || '{}');
            o[n] = v; localStorage.setItem('scp-mock-fixture-overrides', JSON.stringify(o)); }""", [name, value])

    def on_dialog(self, accept):
        def handler(d):
            self.dialogs.append(d.message)
            d.accept() if accept else d.dismiss()
        self.page.once("dialog", handler)

    def close(self):
        self.ctx.close()


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def run(only=None):
    srv = _serve()
    base = "http://127.0.0.1:%d" % srv.server_address[1]
    passed = failed = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROME, args=["--no-sandbox", "--no-proxy-server"])
        for name, fn in _TESTS:
            if only and only not in name:
                continue
            app = App(browser, base)
            try:
                fn(app)
                check(not app.errors, "page errors: %s" % app.errors)
                passed += 1
                print("PASS  " + name)
            except Exception as e:  # noqa: BLE001
                failed += 1
                print("FAIL  " + name + "\n      " + (str(e) or traceback.format_exc()).splitlines()[0][:400])
                try:
                    shot = os.path.join("/tmp", "fail-" + "".join(c if c.isalnum() else "_" for c in name)[:60] + ".png")
                    app.page.screenshot(path=shot, full_page=True)
                    print("      screenshot: " + shot)
                except Exception:  # noqa: BLE001
                    pass
            finally:
                app.close()
        browser.close()
    srv.shutdown()
    print("\n%d passed, %d failed" % (passed, failed))
    return failed
