# TankerLink: Employee Portal

The internal operations portal. It reuses the existing `User`, `Employee`, `EmployeeRole`, `Lead`, `FollowUp`, `EmployeeTask`, KPI, company, transporter, booking and payment tables, so no business record is duplicated.

## Setup

```bash
# backend/.env
ENABLED_PORTALS=company,admin,transporter,driver,employee
# web/.env.local (rebuild web after changing)
NEXT_PUBLIC_ENABLED_PORTALS=company,transporter,driver,employee

cd backend
npx prisma migrate deploy      # additive migration 20261110090000_employee_portal
npm run db:seed                # new roles, permissions, leave policies (idempotent; run on each deploy)
npm run db:seed:employee       # development only, additive, run after db:seed:demo
```

Sign in at `/login/employee`.

## Demo accounts (development only, password `Demo@12345`)

| Mobile | Role | Reports to |
|---|---|---|
| 9300000001 | Sales Manager | |
| 9300000002, 9300000003 | Sales Executive | 9300000001 |
| 9300000004 | Operations Executive | |
| 9300000005 | Verification Executive | |
| 9300000006 | Accounts Executive | |
| 9300000007 | MIS Executive | |

## Access model

- Admin creates employees (`POST /admin/employees`). There is no self-registration. A new employee signs in by OTP on their mobile, or sets a password with forgot-password.
- Only `ACTIVE` employees pass, checked on sign-in and on every request. Super Admins do not use this portal.
- Permissions are `adm.<module>.<action>` on the employee's role, with per-employee GRANT/DENY overrides. Every route checks them on the server; the sidebar only mirrors them.
- A role's `dataScope` of `ASSIGNED` limits leads, companies, transporters, bookings, trips and tickets to the employee's own. Other records return 404.
- Verification ids are `<KIND>:<uuid>` (`COMPANY_DOC`, `KYC`, `BANK`, `COMPANY`, `TRANSPORTER`, `DRIVER`, `TANKER`).
- Negotiation routes can view, note, notify and flag. No employee route accepts an offer or changes agreed freight.
- Payment routes read and annotate only.
- Audit rows are written with `actorType: EMPLOYEE` and have no update or delete route.

## API (`/api/v1/employee`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `/auth/otp/send`, `/auth/otp/verify`, `/auth/forgot-password`, `/auth/logout`; `GET /auth/profile` |
| Dashboard | `GET /dashboard` |
| CRM | `GET/POST /leads`, `POST /leads/check-duplicates`, `GET/PUT /leads/:id`, `POST /leads/:id/{assign,convert,lost,documents}`, `GET/POST /call-logs`, `GET/POST /follow-ups`, `POST /follow-ups/:id/{complete,reschedule}` |
| Onboarding | `GET/POST /companies`, `GET /companies/:id`, `POST /companies/:id/{documents,account-manager}`, `GET/POST /transporters`, `GET /transporters/:id`, `POST /transporters/:id/{documents,tankers}`, `POST /tankers/:id/documents`, `GET/POST /drivers`, `POST /drivers/:id/documents`, `GET /directory` |
| Verification | `GET /verifications`, `GET /verifications/:id/{file,history}`, `POST /verifications/:id/{approve,reject}` |
| Bookings | `GET/POST /bookings`, `GET /bookings/:id`, `POST /bookings/:id/{notes,flag-delayed,issue}` |
| Negotiations | `GET /negotiations[/:id]`, `POST /negotiations/:id/{notes,notify,flag-dispute}` |
| Trips | `GET /trips[/:id]`, `GET /trips/:id/documents/:docId`, `POST /trips/:id/{issue,correct-status}` |
| Support | `GET/POST /support/tickets`, `GET /support/tickets/:id`, `POST /support/tickets/:id/{assign,respond,attachments}` |
| Payments | `GET /payments`, `/payments/summary`, `/payments/settlements`, `GET/POST /payments/:id/notes` |
| Tasks | `GET/POST /tasks`, `GET/PUT /tasks/:id`, `POST /tasks/:id/{transfer,remarks,attachments}` |
| Attendance | `POST /attendance/{check-in,check-out,break-start,break-end}`, `GET /attendance`, `GET /attendance/team` |
| Leave | `GET/POST /leaves`, `GET /leaves/approvals`, `POST /leaves/:id/{cancel,approve,reject}` |
| MIS | `GET/POST /mis`, `PUT /mis/:id`, `GET /mis/:id/revisions`, `GET /mis-team` |
| Performance | `GET /performance`, `/performance/targets`, `/performance/team` |
| Notifications | `GET /notifications`, `PUT /notifications/:id/read`, `PUT /notifications/read-all` |

Admin: `/admin/auth`, `/admin/roles`, `/admin/employees`, and `/admin/hr/{kpi-targets,leave-policies,attendance-rules,activity-logs}`.

## Known limitations

- Admin has no web screens for employees, roles, targets, leave policy or activity logs: these are API-only.
- Manual booking on a company's behalf is API-only (`POST /employee/bookings`), with no form yet.
- `db:seed:employee` does not create new bookings or trips; those come from the company and transporter demo seeds, so demo counts follow them. Demo sales staff have no assigned companies, and bookings need a role with ALL scope.
- SMS, email and push remain unconnected adapters. New employees get no automatic message.
- Attendance rules and leave entitlements are defaults. Replace them with your approved policy and confirm they meet applicable labour law.
- Call duration is entered by hand. There is no telephony integration.
- The other admin routers (`parties`, `fleet`, `finance`, `ops`, `dashboard`) remain unmounted, so transporter settlements cannot yet be marked paid.
