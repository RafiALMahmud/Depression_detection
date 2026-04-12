from __future__ import annotations

import argparse
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path


IS_WINDOWS = os.name == "nt"
VENV_DIR_CANDIDATES = [".venv", "venv"]


def detect_frontend_dir(root_dir: Path) -> Path:
    nested_frontend = root_dir / "frontend"
    if (nested_frontend / "package.json").exists():
        return nested_frontend
    if (root_dir / "package.json").exists():
        return root_dir
    raise FileNotFoundError("Could not find frontend package.json in project root or ./frontend.")


def resolve_python_executable(root_dir: Path) -> str:
    current = Path(sys.executable).resolve()

    for venv_dir_name in VENV_DIR_CANDIDATES:
        venv_root = (root_dir / venv_dir_name).resolve()
        if venv_root in current.parents:
            return str(current)

    interpreter_rel = "Scripts/python.exe" if IS_WINDOWS else "bin/python"
    existing_candidates: list[Path] = []
    for venv_dir_name in VENV_DIR_CANDIDATES:
        candidate = root_dir / venv_dir_name / interpreter_rel
        if candidate.exists():
            existing_candidates.append(candidate)

    if existing_candidates:
        expected = existing_candidates[0]
        if current != expected.resolve():
            print(
                f"[WARN] You are not running from root .venv. Expected: {expected}\n"
                f"       Current interpreter: {current}\n"
                "       Continuing with detected root venv interpreter.",
                file=sys.stderr,
            )
            return str(expected)
        return str(current)

    raise RuntimeError(
        "Root virtual environment not found (.venv or venv).\n"
        "Create it from project root with:\n"
        "  python -m venv .venv\n"
        "  .\\.venv\\Scripts\\Activate.ps1\n"
        "  pip install -r backend\\requirements.txt"
    )


def check_python_dependencies(python_exe: str, backend_dir: Path) -> None:
    probe = (
        "import fastapi,uvicorn,sqlalchemy,psycopg2;"
        "from passlib.context import CryptContext;"
        "CryptContext(schemes=['bcrypt'], deprecated='auto').hash('mindwell-smoke-test')"
    )
    try:
        result = subprocess.run(
            [python_exe, "-c", probe],
            cwd=backend_dir,
            capture_output=True,
            text=True,
            check=False,
            timeout=20,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            "Dependency check timed out for backend imports.\n"
            "Your Python environment may be corrupted. Recreate root .venv and reinstall requirements.\n"
            f"Timeout command: {exc.cmd}"
        ) from exc
    if result.returncode != 0:
        error_output = (result.stderr.strip() or result.stdout.strip()).lower()
        if "bcrypt" in error_output and ("72 bytes" in error_output or "__about__" in error_output):
            raise RuntimeError(
                "Detected incompatible bcrypt/passlib versions in your virtual environment.\n"
                "Run from project root:\n"
                "  .\\venv\\Scripts\\python.exe -m pip install --upgrade --force-reinstall -r backend\\requirements.txt\n"
                "If you use .venv instead, replace the path accordingly."
            )
        raise RuntimeError(
            "Backend dependencies are missing in root .venv.\n"
            "Run from project root:\n"
            "  pip install -r backend\\requirements.txt\n"
            f"Details: {result.stderr.strip() or result.stdout.strip()}"
        )


def resolve_npm_executable() -> str:
    npm = "npm.cmd" if IS_WINDOWS else "npm"
    if shutil.which(npm):
        return npm
    raise RuntimeError("npm is not available in PATH. Install Node.js (LTS) and try again.")


def check_frontend_dependencies(frontend_dir: Path) -> None:
    if not (frontend_dir / "node_modules").exists():
        raise RuntimeError(
            f"Frontend dependencies are missing in {frontend_dir}.\n"
            "Run:\n"
            f"  cd {frontend_dir}\n"
            "  npm install"
        )


def build_frontend(npm_exe: str, frontend_dir: Path) -> None:
    print("[runner] Building frontend for production-like mode...")
    result = subprocess.run(
        [npm_exe, "run", "build"],
        cwd=frontend_dir,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError("Frontend build failed. Fix build errors and retry.")


def stream_logs(prefix: str, stream, stop_event: threading.Event) -> None:
    try:
        for line in iter(stream.readline, ""):
            if stop_event.is_set():
                break
            text = line.rstrip()
            if text:
                print(f"[{prefix}] {text}")
    finally:
        stream.close()


def start_process(name: str, command: list[str], cwd: Path, env: dict[str, str]) -> tuple[subprocess.Popen, threading.Thread]:
    popen_kwargs: dict[str, object] = {
        "cwd": cwd,
        "env": env,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "bufsize": 1,
        "encoding": "utf-8",
        "errors": "replace",
    }
    if IS_WINDOWS:
        popen_kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP

    process = subprocess.Popen(command, **popen_kwargs)  # noqa: S603
    stop_event = threading.Event()
    thread = threading.Thread(target=stream_logs, args=(name, process.stdout, stop_event), daemon=True)
    thread.start()
    process._log_stop_event = stop_event  # type: ignore[attr-defined]
    return process, thread


def stop_process(name: str, process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return

    try:
        if IS_WINDOWS:
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            process.terminate()
    except Exception:
        process.terminate()

    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
    finally:
        stop_event = getattr(process, "_log_stop_event", None)
        if stop_event is not None:
            stop_event.set()
    print(f"[runner] Stopped {name}.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run MindWell in production-like local mode.")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--skip-build", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root_dir = Path(__file__).resolve().parent
    backend_dir = root_dir / "backend"
    frontend_dir = detect_frontend_dir(root_dir)
    dist_dir = frontend_dir / "dist"

    if not backend_dir.exists():
        print(f"[ERROR] Backend directory not found: {backend_dir}", file=sys.stderr)
        return 1

    try:
        python_exe = resolve_python_executable(root_dir)
        npm_exe = resolve_npm_executable()
        check_python_dependencies(python_exe, backend_dir)
        check_frontend_dependencies(frontend_dir)
        if not args.skip_build:
            build_frontend(npm_exe, frontend_dir)
    except RuntimeError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1

    index_file = dist_dir / "index.html"
    if not index_file.exists():
        print(
            "[ERROR] Frontend build output not found.\n"
            f"Expected: {index_file}\n"
            "Run npm run build and retry.",
            file=sys.stderr,
        )
        return 1

    backend_env = os.environ.copy()
    backend_env["PYTHONUNBUFFERED"] = "1"
    backend_env["SERVE_FRONTEND"] = "true"
    backend_env["FRONTEND_DIST_DIR"] = str(dist_dir)

    backend_command = [
        python_exe,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        args.host,
        "--port",
        str(args.port),
    ]

    print("[runner] Starting MindWell production-like local server...")
    print(f"[runner] App URL: http://localhost:{args.port}")
    print("[runner] Frontend is served by FastAPI from built dist/ assets.")
    print("[runner] Press Ctrl+C to stop.")

    backend_process = None
    backend_thread = None

    try:
        backend_process, backend_thread = start_process("backend", backend_command, backend_dir, backend_env)
        while True:
            code = backend_process.poll()
            if code is not None:
                print(f"[runner] Backend exited with code {code}.")
                return code
            time.sleep(0.4)
    except KeyboardInterrupt:
        print("\n[runner] Shutdown requested. Stopping server...")
        return 0
    finally:
        if backend_process is not None:
            stop_process("backend", backend_process)
        if backend_thread is not None:
            backend_thread.join(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())
