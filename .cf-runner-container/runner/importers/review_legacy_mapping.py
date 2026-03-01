from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def is_missing(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def count_missing(records: list[dict[str, Any]], key: str) -> int:
    return sum(1 for item in records if is_missing(item.get(key)))


def unique_values(records: list[dict[str, Any]], key: str) -> int:
    values = {str(item.get(key)).strip() for item in records if not is_missing(item.get(key))}
    return len(values)


def build_report(payload: dict[str, Any]) -> dict[str, Any]:
    data = payload.get("data", {})
    projects = data.get("projects", [])
    sections = data.get("sections", [])
    operator_logs = data.get("operator_logs", [])
    manager_logs = data.get("manager_logs", [])
    breakthrough_reports = data.get("breakthrough_reports", [])

    warnings_data = data.get("warnings", {})
    if isinstance(warnings_data, list):
        warnings_data = {
            "project": warnings_data,
            "operator": [],
            "manager": [],
            "breakthrough": [],
        }

    report = {
        "generated_at": now_iso(),
        "source_generated_at": payload.get("generated_at"),
        "source_files": payload.get("source_files", {}),
        "overview": {
            "projects": len(projects),
            "sections": len(sections),
            "operator_logs": len(operator_logs),
            "manager_logs": len(manager_logs),
            "breakthrough_reports": len(breakthrough_reports),
        },
        "quality": {
            "projects_missing_name": count_missing(projects, "project_name"),
            "sections_missing_code": count_missing(sections, "section_code"),
            "sections_missing_project": count_missing(sections, "project_name"),
            "operator_missing_project": count_missing(operator_logs, "project_name"),
            "operator_missing_section": count_missing(operator_logs, "section_text"),
            "operator_missing_shift": count_missing(operator_logs, "shift"),
            "operator_missing_log_date": count_missing(operator_logs, "log_date"),
            "manager_missing_project": count_missing(manager_logs, "project_name"),
            "manager_missing_date": count_missing(manager_logs, "log_date"),
            "breakthrough_missing_project": count_missing(breakthrough_reports, "project_name"),
            "breakthrough_missing_section": count_missing(breakthrough_reports, "section_text"),
            "breakthrough_missing_date": count_missing(breakthrough_reports, "report_date"),
        },
        "domain_stats": {
            "project_name_unique": unique_values(projects, "project_name"),
            "section_code_unique": unique_values(sections, "section_code"),
            "operator_project_name_unique": unique_values(operator_logs, "project_name"),
            "manager_project_name_unique": unique_values(manager_logs, "project_name"),
            "breakthrough_project_name_unique": unique_values(breakthrough_reports, "project_name"),
        },
        "warnings": {
            "from_dry_run": {
                "project": len(warnings_data.get("project", [])),
                "operator": len(warnings_data.get("operator", [])),
                "manager": len(warnings_data.get("manager", [])),
                "breakthrough": len(warnings_data.get("breakthrough", [])),
            }
        },
    }
    return report


def write_markdown(report: dict[str, Any], path: Path) -> None:
    overview = report["overview"]
    quality = report["quality"]
    domain_stats = report["domain_stats"]

    lines = [
        "# Legacy Mapping Review Report",
        "",
        f"- Generated at: {report['generated_at']}",
        f"- Source generated at: {report.get('source_generated_at')}",
        "",
        "## Overview",
        f"- projects: {overview['projects']}",
        f"- sections: {overview['sections']}",
        f"- operator_logs: {overview['operator_logs']}",
        f"- manager_logs: {overview['manager_logs']}",
        f"- breakthrough_reports: {overview['breakthrough_reports']}",
        "",
        "## Quality",
        f"- projects_missing_name: {quality['projects_missing_name']}",
        f"- sections_missing_code: {quality['sections_missing_code']}",
        f"- sections_missing_project: {quality['sections_missing_project']}",
        f"- operator_missing_project: {quality['operator_missing_project']}",
        f"- operator_missing_section: {quality['operator_missing_section']}",
        f"- operator_missing_shift: {quality['operator_missing_shift']}",
        f"- operator_missing_log_date: {quality['operator_missing_log_date']}",
        f"- manager_missing_project: {quality['manager_missing_project']}",
        f"- manager_missing_date: {quality['manager_missing_date']}",
        f"- breakthrough_missing_project: {quality['breakthrough_missing_project']}",
        f"- breakthrough_missing_section: {quality['breakthrough_missing_section']}",
        f"- breakthrough_missing_date: {quality['breakthrough_missing_date']}",
        "",
        "## Domain Stats",
        f"- project_name_unique: {domain_stats['project_name_unique']}",
        f"- section_code_unique: {domain_stats['section_code_unique']}",
        f"- operator_project_name_unique: {domain_stats['operator_project_name_unique']}",
        f"- manager_project_name_unique: {domain_stats['manager_project_name_unique']}",
        f"- breakthrough_project_name_unique: {domain_stats['breakthrough_project_name_unique']}",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build review report from legacy dry-run JSON.")
    parser.add_argument(
        "--input",
        default="/tmp/legacy_import_dry_run.json",
        help="Input JSON generated by dry_run_legacy_excel.py",
    )
    parser.add_argument(
        "--output-json",
        default="/tmp/legacy_import_review_report.json",
        help="Output report JSON path",
    )
    parser.add_argument(
        "--output-md",
        default="/tmp/legacy_import_review_report.md",
        help="Output report markdown path",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_path = Path(args.input)
    output_json = Path(args.output_json)
    output_md = Path(args.output_md)

    payload = load_json(input_path)
    report = build_report(payload)

    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    write_markdown(report, output_md)

    print(f"review json: {output_json}")
    print(f"review md: {output_md}")


if __name__ == "__main__":
    main()
