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
    current = Path(sys.executable)
    current_resolved = current.resolve()
    current_prefix = Path(sys.prefix).resolve()

    for venv_dir_name in VENV_DIR_CANDIDATES:
        venv_root = (root_dir / venv_dir_name).resolve()
        if venv_root in current.parents or venv_root in current_resolved.parents or venv_root == current_prefix:
            return str(current)

    interpreter_rel = "Scripts/python.exe" if IS_WINDOWS else "bin/python"
    existing_candidates: list[Path] = []
    for venv_dir_name in VENV_DIR_CANDIDATES:
        candidate = root_dir / venv_dir_name / interpreter_rel
        if candidate.exists():
            existing_candidates.append(candidate)

    if existing_candidates:
        expected = existing_candidates[0]
        expected_resolved = expected.resolve()
        if current_resolved != expected_resolved:
            print(
                f"[WARN] You are not running from root .venv. Expected: {expected}\n"
                f"       Current interpreter: {current_resolved}\n"
                "       Continuing with detected root venv interpreter.",
                file=sys.stderr,
            )
            return str(expected)
        return str(expected)

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
    parser = argparse.ArgumentParser(description="Run MindWell frontend + backend in development mode.")
    parser.add_argument("--backend-host", default="0.0.0.0")
    parser.add_argument("--backend-port", type=int, default=8010)
    parser.add_argument("--frontend-host", default="localhost")
    parser.add_argument("--frontend-port", type=int, default=5173)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root_dir = Path(__file__).resolve().parent
    backend_dir = root_dir / "backend"
    frontend_dir = detect_frontend_dir(root_dir)

    if not backend_dir.exists():
        print(f"[ERROR] Backend directory not found: {backend_dir}", file=sys.stderr)
        return 1

    try:
        python_exe = resolve_python_executable(root_dir)
        npm_exe = resolve_npm_executable()
        check_python_dependencies(python_exe, backend_dir)
        check_frontend_dependencies(frontend_dir)
    except RuntimeError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1

    backend_env = os.environ.copy()
    backend_env["PYTHONUNBUFFERED"] = "1"

    frontend_env = os.environ.copy()
    # Use same-origin API path in dev; Vite proxy forwards to backend.
    frontend_env.setdefault("VITE_API_BASE_URL", "/api/v1")
    frontend_env["VITE_DEV_API_TARGET"] = f"http://127.0.0.1:{args.backend_port}"

    backend_command = [
        python_exe,
        "-m",
        "uvicorn",
        "app.main:app",
        "--reload",
        "--host",
        args.backend_host,
        "--port",
        str(args.backend_port),
    ]
    frontend_command = [
        npm_exe,
        "run",
        "dev",
        "--",
        "--host",
        args.frontend_host,
        "--port",
        str(args.frontend_port),
    ]

    print("[runner] Starting MindWell development stack...")
    print(f"[runner] Backend:  http://localhost:{args.backend_port}")
    print(f"[runner] Frontend: http://localhost:{args.frontend_port}")
    print("[runner] Press Ctrl+C once to stop both.")

    backend_process = None
    frontend_process = None
    backend_thread = None
    frontend_thread = None

    try:
        backend_process, backend_thread = start_process("backend", backend_command, backend_dir, backend_env)
        time.sleep(0.6)
        frontend_process, frontend_thread = start_process("frontend", frontend_command, frontend_dir, frontend_env)

        while True:
            backend_code = backend_process.poll()
            frontend_code = frontend_process.poll()

            if backend_code is not None:
                print(f"[runner] Backend exited with code {backend_code}.")
                return backend_code
            if frontend_code is not None:
                print(f"[runner] Frontend exited with code {frontend_code}.")
                return frontend_code

            time.sleep(0.4)
    except KeyboardInterrupt:
        print("\n[runner] Shutdown requested. Stopping services...")
        return 0
    finally:
        if frontend_process is not None:
            stop_process("frontend", frontend_process)
        if backend_process is not None:
            stop_process("backend", backend_process)
        if frontend_thread is not None:
            frontend_thread.join(timeout=2)
        if backend_thread is not None:
            backend_thread.join(timeout=2)


if __name__ == "__main__":
    raise SystemExit(main())
