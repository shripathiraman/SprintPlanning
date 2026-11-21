"""
tests/check_build.py — TEST ONLY. The shipped scp-planner.js must be exactly what
build.py makes from the source files, so a forgotten build (or a hand edit of the
shipped file) fails the test run instead of reaching Confluence.

Run: python3 tests/check_build.py
"""
import os
import subprocess
import sys

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
r = subprocess.run([sys.executable, os.path.join(APP, "build.py"), "--check"], capture_output=True, text=True)
print(("PASS  " if r.returncode == 0 else "FAIL  ") + "scp-planner.js is the build of the 10 source files: " + r.stdout.strip())
print("\n%d passed, %d failed" % ((1, 0) if r.returncode == 0 else (0, 1)))
sys.exit(r.returncode)
