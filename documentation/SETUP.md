# FCF Platform — Setup & Run Guide

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20+ | Backend + Frontend |
| Python | 3.10+ | Compiler service |
| PostgreSQL | 14+ | Database |
| gcc | Any | Code execution (mock mode) |
| Docker | 24+ | Sandbox execution (production) |

---

## 1. Database Setup (PostgreSQL)

After installing PostgreSQL, create the database and user:

```sql
-- Run in psql as postgres user:
CREATE USER fcf_user WITH PASSWORD 'change_me_db_password';
CREATE DATABASE fcf_db OWNER fcf_user;
GRANT ALL PRIVILEGES ON DATABASE fcf_db TO fcf_user;
```

Or use psql shorthand:
```bash
psql -U postgres -c "CREATE USER fcf_user WITH PASSWORD 'change_me';"
psql -U postgres -c "CREATE DATABASE fcf_db OWNER fcf_user;"
```

---

## 2. Backend Setup

```bash
cd backend

# Copy environment file and configure
copy .env.example .env
# Edit .env — set DATABASE_URL, JWT_SECRET, JWT_REFRESH_SECRET

# Install dependencies (already done if you ran npm install)
npm install

# Run database migration
npm run prisma:migrate

# Seed initial admin user + competition structure
npm run prisma:seed

# Start development server
npm run dev
# Backend runs on http://localhost:4000
```

### Backend .env required values:
```env
DATABASE_URL=postgresql://fcf_user:change_me@localhost:5432/fcf_db
JWT_SECRET=<generate 64 char random string>
JWT_REFRESH_SECRET=<generate 64 char random string>
COMPILER_SERVICE_URL=http://localhost:8000
COMPILER_SERVICE_API_KEY=CHANGE_ME_COMPILER_SERVICE_SECRET
FRONTEND_URL=http://localhost:5173
PORT=4000
NODE_ENV=development
```

---

## 3. Compiler Service Setup

```bash
cd compiler-service

# Copy env
copy .env.example .env
# COMPILER_MOCK_MODE=true for dev (uses local gcc, no Docker)

# Install Python deps (venv already created)
.\venv\Scripts\pip install -r requirements.txt

# Start service
.\venv\Scripts\uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# Compiler service runs on http://localhost:8000
```

> **IMPORTANT:** In mock mode, the compiler service executes code on the HOST machine using your local `gcc`.
> This is NOT safe for untrusted code. Use Docker mode in production.

---

## 4. Frontend Setup

```bash
cd frontend

# Install dependencies (already done)
npm install

# Start dev server
npm run dev
# Frontend runs on http://localhost:5173
```

---

## 5. First Run

1. Start backend: `cd backend && npm run dev`
2. Start compiler service: `cd compiler-service && .\venv\Scripts\uvicorn app.main:app --host 0.0.0.0 --port 8000`
3. Start frontend: `cd frontend && npm run dev`
4. Open http://localhost:5173
5. Login as admin: `username=admin, password=admin123`
6. **Change admin password immediately!**

---

## 6. Competition Setup (Admin Steps)

1. Login as admin
2. Go to **Tasks** — configure 5 Dumb Charades questions with correct answers
3. Go to **Participants** — create participant accounts (one per team/person)
4. Share participant credentials with each team
5. When ready: go to **Dashboard**, select activity, click **Start Round**
6. Monitor submissions and flags in real time

---

## 7. Production Deployment (Docker)

```bash
# Create .env file at project root with production values
cp .env.example .env
# Edit .env with production secrets

# Build and start all services
docker compose up --build -d

# Run migrations
docker exec fcf-backend npx prisma migrate deploy

# Seed admin
docker exec fcf-backend npm run prisma:seed

# Build sandbox image (required for production code execution)
docker build -t fcf-sandbox:latest ./compiler-service/sandbox/
```

---

## 8. Security Checklist for Production

- [ ] Change admin password immediately after first login
- [ ] Set strong random values for JWT_SECRET and JWT_REFRESH_SECRET (64+ chars)
- [ ] Set strong DB_PASSWORD
- [ ] Set COMPILER_MOCK_MODE=false in production
- [ ] Build and push `fcf-sandbox:latest` image before competition
- [ ] Run behind HTTPS (use nginx reverse proxy + Let's Encrypt)
- [ ] Ensure server firewall blocks all ports except 80/443
- [ ] Keep competition server offline from internet during event (LAN only)

---

## 9. Architecture Overview

```
Browser (Participant/Admin)
    ↕ HTTP + WebSocket
Frontend (React + Vite)  :5173/80
    ↕ REST API + Socket.IO
Backend (Express + Prisma) :4000
    ↕ SQL
PostgreSQL :5432
    ↕ HTTP + API Key
Compiler Service (FastAPI) :8000
    ↕ Docker socket
Sandbox Container (gcc:alpine)
```

---

## 10. Round 1 — Dumb Charades Flow

1. Admin starts Round 1, selects "Dumb Charades" activity
2. Admin performs physical clue acting in the room
3. Participant watches, writes C program that `printf`s guessed answer in **lowercase**
4. Participant clicks **Submit Answer**
5. Backend sends code to Compiler Service → runs in Docker sandbox
6. Backend compares `stdout.trim().toLowerCase()` with stored `correctAnswer`
7. If match: +10 points, task marked solved
8. No time bonus — score based on total questions solved

---

## Notes

- Participants cannot see correct answers at any time (server-side only)
- Focus loss (tab switch, fullscreen exit) is detected and recorded
- Unlimited attempts per question
- Leaderboard updates in real time via WebSocket
