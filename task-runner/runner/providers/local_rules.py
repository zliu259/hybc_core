from __future__ import annotations

import json
import logging
import os
import time
from io import BytesIO

from .base import AiProvider, ProviderResult

logger = logging.getLogger(__name__)


class LocalRulesProvider(AiProvider):
    provider_key = "local"

    """Rule-based provider for tasks that don't need external AI API calls."""

    def supports(self, task_type: str) -> bool:
        return task_type in [
            "equipment_recommend",
            "consumable_estimation",
            "inventory_alert_analysis",
            "consumption_anomaly",
            "ocr_extract",
            "voice_stt",
            "contract_review",
            "payment_risk_assessment",
            "risk_assessment",
            "reimbursement_check",
            "reimbursement_anomaly",
            "log_smart_fill",
            "log_analysis",
            "log_summary",
            "external_log_audit",
            "file_generate",
            "approval_ai_gate",
        ]

    def execute(
        self,
        task_type: str,
        payload: dict[str, object],
        prompt: dict[str, str] | None = None,
    ) -> ProviderResult:
        start = time.monotonic()

        if task_type == "equipment_recommend":
            output = self._equipment_recommend(payload)
        elif task_type == "consumable_estimation":
            output = self._consumable_estimation(payload)
        elif task_type == "inventory_alert_analysis":
            output = self._inventory_alert_analysis(payload)
        elif task_type == "consumption_anomaly":
            output = self._consumption_anomaly(payload)
        elif task_type == "ocr_extract":
            output = self._ocr_extract(payload)
        elif task_type == "voice_stt":
            output = self._voice_stt(payload)
        elif task_type == "contract_review":
            output = self._contract_review(payload)
        elif task_type in ["payment_risk_assessment", "risk_assessment"]:
            output = self._payment_risk_assessment(payload)
        elif task_type == "reimbursement_check":
            output = self._reimbursement_check(payload)
        elif task_type == "reimbursement_anomaly":
            output = self._reimbursement_anomaly(payload)
        elif task_type == "log_smart_fill":
            output = self._log_smart_fill(payload)
        elif task_type == "log_analysis":
            output = self._log_analysis(payload)
        elif task_type == "log_summary":
            output = self._log_summary(payload)
        elif task_type == "external_log_audit":
            output = self._external_log_audit(payload)
        elif task_type == "file_generate":
            output = self._file_generate(payload)
        elif task_type == "approval_ai_gate":
            output = self._approval_ai_gate(payload)
        else:
            output = json.dumps({"error": f"Unsupported task type: {task_type}"})

        latency = int((time.monotonic() - start) * 1000)
        return ProviderResult(output=output, latency_ms=latency)

    def _equipment_recommend(self, payload: dict[str, object]) -> str:
        """Simple rule-based equipment recommendation."""
        project_type = payload.get("project_type", "general")
        budget_raw = payload.get("budget", 0)
        budget = budget_raw if isinstance(budget_raw, (int, float)) else 0

        recommendations: list[str] = []
        if project_type in ("residential", "commercial"):
            recommendations.append("标准混凝土搅拌站")
            if budget > 500000:
                recommendations.append("塔式起重机")
            else:
                recommendations.append("移动式起重机")
        else:
            recommendations.append("通用施工设备套装")

        return json.dumps(
            {"recommendations": recommendations, "project_type": project_type},
            ensure_ascii=False,
        )

    def _ocr_extract(self, payload: dict[str, object]) -> str:
        """Placeholder for OCR extraction — returns structured format."""
        # In production, this would call an OCR service
        file_url = payload.get("file_url", "")
        return json.dumps(
            {
                "status": "placeholder",
                "message": "OCR extraction not yet implemented",
                "file_url": file_url,
            },
            ensure_ascii=False,
        )

    def _voice_stt(self, payload: dict[str, object]) -> str:
        scene = str(payload.get("scene", "miniapp"))
        hints_raw = payload.get("hints", [])
        hints = hints_raw if isinstance(hints_raw, list) else []
        file_key = str(payload.get("file_key", ""))

        transcript_seed = ""
        if hints:
            first_hint = hints[0]
            transcript_seed = str(first_hint) if first_hint is not None else ""

        if not transcript_seed:
            if scene in ["finance", "payment"]:
                transcript_seed = "我要发起对外付款"
            elif scene in ["warehouse", "log"]:
                transcript_seed = "我要报顶进数据"
            elif scene in ["reimbursement"]:
                transcript_seed = "我要发起报销"
            else:
                transcript_seed = "我要打开审批待办"

        return json.dumps(
            {
                "transcript": transcript_seed,
                "confidence": 0.76,
                "scene": scene,
                "source": "local_rules_mock_stt",
                "file_key": file_key,
            },
            ensure_ascii=False,
        )

    def _consumable_estimation(self, payload: dict[str, object]) -> str:
        items_raw = payload.get("items", [])
        items = items_raw if isinstance(items_raw, list) else []
        estimated: list[dict[str, object]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            planned_qty = float(item.get("planned_qty", 0))
            estimated.append(
                {
                    "asset_type_id": item.get("asset_type_id"),
                    "estimated_consumable_qty": round(planned_qty * 0.15, 2),
                }
            )
        return json.dumps(
            {
                "summary": "本地模拟耗材估算结果。",
                "estimated_items": estimated,
            },
            ensure_ascii=False,
        )

    def _inventory_alert_analysis(self, payload: dict[str, object]) -> str:
        quantity = float(payload.get("quantity", 0))
        min_stock = float(payload.get("min_stock", 0) or 0)
        gap = min_stock - quantity
        level = "low"
        if gap > 0 and min_stock > 0:
            ratio = gap / min_stock
            if ratio >= 0.5:
                level = "high"
            elif ratio >= 0.2:
                level = "medium"

        return json.dumps(
            {
                "alert_level": level,
                "gap": gap,
                "summary": "本地模拟库存预警分析结果。",
                "recommendation": "建议尽快补货" if gap > 0 else "库存充足",
            },
            ensure_ascii=False,
        )

    def _consumption_anomaly(self, payload: dict[str, object]) -> str:
        quantity = float(payload.get("quantity", 0))
        risk = "low"
        if quantity >= 100:
            risk = "high"
        elif quantity >= 30:
            risk = "medium"
        return json.dumps(
            {
                "risk_level": risk,
                "summary": "本地模拟耗材消耗异常检测。",
                "recommendation": (
                    "建议复核当日领用记录" if risk != "low" else "消耗量在常规范围"
                ),
            },
            ensure_ascii=False,
        )

    def _contract_review(self, payload: dict[str, object]) -> str:
        amount_raw = payload.get("total_amount", 0)
        amount = float(amount_raw) if isinstance(amount_raw, (int, float, str)) else 0.0
        risk = "low"
        score = 18
        if amount >= 5_000_000:
            risk = "high"
            score = 76
        elif amount >= 1_000_000:
            risk = "medium"
            score = 48

        return json.dumps(
            {
                "overall_risk": risk,
                "score": score,
                "summary": "本地模拟审查结果（非真实AI调用）。",
                "clause_analysis": [
                    {
                        "clause": "付款条件",
                        "risk_level": risk,
                        "issue": "建议核对付款节点与验收条件是否一一对应。",
                        "suggestion": "补充里程碑验收资料要求。",
                    }
                ],
                "amount_assessment": {
                    "reasonableness": "medium",
                    "basis": "基于合同总额分段规则的本地模拟判断。",
                    "risk_points": ["金额分段触发模拟预警"],
                },
                "recommendations": [
                    "补充违约责任条款",
                    "确认税率与发票类型一致",
                    "在提交审批前完成法务复核",
                ],
            },
            ensure_ascii=False,
        )

    def _payment_risk_assessment(self, payload: dict[str, object]) -> str:
        amount_raw = payload.get("amount", 0)
        amount = float(amount_raw) if isinstance(amount_raw, (int, float, str)) else 0.0
        risk = "low"
        score = 16
        if amount >= 500_000:
            risk = "high"
            score = 81
        elif amount >= 100_000:
            risk = "medium"
            score = 52

        return json.dumps(
            {
                "overall_risk": risk,
                "score": score,
                "summary": "本地模拟风控结果（非真实AI调用）。",
                "recommendations": [
                    "复核合同剩余额度",
                    "校验收款账户与历史记录一致性",
                    "必要时增加经理复核节点",
                ],
                "checks": {
                    "amount_band": amount,
                    "frequency_check": "simulated",
                    "duplicate_check": "simulated",
                },
            },
            ensure_ascii=False,
        )

    def _reimbursement_check(self, payload: dict[str, object]) -> str:
        items_raw = payload.get("items", [])
        duplicates_raw = payload.get("duplicate_checks", [])
        items = items_raw if isinstance(items_raw, list) else []
        duplicates = duplicates_raw if isinstance(duplicates_raw, list) else []

        total_amount_raw = payload.get("total_amount", 0)
        total_amount = (
            float(total_amount_raw)
            if isinstance(total_amount_raw, (int, float, str))
            else 0.0
        )

        high_risk = 0
        medium_risk = 0
        for row in duplicates:
            if not isinstance(row, dict):
                continue
            risk = row.get("risk_level")
            if risk == "high":
                high_risk += 1
            elif risk == "medium":
                medium_risk += 1

        risk_level = "low"
        if high_risk > 0:
            risk_level = "high"
        elif medium_risk > 0 or total_amount >= 10000:
            risk_level = "medium"

        recommendations: list[str] = []
        if high_risk > 0:
            recommendations.append("存在高风险重复票据，建议退回补充说明")
        if total_amount >= 50000:
            recommendations.append("批次金额较大，建议增加经理复核")
        if not recommendations:
            recommendations.append("可进入集中审批")

        return json.dumps(
            {
                "overall_risk": risk_level,
                "summary": "本地模拟报销审计报告。",
                "stats": {
                    "item_count": len(items),
                    "duplicate_total": len(duplicates),
                    "high_risk_duplicates": high_risk,
                    "medium_risk_duplicates": medium_risk,
                },
                "compliance": {
                    "required_fields_complete": True,
                    "amount_reasonable": total_amount >= 0,
                },
                "recommendations": recommendations,
            },
            ensure_ascii=False,
        )

    def _reimbursement_anomaly(self, payload: dict[str, object]) -> str:
        amount_raw = payload.get("amount", 0)
        amount = float(amount_raw) if isinstance(amount_raw, (int, float, str)) else 0.0
        duplicate_count_raw = payload.get("duplicate_count", 0)
        duplicate_count = (
            int(duplicate_count_raw)
            if isinstance(duplicate_count_raw, (int, float, str))
            else 0
        )

        risk_level = "low"
        if duplicate_count > 0:
            risk_level = "high"
        elif amount >= 2000:
            risk_level = "medium"

        anomalies: list[dict[str, object]] = []
        if duplicate_count > 0:
            anomalies.append(
                {
                    "type": "duplicate_invoice",
                    "level": "high",
                    "message": f"发现 {duplicate_count} 条重复票据线索",
                }
            )
        if amount >= 5000:
            anomalies.append(
                {
                    "type": "amount_threshold",
                    "level": "medium",
                    "message": "金额超过本地预警阈值（5000）",
                }
            )

        return json.dumps(
            {
                "risk_level": risk_level,
                "summary": "本地模拟报销异常检测结果。",
                "anomalies": anomalies,
                "recommendation": (
                    "建议补充材料并复核"
                    if risk_level != "low"
                    else "可进入预审"
                ),
            },
            ensure_ascii=False,
        )

    def _log_analysis(self, payload: dict[str, object]) -> str:
        return json.dumps(
            {
                "quality_score": 82,
                "warnings": ["施工参数缺少完整上下文，建议补充"],
                "summary": "本地模拟日志分析结果。",
                "input": payload,
            },
            ensure_ascii=False,
        )

    def _log_smart_fill(self, payload: dict[str, object]) -> str:
        previous_raw = payload.get("previous_log")
        previous = previous_raw if isinstance(previous_raw, dict) else {}
        completed_raw = payload.get("completed_pipe_count", 0)
        completed = (
            float(completed_raw)
            if isinstance(completed_raw, (int, float, str))
            else 0.0
        )
        previous_cumulative_raw = previous.get("cumulative_pipe_count", 0)
        previous_cumulative = (
            float(previous_cumulative_raw)
            if isinstance(previous_cumulative_raw, (int, float, str))
            else 0.0
        )
        cumulative = previous_cumulative + completed
        return json.dumps(
            {
                "prefill": {
                    "weather": previous.get("weather") or "晴",
                    "issue_summary": previous.get("issue_summary")
                    or "延续上一班次关注事项",
                    "cumulative_pipe_count": round(cumulative, 2),
                },
                "summary": "已按上一班次自动预填并计算累计下管数量。",
            },
            ensure_ascii=False,
        )

    def _log_summary(self, payload: dict[str, object]) -> str:
        report_type = str(payload.get("report_type", "daily"))
        date_from = str(payload.get("date_from", ""))
        date_to = str(payload.get("date_to", ""))
        project_id = payload.get("project_id")
        return json.dumps(
            {
                "report_type": report_type,
                "project_id": project_id,
                "date_range": {"from": date_from, "to": date_to},
                "summary": "本地模拟施工日志汇总完成。",
                "highlights": [
                    "本周期日志填报完整性良好",
                    "重点问题已进入跟踪列表",
                    "建议持续关注进度偏差项目",
                ],
                "progress_alert": {
                    "level": "medium",
                    "message": "部分项目今日进度低于近7日均值",
                },
            },
            ensure_ascii=False,
        )

    def _external_log_audit(self, payload: dict[str, object]) -> str:
        def as_float(value: object) -> float:
            if isinstance(value, (int, float)):
                return float(value)
            if isinstance(value, str):
                try:
                    return float(value)
                except ValueError:
                    return 0.0
            return 0.0

        operator_raw = payload.get("operator_log")
        operator = operator_raw if isinstance(operator_raw, dict) else {}
        project_log_raw = payload.get("project_log")
        project_log = project_log_raw if isinstance(project_log_raw, dict) else {}
        context_raw = payload.get("context")
        context = context_raw if isinstance(context_raw, dict) else {}
        previous_raw = context.get("previous_operator_logs", [])
        previous = previous_raw if isinstance(previous_raw, list) else []

        issues: list[dict[str, str]] = []
        completed = as_float(operator.get("completed_pipe_count"))
        cumulative = as_float(operator.get("cumulative_pipe_count"))
        if cumulative < completed:
            issues.append(
                {
                    "severity": "high",
                    "message": "累计下管数量小于本班次下管数量，需要人工核对。",
                }
            )

        previous_cumulative = None
        for item in previous:
            if isinstance(item, dict):
                value = item.get("cumulative_pipe_count")
                parsed = as_float(value)
                if parsed > 0:
                    previous_cumulative = parsed
                    break
        if previous_cumulative is not None and cumulative < previous_cumulative:
            issues.append(
                {
                    "severity": "high",
                    "message": "累计下管数量低于最近历史记录，需要人工核对连续性。",
                }
            )

        detail = str(project_log.get("detail_html") or project_log.get("detail") or "")
        remark = str(operator.get("remark") or "")
        issue_summary = str(operator.get("issue_summary") or "")
        if len(detail.strip()) < 8 and len(remark.strip()) < 8 and len(issue_summary.strip()) < 8:
            issues.append(
                {
                    "severity": "medium",
                    "message": "施工日志和项目日志描述过短，无法充分判断现场情况。",
                }
            )

        score = 92 if not issues else 68
        return json.dumps(
            {
                "decision": "auto_approve" if not issues else "needs_manual_review",
                "risk_level": "low" if not issues else "medium",
                "score": score,
                "summary": "本地规则审计完成，未发现明显异常。"
                if not issues
                else "本地规则审计发现需要管理员复核的问题。",
                "issues": issues,
            },
            ensure_ascii=False,
        )

    def _file_generate(self, payload: dict[str, object]) -> str:
        try:
            from reportlab.graphics import renderPDF
            from reportlab.graphics.shapes import Drawing
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.units import mm
            from reportlab.pdfgen import canvas
            from reportlab.graphics.barcode.qr import QrCodeWidget

            envelope_uuid = str(payload.get("envelope_uuid", ""))
            envelope_no = str(payload.get("envelope_no", ""))
            project_id = str(payload.get("project_id", ""))
            applicant_userid = str(payload.get("applicant_userid", ""))
            submitted_at = str(payload.get("submitted_at", ""))
            created_at = str(payload.get("created_at", ""))
            received_at = str(payload.get("received_at", ""))

            output_dir = "/tmp/hybc-pdf"
            os.makedirs(output_dir, exist_ok=True)
            file_name = f"envelope-{envelope_no or envelope_uuid or 'unknown'}.pdf"
            local_path = os.path.join(output_dir, file_name)

            width, height = A4
            fold_y = height / 2

            pdf_buffer = BytesIO()
            pdf = canvas.Canvas(pdf_buffer, pagesize=A4)

            pdf.setLineWidth(1)
            pdf.setDash(4, 4)
            pdf.line(12 * mm, fold_y, width - 12 * mm, fold_y)
            pdf.setDash()

            qr = QrCodeWidget(envelope_uuid)
            qr_bounds = qr.getBounds()
            qr_w = qr_bounds[2] - qr_bounds[0]
            qr_h = qr_bounds[3] - qr_bounds[1]
            qr_size = 45 * mm
            drawing = Drawing(
                qr_size,
                qr_size,
                transform=[qr_size / qr_w, 0, 0, qr_size / qr_h, 0, 0],
            )
            drawing.add(qr)
            renderPDF.draw(drawing, pdf, 20 * mm, height - 65 * mm)

            pdf.setFont("Helvetica-Bold", 14)
            pdf.drawString(75 * mm, height - 28 * mm, "报销信封（A4对折）")
            pdf.setFont("Helvetica", 10)
            pdf.drawString(75 * mm, height - 40 * mm, f"明文UUID: {envelope_uuid}")
            pdf.drawString(75 * mm, height - 52 * mm, f"信封编号: {envelope_no}")

            top_y = height - 80 * mm
            line_gap = 12 * mm
            pdf.drawString(20 * mm, top_y, f"所属工程: {project_id}")
            pdf.drawString(20 * mm, top_y - line_gap, f"申报人: {applicant_userid}")
            pdf.drawString(20 * mm, top_y - line_gap * 2, f"填报日期: {created_at[:10] if created_at else ''}")
            pdf.drawString(20 * mm, top_y - line_gap * 3, f"提交日期: {submitted_at[:10] if submitted_at else ''}")
            pdf.drawString(20 * mm, top_y - line_gap * 4, f"签收日期: {received_at[:10] if received_at else ''}")

            bottom_start = fold_y - 20 * mm
            pdf.setFont("Helvetica-Bold", 11)
            pdf.drawString(20 * mm, bottom_start, "票据内袋（对折后置于内侧）")
            pdf.setFont("Helvetica", 10)
            pdf.drawString(20 * mm, bottom_start - 12 * mm, "- 内装票据后沿折线对折")
            pdf.drawString(20 * mm, bottom_start - 24 * mm, "- 线下字段可现场补充")
            pdf.drawString(20 * mm, bottom_start - 36 * mm, "填报日期: ____________________")
            pdf.drawString(20 * mm, bottom_start - 48 * mm, "提交日期: ____________________")
            pdf.drawString(20 * mm, bottom_start - 60 * mm, "签收日期: ____________________")

            pdf.drawString(20 * mm, 20 * mm, f"UUID: {envelope_uuid}")
            pdf.drawString(120 * mm, 20 * mm, f"工程: {project_id}  申报人: {applicant_userid}")

            pdf.save()
            with open(local_path, "wb") as output:
                output.write(pdf_buffer.getvalue())

            return json.dumps(
                {
                    "status": "generated",
                    "file_name": file_name,
                    "file_key": f"local/reimbursement-envelope/{file_name}",
                    "local_path": local_path,
                    "message": "报销信封PDF模板生成完成。",
                },
                ensure_ascii=False,
            )
        except Exception as exc:
            return json.dumps(
                {
                    "status": "failed",
                    "message": f"PDF generation failed: {exc}",
                    "input": payload,
                },
                ensure_ascii=False,
            )


    def _approval_ai_gate(self, payload: dict[str, object]) -> str:
        return json.dumps(
            {
                "output": "本地模拟AI关卡建议通过。",
                "metadata": {
                    "outcome": "approve",
                    "comment": "local-mock ai_gate approve",
                },
                "input": payload,
            },
            ensure_ascii=False,
        )
