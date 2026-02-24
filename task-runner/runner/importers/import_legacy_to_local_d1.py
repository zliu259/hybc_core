from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def as_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def as_int(value: Any, default: int = 0) -> int:
    if value is None:
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_key(text: str) -> str:
    value = as_text(text)
    value = re.sub(r"[\s\-_/|，。；、（）()\[\]{}]+", "", value)
    return value.lower()


def make_legacy_id(prefix: str, *parts: str) -> str:
    base = "|".join([prefix, *[as_text(p) for p in parts]])
    digest = hashlib.sha1(base.encode("utf-8")).hexdigest()[:16]
    return f"legacy_excel:{prefix}:{digest}"


def make_project_code(project_name: str, short_name: str, index: int) -> str:
    seed = f"{project_name}|{short_name}|{index}"
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:8].upper()
    return f"LEGACY-{digest}"


def sql_str(value: Any) -> str:
    if value is None:
        return "NULL"
    text = as_text(value)
    if not text:
        return "NULL"
    escaped = text.replace("'", "''")
    return f"'{escaped}'"


def sql_num(value: Any) -> str:
    parsed = as_float(value)
    if parsed is None:
        return "NULL"
    return str(parsed)


def build_import(payload: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
    data = payload.get("data", {})
    projects = data.get("projects", [])
    sections = data.get("sections", [])
    operator_logs = data.get("operator_logs", [])
    manager_logs = data.get("manager_logs", [])
    breakthrough_reports = data.get("breakthrough_reports", [])

    sql_lines: list[str] = ["BEGIN;"]
    unmatched: dict[str, list[dict[str, Any]]] = {
        "operator_logs": [],
        "manager_logs": [],
        "breakthrough_reports": [],
    }

    project_by_norm_name: dict[str, str] = {}
    project_seen: set[str] = set()
    stats = {
        "projects_prepared": 0,
        "sections_prepared": 0,
        "operator_prepared": 0,
        "manager_prepared": 0,
        "breakthrough_prepared": 0,
        "operator_unmatched": 0,
        "manager_unmatched": 0,
        "breakthrough_unmatched": 0,
    }

    project_auto_index = 0

    def register_project(row: dict[str, Any], synthetic: bool = False) -> None:
        nonlocal project_auto_index
        project_name = as_text(row.get("project_name"))
        short_name = as_text(row.get("project_short_name"))
        if not project_name:
            return
        dedupe_key = f"{normalize_key(project_name)}|{normalize_key(short_name)}"
        if dedupe_key in project_seen:
            return
        project_seen.add(dedupe_key)
        project_auto_index += 1

        legacy_id = make_legacy_id("project", project_name, short_name)
        project_code = make_project_code(project_name, short_name, project_auto_index)
        status = "active"
        created_at = now_iso()
        legacy_note = row.get("legacy_note")
        if synthetic:
            legacy_note = as_text(legacy_note) or "auto-created from legacy logs mapping"

        sql_lines.append(
            "INSERT INTO project ("
            "project_code, project_name, status, created_at, updated_at, "
            "legacy_data_id, project_short_name, project_alias, province, city, district, "
            "address_detail, geotech_soil, machine_type, pipe_material, pipe_spec, legacy_note"
            ") "
            "SELECT "
            f"{sql_str(project_code)}, {sql_str(project_name)}, {sql_str(status)}, "
            f"{sql_str(created_at)}, {sql_str(created_at)}, {sql_str(legacy_id)}, "
            f"{sql_str(row.get('project_short_name'))}, {sql_str(row.get('project_alias'))}, "
            f"{sql_str(row.get('province'))}, {sql_str(row.get('city'))}, {sql_str(row.get('district'))}, "
            f"{sql_str(row.get('address_detail'))}, {sql_str(row.get('geotech_soil'))}, {sql_str(row.get('machine_type'))}, "
            f"{sql_str(row.get('pipe_material'))}, {sql_str(row.get('pipe_spec'))}, {sql_str(legacy_note)} "
            "WHERE NOT EXISTS ("
            f"SELECT 1 FROM project WHERE legacy_data_id = {sql_str(legacy_id)}"
            ");"
        )
        name_keys = {
            normalize_key(project_name),
            normalize_key(short_name),
            normalize_key(as_text(row.get("project_alias"))),
        }
        for key in name_keys:
            if key:
                project_by_norm_name.setdefault(key, legacy_id)
        stats["projects_prepared"] += 1

    for row in projects:
        register_project(row, synthetic=False)

    synthetic_names: set[str] = set()
    for collection in (operator_logs, manager_logs, breakthrough_reports):
        for row in collection:
            project_name = as_text(row.get("project_name"))
            if not project_name:
                continue
            key = normalize_key(project_name)
            if not key or key in project_by_norm_name:
                continue
            synthetic_names.add(project_name)

    for project_name in sorted(synthetic_names):
        register_project(
            {
                "project_name": project_name,
                "project_short_name": project_name,
                "project_alias": None,
                "province": None,
                "city": None,
                "district": None,
                "address_detail": None,
                "geotech_soil": None,
                "machine_type": None,
                "pipe_material": None,
                "pipe_spec": None,
                "legacy_note": "auto-created from legacy logs mapping",
            },
            synthetic=True,
        )

    section_map: dict[tuple[str, str], str] = {}
    section_seen: set[str] = set()
    for row in sections:
        project_name = as_text(row.get("project_name"))
        section_code = as_text(row.get("section_code"))
        section_name = as_text(row.get("section_name"))
        project_legacy_id = project_by_norm_name.get(normalize_key(project_name))
        if not project_legacy_id:
            continue

        legacy_ref = section_code or section_name
        if not legacy_ref:
            continue

        dedupe = f"{project_legacy_id}|{normalize_key(legacy_ref)}"
        if dedupe in section_seen:
            continue
        section_seen.add(dedupe)

        section_id = make_legacy_id("section", project_name, legacy_ref)
        section_code_final = section_code or legacy_ref
        section_name_final = section_name or section_code or legacy_ref
        created_at = now_iso()

        project_id_subquery = (
            f"(SELECT id FROM project WHERE legacy_data_id = {sql_str(project_legacy_id)} LIMIT 1)"
        )

        sql_lines.append(
            "INSERT INTO project_section ("
            "project_id, section_code, section_name, section_length, status, created_at, updated_at, "
            "legacy_section_ref, design_slope, pipe_diameter_mm"
            ") "
            "SELECT "
            f"{project_id_subquery}, {sql_str(section_code_final)}, {sql_str(section_name_final)}, "
            f"{sql_num(row.get('section_length'))}, 'active', {sql_str(created_at)}, {sql_str(created_at)}, "
            f"{sql_str(legacy_ref)}, {sql_num(row.get('design_slope'))}, {sql_num(row.get('pipe_diameter_mm'))} "
            "WHERE "
            f"{project_id_subquery} IS NOT NULL "
            "AND NOT EXISTS ("
            "SELECT 1 FROM project_section "
            f"WHERE project_id = {project_id_subquery} AND legacy_section_ref = {sql_str(legacy_ref)}"
            ");"
        )

        section_map[(project_legacy_id, normalize_key(legacy_ref))] = legacy_ref
        section_map[(project_legacy_id, normalize_key(section_code_final))] = legacy_ref
        section_map[(project_legacy_id, normalize_key(section_name_final))] = legacy_ref
        stats["sections_prepared"] += 1

    for idx, row in enumerate(operator_logs, start=1):
        project_name = as_text(row.get("project_name"))
        project_legacy_id = project_by_norm_name.get(normalize_key(project_name))
        if not project_legacy_id:
            unmatched["operator_logs"].append({"index": idx, "reason": "project_not_matched", "row": row})
            stats["operator_unmatched"] += 1
            continue

        section_text = as_text(row.get("section_text"))
        section_ref = section_map.get((project_legacy_id, normalize_key(section_text))) if section_text else None

        legacy_data_id = make_legacy_id(
            "operator_log",
            project_name,
            section_text,
            as_text(row.get("log_date")),
            as_text(row.get("shift")),
            str(idx),
        )

        created_at = as_text(row.get("submitted_at")) or now_iso()
        shift = as_text(row.get("shift")) or "day"
        log_date = as_text(row.get("log_date")) or created_at[:10]
        operator_userid = as_text(row.get("operator_name")) or "legacy_import"

        project_id_subquery = (
            f"(SELECT id FROM project WHERE legacy_data_id = {sql_str(project_legacy_id)} LIMIT 1)"
        )
        section_id_subquery = (
            "NULL"
            if not section_ref
            else (
                "(SELECT s.id FROM project_section s "
                "JOIN project p ON p.id = s.project_id "
                f"WHERE p.legacy_data_id = {sql_str(project_legacy_id)} "
                f"AND s.legacy_section_ref = {sql_str(section_ref)} LIMIT 1)"
            )
        )

        sql_lines.append(
            "INSERT INTO operator_log ("
            "project_id, section_id, log_date, shift, weather, completed_pipe_count, cumulative_pipe_count, "
            "footage_m, issue_summary, remark, operator_userid, status, created_at, updated_at, "
            "legacy_data_id, section_text, operator_name, shift_cn, main_thrust_mpa, jacking_count, "
            "chamber_pressure_mpa, cutter_current_a, screw_current_a, soil_type, deviation_direction, "
            "deviation_value_mm, photo_keys_raw, submitted_by_name, submitted_at"
            ") "
            "SELECT "
            f"{project_id_subquery}, {section_id_subquery}, {sql_str(log_date)}, {sql_str(shift)}, NULL, "
            f"{as_int(row.get('completed_pipe_count'))}, {as_int(row.get('cumulative_pipe_count'))}, {sql_num(row.get('footage_m'))}, "
            f"{sql_str(row.get('section_text'))}, {sql_str(row.get('remark'))}, {sql_str(operator_userid)}, 'submitted', "
            f"{sql_str(created_at)}, {sql_str(created_at)}, {sql_str(legacy_data_id)}, {sql_str(row.get('section_text'))}, "
            f"{sql_str(row.get('operator_name'))}, {sql_str(row.get('shift_cn'))}, {sql_num(row.get('main_thrust_mpa'))}, "
            f"{as_int(row.get('completed_pipe_count'))}, {sql_num(row.get('chamber_pressure_mpa'))}, {sql_num(row.get('cutter_current_a'))}, "
            f"{sql_num(row.get('screw_current_a'))}, {sql_str(row.get('soil_type'))}, {sql_str(row.get('deviation_direction'))}, "
            f"{sql_num(row.get('deviation_value_mm'))}, {sql_str(row.get('photo_keys_raw'))}, {sql_str(row.get('operator_name'))}, {sql_str(row.get('submitted_at'))} "
            "WHERE "
            f"{project_id_subquery} IS NOT NULL "
            "AND NOT EXISTS ("
            f"SELECT 1 FROM operator_log WHERE legacy_data_id = {sql_str(legacy_data_id)}"
            ");"
        )
        stats["operator_prepared"] += 1

    for idx, row in enumerate(manager_logs, start=1):
        project_name = as_text(row.get("project_name"))
        project_legacy_id = project_by_norm_name.get(normalize_key(project_name))
        if not project_legacy_id:
            unmatched["manager_logs"].append({"index": idx, "reason": "project_not_matched", "row": row})
            stats["manager_unmatched"] += 1
            continue

        legacy_data_id = make_legacy_id(
            "manager_log",
            project_name,
            as_text(row.get("log_date")),
            as_text(row.get("submitter_name")),
            str(idx),
        )
        created_at = as_text(row.get("submitted_at")) or now_iso()
        log_date = as_text(row.get("log_date")) or created_at[:10]
        manager_userid = as_text(row.get("submitter_name")) or "legacy_import"

        project_id_subquery = (
            f"(SELECT id FROM project WHERE legacy_data_id = {sql_str(project_legacy_id)} LIMIT 1)"
        )

        sql_lines.append(
            "INSERT INTO manager_log ("
            "project_id, log_date, title, detail_html, risk_note, manager_userid, status, created_at, updated_at, "
            "legacy_data_id, submitter_name, tomorrow_plan, submitted_at"
            ") "
            "SELECT "
            f"{project_id_subquery}, {sql_str(log_date)}, NULL, {sql_str(row.get('detail_html'))}, NULL, "
            f"{sql_str(manager_userid)}, 'submitted', {sql_str(created_at)}, {sql_str(created_at)}, "
            f"{sql_str(legacy_data_id)}, {sql_str(row.get('submitter_name'))}, {sql_str(row.get('tomorrow_plan'))}, {sql_str(row.get('submitted_at'))} "
            "WHERE "
            f"{project_id_subquery} IS NOT NULL "
            "AND NOT EXISTS ("
            f"SELECT 1 FROM manager_log WHERE legacy_data_id = {sql_str(legacy_data_id)}"
            ");"
        )
        stats["manager_prepared"] += 1

    for idx, row in enumerate(breakthrough_reports, start=1):
        project_name = as_text(row.get("project_name"))
        project_legacy_id = project_by_norm_name.get(normalize_key(project_name))
        if not project_legacy_id:
            unmatched["breakthrough_reports"].append(
                {"index": idx, "reason": "project_not_matched", "row": row}
            )
            stats["breakthrough_unmatched"] += 1
            continue

        section_text = as_text(row.get("section_text"))
        section_ref = section_map.get((project_legacy_id, normalize_key(section_text))) if section_text else None

        legacy_data_id = make_legacy_id(
            "breakthrough_report",
            project_name,
            section_text,
            as_text(row.get("report_date")),
            str(idx),
        )
        report_no = f"GT-LEG-{hashlib.sha1(legacy_data_id.encode('utf-8')).hexdigest()[:10].upper()}"
        created_at = as_text(row.get("submitted_at")) or now_iso()
        report_date = as_text(row.get("report_date")) or created_at[:10]

        project_id_subquery = (
            f"(SELECT id FROM project WHERE legacy_data_id = {sql_str(project_legacy_id)} LIMIT 1)"
        )
        section_id_subquery = (
            "NULL"
            if not section_ref
            else (
                "(SELECT s.id FROM project_section s "
                "JOIN project p ON p.id = s.project_id "
                f"WHERE p.legacy_data_id = {sql_str(project_legacy_id)} "
                f"AND s.legacy_section_ref = {sql_str(section_ref)} LIMIT 1)"
            )
        )

        sql_lines.append(
            "INSERT INTO breakthrough_report ("
            "report_no, project_id, section_id, report_date, breakthrough_m, summary, detail, reporter_userid, "
            "status, created_at, updated_at, legacy_data_id, section_text, start_date, jacking_days, pipe_diameter, "
            "total_length_m, total_pipe_count, deviation_direction, deviation_value_mm, other_notes, submitted_at"
            ") "
            "SELECT "
            f"{sql_str(report_no)}, {project_id_subquery}, {section_id_subquery}, {sql_str(report_date)}, "
            f"{sql_num(row.get('total_length_m'))}, {sql_str(row.get('other_notes'))}, {sql_str(row.get('other_notes'))}, "
            "'legacy_import', 'submitted', "
            f"{sql_str(created_at)}, {sql_str(created_at)}, {sql_str(legacy_data_id)}, {sql_str(row.get('section_text'))}, "
            f"{sql_str(row.get('start_date'))}, {as_int(row.get('jacking_days'))}, {sql_str(row.get('pipe_diameter'))}, "
            f"{sql_num(row.get('total_length_m'))}, {as_int(row.get('total_pipe_count'))}, {sql_str(row.get('deviation_direction'))}, "
            f"{sql_num(row.get('deviation_value_mm'))}, {sql_str(row.get('other_notes'))}, {sql_str(row.get('submitted_at'))} "
            "WHERE "
            f"{project_id_subquery} IS NOT NULL "
            "AND NOT EXISTS ("
            f"SELECT 1 FROM breakthrough_report WHERE legacy_data_id = {sql_str(legacy_data_id)}"
            ");"
        )
        stats["breakthrough_prepared"] += 1

    sql_lines.append("COMMIT;")

    summary = {
        "generated_at": now_iso(),
        "stats": stats,
        "unmatched": {
            key: value[:200] for key, value in unmatched.items()
        },
    }
    return sql_lines, summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build SQL import file for legacy data into local D1.")
    parser.add_argument(
        "--input",
        default="/tmp/legacy_import_dry_run.json",
        help="Input dry-run JSON file",
    )
    parser.add_argument(
        "--output-sql",
        default="/tmp/legacy_import_apply.sql",
        help="Generated SQL file path",
    )
    parser.add_argument(
        "--output-summary",
        default="/tmp/legacy_import_apply_summary.json",
        help="Generated summary JSON file path",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    sql_lines, summary = build_import(payload)

    output_sql = Path(args.output_sql)
    output_summary = Path(args.output_summary)
    output_sql.parent.mkdir(parents=True, exist_ok=True)
    output_summary.parent.mkdir(parents=True, exist_ok=True)

    output_sql.write_text("\n".join(sql_lines) + "\n", encoding="utf-8")
    output_summary.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"sql: {output_sql}")
    print(f"summary: {output_summary}")
    print(json.dumps(summary["stats"], ensure_ascii=False))


if __name__ == "__main__":
    main()
