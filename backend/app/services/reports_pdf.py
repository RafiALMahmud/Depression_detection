from __future__ import annotations

import io
import textwrap
from datetime import datetime
from typing import Any

from app.models.report import Report


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed


def _format_datetime(value: datetime | None) -> str:
    if not value:
        return "-"
    return value.strftime("%b %d, %Y %H:%M")


def _extract_flagged_rows(report: Report) -> list[dict[str, Any]]:
    raw = report.flagged_employees_data
    if not isinstance(raw, list):
        return []
    result: list[dict[str, Any]] = []
    for item in raw:
        if isinstance(item, dict):
            result.append(item)
    return result


def _paragraph(text: str | None, width: int = 110) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        return "Not provided."
    return "\n".join(textwrap.wrap(cleaned, width=width))


def _risk_distribution(flagged_rows: list[dict[str, Any]]) -> dict[str, int]:
    tiers = {"low": 0, "moderate": 0, "high": 0, "severe": 0}
    for row in flagged_rows:
        tier = str(row.get("threshold_tier", "")).strip().lower()
        if tier in tiers:
            tiers[tier] += 1
    return tiers


def _average(values: list[float | None]) -> float:
    filtered = [value for value in values if value is not None]
    if not filtered:
        return 0.0
    return round(sum(filtered) / len(filtered), 2)


