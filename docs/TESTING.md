# Testing report

## Company Portal — re-verification against the master spec, run date 2026-11-07

| Check | Result |
|---|---|
| Backend and web `tsc --noEmit` | ✅ pass |
| Backend automated tests (`npm test`) | ✅ **88 / 88 passed** |
| 7 migrations on a fresh embedded PostgreSQL + `db:seed` + `db:seed:demo` | ✅ pass |
| Live journey `node scripts/smoke-company-api.mjs` (spec §21 steps 1–22 + data isolation) | ✅ **32 / 32 passed** |
| Web `next build` + `next start`, signed in through the proxy (cookie session), all 19 company routes incl. booking detail / offers / confirmation / trip detail | ✅ all HTTP 200, no server errors |
| Visual browser pass and phone-width check | ⚠️ not done — the Chrome extension was not connected in this session |

Note: Next.js bakes the `/api/v1` rewrite target in at **build** time, so set `API_URL` (or `NEXT_PUBLIC_API_URL`) before `next build`, not only before `next start`.

## Company Portal (Phase 1, revised spec) — run date 2026-11-06

| Check | Result |
|---|---|
| Backend `tsc --noEmit` | ✅ pass |
| 6 migrations applied to a fresh PostgreSQL 18 + `db:seed` + `db:seed:demo` | ✅ pass |
| Backend automated tests (`npm test`) | ✅ **88 / 88 passed** (65 auth + 23 company portal) |
| Live end-to-end journey `node scripts/smoke-company-api.mjs http://localhost:4110` (spec section 21, steps 1–22 + isolation) | ✅ **32 / 32 checks passed** |
| Web `tsc --noEmit` and `next build` (all routes, incl. 21 company routes) | ✅ pass |
| Browser walkthrough (desktop): login → dashboard → book (OSM map + route) → bookings → offer comparison → reports → trips → tracking | ✅ renders and navigates; only console errors are hydration warnings from a browser extension (`fdprocessedid`) |
| Phone-width visual check | ⚠️ not verified: the browser window could not be resized in this session. Layouts use responsive stacking and a drawer sidebar. |

Journey coverage (smoke script): register with mobile and email OTP (dev echo) → login → profile and authorized contact → GST and PAN upload → booking blocked while unverified → demo admin verification → saved location → places search → OSRM road route (432.5 km, 2 alternatives) → freight estimate → booking (SEARCHING) → 3 demo offers → counter-offer → transporter accepts (demo) → confirm → duplicate accept rejected → 3-tanker booking split across 2 transporters (3 trips) → vehicle and driver assigned → SIMULATED tracking → forged payment rejected → credit-card payment verified → invoice and receipt PDFs → support ticket with attachment → booking history → all 13 reports, figures matching the database, Excel and PDF export → another company gets 404 on 7 private resources and never sees these rows in its reports.

---

## Company Portal (Phase 1) — run date 2026-11-06

| Check | Result |
|---|---|
| Backend `tsc --noEmit` | ✅ pass |
| Migrations (5) applied to a fresh PostgreSQL 18 + `db:seed` + `db:seed:demo` (routes from OSRM) | ✅ pass |
| Backend automated tests (`npm test`) | ✅ **84 / 84 passed** (6 files: 65 existing auth tests + 19 new in `tests/company.test.ts`) |
| Live API smoke test `node scripts/smoke-company-api.mjs http://localhost:4100` (demo data, OSM routing) | ✅ **25 / 25 checks passed** |
| Web `tsc --noEmit` (all company portal pages) | ✅ pass |
| Web dev server: `/login`, `/register` render (200); legacy `/admin/*` redirects to `/login` | ✅ pass |
| Full browser walkthrough + `next build` + responsive check | ⏳ not completed — the local dev servers were stopped by the machine's low-memory guard; rerun when resources allow |

Acceptance tests covered by automated checks (vitest `company.test.ts` + smoke script):

