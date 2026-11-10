# Deployment

## Backend
1. Provision PostgreSQL 14+ and set `DATABASE_URL`.
2. Generate three distinct secrets: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
3. Set `NODE_ENV=production`, `COOKIE_SECURE=true`, a real `OTP_PROVIDER` (`msg91` or `twilio`) with credentials, and `EMAIL_PROVIDER=smtp`. The process refuses to start otherwise.
4. Build and migrate:
   ```bash
   npm ci
   npm run build                 # prisma generate + tsc
   npx prisma migrate deploy
   npm run db:seed               # idempotent, safe on every deploy
   npm start
   ```
5. Create the first Super Admin on the server: `SUPER_ADMIN_PASSWORD=… npm run create-super-admin -- --name … --phone … --email …` (or omit the env var to be prompted).
6. Put the API behind HTTPS and set `TRUST_PROXY` to the number of proxies.
7. With more than one instance, swap the in-memory `express-rate-limit` store for a shared one (e.g. `rate-limit-redis`). OTP limits, lockouts and session revocation already live in PostgreSQL.
8. Optionally schedule a cleanup of expired `OTPVerification` and revoked `RefreshSession` rows (e.g. older than 30 days).

## Web
```bash
npm ci && npm run build && npm start
```
Set `NEXT_PUBLIC_API_URL` (or `API_URL`) at **build and run time**. Serve the web app and API over HTTPS. Because the browser calls `/api/v1` on the web origin, cookies stay first-party and CORS isn't involved in normal use.

## Mobile
Set `EXPO_PUBLIC_API_URL=https://api.your-domain` and build with EAS (`eas build`). Don't ship a cleartext HTTP API URL.
