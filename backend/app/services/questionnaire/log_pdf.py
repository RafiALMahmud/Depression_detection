from __future__ import annotations

import io
from datetime import date, datetime
from typing import Any


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _format_datetime(value: str | None) -> str:
    if not value:
        return "-"
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.strftime("%b %d, %Y %H:%M")
    except ValueError:
        return value


def build_depression_log_pdf(
    *,
    employee_name: str,
    entries: list[dict[str, Any]],
    date_from: date | None,
    date_to: date | None,
) -> bytes:
    try:
        import matplotlib

        matplotlib.use("Agg")
        from matplotlib import pyplot as plt
        from matplotlib.backends.backend_pdf import PdfPages
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("PDF export is not available because matplotlib is not installed on the backend.") from exc

    palette = {
        "navy": "#143250",
        "muted": "#5a6f84",
        "cream": "#f5f3eb",
        "border": "#d4dde6",
        "card": "#ffffff",
    }

    from_label = date_from.isoformat() if date_from else "Start"
    to_label = date_to.isoformat() if date_to else "Now"

    buffer = io.BytesIO()
    with PdfPages(buffer) as pdf:
        # Summary page
        fig = plt.figure(figsize=(11.69, 8.27), facecolor=palette["cream"])
        fig.text(0.05, 0.95, "MindWell Personal Depression Score Log", fontsize=23, fontweight="bold", color=palette["navy"])
        fig.text(0.05, 0.92, f"Employee: {employee_name}", fontsize=11, color=palette["muted"])
        fig.text(0.05, 0.90, f"Date range: {from_label} to {to_label}", fontsize=10, color=palette["muted"])
        fig.text(0.05, 0.88, f"Generated: {datetime.utcnow().strftime('%b %d, %Y %H:%M')} UTC", fontsize=9.5, color=palette["muted"])

        ax = fig.add_axes([0.05, 0.57, 0.90, 0.24])
        ax.set_facecolor(palette["card"])
        for spine in ax.spines.values():
            spine.set_color(palette["border"])
        ax.set_xticks([])
        ax.set_yticks([])

        total_sessions = len(entries)
        avg_composite = (
            sum(_safe_float(entry.get("composite_score")) or 0 for entry in entries) / total_sessions
            if total_sessions
            else 0
        )
        summary_lines = [
            f"Total completed sessions: {total_sessions}",
            f"Average composite score: {avg_composite:.2f}",
            "Each entry includes facial score, questionnaire score, composite score, threshold tier,",
            "and full questionnaire answers captured during that session.",
        ]
        y = 0.78
        for line in summary_lines:
            ax.text(0.04, y, line, fontsize=11, color=palette["navy"])
            y -= 0.18

        table_ax = fig.add_axes([0.05, 0.08, 0.90, 0.42])
        table_ax.axis("off")

        table_rows = []
        for index, entry in enumerate(entries[:20], start=1):
            table_rows.append(
                [
                    str(index),
                    _format_datetime(entry.get("session_datetime")),
                    f"{(_safe_float(entry.get('facial_score')) or 0):.2f}",
                    f"{(_safe_float(entry.get('questionnaire_score')) or 0):.2f}",
                    f"{(_safe_float(entry.get('composite_score')) or 0):.2f}",
                    str(entry.get("threshold_tier") or "-").title(),
                ]
            )

        if table_rows:
            table = table_ax.table(
                cellText=table_rows,
                colLabels=["S/N", "Date & Time", "Facial", "Questionnaire", "Composite", "Tier"],
                colColours=[palette["navy"]] * 6,
                colWidths=[0.06, 0.28, 0.12, 0.16, 0.13, 0.10],
                cellLoc="center",
                loc="upper center",
            )
            table.auto_set_font_size(False)
            table.set_fontsize(9)
            table.scale(1, 1.4)
            for (row, _col), cell in table.get_celld().items():
                if row == 0:
                    cell.set_text_props(color="white", weight="bold")
                else:
                    cell.set_facecolor("white")
                    cell.set_text_props(color=palette["muted"])
                    cell.set_edgecolor(palette["border"])
        else:
            table_ax.text(0.5, 0.5, "No completed sessions found for selected date range.", ha="center", va="center", color=palette["muted"])

        pdf.savefig(fig)
        plt.close(fig)

        # Detail pages with answers
        for index, entry in enumerate(entries, start=1):
            fig = plt.figure(figsize=(11.69, 8.27), facecolor=palette["cream"])
            fig.text(0.05, 0.95, f"Session {index}", fontsize=20, fontweight="bold", color=palette["navy"])
            fig.text(0.05, 0.92, f"Date & time: {_format_datetime(entry.get('session_datetime'))}", fontsize=10.5, color=palette["muted"])
            fig.text(
                0.05,
                0.90,
                "Facial: "
                f"{(_safe_float(entry.get('facial_score')) or 0):.2f}    "
                "Questionnaire: "
                f"{(_safe_float(entry.get('questionnaire_score')) or 0):.2f}    "
                "Composite: "
                f"{(_safe_float(entry.get('composite_score')) or 0):.2f}    "
                f"Tier: {str(entry.get('threshold_tier') or '-').title()}",
                fontsize=10,
                color=palette["muted"],
            )

            answers_ax = fig.add_axes([0.05, 0.08, 0.90, 0.78])
            answers_ax.axis("off")
            answers = entry.get("questions_and_answers") or []

            answer_rows = []
            for answer in answers:
                answer_rows.append(
                    [
                        str(answer.get("sequence_order") or "-"),
                        str(answer.get("question_text") or "-")[:75],
                        str(answer.get("answer_label") or "-")[:45],
                        str(answer.get("score") if answer.get("score") is not None else "-"),
                    ]
                )

            if answer_rows:
                table = answers_ax.table(
                    cellText=answer_rows,
                    colLabels=["Q#", "Question", "Answer", "Score"],
                    colColours=[palette["navy"]] * 4,
                    colWidths=[0.06, 0.52, 0.30, 0.08],
                    cellLoc="left",
                    loc="upper center",
                )
                table.auto_set_font_size(False)
                table.set_fontsize(8.5)
                table.scale(1, 1.28)
                for (row, _col), cell in table.get_celld().items():
                    if row == 0:
                        cell.set_text_props(color="white", weight="bold")
                    else:
                        cell.set_facecolor("white")
                        cell.set_text_props(color=palette["muted"])
                        cell.set_edgecolor(palette["border"])
            else:
                answers_ax.text(0.5, 0.5, "No questionnaire answers recorded for this session.", ha="center", va="center", color=palette["muted"])

            pdf.savefig(fig)
            plt.close(fig)

    buffer.seek(0)
    return buffer.read()
