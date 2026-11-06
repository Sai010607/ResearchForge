# Temporary hosting: Netlify (frontend) + Render (API) + Neon (PostgreSQL)

1. **Neon**: create a free project at neon.tech. Copy the connection string and turn it into
   `postgresql+psycopg://USER:PASSWORD@HOST/DBNAME?sslmode=require` (replace the leading `postgresql://`).
2. **Render**: New > Blueprint > pick this GitHub repo. When asked, paste the Neon URL as `DATABASE_URL`.
   Wait for the deploy; `https://researchforge-api.onrender.com/api/health` should return `{"status":"ok",...}`.
   If Render gives you a different URL, edit it in `netlify.toml` and `frontend/netlify.toml`.
3. **Netlify**: push to `main`. The site rebuilds with `/api/*` proxied to Render.
4. Open https://researchforgess.netlify.app. Free Render sleeps when idle, so the first request can take ~30 s.

Notes: verification/reset emails are printed in the Render logs (no SMTP configured). Rate limits live in
memory and reset when Render restarts. Remove the deploy when you are done sharing.
