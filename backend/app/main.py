from pathlib import Path

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.db.init_db import initialize_database
from app.db.session import SessionLocal

# Import models so SQLAlchemy metadata includes all tables for create_all.
from app.models import (  # noqa: F401
    AuditLog,
    Company,
    CompanyHead,
    Department,
    DepartmentManager,
    Employee,
    Invitation,
    SystemAdminProfile,
    User,
)

app = FastAPI(title=settings.app_name, debug=settings.debug)

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


@app.on_event("startup")
def on_startup() -> None:
    with SessionLocal() as db:
        initialize_database(db)


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
