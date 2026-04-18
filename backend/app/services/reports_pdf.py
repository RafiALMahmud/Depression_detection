from __future__ import annotations

import io
import textwrap
from datetime import datetime
from typing import Any

from app.models.report import Report

PAGE_WIDTH = 11.69
PAGE_HEIGHT = 8.27

PALETTE = {
    "navy": "#143250",
    "green": "#2f8f5b",
    "cream": "#f5f3eb",
    "muted": "#5a6f84",
    "danger": "#bf3f4a",
    "warning": "#d08d25",
    "info": "#4f7ca3",
    "card_border": "#d4dde6",
    "card_bg": "#ffffff",
}

MAX_PARAGRAPH_LINES = 14
TABLE_ROWS_PER_PAGE = 20


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


def _wrapped_lines(text: str | None, width: int, max_lines: int) -> list[str]:
    cleaned = (text or "").strip()
    if not cleaned:
        return ["Not provided."]
    wrapped = textwrap.wrap(cleaned, width=width, break_long_words=True, break_on_hyphens=False)
    if len(wrapped) <= max_lines:
        return wrapped
    return [*wrapped[: max_lines - 1], f"{wrapped[max_lines - 1]}..."]


def _draw_card(ax: Any, title: str, lines: list[str]) -> None:
    ax.set_facecolor(PALETTE["card_bg"])
    for spine in ax.spines.values():
        spine.set_color(PALETTE["card_border"])
        spine.set_linewidth(1.0)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)

    ax.text(0.04, 0.92, title, fontsize=12.2, fontweight="bold", color=PALETTE["navy"], va="top")
    ax.plot([0.04, 0.96], [0.865, 0.865], color=PALETTE["card_border"], linewidth=1.0)
    y = 0.80
    for line in lines:
        ax.text(0.04, y, line, fontsize=9.6, color=PALETTE["muted"], va="top")
        y -= 0.062
        if y < 0.08:
            break


def _kpi_card(ax: Any, label: str, value: str) -> None:
    ax.set_facecolor(PALETTE["card_bg"])
    for spine in ax.spines.values():
        spine.set_color(PALETTE["card_border"])
        spine.set_linewidth(1.0)
    ax.set_xticks([])
    ax.set_yticks([])
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.text(0.06, 0.72, label, fontsize=10, color=PALETTE["muted"], fontweight="bold")

    cleaned = (value or "-").strip() or "-"
    if len(cleaned) <= 12:
        ax.text(0.06, 0.24, cleaned, fontsize=20, color=PALETTE["navy"], fontweight="bold")
        return

    if len(cleaned) <= 18:
        ax.text(0.06, 0.28, cleaned, fontsize=15.5, color=PALETTE["navy"], fontweight="bold")
        return

    wrapped = textwrap.wrap(cleaned, width=16, break_long_words=True, break_on_hyphens=False)
    if len(wrapped) > 2:
        wrapped = [wrapped[0], f"{wrapped[1][:15]}..."]

    y = 0.44
    for line in wrapped:
        ax.text(0.06, y, line, fontsize=11.2, color=PALETTE["navy"], fontweight="bold", va="top")
        y -= 0.22


def _add_page_header(fig: Any, *, title: str, subtitle: str, meta_line: str) -> None:
    fig.text(0.05, 0.955, title, fontsize=23, fontweight="bold", color=PALETTE["navy"])
    fig.text(0.05, 0.927, subtitle, fontsize=10.8, color=PALETTE["muted"])
    fig.text(0.05, 0.905, meta_line, fontsize=9.5, color=PALETTE["muted"])

    header_rule = fig.add_axes([0.05, 0.892, 0.90, 0.0022])
    header_rule.set_facecolor(PALETTE["card_border"])
    header_rule.set_xticks([])
    header_rule.set_yticks([])
    for spine in header_rule.spines.values():
        spine.set_visible(False)


def _add_page_footer(fig: Any, page_title: str) -> None:
    fig.text(0.05, 0.03, f"MindWell | {page_title}", fontsize=9, color=PALETTE["muted"])


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


