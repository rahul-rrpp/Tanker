# TankerLink

A B2B marketplace for booking oil tankers. Companies post a load and name their freight price. Verified transporters accept or counter, and the company confirms one. The trip is then tracked live from loading to delivery, through settlement and documents.

One backend serves three front ends: the customer web app (company, transporter, driver and employee portals), a separate admin console, and a mobile app (customers, transporters, drivers).

| Portal | Who | Web | Mobile |
| --- | --- | --- | --- |
| **Company** (customer) | Companies that need oil moved | `/company` | ✓ |
| **Transporter** | Tanker fleet owners and their staff | `/transporter` | ✓ |
| **Driver** | Drivers added by a transporter | `/driver` | ✓ (with background GPS) |
| **Employee** | TankerLink sales, operations, verification, accounts and MIS staff | `/employee` | – |
| **Admin** | Platform administrators | Separate site: [admin-web](admin-web/README.md) on port 3100 | – |

## Repository

```
tanker/
├── backend/   Express 5 + TypeScript + Prisma 6 (PostgreSQL), REST API at /api/v1, Socket.IO realtime at /realtime
├── web/       Next.js 15 (App Router) + Tailwind 4, company / transporter / driver / employee portals
├── admin-web/ Next.js 15 admin console for platform administrators (port 3100)
├── mobile/    Expo SDK 54 + expo-router, company / transporter / driver app
├── docs/      Detailed documentation per portal and topic
└── scripts/   End-to-end and smoke scripts
```

## Requirements

- Node.js 20 or newer, npm 10 or newer
- PostgreSQL 14+ with the `btree_gist` extension, or the bundled embedded PostgreSQL for development (`npm run db:local`)
- For mobile: the Expo Go app, or Android Studio / Xcode for a development build

## Quick start (development)