| # | Scenario | Covered by |
|---|---|---|
| 1 | Register with mobile + email OTP, company ID, login (password/OTP), login history | vitest TEST 1 |
| 2 | Profile edit (PAN↔GST, billing address), document upload/replace with history, disguised file rejected | vitest TEST 2/3, smoke |
| 3 | Saved locations, single default pickup | vitest TEST 2/3 |
| 4–7 | Places search, road route, freight estimate, product/capacity/date validation | smoke (OSRM/Photon), vitest (fixture) |
| 8 | Booking created (SEARCHING), out-of-range offer rejected | both |
| 9–11 | Demo offers, counter, transporter reply, accept → confirmed, others closed, concurrent double accept → exactly one wins | both |
| 12–13 | Trip progression, SIMULATED tracking labelled | both |
| 14 | Payment order, forged signature rejected, verified payment, receipt PDF, payments undeletable | both |
| 15 | Confirmation / invoice / receipt documents downloadable | both |
| 16 | Support ticket with attachment | both |
| 17 | Cross-company access → 404 on bookings, offers, PDFs, documents, payments, demo endpoints | both |
| 18 | Responsive layout | built mobile-first (stacked form/map, drawer sidebar); manual browser check pending |

---

## Authentication core (earlier report)

Run date: 2026-11-05 · Node 24.13 · Windows 11

## How to run

```bash
cd backend && npm test        # Vitest + Supertest against a real PostgreSQL
```
The test run starts a throwaway embedded PostgreSQL on port 54330, applies the migrations and seeds RBAC. Set `TEST_DATABASE_URL` to use an existing database instead (e.g. a CI service container). Codes are read from the mock OTP provider's in-memory outbox.

Web E2E (needs the backend in dev mode with its console logged to a file, plus a running web app):
```bash
node scripts/e2e-web.mjs <path-to-backend-console-log>
```

## Results

| Check | Result |
|---|---|
| Backend `tsc --noEmit` | ✅ pass |
| Backend `npm run build` | ✅ pass |
| Prisma migration `init_auth` applied + seed (7 roles, 18 permissions) | ✅ pass |
| Backend automated tests | ✅ **62 / 62 passed** (5 files) |
| Web `tsc --noEmit` and `next build` (22 routes + middleware) | ✅ pass |
| Web E2E through the Next.js proxy + middleware | ✅ **29 / 29 passed** |
| Mobile `tsc --noEmit` | ✅ pass |
| Mobile `expo install --check` (SDK 54 compatibility) | ✅ up to date |
| Mobile `expo export --platform android` (Metro/Hermes bundle) | ✅ pass |

## Coverage of required scenarios (backend tests)

| Scenario | Test file |
|---|---|
| Agency / driver / customer registration | registration.test.ts |
| Duplicate phone, duplicate email | registration.test.ts |
| Verification-token reuse and mismatch | registration.test.ts |
| Driver flow cannot escalate roles; invalid or single-use invitation codes | registration.test.ts |
| OTP send (hash-only storage), invalid OTP, expired OTP, reuse prevention, max attempts, resend cooldown | otp.test.ts |
| Correct login (phone/email), incorrect password, unknown account (generic error), lockout | login.test.ts |
| Suspended account (login blocked + live sessions revoked) | login.test.ts |
| Pending agency (pending redirect, restricted operations → 403) | login.test.ts, registration.test.ts |
| OTP login (+ no enumeration), password reset, password change | login.test.ts |
| Token refresh/rotation, refresh-token reuse detection, race conflict, session expiry, expired/forged JWT | session.test.ts |
| Logout (device), logout-all, revoke single session, web cookies + CSRF + Origin | session.test.ts |
| Unauthorized API access, role-based access, staff role restrictions, approval unlocks access | rbac.test.ts |
| Cross-agency access prevention (drivers, invitations) | rbac.test.ts |

## Web E2E coverage (scripts/e2e-web.mjs)

Anonymous redirect to login with `next`, rendering of all public auth pages, customer signup via the proxy, server-rendered dashboard, customer → admin redirected to `/unauthorized`, signed-in user bounced off `/login`, CSRF rejection, **transparent refresh by middleware when the access cookie has expired**, account page, client refresh, wrong/correct password login, logout clearing cookies, OTP login, agency signup → `/pending-verification` with status details, and the OpenAPI document.

## Not covered / limitations

- **Mobile runtime**: no emulator or device was available, so mobile screens were verified by typecheck and a production bundle only, not by on-device interaction. The mobile client uses the same endpoints and `X-Client-Type: mobile` mode, which the backend tests cover thoroughly.
- **Real SMS/email delivery**: the MSG91, Twilio and SMTP providers are implemented but untested without credentials. Tests use the mock provider.
- **Visual review**: the web UI was verified by build and HTTP E2E, not by screenshots.