def build_department_report_pdf(
    report: Report,
    *,
    company_name: str,
    department_name: str,
) -> bytes:
    try:
        import matplotlib

        matplotlib.use("Agg")
        from matplotlib import pyplot as plt
        from matplotlib.backends.backend_pdf import PdfPages
    except Exception as exc:  # pragma: no cover - defensive guard
        raise RuntimeError(
            "PDF export is not available because matplotlib is not installed on the backend."
        ) from exc

    summary = report.department_summary if isinstance(report.department_summary, dict) else {}
    flagged_rows = _extract_flagged_rows(report)
    submitted_at = _format_datetime(report.submitted_at)
    generated_at = _format_datetime(datetime.utcnow())

    total_employees = int(summary.get("total_employees") or 0)
    flagged_count = int(summary.get("flagged_count") or report.flagged_employee_count or 0)
    compliant_count = int(summary.get("compliant_count") or 0)
    average_composite_score = _safe_float(summary.get("average_composite_score")) or 0.0
    remainder_count = max(total_employees - flagged_count - compliant_count, 0)

    risk_counts = _risk_distribution(flagged_rows)
    flagged_composite = [_safe_float(row.get("composite_score")) for row in flagged_rows]
    flagged_facial = [_safe_float(row.get("facial_score")) for row in flagged_rows]
    flagged_questionnaire = [_safe_float(row.get("questionnaire_score")) for row in flagged_rows]

    palette = {
        "navy": "#143250",
        "green": "#2f8f5b",
        "cream": "#f5f3eb",
        "muted": "#5a6f84",
        "danger": "#bf3f4a",
        "warning": "#d08d25",
        "info": "#4f7ca3",
    }

    buffer = io.BytesIO()
    with PdfPages(buffer) as pdf:
        # Page 1: Executive summary + narrative
        fig = plt.figure(figsize=(11.69, 8.27), facecolor=palette["cream"])
        fig.text(0.06, 0.93, "MindWell Department Wellness Report", fontsize=24, fontweight="bold", color=palette["navy"])
        fig.text(
            0.06,
            0.895,
            f"Company: {company_name}    Department: {department_name}    Version: v{report.version}",
            fontsize=11,
            color=palette["muted"],
        )
        fig.text(
            0.06,
            0.872,
            f"Submitted: {submitted_at}    Generated: {generated_at}    Status: {report.status.title()}",
            fontsize=10,
            color=palette["muted"],
        )

        summary_rows = [
            ["Total Employees", str(total_employees)],
            ["Flagged Employees", str(flagged_count)],
            ["Compliant Employees", str(compliant_count)],
            ["Average Composite Score", f"{average_composite_score:.2f}"],
            ["Report Author", report.manager.full_name if report.manager else "Unknown"],
        ]
        ax_summary = fig.add_axes([0.06, 0.56, 0.44, 0.25])
        ax_summary.axis("off")
        table = ax_summary.table(
            cellText=summary_rows,
            colLabels=["Metric", "Value"],
            loc="center",
            cellLoc="left",
            colColours=[palette["navy"], palette["navy"]],
        )
        table.auto_set_font_size(False)
        table.set_fontsize(10)
        table.scale(1, 1.5)
        for (row, col), cell in table.get_celld().items():
            if row == 0:
                cell.set_text_props(color="white", weight="bold")
            else:
                cell.set_facecolor("white")
                if col == 0:
                    cell.set_text_props(weight="bold", color=palette["navy"])
                else:
                    cell.set_text_props(color=palette["muted"])

        fig.text(0.54, 0.79, "Assessment", fontsize=14, color=palette["navy"], fontweight="bold")
        fig.text(0.54, 0.64, _paragraph(report.assessment), fontsize=10.5, color=palette["muted"], va="top")

        fig.text(0.06, 0.45, "Observed Behavioural Patterns", fontsize=12.5, color=palette["navy"], fontweight="bold")
        fig.text(0.06, 0.33, _paragraph(report.behavioral_patterns, width=140), fontsize=10, color=palette["muted"], va="top")

        fig.text(0.06, 0.23, "Recommended Interventions", fontsize=12.5, color=palette["navy"], fontweight="bold")
        fig.text(0.06, 0.11, _paragraph(report.recommended_interventions, width=140), fontsize=10, color=palette["muted"], va="top")

        pdf.savefig(fig, bbox_inches="tight")
        plt.close(fig)

        # Page 2: Graphs
        fig, axes = plt.subplots(2, 2, figsize=(11.69, 8.27), facecolor=palette["cream"])
        fig.suptitle("Wellness Distribution and Score Graphs", fontsize=20, fontweight="bold", color=palette["navy"], y=0.98)

        ax = axes[0, 0]
        composition_labels = ["Flagged", "Compliant", "Other"]
        composition_values = [flagged_count, compliant_count, remainder_count]
        if sum(composition_values) == 0:
            ax.text(0.5, 0.5, "No department composition data available", ha="center", va="center", color=palette["muted"])
            ax.axis("off")
        else:
            ax.pie(
                composition_values,
                labels=composition_labels,
                autopct="%1.0f%%",
                colors=[palette["danger"], palette["green"], palette["info"]],
                startangle=90,
                wedgeprops={"edgecolor": "white"},
            )
            ax.set_title("Employee Composition")

        ax = axes[0, 1]
        risk_labels = ["Low", "Moderate", "High", "Severe"]
        risk_values = [risk_counts["low"], risk_counts["moderate"], risk_counts["high"], risk_counts["severe"]]
        ax.bar(risk_labels, risk_values, color=[palette["info"], palette["warning"], "#ce6a56", palette["danger"]])
        ax.set_title("Flagged Risk Tier Distribution")
        ax.set_ylabel("Employee Count")
        for idx, value in enumerate(risk_values):
            ax.text(idx, value + 0.05, str(value), ha="center", va="bottom", color=palette["navy"], fontsize=9)

        ax = axes[1, 0]
        score_labels = ["Dept Avg Composite", "Flagged Composite Avg", "Flagged Facial Avg", "Flagged Questionnaire Avg"]
        score_values = [
            average_composite_score,
            _average(flagged_composite),
            _average(flagged_facial),
            _average(flagged_questionnaire),
        ]
        ax.barh(score_labels, score_values, color=[palette["navy"], palette["danger"], palette["green"], palette["info"]])
        ax.set_title("Score Summary")
        ax.set_xlabel("Score")
        for idx, value in enumerate(score_values):
            ax.text(value + 0.3, idx, f"{value:.2f}", va="center", color=palette["navy"], fontsize=9)

        ax = axes[1, 1]
        top_flagged = sorted(
            [row for row in flagged_rows if _safe_float(row.get("composite_score")) is not None],
            key=lambda row: _safe_float(row.get("composite_score")) or 0.0,
            reverse=True,
        )[:8]
        if not top_flagged:
            ax.text(0.5, 0.5, "No flagged score data available", ha="center", va="center", color=palette["muted"])
            ax.axis("off")
        else:
            names = [str(row.get("anonymized_id", "-")) for row in top_flagged]
            values = [_safe_float(row.get("composite_score")) or 0.0 for row in top_flagged]
            ax.plot(names, values, marker="o", linewidth=2.2, color=palette["navy"])
            ax.fill_between(names, values, color="#86a8c6", alpha=0.25)
            ax.set_ylim(bottom=0)
            ax.set_title("Top Flagged Composite Scores")
            ax.set_ylabel("Composite Score")
            ax.tick_params(axis="x", labelrotation=30)

        for chart in axes.flat:
            chart.set_facecolor("white")
            for spine in chart.spines.values():
                spine.set_edgecolor("#d2d9e0")

        fig.tight_layout(rect=[0, 0, 1, 0.95])
        pdf.savefig(fig, bbox_inches="tight")
        plt.close(fig)

        # Page 3: Flagged data table
        fig = plt.figure(figsize=(11.69, 8.27), facecolor=palette["cream"])
        fig.text(0.06, 0.93, "Flagged Employee Data Snapshot", fontsize=21, fontweight="bold", color=palette["navy"])
        fig.text(
            0.06,
            0.902,
            "Anonymized data captured at the time of report submission.",
            fontsize=10.5,
            color=palette["muted"],
        )

        table_rows = []
        for row in flagged_rows[:15]:
            table_rows.append(
                [
                    str(row.get("anonymized_id", "-")),
                    str(row.get("threshold_tier", "-")).title(),
                    f"{(_safe_float(row.get('composite_score')) or 0.0):.2f}",
                    f"{(_safe_float(row.get('facial_score')) or 0.0):.2f}",
                    f"{(_safe_float(row.get('questionnaire_score')) or 0.0):.2f}",
                    str(int(row.get("sessions_count") or 0)),
                ]
            )

        ax = fig.add_axes([0.06, 0.14, 0.88, 0.72])
        ax.axis("off")
        if table_rows:
            table = ax.table(
                cellText=table_rows,
                colLabels=["Anonymized ID", "Risk Tier", "Composite", "Facial", "Questionnaire", "Sessions"],
                colColours=[palette["navy"]] * 6,
                cellLoc="center",
                loc="upper center",
            )
            table.auto_set_font_size(False)
            table.set_fontsize(9)
            table.scale(1, 1.5)
            for (row, _col), cell in table.get_celld().items():
                if row == 0:
                    cell.set_text_props(color="white", weight="bold")
                else:
                    cell.set_facecolor("white")
                    cell.set_text_props(color=palette["muted"])
        else:
            ax.text(0.5, 0.5, "No flagged employees were recorded in this submission.", ha="center", va="center", color=palette["muted"], fontsize=13)

        fig.text(0.06, 0.06, "Generated by MindWell Analytics Engine", fontsize=9.5, color=palette["muted"])
        pdf.savefig(fig, bbox_inches="tight")
        plt.close(fig)

    buffer.seek(0)
    return buffer.read()
