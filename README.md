# ResearchForge — local setup (Windows 11, PowerShell)

AI research copilot for neuroimaging and computational neuroscience.
Next.js 16 · React 19 · FastAPI · PostgreSQL 16 · SQLAlchemy · Alembic.

**Status:** Phase 1 (project CRUD) ✅ · Phase 2 (visual redesign) ✅ · Phase 2.5 (authentication + free trial) ✅.
Literature, Experiments and the other modules are still placeholders and are labelled as such in the UI.

---

## 1. Database (PostgreSQL via Docker)
Start **Docker Desktop**, wait until it says "running", then:
```powershell
cd D:\ResearchForge
docker compose up -d
docker compose ps          # postgres should be "healthy"
```
No Docker? Install PostgreSQL 16 and create role/db `researchforge` (password `researchforge`).

## 2. Backend (FastAPI) — http://localhost:8000 , docs at /docs
```powershell
cd D:\ResearchForge\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt          # now includes argon2-cffi, PyJWT, email-validator
Copy-Item .env.example .env              # skip if you already have a .env
```
**Add a `SECRET_KEY` to `backend\.env`** (required — the API refuses to start without it):
```powershell
python -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(48))" | Add-Content .env
```
Then migrate and run:
```powershell
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

## 3. Frontend (Next.js) — http://localhost:3000
```powershell
cd D:\ResearchForge\frontend
npm install                               # new dev dependencies: vitest + Testing Library
Copy-Item .env.local.example .env.local   # skip if it exists
npm run dev
```
> **Use `http://localhost:3000` (not `127.0.0.1`)** — the API is on `localhost:8000`, and the auth cookies are
> same-site only when both use the same hostname.

## 4. Tests and quality gates
```powershell
# Backend — real PostgreSQL, a SEPARATE database "researchforge_test" is created automatically
cd D:\ResearchForge\backend ; .\.venv\Scripts\Activate.ps1 ; pytest -q

# Frontend
cd D:\ResearchForge\frontend
npm test            # vitest (73 tests)
npm run typecheck   # tsc --noEmit
npm run lint
npm run build       # production build
```
The backend tests never touch your development database (they use `<dbname>_test`, or `TEST_DATABASE_URL`).

## 5. Your existing projects (important)
Projects created **before** authentication existed are not deleted and are **not visible to every user**.
Migration `0002` assigns them to a disabled system account (`legacy@researchforge.invalid`, cannot log in).
After you register your own account, take them over once:
```powershell
cd D:\ResearchForge\backend
python -m app.scripts.claim_legacy --email you@example.com
```

---

## Environment variables (`backend\.env`)
| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | local docker DB | SQLAlchemy URL |
| `SECRET_KEY` | **required, ≥ 32 chars** | Derives the JWT-signing key and the guest-cookie signing key |
| `CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Allowed browser origins (credentialed CORS, no wildcard) |
| `FRONTEND_URL` | `http://localhost:3000` | Used in verification / reset email links |
| `ENVIRONMENT` | `development` | `production` enforces `COOKIE_SECURE=true` and an `https://` `FRONTEND_URL` |
| `COOKIE_SECURE` / `COOKIE_SAMESITE` | `false` / `lax` | Cookie attributes (set `true` behind HTTPS) |
| `REQUIRE_EMAIL_VERIFICATION` | `false` | `true` = users can't sign in until they verify their email |
| `ACCESS_TOKEN_MINUTES` | `15` | Access-token lifetime |
| `REFRESH_DAYS_REMEMBER` / `REFRESH_HOURS_SESSION` | `30` / `24` | "Remember me" vs browser-session sign-in |
| `GUEST_SESSION_DAYS` | `180` | Guest trial cookie / DB-row lifetime |
| `MAX_PROJECTS_PER_USER` / `PROJECT_CREATES_PER_HOUR` | `200` / `30` | Service limits for members |
| `RATE_LIMIT_ENABLED` | `true` | In-memory rate limiting |
| `TRUST_PROXY_HEADERS` | `false` | Only behind a reverse proxy you control |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | empty | Real email delivery |
| `ARGON2_TIME_COST` / `ARGON2_MEMORY_KIB` / `ARGON2_PARALLELISM` | `3` / `65536` / `4` | Argon2id cost |

Frontend (`frontend\.env.local`): `NEXT_PUBLIC_API_URL` only. **No secrets ever go in the frontend.**