**1. Backend** (API on http://localhost:4000, Swagger UI at `/api/docs`)

```bash
cd backend
npm install
cp .env.example .env        # fill JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, OTP_HASH_SECRET, FIELD_ENCRYPTION_KEY
                            # generate each with: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npm run db:local            # terminal A: embedded PostgreSQL on :54329 (skip if you have your own database)
npm run db:setup            # terminal B: run migrations + seed roles and permissions
npm run db:seed:demo        # optional demo data: companies, bookings
npm run db:seed:transporter # optional demo data: transporters, fleet, drivers, trips
npm run db:seed:employee    # optional demo data: employees, leads, tasks
npm run dev
```

**2. Web** (http://localhost:3000)

```bash
cd web
npm install
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev
```

**3. Admin console** (http://localhost:3100)

```bash
cd admin-web
npm install
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev
```

The backend must list `http://localhost:3100` in `CORS_ORIGINS` (the example file already does).

**4. Mobile**

```bash
cd mobile
npm install
cp .env.example .env        # EXPO_PUBLIC_API_URL: 10.0.2.2 on the Android emulator, your LAN IP on a phone
npx expo start
```

The driver's background location tracking does not run in Expo Go. Use `npx expo run:android` or an EAS build for that.

To create the first platform administrator:

```bash
cd backend
npm run create-super-admin -- --name "Platform Admin" --phone 9876543210 --email admin@example.com
```

## Demo logins

Development only. Every account uses the password `Demo@12345`.

| Portal | Mobile number | Notes |
| --- | --- | --- |
| Company | 9100000001 | Demo company with bookings |
| Transporter | 9200000001 | Verified. 9200000002 is pending, 9200000003 is suspended |
| Driver | 9200000011 | Signs in with a one-time code |
| Employee | 9300000001 – 9300000007 | Sales manager, sales, operations, verification, accounts, MIS. Sign in at `/login/employee` |

With `OTP_PROVIDER=mock`, one-time codes are printed in the backend console. `OTP_DEV_ECHO=true` also shows them in the app. Both are refused in production.

## Main workflow

1. A **company** creates a booking: pickup, delivery, product, quantity, date and its offered price.
2. Verified **transporters** whose tankers match the booking see it in the marketplace. Each one accepts the price or counters.
3. The company accepts, counters or rejects offers. Accepting one confirms the booking and closes the rest.
4. The **transporter** assigns a tanker and a driver. Double booking a tanker or driver is blocked by the database.
5. The **driver** confirms and moves the trip step by step: pickup, loading, in transit, delivery, unloading. The phone shares live location. The driver uploads proof of delivery and submits.
6. The transporter closes the trip, and the company sees the documents and payment status. **Employees** follow up on leads, onboarding, verification, trips, support and payments throughout.

## Configuration

All variables are documented in [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) and in each `.env.example`. The main ones:

| Variable | Where | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | backend | PostgreSQL connection |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OTP_HASH_SECRET` | backend | Token and OTP signing |
| `FIELD_ENCRYPTION_KEY` | backend | Encrypts bank account numbers (AES-256-GCM). Required in production |
| `ENABLED_PORTALS` | backend | Which portals the API serves: `company,admin,transporter,driver,employee` |
| `OTP_PROVIDER`, `SMS_API_KEY` | backend | `mock` in development, a real SMS provider (with its key) in production |
| `GOOGLE_MAPS_SERVER_KEY` | backend | Place search and routes (falls back to a development provider when empty) |
| `RAZORPAY_*` | backend | Online payments |
| `NEXT_PUBLIC_API_URL` | web | Backend URL |
| `NEXT_PUBLIC_ENABLED_PORTALS` | web | Which portals the web app shows |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | web | Google map in the browser (OpenStreetMap when empty) |
| `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_URL` | mobile | Backend URL and web URL (for registration and payment links) |

## Security model

- Web sessions use httpOnly cookies with CSRF protection. The mobile app uses Bearer tokens, with the refresh token kept in the device's secure store (`X-Client-Type: mobile`).
- Refresh tokens rotate on every use, and reuse of an old token revokes the session.
- Every request is authorized from the database: roles, permissions and account status are re-checked each time.
- Ownership always comes from the signed-in user. The API never trusts a transporter, driver or company id sent by the client.
- Employees get only the permissions their role grants, never Super Admin rights. The audit log is append-only and hash-chained.

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Testing

```bash
cd backend && npm test             # Vitest + an embedded PostgreSQL test database (no setup needed)
cd backend && npm run typecheck
cd web && npm run typecheck && npm run build
cd mobile && npm run typecheck && npx expo export --platform android
```

The backend suite covers authentication, OTP, sessions, role checks, registration and the company, transporter and employee portals. See [docs/TESTING.md](docs/TESTING.md).

## Production

Build with `npm run build` and run with `npm start` in `backend/`, `web/` and `admin-web/`. Run `npm run prisma:deploy` before starting a new backend version. Behind a reverse proxy, forward WebSocket upgrades on `/realtime` to the API. Use HTTPS everywhere and a real OTP provider. The full checklist is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Status

- **Done:** company, transporter, driver and employee portals on the web; the company, transporter and driver mobile app; the admin console (`admin-web`) with every admin API section switched on: dashboard, companies, transporters, drivers, tankers, bookings, offers, trips, tracking, payments, commissions and settlements, subscriptions, services, leads, tasks, employees, roles, HR settings and the activity log.
- `web/` has no admin screens. All administration happens in `admin-web`.
- Service-provider login is out of scope.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/COMPANY_PORTAL.md](docs/COMPANY_PORTAL.md) | Company portal: booking, offers, tracking, payments |
| [docs/TRANSPORTER_PORTAL.md](docs/TRANSPORTER_PORTAL.md) | Transporter portal and driver sub-login |
| [docs/EMPLOYEE_PORTAL.md](docs/EMPLOYEE_PORTAL.md) | Employee portal, roles and permissions |
| [admin-web/README.md](admin-web/README.md) | Admin console: setup, sign-in, sections |
| [docs/MOBILE_APP.md](docs/MOBILE_APP.md) | Mobile app for company, transporter and driver |
| [docs/API.md](docs/API.md) | API conventions, response format, error codes |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Data model, sessions, security |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Every environment variable |
| [docs/TESTING.md](docs/TESTING.md) | Test suites |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production checklist |
