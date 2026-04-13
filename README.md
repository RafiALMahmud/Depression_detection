# MindWell Full-Stack Platform

MindWell is an AI-powered employee wellness platform with:
- React + Vite frontend
- FastAPI + PostgreSQL backend
- JWT auth, invitation onboarding, and role-based dashboards

This repo is configured for a single root-command startup on Windows from `D:\CSE471`.

If your local virtual environment folder is named `venv` instead of `.venv`, use:

```powershell
.\venv\Scripts\Activate.ps1
```

## Root-First Developer Flow

### Expected root structure

```text
D:\CSE471
|- .venv\                    # Single shared Python virtual environment
|- backend\                  # FastAPI app
|- src\                      # Frontend source (Vite app)
|- run_dev.py                # One-command dev runner (backend + frontend)
|- run_prod.py               # One-command production-like local runner
|- start.ps1                 # PowerShell wrapper for run_dev.py
|- start_prod.ps1            # PowerShell wrapper for run_prod.py
`- README.md
```

Note: If you later move frontend files into `frontend\`, the runners auto-detect that layout too.

## One Command (Development)

From root:

```powershell
cd D:\CSE471
.\.venv\Scripts\Activate.ps1
python run_dev.py
```

Alternative equivalent commands:

```powershell
.\start.ps1
```

or

```powershell
npm run dev:full
```

What this starts:
- FastAPI backend with reload on `http://localhost:8000`
- React dev server on `http://localhost:5173`
- Shared logs in one terminal
- Ctrl+C stops both processes

## One Command (Production-like Local)

From root:

```powershell
cd D:\CSE471
.\.venv\Scripts\Activate.ps1
python run_prod.py
```

Alternative:

```powershell
.\start_prod.ps1
```

or

```powershell
npm run prod:full
```

What this does:
- Builds frontend (`npm run build`)
- Starts FastAPI (no reload)
- FastAPI serves built frontend static files
- Unified app URL: `http://localhost:8000`

Optional:

```powershell
python run_prod.py --skip-build
```

## First-Time Setup (Root)

### 1. Create one shared `.venv`

```powershell
cd D:\CSE471
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

### 2. Install backend dependencies into root `.venv`

```powershell
pip install -r backend\requirements.txt
```

### 3. Install frontend dependencies

```powershell
npm install
```

### 4. Configure environment files

Frontend (optional root `.env`):

```env
VITE_API_BASE_URL=http://localhost:8000/api/v1
```

Backend:

```powershell
Copy-Item backend\.env.example backend\.env
```

Then edit `backend\.env` (DB credentials, JWT secrets, SMTP config).

### 5. Prepare database

```powershell
cd D:\CSE471\backend
..\.venv\Scripts\python.exe -m alembic upgrade head
```

### 6. Run everything

```powershell
cd D:\CSE471
.\.venv\Scripts\Activate.ps1
python run_dev.py
```

## Login and Seeded Accounts

When `AUTO_SEED=true`, backend startup syncs demo accounts so documented credentials remain usable.

Super Admin demo credentials:
- `rafi.almahmud.007@gmail.com` / `Rafi0008.@`
- `wardat@gmail.com` / `12345678`
- `yaad@gmail.com` / `12345678`

## Production-Mode Static Serving Support

Backend supports optional frontend static serving with:
- `SERVE_FRONTEND=true`
- `FRONTEND_DIST_DIR=dist`

`run_prod.py` sets these automatically and serves built assets through FastAPI.

## Existing App Features Preserved

The startup refactor keeps current functionality:
- Login and JWT auth
- Invitation signup flow
- Super Admin dashboard
- System Admin dashboard
- API routing and role guards
- Email invitation flow

## Useful Commands

From `D:\CSE471`:

```powershell
npm run dev              # frontend only
npm run dev:clean        # frontend with forced fresh Vite bundle
npm run backend:dev      # backend only (with reload)
npm run dev:full         # full stack via Python runner
npm run dev:full:clean   # full stack after clearing Vite cache
npm run prod:full        # production-like local run
npm run backend:migrate  # run backend migrations
npm run backend:seed     # manual seed
npm run clean:vite-cache # clear Vite HMR/prebundle cache only
```

## If Dashboard Route Looks Blank During Dev

The frontend now includes:
- global React error boundary (prevents full white-screen collapse)
- protected-route bootstrap loader and retryable error fallback
- deterministic auth bootstrap and session-expiry handling
- dashboard section retry states and development-stage logging

If you suspect stale Vite HMR cache, run:

```powershell
npm run dev:full:clean
```

