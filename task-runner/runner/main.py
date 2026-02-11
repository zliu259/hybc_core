from __future__ import annotations

import os
import time

import requests


POLL_INTERVAL_SECONDS = float(os.getenv("POLL_INTERVAL_SECONDS", "5"))
API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8787")


def poll_once() -> None:
    endpoint = f"{API_BASE_URL}/api/v1/system/health"
    response = requests.get(endpoint, timeout=10)
    response.raise_for_status()


def main() -> None:
    while True:
        try:
            poll_once()
            print("task-runner heartbeat ok")
        except Exception as exc:
            print(f"task-runner heartbeat failed: {exc}")
        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