def _autopct_for_nonzero(values: list[float]) -> Any:
    total = sum(values)

    def _inner(percent: float) -> str:
        if total <= 0:
            return ""
        absolute = total * percent / 100.0
        if absolute < 1:
            return ""
        if percent < 1:
            return ""
        return f"{percent:.0f}%"

    return _inner


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

    plt.rcParams["font.family"] = "DejaVu Sans"

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

    buffer = io.BytesIO()
    with PdfPages(buffer) as pdf:
        # Page 1: structured executive summary
        fig = plt.figure(figsize=(PAGE_WIDTH, PAGE_HEIGHT), facecolor=PALETTE["cream"])
        _add_page_header(
            fig,
            title="MindWell Department Wellness Report",
            subtitle=f"{company_name} | {department_name} | Version v{report.version}",
            meta_line=f"Submitted: {submitted_at}    Generated: {generated_at}    Status: {report.status.title()}",
        )
        _add_page_footer(fig, "Executive Summary")

        kpi_grid = fig.add_gridspec(
            1,
            5,
            left=0.05,
            right=0.95,
            top=0.84,
            bottom=0.70,
            wspace=0.03,
        )
        kpis = [
            ("Total Employees", str(total_employees)),
            ("Flagged", str(flagged_count)),
            ("Compliant", str(compliant_count)),
            ("Avg Composite", f"{average_composite_score:.2f}"),
            ("Report Author", report.manager.full_name if report.manager else "Unknown"),
        ]
        for idx, (label, value) in enumerate(kpis):
            _kpi_card(fig.add_subplot(kpi_grid[0, idx]), label, value)

        snapshot_lines = [
            f"Company: {company_name}",
            f"Department: {department_name}",
            f"Report version: v{report.version}",
            f"Submitted at: {submitted_at}",
            f"Generated at: {generated_at}",
            f"Status: {report.status.title()}",
            f"Flagged ratio: {flagged_count}/{total_employees}",
            f"Average score: {average_composite_score:.2f}",
        ]

        content_grid = fig.add_gridspec(
            2,
            2,
            left=0.05,
            right=0.95,
            top=0.66,
            bottom=0.08,
            wspace=0.04,
            hspace=0.08,
        )
        _draw_card(
            fig.add_subplot(content_grid[0, 0]),
            "1. Report Snapshot",
            snapshot_lines,
        )
        _draw_card(
            fig.add_subplot(content_grid[0, 1]),
            "2. Assessment Summary",
            _wrapped_lines(report.assessment, width=68, max_lines=MAX_PARAGRAPH_LINES),
        )
        _draw_card(
            fig.add_subplot(content_grid[1, 0]),
            "3. Observed Behavioural Patterns",
            _wrapped_lines(report.behavioral_patterns, width=68, max_lines=MAX_PARAGRAPH_LINES),
        )
        _draw_card(
            fig.add_subplot(content_grid[1, 1]),
            "4. Recommended Interventions",
            _wrapped_lines(report.recommended_interventions, width=68, max_lines=MAX_PARAGRAPH_LINES),
        )

        pdf.savefig(fig)
        plt.close(fig)

        # Page 2: Charts
        fig, axes = plt.subplots(2, 2, figsize=(PAGE_WIDTH, PAGE_HEIGHT), facecolor=PALETTE["cream"])
        _add_page_header(
            fig,
            title="Wellness Distribution and Score Graphs",
            subtitle=f"{company_name} | {department_name}",
            meta_line=f"Report Version: v{report.version}",
        )
        _add_page_footer(fig, "Graphical Insights")

        ax = axes[0, 0]
        composition = [
            ("Flagged", flagged_count, PALETTE["danger"]),
            ("Compliant", compliant_count, PALETTE["green"]),
            ("Other", remainder_count, PALETTE["info"]),
        ]
        non_zero_composition = [entry for entry in composition if entry[1] > 0]

        if not non_zero_composition:
            ax.text(
                0.5,
                0.5,
                "No department composition data available",
                ha="center",
                va="center",
                color=PALETTE["muted"],
            )
            ax.axis("off")
        else:
            composition_labels = [entry[0] for entry in non_zero_composition]
            composition_values = [float(entry[1]) for entry in non_zero_composition]
            composition_colors = [entry[2] for entry in non_zero_composition]

            wedges, _text_labels, auto_texts = ax.pie(
                composition_values,
                labels=None,
                autopct=_autopct_for_nonzero(composition_values),
                colors=composition_colors,
                startangle=90,
                wedgeprops={"edgecolor": "white"},
                pctdistance=0.62,
            )
            ax.set_title("Employee Composition")
            ax.legend(
                wedges,
                [f"{label} ({int(value)})" for label, value in zip(composition_labels, composition_values)],
                loc="lower center",
                bbox_to_anchor=(0.5, -0.13),
                frameon=False,
                ncol=min(3, len(composition_labels)),
                fontsize=9,
            )
            for text in auto_texts:
                text.set_color(PALETTE["navy"])
                text.set_fontsize(10)
                text.set_fontweight("bold")

        ax = axes[0, 1]
        risk_labels = ["Low", "Moderate", "High", "Severe"]
        risk_values = [risk_counts["low"], risk_counts["moderate"], risk_counts["high"], risk_counts["severe"]]
        ax.bar(risk_labels, risk_values, color=[PALETTE["info"], PALETTE["warning"], "#ce6a56", PALETTE["danger"]])
        ax.set_title("Flagged Risk Tier Distribution")
        ax.set_ylabel("Employee Count")
        for idx, value in enumerate(risk_values):
            ax.text(idx, value + 0.05, str(value), ha="center", va="bottom", color=PALETTE["navy"], fontsize=9)

        ax = axes[1, 0]
        score_labels = ["Dept Composite", "Flagged Composite", "Flagged Facial", "Flagged Questionnaire"]
        score_values = [
            average_composite_score,
            _average(flagged_composite),
            _average(flagged_facial),
            _average(flagged_questionnaire),
        ]
        ax.barh(score_labels, score_values, color=[PALETTE["navy"], PALETTE["danger"], PALETTE["green"], PALETTE["info"]])
        ax.set_title("Score Summary")
        ax.set_xlabel("Score")
        ax.tick_params(axis="y", labelsize=10)
        for idx, value in enumerate(score_values):
            ax.text(value + 0.3, idx, f"{value:.2f}", va="center", color=PALETTE["navy"], fontsize=9)

        ax = axes[1, 1]
        top_flagged = sorted(
            [row for row in flagged_rows if _safe_float(row.get("composite_score")) is not None],
            key=lambda row: _safe_float(row.get("composite_score")) or 0.0,
            reverse=True,
        )[:8]
        if not top_flagged:
            ax.text(0.5, 0.5, "No flagged score data available", ha="center", va="center", color=PALETTE["muted"])
            ax.axis("off")
        else:
            names = [str(row.get("anonymized_id", "-")) for row in top_flagged]
            values = [_safe_float(row.get("composite_score")) or 0.0 for row in top_flagged]
            ax.plot(names, values, marker="o", linewidth=2.2, color=PALETTE["navy"])
            ax.fill_between(names, values, color="#86a8c6", alpha=0.25)
            ax.set_ylim(bottom=0)
            ax.set_title("Top Flagged Composite Scores")
            ax.set_ylabel("Composite Score")
            ax.tick_params(axis="x", labelrotation=30)

        for chart in axes.flat:
            chart.set_facecolor(PALETTE["card_bg"])
            for spine in chart.spines.values():
                spine.set_edgecolor(PALETTE["card_border"])
            chart.grid(alpha=0.12, axis="y")

        fig.subplots_adjust(left=0.12, right=0.95, bottom=0.08, top=0.84, wspace=0.24, hspace=0.32)
        pdf.savefig(fig)
        plt.close(fig)

        # Page 3+: Flagged data table with pagination
        table_rows: list[list[str]] = []
        for index, row in enumerate(flagged_rows, start=1):
            table_rows.append(
                [
                    str(index),
                    str(row.get("anonymized_id", "-")),
                    str(row.get("threshold_tier", "-")).title(),
                    f"{(_safe_float(row.get('composite_score')) or 0.0):.2f}",
                    f"{(_safe_float(row.get('facial_score')) or 0.0):.2f}",
                    f"{(_safe_float(row.get('questionnaire_score')) or 0.0):.2f}",
                    str(int(row.get("sessions_count") or 0)),
                ]
            )

        if not table_rows:
            fig = plt.figure(figsize=(PAGE_WIDTH, PAGE_HEIGHT), facecolor=PALETTE["cream"])
            _add_page_header(
                fig,
                title="Flagged Employee Data Snapshot",
                subtitle="Anonymized data captured at submission time",
                meta_line=f"Company: {company_name}    Department: {department_name}",
            )
            _add_page_footer(fig, "Flagged Data")
            ax = fig.add_axes([0.05, 0.10, 0.90, 0.75])
            _draw_card(
                ax,
                "No flagged employee rows",
                ["No High/Severe flagged employee was recorded for this report."],
            )
            pdf.savefig(fig)
            plt.close(fig)
        else:
            total_pages = (len(table_rows) + TABLE_ROWS_PER_PAGE - 1) // TABLE_ROWS_PER_PAGE
            for page_index in range(total_pages):
                fig = plt.figure(figsize=(PAGE_WIDTH, PAGE_HEIGHT), facecolor=PALETTE["cream"])
                _add_page_header(
                    fig,
                    title="Flagged Employee Data Snapshot",
                    subtitle=f"Anonymized data captured at submission time | Page {page_index + 1}/{total_pages}",
                    meta_line=f"Company: {company_name}    Department: {department_name}",
                )
                _add_page_footer(fig, "Flagged Data")

                start = page_index * TABLE_ROWS_PER_PAGE
                end = start + TABLE_ROWS_PER_PAGE
                page_rows = table_rows[start:end]

                ax = fig.add_axes([0.05, 0.10, 0.90, 0.75])
                ax.axis("off")
                table = ax.table(
                    cellText=page_rows,
                    colLabels=["S/N", "Anonymized ID", "Risk Tier", "Composite", "Facial", "Questionnaire", "Sessions"],
                    colColours=[PALETTE["navy"]] * 7,
                    colWidths=[0.06, 0.16, 0.13, 0.14, 0.14, 0.18, 0.10],
                    cellLoc="center",
                    loc="upper center",
                )
                table.auto_set_font_size(False)
                table.set_fontsize(9)
                table.scale(1, 1.38)
                for (row_index, _col), cell in table.get_celld().items():
                    if row_index == 0:
                        cell.set_text_props(color="white", weight="bold")
                    else:
                        cell.set_facecolor(PALETTE["card_bg"])
                        cell.set_text_props(color=PALETTE["muted"])
                        cell.set_edgecolor(PALETTE["card_border"])
                        cell.set_linewidth(0.8)

                pdf.savefig(fig)
                plt.close(fig)

    buffer.seek(0)
    return buffer.read()
