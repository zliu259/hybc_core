from __future__ import annotations

import logging
import threading
import time
from typing import Callable

from runner.config import Settings

logger = logging.getLogger(__name__)


class HeartbeatReporter:
    """Reports heartbeat to the API at regular intervals in a background thread."""

    def __init__(self, settings: Settings, send_heartbeat: Callable[[], None]) -> None:
        self.settings = settings
        self.send_heartbeat = send_heartbeat
        self._running = False
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        """Start the heartbeat background thread."""
        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        logger.info(
            "Heartbeat started (interval=%.0fs)", self.settings.heartbeat_interval_seconds
        )

    def stop(self) -> None:
        """Stop the heartbeat thread and wait for it to finish."""
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=10)
        logger.info("Heartbeat stopped")

    def _run(self) -> None:
        """Background thread loop."""
        while self._running:
            self._report()
            time.sleep(self.settings.heartbeat_interval_seconds)

    def _report(self) -> None:
        """Send a single heartbeat to the API."""
        try:
            self.send_heartbeat()
            logger.debug("Heartbeat sent")
        except Exception as exc:
            logger.warning("Heartbeat failed: %s", exc)
