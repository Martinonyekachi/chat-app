# Muse private chat

The Express API uses PostgreSQL for accounts, conversations, messages, and
revocable JWT sessions. Login returns a Bearer access token and also sets an
HTTP-only session cookie as a fallback.

## Local setup

1. Create a PostgreSQL database named `muse`.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` to that database and set
   `JWT_SECRET` to a random value of at least 32 characters (for example,
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`).
   Keep `.env` private and out of source control.
3. From this directory, run `npm install` and `npm start`. The API creates or
   migrates the users, sessions, conversations, and messages tables at startup.
4. From `../frontend`, run `npm install` and `npm run dev`. Open the URL printed
   by Vite (normally `http://localhost:5173`).
5. Register two accounts in separate browser sessions, then use **Start a
   conversation** to select the other registered account.

The Vite development server proxies API and Socket.IO traffic to
`http://localhost:3001`. In production, serve both through the same origin or
configure `WEB_ORIGIN` as a comma-separated allowlist of frontend origins.
Never put database credentials or JWT secrets in frontend environment files.
When using separate Render services, open the **Static Site** URL for the chat
UI; the backend Web Service is an API and does not serve the frontend at `/`.

## Render deployment

- On the backend Web Service, set `DATABASE_URL` to the Render PostgreSQL
  connection URL and `JWT_SECRET` to a unique random value of at least 32
  characters. Set `NODE_ENV=production` and `WEB_ORIGIN` to the exact frontend
  origin (for example, `https://your-muse.onrender.com`, without a trailing
  slash). Add any custom frontend domains as comma-separated origins.
- Production database connections force `sslmode=verify-full`. This keeps TLS
  enabled, validates the database certificate and hostname, and avoids the
  weaker `uselibpqcompat` behavior. Use a Render database URL whose TLS
  certificate can be verified; do not switch to `sslmode=require` with
  compatibility mode or disable certificate checks.
- Render supplies `PORT` to the backend automatically. The server trusts one
  proxy hop for client IP resolution and rate limiting.
- On the frontend Static Site, set the build-time variable
  `VITE_API_BASE_URL` to the backend URL ending in `/api` (for example,
  `https://your-api.onrender.com/api`). The current
  `frontend/.env.production` value is used when building locally; configure
  the value in Render as well so a Render build targets the deployed backend.
- Configure the Static Site build command as `npm run build` with
  `frontend` as its root directory and `dist` as its publish directory. Keep
  `DATABASE_URL` and `JWT_SECRET` exclusively on the backend.

Passwords are hashed with bcrypt. API requests and Socket.IO connections
validate the same signed JWT against the active session table. Logging out
revokes the session and disconnects its sockets. Conversation membership is
checked before history access, socket room joins, and message persistence.
Messages are broadcast only after the PostgreSQL transaction commits.
