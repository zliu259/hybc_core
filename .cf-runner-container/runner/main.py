from __future__ import annotations

import logging
import os
import signal
import sys
import time

from runner.config import Settings
from runner.executor import TaskExecutor
from runner.heartbeat import HeartbeatReporter
from runner.poller import TaskPoller
from runner.providers.claude import ClaudeProvider
from runner.providers.openai_provider import OpenAIProvider
from runner.providers.local_rules import LocalRulesProvider

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
logger = logging.getLogger("task-runner")


def build_executor() -> TaskExecutor:
    providers = []

    mock_ai_only = os.getenv("MOCK_AI_ONLY", "false").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    openai_key = os.getenv("OPENAI_API_KEY", "")
    if openai_key and not mock_ai_only:
        openai_model = os.getenv("OPENAI_MODEL", "gpt-5.2")
        openai_base_url = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
        openai_org_id = os.getenv("OPENAI_ORG_ID", "")
        openai_project_id = os.getenv("OPENAI_PROJECT_ID", "")
        openai_timeout = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "30"))
        openai_retries = int(os.getenv("OPENAI_MAX_RETRIES", "2"))
        providers.append(
            OpenAIProvider(
                api_key=openai_key,
                model=openai_model,
                base_url=openai_base_url,
                organization=openai_org_id or None,
                project=openai_project_id or None,
                timeout_seconds=openai_timeout,
                max_retries=openai_retries,
            )
        )
        logger.info("OpenAI provider enabled (model=%s)", openai_model)
    elif openai_key and mock_ai_only:
        logger.info("MOCK_AI_ONLY=true — OpenAI provider skipped")
    else:
        logger.warning("OPENAI_API_KEY not set — OpenAI provider disabled")

    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "")
    if anthropic_key and not mock_ai_only:
        model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
        providers.append(ClaudeProvider(api_key=anthropic_key, model=model))
        logger.info("Claude provider enabled (model=%s)", model)
    elif anthropic_key and mock_ai_only:
        logger.info("MOCK_AI_ONLY=true — Claude provider skipped")
    else:
        logger.warning("ANTHROPIC_API_KEY not set — Claude provider disabled")

    providers.append(LocalRulesProvider())
    logger.info("LocalRules provider enabled")

    return TaskExecutor(providers)


def main() -> None:
    settings = Settings.from_env()
    logger.info(
        "Starting task-runner node_id=%s name=%s",
        settings.node_id,
        settings.node_name,
    )
    if settings.api_base_url_fallbacks:
        logger.info("Fallback API base URLs: %s", ", ".join(settings.api_base_url_fallbacks))
    if settings.tls_ca_cert_path:
        logger.info("mTLS/CA verify enabled")

    poller = TaskPoller(settings)
    executor = build_executor()
    heartbeat = HeartbeatReporter(settings, poller.heartbeat)

    # Register node on startup
    poller.register_node()
    heartbeat.start()

    # Graceful shutdown
    running = True

    def shutdown(signum: int, frame: object) -> None:
        nonlocal running
        logger.info("Received signal %d, shutting down...", signum)
        running = False

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    # Main poll loop
    logger.info(
        "Polling every %.1fs for tasks: %s",
        settings.poll_interval_seconds,
        ", ".join(settings.capabilities),
    )

    while running:
        task = poller.poll()
        if task:
            task_id = task.get("id")
            task_type = task.get("task_type", "unknown")
            logger.info("Executing task %s (type=%s)", task_id, task_type)
            try:
                result = executor.execute(task)
                if task_id is not None:
                    poller.submit_result(task_id, result)
            except Exception as exc:
                logger.error("Task %s failed: %s", task_id, exc)
                if task_id is not None:
                    poller.submit_error(task_id, str(exc))
        else:
            time.sleep(settings.poll_interval_seconds)

    heartbeat.stop()
    poller.close()
    logger.info("Task-runner stopped.")


if __name__ == "__main__":
    main()
