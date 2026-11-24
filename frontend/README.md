# Muse frontend

The browser sends API requests to the same-origin path `/api`. Vite proxies
`/api` and `/socket.io` to the backend configured by `API_PROXY_TARGET` in
`.env`. The frontend environment file contains only local routing settings;
database credentials and JWT secrets belong in `../Backend/.env` and must
never be added to frontend variables.

## Run locally

1. Start the API by running `npm start` in `../Backend`.
2. Run `npm install` once, then `npm run dev` in this directory.
3. Open `http://127.0.0.1:5173` and register or log in with a database-backed
   account.
