from __future__ import annotations

import os
import json
import time
from pathlib import Path
from typing import Any, Dict, Optional


class WriterLock:
    """
    Simple cross-process lock using O_EXCL lockfile.
    Ensures ONLY ONE writer touches DuckDB at a time.
    """

    def __init__(self, lock_path: str, meta: Optional[Dict[str, Any]] = None, timeout_s: int = 120):
        self.lock_path = Path(lock_path)
        self.meta = meta or {}
        self.timeout_s = timeout_s
        self._acquired = False

    def __enter__(self):
        deadline = time.time() + self.timeout_s
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)

        while True:
            try:
                fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
                try:
                    payload = {"pid": os.getpid(), "meta": self.meta, "acquired_at": time.time()}
                    os.write(fd, json.dumps(payload).encode("utf-8"))
                finally:
                    os.close(fd)
                self._acquired = True
                return self
            except FileExistsError:
                if time.time() >= deadline:
                    raise TimeoutError(f"Timed out waiting for writer lock: {self.lock_path}")
                time.sleep(0.1)

    def __exit__(self, exc_type, exc, tb):
        if self._acquired:
            try:
                self.lock_path.unlink(missing_ok=True)
            except Exception:
                # Worst case: lockfile remains; next run will timeout and show the path.
                pass
        return False

