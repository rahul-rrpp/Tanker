# TankerLink — Company Portal (Phase 1)

The Company Portal lets a company register, book oil tankers on a map, compare and negotiate transporter
offers, confirm one transporter, track the trip, pay and download documents. Admin, employee, transporter
and driver portals are **not** exposed in this release. Their data model and service functions are in place
so those portals can be added without restructuring the booking engine.

## 1. Architecture

```
web/  Next.js 15 + TypeScript + Tailwind 4 + Recharts + Lucide (company portal UI at /company/*)
  └─ /api/v1/* is proxied to the backend so session cookies stay first-party (httpOnly, CSRF double-submit)
backend/  Express 5 + TypeScript + Prisma 6 + PostgreSQL
  src/modules/
    auth/           register (company), login (password / OTP), remember me, reset, sessions, login history
    company/        profile, logo, KYC documents, dashboard analytics, saved locations
    maps/           Google Places (New) + Routes API; dev fallback = Photon geocoding + OSRM road routing
    pricing/        rule-based indicative freight (pricing_rules + platform_settings)
    bookings/       booking engine (create/list/edit/cancel/repeat/quote, PDFs)
    offers/         negotiation engine (company side + transporter side), expiry sweep, matching
    trips/          trips and tracking read model
    payments/       Razorpay adapter + dev gateway simulator, server-side verification, webhook
    documents/      confirmations, invoices, receipts, trip documents (pdfkit)
    notifications/  in-app notifications + channel adapters (SMS/WhatsApp/email ready)
    support/        tickets with attachments
    demo/           DEMO_MODE-only simulator standing in for the transporter/driver/admin portals
    audit/          business audit log
```

### Roles and release gating
| Future portal | Role(s) | Phase 1 |
|---|---|---|
| Admin | `SUPER_ADMIN` | backend-ready, login blocked |
| Employee | `EMPLOYEE` | role seeded, login blocked |
| **Company** | **`COMPANY_ADMIN`**, `COMPANY_USER` | **live** |
| Transporter | `AGENCY_OWNER`, `AGENCY_MANAGER`, `DISPATCHER`, `FINANCE_MANAGER` (the "Agency" model *is* the transporter) | backend-ready, login blocked |
| Driver | `DRIVER` (sub-login under a transporter) | backend-ready, login blocked |

`ENABLED_PORTALS=company` (backend) refuses sign-in, refresh and API access for non-company roles and returns 404
for legacy registration endpoints. `NEXT_PUBLIC_ENABLED_PORTALS=company` (web) redirects legacy screens to `/login`.

## 2. Database (Prisma, PostgreSQL)

Migrations: `init_auth`, `simple_customer_signup`, `company_portal_marketplace`, `codes_and_constraints`, `otp_contact_change`, `reports_partial_fulfilment`.

| Spec table | Actual table / model |
|---|---|
| users | `User` (existing auth table) |
| companies, company_documents, company_addresses, company_contacts | `companies`, `company_documents`, `company_addresses`, `company_contacts` (+ `company_users` link) |
| saved_locations | `saved_locations` |
| bookings, booking_locations, booking_requirements, booking_status_history | same names |
| transporters | `Agency` (existing tenant table, extended with rating, completedTrips, serviceStates, isDemo) |
| tankers | `tankers` (+ `tanker_products` = product compatibility) |
| drivers | `Driver` (existing) |
| transporter_offers, offer_negotiation_history, booking_allocations | same names |
| trips, trip_tracking, trip_documents | same names |
| payments, invoices | same names |
| notifications | `notifications` (+ `notification_deliveries`, `notification_preferences`) |
| support_tickets, support_attachments | same names |
| products, tanker_types, pricing_rules | same names (+ `platform_settings`) |
| audit_logs | `audit_logs` (auth events stay in `LoginAudit`) |

Rules enforced in the database, not only in code:
- Sequential IDs from PostgreSQL sequences: `CMP000001`, `TLB0000001`, `TRP0000001`, `INV-000001`, `RCP-000001`, `TKT000001`.
- `DECIMAL` for every money value. Latitude and longitude are separate `DECIMAL(9,6)` columns with range CHECKs.
- CHECK constraints keep amounts positive and quantities greater than zero.
- Double booking is prevented by the booking row lock, a unique allocation per offer and the rule sum(allocated tankers) ≤ tankers required.
- Triggers block `DELETE` on `payments` and `invoices`, so financial history can't be deleted.
- Timestamps are stored in UTC and displayed in Asia/Kolkata. Loading and delivery dates are `DATE` columns.

