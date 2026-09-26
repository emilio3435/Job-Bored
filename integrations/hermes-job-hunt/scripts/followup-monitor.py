#!/usr/bin/env python3
"""Cron entry point kept for existing Hermes cron jobs.

The implementation lives in followup_monitor.py (one copy, BEAUDIT H19); this
file only runs it so crons that call `followup-monitor.py` keep working.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from followup_monitor import main  # noqa: E402

if __name__ == "__main__":
    main()
