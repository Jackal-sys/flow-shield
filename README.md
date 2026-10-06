# FlowShield

Privacy-preserving adaptive task and time management app (thesis project).
Stack: static HTML/CSS/JS + Supabase (Postgres, Auth, RLS) hosted on Vercel.

## Structure
```
index.html          page structure
vercel.json         security headers (CSP, HSTS, ...)
css/style.css       styling
js/config.js        Supabase URL + anon key (the ONLY file you edit to configure)
js/supabase.js      shared client
js/ui.js            DOM helpers (textContent only, no innerHTML)
js/auth.js          sign in/up, mandatory TOTP MFA
js/tasks.js         tasks
js/events.js        calendar events
js/periods.js       protected time (sleep, meals, rest)
js/admin.js         admin account panel
js/main.js          routing and tabs
database/           SQL schema and security tests (run in Supabase SQL editor)
```

## Run locally
`python3 -m http.server 8000` then open http://localhost:8000

## Deploy
Push to GitHub; Vercel redeploys automatically. Add the live URL in
Supabase > Authentication > URL Configuration.

## Security rules
Only public keys in the repo. Never commit the service_role/secret key.