## 3. Booking & negotiation workflow

```
SEARCHING ──offer──▶ OFFERS_RECEIVED ──company counter──▶ NEGOTIATION
     ▲                         │  (all offers rejected/expired → back to SEARCHING)
     └─────────────────────────┘
company accepts ▶ CONFIRMED ▶ VEHICLE_ASSIGNED ▶ DRIVER_ASSIGNED ▶ LOADING ▶ IN_TRANSIT ▶ DELIVERED ▶ COMPLETED
cancellable until CONFIRMED (paid amounts → REFUND_PENDING); DISPUTED reserved for operations
```

- **Distance is never trusted from the browser.** When a booking is created, the server recomputes the road route and the suggested freight.
- **Suggested freight** = max(distance × rate, minimum) × tankers. The most specific active pricing rule wins (by capacity, product, tanker type and route), and the UI shows it as an estimate.
- **Customer offers** must fall within the configured range (default 50–200% of suggested).
- **Each (booking, transporter) pair has one thread.** `PENDING` means the company decides next; `COUNTERED` means the transporter decides. Offers expire after `offerExpiryHours`, enforced by a 60 s sweep plus a check on every read, and negotiation is limited to `maxNegotiationRounds`.
- **Only the company makes the final accept.** If a transporter accepts a counter, the offer returns to `PENDING` at the counter price and the company confirms it. That way several transporters accepting counters at once can't double-book the company.
- **Accept is one transaction.** It locks the booking row (`SELECT … FOR UPDATE`), locks the freight, closes all other offers as `UNSUCCESSFUL` with history entries, creates the allocation, trip and freight invoice, and writes an audit entry.
- **Product compatibility:** a transporter is matched only if it has an AVAILABLE tanker of sufficient capacity that is certified for the product (`tanker_products`), plus the tanker type and compartments if requested.
- **Multi-tanker bookings and partial fulfilment:** accepting an offer allocates min(tankers offered, tankers still unallocated) to that transporter. Each allocation gets its own locked price (pro-rated when the offer covers more tankers than remain), its own freight invoice, and one trip per tanker. The booking stays in NEGOTIATION until every tanker is allocated, then becomes CONFIRMED and the remaining offers close. A booking advances only as far as its least-advanced trip.
- **Verification gate:** companies that are pending or rejected can complete their profile, upload documents, save locations and get route and freight quotes. Submitting a booking requires `VERIFIED` (`allowPendingCompanyBookings=false`).

## 4. Demo environment (`DEMO_MODE=true`, never in production)

`npm run db:seed:demo` creates 5 companies, 10 transporters, 20 tankers, 20 drivers and 25 bookings in every status. It also adds offers with negotiation history, 11 delivered/completed trips plus 5 active ones, invoices, payments (including one failed attempt), simulated GPS, delivery proofs, notifications and a support ticket. All company and transporter names end in "(Demo)", and demo rows carry `isDemo` or `SIMULATED`. The UI shows a magenta DEMO badge and a site-wide banner. Routes come from real OSRM road routing.

| Company ID | Login (mobile / email) | Password | Status |
|---|---|---|---|
| CMP000001 | 9100000001 / demo.company1@tankerlink.example | `Demo@12345` | Verified (main demo, 15 bookings) |
| CMP000002 | 9100000002 / demo.company2@tankerlink.example | `Demo@12345` | Verified |
| CMP000003 | 9100000003 / demo.company3@tankerlink.example | `Demo@12345` | Verified |
| CMP000004 | 9100000004 / demo.company4@tankerlink.example | `Demo@12345` | Verified |
| CMP000005 | 9100000005 / demo.company5@tankerlink.example | `Demo@12345` | Pending verification |

The demo simulator buttons appear in dashed magenta panels and stand in for the future portals:
- **Receive demo transporter offers:** compatible demo transporters quote. One accepts your price; the others quote higher.
- **Simulate transporter reply:** accept your counter, or counter again.
- **Advance trip:** moves the trip through vehicle → driver → loading → in transit (+30% of the route per click, as SIMULATED GPS) → delivered (a simulated proof of delivery is generated) → completed.
- **Simulate admin approval:** verifies a pending company.

Development OTPs: with `OTP_PROVIDER=mock` and `OTP_DEV_ECHO=true`, codes are shown in a magenta "Development OTP simulation" box and printed to the backend console. Production rejects this configuration.

## 5. Maps