### Email in development
With `SMTP_HOST` empty, **no email leaves your machine**: the verification / password-reset link is printed in the
uvicorn console (`[console mailer] To: …`). Copy the link into the browser. Set `SMTP_*` for real delivery.

---

## API endpoints
| Method & path | Auth | Purpose |
|---|---|---|
| `GET /api/health` | – | API + DB status |
| `GET /api/auth/session` | – | **Source of truth for the UI**: `anonymous` / `guest` (+ trial counters) / `user`. Silently refreshes an expired access token |
| `POST /api/auth/register` | – | Create account (rate-limited), claims the visitor's trial project, signs in |
| `POST /api/auth/login` | – | Sign in (`remember_me`), claims trial project |
| `POST /api/auth/logout` | – | Revokes the refresh-token family, clears cookies |
| `POST /api/auth/refresh` | refresh cookie | Rotates the refresh token, issues a new access token |
| `POST /api/auth/verify-email` | – | Consume a single-use verification token |
| `POST /api/auth/resend-verification` | user | New verification link |
| `POST /api/auth/forgot-password` | – | Always `202` (no account enumeration) |
| `POST /api/auth/reset-password` | – | Single-use token → new password; signs out all devices |
| `POST /api/guest/session` | – | Idempotent: issues/returns the signed guest-trial session |
| `POST /api/projects` | user or guest | Create (guest: exactly one, enforced atomically) |
| `GET /api/projects`, `GET /api/projects/{id}` | user or guest | **Own** projects only |
| `PUT /api/projects/{id}`, `DELETE /api/projects/{id}` | user | Edit / delete **own** project |

Errors carry a machine-readable code: `detail: {code, message}` (e.g. `trial_exhausted`, `email_taken`,
`invalid_credentials`, `email_not_verified`, `rate_limited`, `csrf_failed`, `not_authenticated`).

## Frontend routes
`/login` · `/register` · `/forgot-password` · `/reset-password` · `/auth/callback` (email verification) ·
`/workspace` (trial or member) · `/dashboard` (guests and members; anonymous visitors are asked to sign in).

---

## Database changes (migration `0002_auth_and_ownership`)
New tables: `users`, `guest_sessions`, `refresh_sessions`, `auth_tokens`.
`projects` gains `owner_user_id` (FK users, `ON DELETE CASCADE`) and `guest_session_id` (FK guest_sessions,
`ON DELETE RESTRICT`), plus:
- `CHECK (num_nonnulls(owner_user_id, guest_session_id) = 1)` — every project has **exactly one** owner type.
- Partial unique index `ON projects(guest_session_id) WHERE guest_session_id IS NOT NULL` — a database-level
  backstop: a guest session can own at most one project even if application code had a bug.
- `users.email` is unique and constrained to lowercase.
- No plaintext password and no raw token is stored anywhere: `password_hash` is Argon2id; guest / refresh /
  email-verification / password-reset tokens are stored only as SHA-256 hashes.

Existing rows are back-filled to the disabled legacy owner (see §5). `alembic downgrade 0001` keeps all projects
(ownership information is dropped).

---

## Security decisions
- **Passwords:** Argon2id (`argon2-cffi`), per-password salt, tunable cost, transparent re-hash on login. Policy:
  10–128 chars, a letter and a number, not your email, small deny-list. Unknown / disabled accounts burn the same
  CPU as real ones (timing-safe) and return the same message as a wrong password.
- **Sessions:** a 15-minute **JWT access token** (`rf_access`) and an **opaque rotating refresh token**
  (`rf_refresh`, `Path=/api/auth` so it is never sent with ordinary API calls), both **HttpOnly** (JavaScript can't
  read them), `SameSite=Lax`, `Secure` in production. Refresh tokens are single-use: each refresh rotates it, and
  replaying an already-used token outside a 10-second grace window **revokes the whole login family** (stolen-token
  detection). Password reset bumps `auth_version` (kills access tokens immediately) and revokes every refresh session.
  "Remember me" = 30-day refresh cookie; otherwise a browser-session cookie with a 24-hour server-side limit.
  *Known trade-off:* after logout an already-issued access token stays valid for ≤ 15 minutes (stateless JWT).
