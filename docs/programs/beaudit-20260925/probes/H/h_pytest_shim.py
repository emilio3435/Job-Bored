#!/usr/bin/env python3
"""Run integrations/hermes-job-hunt/tests/test_phase7_universal_filler.py without pytest.

httpx and playwright are stubbed (not installed on this machine; no network).
The test file hardcodes SCRIPTS_DIR = Path.home()/.hermes/job-hunt/scripts, so HOME decides
which code is tested. Usage from the worktree root:
  HOME="$PWD/.lane-evidence/home" python3 .lane-evidence/probes/h_pytest_shim.py            # runtime path absent
  HOME="$PWD/.lane-evidence/home-linked" python3 .lane-evidence/probes/h_pytest_shim.py     # symlink -> repo scripts
"""
import importlib.util
import inspect
import sys
import tempfile
import traceback
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEST = ROOT / "integrations" / "hermes-job-hunt" / "tests" / "test_phase7_universal_filler.py"

httpx = types.ModuleType("httpx"); httpx.Client = object
sys.modules["httpx"] = httpx
pw = types.ModuleType("playwright"); pws = types.ModuleType("playwright.sync_api")
pws.Page = object
pws.sync_playwright = lambda: (_ for _ in ()).throw(RuntimeError("playwright stubbed"))
sys.modules["playwright"] = pw; sys.modules["playwright.sync_api"] = pws

spec = importlib.util.spec_from_file_location("t_phase7", TEST)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print("SCRIPTS_DIR under test:", mod.SCRIPTS_DIR, "exists=", mod.SCRIPTS_DIR.exists())
passed = failed = 0
for name, fn in sorted(vars(mod).items()):
    if not name.startswith("test_") or not callable(fn):
        continue
    kwargs = {}
    if "tmp_path" in inspect.signature(fn).parameters:
        kwargs["tmp_path"] = Path(tempfile.mkdtemp(dir=ROOT / ".lane-evidence"))
    try:
        fn(**kwargs)
        passed += 1
        print("PASS", name)
    except Exception as e:
        failed += 1
        print("FAIL", name, "->", type(e).__name__, str(e)[:120])
print(f"== {passed} passed, {failed} failed")