| Concern | With `GOOGLE_MAPS_SERVER_KEY` | Without (development) |
|---|---|---|
| Autocomplete / details | Places API (New), session tokens | Photon (OpenStreetMap) |
| Reverse geocode (pin drag / map click) | Geocoding API | Photon reverse |
| Road distance, ETA, alternatives | Routes API `computeRoutes` (alternatives on) | OSRM `route/v1/driving` (alternatives on) |
| Browser map | Google Maps JS (`NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`, referrer-restricted) | Leaflet + OSM tiles, labelled "Development map" |

The server key never reaches the browser: autocomplete, details, geocoding and routing are proxied through `/api/v1/maps/*` with a per-IP limit of 90 requests per minute and a TTL cache. ETAs are multiplied by `heavyVehicleEtaFactor` (default 1.3) for loaded tankers. Straight-line distance is never used as road distance. The `fixture` provider exists only for automated tests.

## 6. Payments

- Breakdown: agreed freight + platform fee (2%) + GST (5% on freight + fee, configurable, "where applicable"); advance = 30% of total.
- `POST /payments/create-order` creates a Razorpay order (or a mock order). Unpaid orders are reused for 30 minutes, which makes the call idempotent.
- **Verification:** `POST /payments/verify` checks the HMAC signature of `order_id|payment_id` with the key secret, then fetches the payment from Razorpay and checks the order, the amount and that the status is `captured` (authorized payments are captured server-side). Only then is the payment marked `PAID`, a receipt number assigned and the booking/invoice status recomputed. A browser's claim of success is never trusted.
- Webhook: `POST /api/v1/payments/webhook/razorpay` uses a raw body and an `X-Razorpay-Signature` HMAC check, and handles `payment.captured` and `payment.failed`.
- `PAYMENT_PROVIDER=mock` is a hosted-checkout simulator that uses the same signature scheme and server-side record. It is rejected in production.
- Transporter settlement and refunds are out of scope for Phase 1. The statuses `REFUND_PENDING` and `REFUNDED` exist for them.

## 7. REST API (`/api/v1`, JSON envelope `{ success, message, data | error }`)

