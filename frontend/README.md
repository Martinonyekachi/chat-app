# Muse frontend

During local development, the browser sends API requests to `/api` and Vite
proxies `/api` and `/socket.io` to the backend configured by
`API_PROXY_TARGET` in `.env`. Production builds use `VITE_API_BASE_URL` to
connect directly to the backend. Frontend environment files contain routing
settings only; database credentials and JWT secrets belong in
`../Backend/.env` and must never be added to frontend variables.

On successful login or registration, the API returns a signed access token.
The frontend keeps it in tab-scoped `sessionStorage`, attaches it as a Bearer
token to API requests, and passes it through the Socket.IO `auth` handshake.
An HTTP-only cookie is also set as a fallback. Signing out clears both
client-side token state and the cookie.

For a deployed frontend, set `VITE_API_BASE_URL` to the backend API URL,
including `/api` (for example, `https://your-backend.example/api`). Set
`WEB_ORIGIN` to the frontend's exact origin so the API and Socket.IO CORS
checks allow it. `NODE_ENV=production` enables secure cross-origin fallback
cookies; Bearer-token auth does not depend on third-party cookie support.

The committed `.env.production` points this app's production build to
`https://chat-app-jyme.onrender.com/api`. Vite embeds this value at build time;
after changing it, redeploy the frontend. The frontend and backend must be
separate Render services:

- Frontend Static Site root: `frontend`; build command: `npm ci && npm run build`;
  publish directory: `dist`.
- Backend Web Service root: `Backend`; build command: `npm ci`; start command:
  `npm start`.

The backend service must allow the frontend's exact HTTPS origin in `WEB_ORIGIN`.
Socket.IO uses the API origin and the same HTTP server as the API; do not point
the socket client at the frontend Static Site hostname.
Open the frontend Static Site URL to use the app. The backend Web Service's
root `/` is not the chat UI; its health check is `/api/health`.

## Run locally

1. Start the API by running `npm start` in `../Backend`.
2. Run `npm install` once, then `npm run dev` in this directory.
3. Open `http://127.0.0.1:5173` and register or log in with a database-backed
   account.
