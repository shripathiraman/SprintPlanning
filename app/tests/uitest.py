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
import re
import socketserver
import urllib.parse
import sys
import tempfile
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
    """Serves the app folder. /download/attachments/<page>/<name> plays Confluence serving
    the planner's files as page attachments; SERVE (set through /__serve/<mode>) can make it
    answer 404 for one file ("missing:<name>") or refuse code like a locked-down Confluence
    ("nosniff": .js as application/octet-stream with X-Content-Type-Options: nosniff)."""
    SERVE = {"mode": "ok"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP_DIR, **kw)

    def log_message(self, *a):
        pass

    def _attachment(self, with_body):
        m = re.match(r"^/download/attachments/\d+/([^?]+)", self.path)
        if not m:
            return False
        name = urllib.parse.unquote(m.group(1))
        path = os.path.join(APP_DIR, os.path.basename(name))
        mode = Quiet.SERVE["mode"]
        if not os.path.isfile(path) or mode == "missing:" + name:
            self.send_response(404)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            return True
        body = open(path, "rb").read()
        ctype = "text/css" if name.endswith(".css") else "application/javascript"
        self.send_response(200)
        if mode == "nosniff" and name.endswith(".js"):
            ctype = "application/octet-stream"
            self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if with_body:
            self.wfile.write(body)
        return True

    def do_GET(self):
        if self.path.startswith("/__serve/"):
            Quiet.SERVE["mode"] = urllib.parse.unquote(self.path[len("/__serve/"):])
            self.send_response(204)
            self.end_headers()
            return
        if not self._attachment(True):
            super().do_GET()

    def do_HEAD(self):
        if not self._attachment(False):
            super().do_HEAD()


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
        # The planner asks in an in-page dialog; a browser pop-up (window.confirm) is a bug.
        self.page.on("dialog", lambda d: (self.errors.append("browser pop-up: " + d.message), d.dismiss()))

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

    def serve(self, mode):
        """How the test server answers /download/attachments/: 'ok', 'nosniff' or 'missing:<file>'."""
        self.page.request.get(self.base + "/__serve/" + urllib.parse.quote(mode))

    def reload(self, wait_connected=True, page="harness.html"):
        self.page.goto(self.base + "/tests/" + page)
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
        """Answer the next in-page confirmation (OK or Cancel) on this page; its text lands in app.dialogs."""
        self.page.evaluate("""accept => {
            window.__scpDialogs = [];
            const obs = new MutationObserver(() => {
                const d = document.querySelector('dialog[data-test=confirm][open]');
                if (!d || d.dataset.answered) return;
                d.dataset.answered = '1';
                obs.disconnect();
                window.__scpDialogs.push(d.querySelector('[data-test=confirm-msg]').innerText);
                setTimeout(() => d.querySelector(accept ? '[data-act=confirm-ok]' : '[data-act=confirm-cancel]').click(), 0);
            });
            obs.observe(document.body, { subtree: true, childList: true, attributes: true });
        }""", accept)

    @property
    def dialogs(self):
        """Texts of the in-page confirmations answered since the last on_dialog()."""
        return self.page.evaluate("() => window.__scpDialogs || []")

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
            Quiet.SERVE["mode"] = "ok"
            try:
                fn(app)
                check(not app.errors, "page errors: %s" % app.errors)
                passed += 1
                print("PASS  " + name)
            except Exception as e:  # noqa: BLE001
                failed += 1
                print("FAIL  " + name + "\n      " + (str(e) or traceback.format_exc()).splitlines()[0][:400])
                try:
                    shot = os.path.join(tempfile.gettempdir(), "fail-" + "".join(c if c.isalnum() else "_" for c in name)[:60] + ".png")
                    app.page.screenshot(path=shot, full_page=True)
                    print("      screenshot: " + shot)
                except Exception as shot_error:  # noqa: BLE001
                    print("      (no screenshot: %s)" % shot_error)
            finally:
                app.close()
        browser.close()
    srv.shutdown()
    print("\n%d passed, %d failed" % (passed, failed))
    return failed
