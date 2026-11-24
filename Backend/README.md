# Muse private chat

The Express API uses PostgreSQL for accounts, conversations, and messages.
Authentication uses an HTTP-only JWT cookie, and Socket.IO delivers saved
messages and online status to authenticated users.

## Local setup

1. Create a PostgreSQL database named `muse`.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` to that database and set
   `JWT_SECRET` to a random value of at least 32 characters (for example,
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`).
   Keep `.env` private and out of source control.
3. From this directory, run `npm install` and `npm start`. The API creates or
   migrates the users, conversations, and messages tables at startup.
4. From `../frontend`, run `npm install` and `npm run dev`. Open the URL printed
   by Vite (normally `http://localhost:5173`).
5. Register two accounts in separate browser sessions, then use **Start a
   conversation** to select the other registered account.

The Vite development server proxies API and Socket.IO traffic to
`http://localhost:3001`. In production, serve both through the same origin or
configure `WEB_ORIGIN` as a comma-separated allowlist of frontend origins.
Never put database credentials or JWT secrets in frontend environment files.

Passwords are hashed with bcrypt. Conversation membership is checked before
history access, socket room joins, and message persistence. Messages are
broadcast only after the PostgreSQL transaction commits.