- **CSRF** (needed because auth is cookie-based): three independent layers — `SameSite=Lax`; an `Origin`/`Referer`
  allow-list check on every state-changing request; and a required custom header `X-Requested-With: ResearchForge`
  (a cross-site page can't send it without passing a CORS preflight that only allowed origins pass).
- **CORS:** explicit origins, `allow_credentials=true`, only the methods/headers the app uses.
- **Authorization:** every project query is filtered by the caller's identity at the SQL level. Other users' ids
  return **404** (never 403), so ids can't be probed. Guests can create (once) and read only; they cannot edit/delete.
- **Rate limiting** (per IP unless noted): login 10/min + 8/5 min per email · register 5/h · forgot-password 5/h
  + 3/h per email · reset 10/h · new guest sessions 10/h · project creation 30/h per user · 200 projects per user.
- **Validation:** Pydantic on every payload; the UI mirrors the rules but the server is the authority.
- **Email verification / reset:** 256-bit random single-use tokens, hashed at rest, expiring (48 h / 30 min);
  re-issuing invalidates older ones; forgot-password never reveals whether an address exists.
- **Secrets:** only in `backend\.env` (git-ignored). The API refuses to start without `SECRET_KEY`; production mode
  refuses insecure cookie settings.

## The free trial — how it works and what it can't do
1. **Try ResearchForge Free** calls `POST /api/guest/session`. The server creates a `guest_sessions` row and sets a
   180-day **HttpOnly cookie** containing a random token **plus an HMAC signature**; the DB stores only the token's
   SHA-256. A forged, tampered, unsigned or unknown cookie is rejected.
2. `POST /api/projects` for a guest runs in **one transaction**: lock the guest row (`SELECT … FOR UPDATE`),
   insert the project, set `trial_used = true`, commit. Validation (422) happens *before* the transaction, and any
   failure rolls back — so **only a successfully saved project consumes the trial**. Eight simultaneous requests
   yield exactly one project (tested). The partial unique index is the last line of defence.
3. The UI shows the **server's** counters (`Guest Trial: 1/1 remaining` → `0/1`). Refreshing, or closing and
   reopening the browser, keeps the state (the cookie is persistent and validated against PostgreSQL).
4. When the trial is used, creation is blocked with an explanation and **Create Free Account / Sign In** buttons.
   The first project is never deleted; on register/login it is **moved into the new account** automatically.

**Limitations (by design — please read):**
- Identity is a **cookie**. A visitor who clears cookies, uses a private window, another browser, or another device
  is a new guest and gets another trial. There is no reliable way to stop that without an account.
  We deliberately do **not** key the trial on IP address (shared by whole universities / households / VPNs, so it
  would block legitimate people and still be trivially bypassed) and do not fingerprint browsers.
- What *is* limited: guest-session creation is rate-limited per IP (10/hour), and every guest project is a single
  small row, so mass farming is slow and cheap to clean up. Registration is the real gate.
- Rate limiting is **in-process memory**: correct for this single-process deployment; with multiple workers each has
  its own counters — move it to Redis before scaling out. It also resets when the API restarts.
- Behind a reverse proxy set `TRUST_PROXY_HEADERS=true` (only if the proxy overwrites `X-Forwarded-For`), otherwise
  every visitor shares the proxy's IP.
- Guest sessions that expire after 180 days of inactivity make the guest project unreachable (it stays in the
  database); registering with the same browser before then claims it.

## OAuth / Google sign-in — not implemented (honest status)
There is **no Google/GitHub button** because no OAuth credentials exist for this project. Email + password is fully
functional. To add Google later:
1. Google Cloud Console → *APIs & Services → Credentials → OAuth client ID (Web)*; authorised redirect URI
   `http://localhost:8000/api/auth/google/callback`.
2. Put `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `backend\.env`.
3. Implement the Authorization-Code + PKCE flow (e.g. Authlib), link accounts **only by a Google-verified email**,
   then issue the same cookies via `app/services/sessions.py::issue_session`.
4. Only then add the button — a button without working credentials would be a fake feature.

---

## Troubleshooting
- `failed to connect to the docker API` → Docker Desktop isn't running.
- API won't start: `Field required … secret_key` → add `SECRET_KEY` to `backend\.env` (step 2).
- Header shows "Backend offline" → uvicorn isn't running, or `NEXT_PUBLIC_API_URL` is wrong (restart `npm run dev`).
- Signed in but immediately logged out / trial never sticks → you opened the site on `127.0.0.1`; use `localhost`.
- `429 Too many attempts` → the in-memory rate limiter; wait, or restart uvicorn in development.
- Verification / reset email never arrives → in development the link is in the **uvicorn console**.
- `Activate.ps1 cannot be loaded` → `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- Port in use → `Get-NetTCPConnection -LocalPort 8000` then `Stop-Process -Id <pid>`.
