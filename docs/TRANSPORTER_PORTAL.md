# TankerLink: Transporter Portal and Driver Sub-login

Built into the existing application. `Agency` is the transporter. The booking, negotiation, commission, notification and auth code is reused, not duplicated.

## Setup

```bash
# backend/.env
ENABLED_PORTALS=company,admin,transporter,driver
FIELD_ENCRYPTION_KEY=<32+ chars>     # required in production
GPS_INGEST_KEY=<24+ chars>           # optional; enables GPS hardware ingestion

# web/.env.local
NEXT_PUBLIC_ENABLED_PORTALS=company,transporter,driver
NEXT_PUBLIC_SOCKET_URL=              # optional; defaults to NEXT_PUBLIC_API_URL

cd backend
npx prisma migrate deploy            # additive migration 20261109090000_transporter_portal
npm run db:seed                      # adds new permissions and Silver/Gold plans (idempotent, run on every deploy)
npm run db:seed:demo                 # development only
npm run db:seed:transporter          # development only, additive
```

The migration needs the PostgreSQL `btree_gist` extension, which it creates. On managed PostgreSQL, confirm the migration role may create it.

The web production build reads `NEXT_PUBLIC_*` at build time. Rebuild after changing them.

Behind a reverse proxy, forward WebSocket upgrades on `/realtime` to the API, and include the web origin in `CORS_ORIGINS`.

## Demo accounts (development only, password `Demo@12345`)

| Account | Login |
|---|---|
| Verified transporter | 9200000001 |
| Pending transporter | 9200000002 |
| Suspended transporter (sign-in refused) | 9200000003 |
| Driver | 9200000011, by OTP |

## Workflow

Company creates booking → matching transporters are alerted → transporter accepts or counters (`POST /bookings/:id/offers`) → multi-round negotiation → **the company makes the final accept** → allocation, trips, invoice, commission and an ON_HOLD settlement are created → transporter assigns a tanker, then a driver → driver walks the status steps and shares location → driver uploads proof and submits (DELIVERED) → transporter closes the trip (COMPLETED) → tanker released at its actual location, settlement becomes PENDING → admin marks it settled.

## Key rules and where they live

| Rule | Implementation |
|---|---|
| One definition of "can this tanker serve this booking" | `transporter/matching.service.ts`, used by marketplace, offers and assignment |
| Tanker availability is date-based, not status-based | `bookingWindow` plus trips and `tanker_availability` |
| No overlapping tanker or driver assignments | Row lock in the transaction, backed by exclusion constraints `trips_tanker_no_overlap` and `trips_driver_no_overlap` |
| Controlled trip status changes | `transporter/trip.engine.ts`, recorded in `trip_status_history` |
| Tenant isolation | `requireTransporter` / `requireDriver`; other tenants' records return 404 |
| Compliance cannot be self-certified | Status fields are not accepted on write (`.strict()` schemas); material edits send a verified tanker back to review |
| Financial data is read-only to transporters | `finance.routes.ts` has no write routes |
| Bank details | AES-256-GCM, masked in responses, OTP to change, new row plus audit entry |
| Simulated GPS is never shown as live | `isSimulated` / `SIMULATED` source, labelled in the UI |

Matching settings are in `platform_settings`: `marketplaceRadiusKm`, `marketplaceMatchOperatingStates`, `assignmentBufferHours`, `gpsOfflineMinutes`, `routeDeviationKm`, `stoppageMinutes`.

## API (`/api/v1`)

Routes on paths shared with the Company Portal (`/offers/:id`, `/trips/:id`, `/support/tickets`) apply to transporter callers; company callers fall through to the existing routers unchanged.

| Area | Endpoints |
|---|---|
| Account | `POST /transporters/register`, `GET/PUT /transporters/me`, `POST /transporters/me/documents`, `GET /transporters/me/verification`, `POST /transporters/me/bank/send-otp`, `PUT /transporters/me/bank`, `/transporters/me/contacts`, `PUT /transporters/me/preferences`, `GET /transporters/dashboard` |
| Marketplace | `GET /marketplace/bookings`, `GET /marketplace/bookings/:id`, `POST /marketplace/bookings/:id/ignore` |
| Offers | `POST /bookings/:id/offers`, `GET /transporters/me/offers`, `GET /offers/:id`, `POST /offers/:id/{counter,accept,reject,withdraw}` |
| Fleet | `POST/GET /tankers`, `GET/PUT /tankers/:id`, `POST /tankers/:id/documents`, `PUT /tankers/:id/availability`, `POST /tankers/:id/assign-driver`, `GET /tankers/availability/calendar` |
| Drivers | `POST/GET /transporters/me/drivers`, `GET/PUT /transporters/me/drivers/:id`, `POST .../documents`, `POST .../invite`, `PUT .../status` |
| Operations | `GET /transporters/me/bookings`, `POST /bookings/:id/assign-tanker`, `POST /bookings/:id/assign-driver`, `GET /transporters/me/trips`, `GET /trips/:id`, `GET /trips/:id/history`, `GET /trips/:id/tracking`, `POST /trips/:id/{complete,issue}`, `POST /trips/:id/alerts/:alertId/resolve`, `GET /transporters/me/active-vehicles` |
| Driver | `GET /driver/me`, `GET /driver/me/trips[/:id]`, `POST /driver/me/trips/:id/{status,documents,location,emergency}` |
| Finance | `GET /transporters/me/{earnings,payments,commissions,settlements}`, `GET /transporters/me/statement.pdf`, `GET /transporters/me/settlements/:id/statement.pdf`, `GET /transporters/me/documents-centre` |
| Reports | `GET /transporters/me/reports[/:key[/export]]` (27 reports) |
| Support | `POST/GET /support/tickets`, `GET /support/tickets/:id`, `POST /support/tickets/:id/{replies,reopen}`; staff: `/admin/transporter-tickets` |
| Plans and services | `GET /subscription-plans`, `GET /transporters/me/subscription`, `POST /transporters/me/subscription-orders`, `GET /services`, `GET/POST /service-requests` |
| Realtime and GPS | `GET /realtime/ticket` (then Socket.IO at `/realtime`), `POST /gps/ingest` (`X-GPS-Key`) |

## Known limitations

- The Admin Portal routers (`modules/admin/{auth,dashboard,people,parties,fleet,ops,finance}.routes.ts`) are not mounted in `app.ts`. Until they are, tankers cannot be verified through the API, and settlements cannot be marked paid.
- Paid subscriptions are recorded as `PENDING`, because `payments` rows require a booking. Activation needs an admin step.
- `Processing`, `Partially Settled` and `Failed` settlement states display correctly, but nothing sets them yet.
- Commission tax and adjustment lines show zero: the commission engine has no such fields.
- SMS, WhatsApp, email and push remain unconnected adapters. In-app notifications are live.
- `Booking Expiring` and `Payment Received` notifications are not emitted yet.
- Mobile-browser GPS works only while the page is open. Continuous tracking needs the native app or `POST /gps/ingest`.
- Local-disk file storage: implement a `StorageDriver` for object storage before running more than one instance.
- Socket.IO is single-instance: add the Redis adapter to scale out.
- Seeded trips have no planned windows, so the availability calendar shows them as free.
