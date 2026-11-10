# TankerLink Admin Console (`admin-web`)

A separate Next.js website for TankerLink platform administrators. It runs on its own port (3100) and talks to the same backend as the customer web app and the mobile app.

## Run it

```bash
cd admin-web
npm install
cp .env.example .env.local      # NEXT_PUBLIC_API_URL=http://localhost:4000
npm run dev                     # http://localhost:3100
```

The backend must allow this site's address. In `backend/.env`:

```
ENABLED_PORTALS=company,admin,transporter,driver,employee
CORS_ORIGINS=http://localhost:3000,http://localhost:3100
```

Restart the backend after changing it. In production, add the admin site's real URL (for example `https://admin.tankerlink.in`) to `CORS_ORIGINS`.

## Signing in

Two steps: mobile number or email plus password, then a one-time code sent to the admin's email (or mobile). In development with `OTP_DEV_ECHO=true`, the code is shown on the page.

- **Super Admin:** created on the server with `npm run create-super-admin` in `backend/`. There is no sign-up page.
- **Employees** can also sign in here. They see only the sections their role allows, and only the records assigned to them if their role is limited to assigned records. The backend enforces this on every request; hiding menu items is only a convenience.

## What it covers

| Area | Sections |
| --- | --- |
| Overview | Dashboard: KPIs for any period, bookings per day, revenue by month, registrations, booking funnel, top routes, employee performance |
| Partners | Companies, Transporters, Drivers, Tankers: lists with search, status tabs, date range, Excel/PDF export; detail pages with tabs; review → approve / reject; suspend / reactivate; assign an account manager; notes; driver transfer; tanker availability |
| Operations | Bookings (cancel, resolve disputes, notes), Offers & negotiation (approve freight corrections), Trips (correct status, resolve delay/emergency alerts), Live tracking, Support tickets (reply, internal notes, status) |
| Finance | Payments (summary, offline receipts, refunds, gateway reconcile), Commissions & settlements (rules, per-booking commission, mark payouts paid), Subscriptions (plans, assign / cancel), Value-added services (catalogue, orders) |
| Team | Leads, Tasks & follow-ups, Employees (create, edit, enable/disable login, reset access), Roles & permissions (permission matrix editor), HR settings (attendance rules, leave policies, KPI targets), Employee activity (append-only log) |

## How it is built

- `src/config/pages.ts` declares each section: its API endpoints, filter tabs, detail tabs and action forms. Adding a button usually means adding one entry there.
- Most list endpoints describe their own columns and formats (`columns` in the response), so tables follow the backend.
- `src/components/AutoView.tsx` renders detail responses: plain fields as a grid, related lists as tables.
- Custom screens: `dashboard`, `roles` (permission matrix), `hr`, `login`.
- The browser only calls `/api/v1` on this site; Next.js forwards it to the backend, so session cookies stay first-party and are never readable by JavaScript. Every change sends the CSRF token.

## Checks

```bash
npm run typecheck
npm run build
```

Backend tests for the admin API: `cd backend && npm test -- admin-portal`.
