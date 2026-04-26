import logging
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.db.init_db import initialize_database
from app.db.session import SessionLocal
from app.services.checkin_reminders import run_due_checkin_reminders
from app.services.consultant_service import cleanup_old_messages

# Import models so SQLAlchemy metadata includes all tables for create_all.
from app.models import (  # noqa: F401
    AuditLog,
    Consultant,
    ConsultationThread,
    ConsultationMessage,
    CheckInReminderLog,
    CheckInSession,
    Company,
    CompanyHead,
    ConsultationTeamConfig,
    CounselorConsultationRequest,
    Department,
    DepartmentManager,
    Employee,
    EscalationAlert,
    Invitation,
    PeerSupportReaction,
    PeerSupportReply,
    PeerSupportThread,
    QuestionnaireResponse,
    ScoringConfig,
    SystemAdminProfile,
    User,
)

app = FastAPI(title=settings.app_name, debug=settings.debug)
logger = logging.getLogger(__name__)
_reminder_worker_stop = threading.Event()
_reminder_worker_thread: threading.Thread | None = None

configured_origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
local_dev_origin_regex = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins,
    allow_origin_regex=local_dev_origin_regex if settings.environment != "production" else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

project_root_dir = Path(__file__).resolve().parents[2]
configured_dist_dir = Path(settings.frontend_dist_dir).expanduser()
frontend_dist_dir = configured_dist_dir if configured_dist_dir.is_absolute() else (project_root_dir / configured_dist_dir)
frontend_dist_dir = frontend_dist_dir.resolve()
frontend_index_file = frontend_dist_dir / "index.html"
should_serve_frontend = settings.serve_frontend and frontend_index_file.exists()
frontend_assets_dir = frontend_dist_dir / "assets"

if should_serve_frontend and frontend_assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=frontend_assets_dir), name="frontend-assets")


def _run_reminder_cycle() -> int:
    with SessionLocal() as db:
        sent_count = run_due_checkin_reminders(db)
        db.commit()
        return sent_count


def _reminder_worker_loop() -> None:
    while not _reminder_worker_stop.wait(settings.checkin_reminder_poll_seconds):
        try:
            sent_count = _run_reminder_cycle()
            if sent_count:
                logger.info("MindWell reminder worker sent %s email reminder(s).", sent_count)
        except Exception:  # pragma: no cover - defensive background-task guard
            logger.exception("MindWell reminder worker failed to run reminder cycle.")


@app.on_event("startup")
def on_startup() -> None:
    global _reminder_worker_thread
    with SessionLocal() as db:
        initialize_database(db)
        try:
            deleted = cleanup_old_messages(db)
            if deleted:
                logger.info("MindWell startup: purged %s consultation messages older than 2 weeks.", deleted)
        except Exception:
            logger.exception("MindWell startup: consultation message cleanup failed.")
    if settings.checkin_reminders_enabled:
        try:
            sent_count = _run_reminder_cycle()
            if sent_count:
                logger.info("MindWell startup reminder cycle sent %s email reminder(s).", sent_count)
        except Exception:
            logger.exception("MindWell startup reminder cycle failed.")

        if _reminder_worker_thread is None or not _reminder_worker_thread.is_alive():
            _reminder_worker_stop.clear()
            _reminder_worker_thread = threading.Thread(
                target=_reminder_worker_loop,
                name="mindwell-reminder-worker",
                daemon=True,
            )
            _reminder_worker_thread.start()


@app.on_event("shutdown")
def on_shutdown() -> None:
    global _reminder_worker_thread
    _reminder_worker_stop.set()
    if _reminder_worker_thread and _reminder_worker_thread.is_alive():
        _reminder_worker_thread.join(timeout=2)
    _reminder_worker_thread = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/")
def root():
    if should_serve_frontend:
        return FileResponse(frontend_index_file)
    return {"message": "MindWell API is running"}


app.include_router(api_router, prefix=settings.api_v1_prefix)

if should_serve_frontend:

    @app.get("/{full_path:path}", include_in_schema=False)
    def frontend_spa_fallback(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

        requested_path = (frontend_dist_dir / full_path).resolve()

        try:
            requested_path.relative_to(frontend_dist_dir)
        except ValueError as exc:  # pragma: no cover - path traversal guard
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found") from exc

        if requested_path.is_file():
            return FileResponse(requested_path)

        return FileResponse(frontend_index_file)
