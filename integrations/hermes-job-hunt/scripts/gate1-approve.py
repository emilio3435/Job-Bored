#!/usr/bin/env python3
"""Deprecated name for interest-approve.py (BEAUDIT H22).

"YES <COMPANY>" records research interest (Status = Researching). It is not
Gate 1; Gate 1 is the Pipeline Approval Status column. This shim keeps existing
Hermes skills that call gate1-approve.py working while they move to
interest-approve.py.
"""

import os
import runpy
import sys
from pathlib import Path

if __name__ == "__main__":
    print("gate1-approve.py is deprecated; use interest-approve.py", file=sys.stderr)
    target = Path(__file__).resolve().parent / "interest-approve.py"
    sys.argv[0] = str(target)
    os.environ.setdefault("JHOS_INVOKED_AS", "gate1-approve.py")
    runpy.run_path(str(target), run_name="__main__")