Auth: cookie session on the web (CSRF header required for writes), or `Authorization: Bearer` with `X-Client-Type: mobile`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register` (company), `POST /auth/register/company`, `POST /auth/send-otp`, `POST /auth/verify-otp` (aliases of `/auth/otp/send|verify`), `POST /auth/login` (`rememberMe`), `POST /auth/login/otp/send`, `POST /auth/login/otp/verify`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/profile` (= `/auth/me`), `GET /auth/login-history`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`, `POST /auth/change-password`, `POST /auth/contact/send-otp`, `POST /auth/contact/verify` |
| Company | `GET/PUT /companies/profile`, `POST/GET /companies/logo`, `POST/GET /companies/documents`, `GET /companies/documents/:id/download`, `DELETE /companies/documents/:id` (unverified only), `GET/POST /companies/contacts`, `PUT/DELETE /companies/contacts/:id`, `GET /companies/dashboard` |
| Locations | `GET /locations?q&type`, `POST /locations`, `PUT /locations/:id`, `DELETE /locations/:id`, `POST /locations/:id/default` |
| Catalog / maps | `GET /catalog`, `GET /maps/config`, `GET /maps/places?q`, `GET /maps/places/details?placeId`, `GET /maps/reverse?lat&lng`, `POST /maps/route`, `POST /maps/distance` |
| Bookings | `POST /bookings/quote`, `POST /bookings[?repeatOf]`, `GET /bookings?tab&q&from&to&productId&capacity&page`, `GET /bookings/:id`, `PUT /bookings/:id` (needs `version`), `POST /bookings/:id/cancel`, `POST /bookings/:id/repeat`, `GET /bookings/:id/offers`, `GET /bookings/:id/summary.pdf`, `GET /bookings/:id/confirmation.pdf`, `GET /bookings/:id/payment` |
| Offers | `GET /offers?status=open|closed|all`, `GET /offers/:id`, `POST /offers/:id/counter`, `POST /offers/:id/accept`, `POST /offers/:id/reject`, `GET /transporters/:id` |
| Trips | `GET /trips?scope=active|completed|all`, `GET /trips/:id`, `GET /trips/:id/tracking` |
| Payments | `GET /payments/summary`, `GET /payments?bookingId&status`, `GET /payments/:id`, `GET /payments/:id/receipt.pdf`, `POST /payments/create-order`, `POST /payments/verify`, `POST /payments/failed`, `POST /payments/mock/checkout` (dev), `POST /payments/webhook/razorpay` |
| Documents | `GET /documents?type&bookingId&from&to`, `GET /documents/:type:id[/download][?inline=1]` |
| Notifications | `GET /notifications?unread&page`, `GET /notifications/unread-count`, `PUT /notifications/:id/read`, `PUT /notifications/read-all`, `GET/PUT /notifications/preferences` |
| Reports | `GET /reports` (13 reports), `GET /reports/:key?from&to`, `GET /reports/:key/export?format=xlsx|pdf&from&to` |
| Support | `POST /support/tickets` (multipart, ≤5 attachments), `GET /support/tickets?status`, `GET /support/tickets/:id`, `GET /support/tickets/:id/attachments/:attachmentId` |
| Demo (DEMO_MODE) | `GET /demo/status`, `POST /demo/bookings/:id/offers`, `POST /demo/offers/:id/respond`, `POST /demo/trips/:id/advance`, `POST /demo/company/verify` |

Error codes added in this phase include `PORTAL_NOT_AVAILABLE`, `COMPANY_REQUIRED`, `COMPANY_NOT_ELIGIBLE`, `COMPANY_SUSPENDED`, `GST_ALREADY_REGISTERED`, `OFFER_OUT_OF_RANGE`, `OFFER_NOT_ACTIONABLE`, `OFFER_EXPIRED`, `BOOKING_ALREADY_CONFIRMED`, `INVALID_STATE_TRANSITION`, `ROUTE_NOT_FOUND`, `MAPS_UNAVAILABLE`, `PAYMENT_NOT_ALLOWED`, `PAYMENT_VERIFICATION_FAILED`, `FILE_REJECTED` and `DEMO_DISABLED`.

## 7a. Reports & Analytics

These 13 reports are computed on request from the company's own records, with nothing cached or hard-coded:

- total bookings
- monthly bookings
- route-wise
- oil type-wise
- tanker capacity-wise
- transporter-wise
- freight comparison (suggested vs offer vs agreed)
- monthly freight expenditure
- payments
- pending payments
- completed trips
- cancelled bookings
- repeat bookings

Each report has a date filter (default: last 12 months, IST), summary cards, a chart and a searchable table. It can be exported to Excel (typed cells via exceljs) or PDF (landscape, pdfkit), and every export is audit-logged.

## 8. Security controls

- Passwords are hashed with Argon2id; accounts lock out after repeated failures. Session tokens are httpOnly cookies with refresh rotation and reuse detection.
- Remember me: when off, the refresh/CSRF cookies are browser-session cookies and the session lasts 12 h.
- **Tenant isolation:** `requireCompany` resolves the company from the database principal, and every query filters by `companyId`. Another company's resources return **404**, so their existence isn't revealed (covered by tests).
- Permissions come from the database (`company:*`). Every input is validated with Zod (`.strict()` on writes). Prisma parameterises all queries, and the only raw SQL uses fixed sequence names or tagged templates.
- Rate limits apply per IP: global, login, OTP, registration and maps.
- **Uploads:** stored in memory with size and count limits. The file type is detected from magic bytes (PDF/PNG/JPEG/WEBP), the storage key is random and traversal-safe, and downloads go only through authorised endpoints with `nosniff` and a sandbox CSP.
- GSTIN is checked for format, check digit and that its state code matches the selected state. Mobile numbers and emails must be OTP-verified, and duplicates are blocked.
- Payments are verified server-side, as described in section 6. Every important business action is recorded in the audit log.
- Production refuses to start with mock OTP, OTP echo, mock payments or fixture maps. Secrets come only from environment variables.

## 9. Setup

```bash
# backend
cd backend && npm install && cp .env.example .env     # fill the three secrets
npm run db:local                                      # terminal A (or point DATABASE_URL at PostgreSQL)
npm run db:setup                                      # migrate deploy + roles/permissions/products/pricing/settings
npm run db:seed:demo                                  # optional demo data (development only)
npm run dev                                           # http://localhost:4000, Swagger at /api/docs

# web
cd web && npm install && cp .env.example .env.local
npm run dev                                           # http://localhost:3000 → /login or /register
```

Production checklist: set `NODE_ENV=production`, `COOKIE_SECURE=true`, real OTP/SMTP providers, `PAYMENT_PROVIDER=razorpay` with keys and a webhook secret, `GOOGLE_MAPS_SERVER_KEY` (IP-restricted) and `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` (referrer-restricted), `DEMO_MODE=false`, and `ENABLED_PORTALS=company`. Move `UPLOAD_DIR` to persistent storage, or implement an S3 `StorageDriver`. Use a shared rate-limit store when running more than one instance. Run `npm run db:setup` on each deploy, and **never** run `db:seed:demo` in production.
