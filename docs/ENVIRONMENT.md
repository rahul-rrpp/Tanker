# Environment variables

Never commit real values. Each app ships a `.env.example`. The backend validates its environment at startup with Zod and refuses to boot on invalid or unsafe production configuration.

## Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | development | `production` enforces real OTP/email providers and secure cookies |
| `PORT` | 4000 | |
| `LOG_LEVEL` | info | pino level |
| `TRUST_PROXY` | 1 | Number of reverse proxies (needed for correct client IPs and rate limits) |
| `DATABASE_URL` | – | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | – | ≥32 chars. Signs access and verification tokens |
| `JWT_REFRESH_SECRET` | – | ≥32 chars. HMAC key for refresh-token hashes |
| `OTP_HASH_SECRET` | – | ≥32 chars. HMAC key for OTP and invitation-code hashes. All three secrets must differ in production |
| `JWT_ISSUER` / `JWT_AUDIENCE` | ttms-auth / ttms | |
| `ACCESS_TOKEN_EXPIRY` | 15m | Durations accept `s`, `m`, `h` and `d` |
| `REFRESH_TOKEN_EXPIRY` | 30d | Sliding: renewed on each rotation |
| `VERIFICATION_TOKEN_EXPIRY` | 15m | Window between OTP verification and registration submit |
| `OTP_LENGTH` | 6 | |
| `OTP_EXPIRY` | 5m | |
| `OTP_RESEND_COOLDOWN` | 45s | |
| `OTP_MAX_ATTEMPTS` | 5 | |
| `OTP_MAX_SENDS_PER_HOUR` | 5 | Per destination and purpose |
| `OTP_PROVIDER` | mock | `mock` (dev only) \| `msg91` \| `twilio` |
| `SMS_API_KEY` | – | MSG91 authkey / Twilio auth token |
| `SMS_SENDER_ID` | – | MSG91 sender / Twilio From number or Messaging Service SID |
| `SMS_TEMPLATE_ID` | – | MSG91 DLT flow template (variables `otp` and `minutes`) |
| `TWILIO_ACCOUNT_SID` | – | Twilio only |
| `EMAIL_PROVIDER` | mock | `mock` (dev only) \| `smtp` |
| `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | – | SMTP settings |
| `EMAIL_VERIFICATION_REQUIRED` | false | Require an email OTP at signup when an email is given (also set `NEXT_PUBLIC_EMAIL_VERIFICATION_REQUIRED` on web) |
| `MAX_FAILED_LOGINS` | 5 | Failures before lockout |
| `ACCOUNT_LOCK_DURATION` | 15m | |
| `RATE_LIMIT_ENABLED` | true | IP limiters (tests set this to false) |
| `CORS_ORIGINS` | http://localhost:3000 | Comma-separated browser origins |
| `WEB_APP_URL` | http://localhost:3000 | Also accepted by the CSRF Origin check |
| `COOKIE_SECURE` | false | **Must be true in production** |
| `COOKIE_DOMAIN` | – | Optional cookie domain |

## Web (`web/.env.local`)

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend base URL, used by the `/api/v1` rewrite and server-side session checks |
| `API_URL` | Optional internal URL for server-to-server calls (defaults to the above) |
| `NEXT_PUBLIC_EMAIL_VERIFICATION_REQUIRED` | `true` shows the email OTP step in agency signup |

## Mobile (`mobile/.env`)

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend base URL. Android emulator: `http://10.0.2.2:4000`. Must be HTTPS in production |
