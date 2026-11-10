# TTMS Auth API (v1)

Base URL: `/api/v1`. Interactive docs: `GET /api/docs` (Swagger UI). Raw spec: `GET /api/docs/openapi.json`.

## Conventions

**Success**
```json
{ "success": true, "message": "Login successful", "data": { "accessToken": "…", "user": { "id": "…", "roles": ["AGENCY_OWNER"], "accountStatus": "ACTIVE" }, "redirectTo": "/agency/dashboard" } }
```
**Failure**
```json
{ "success": false, "message": "Please correct the highlighted fields", "error": { "code": "VALIDATION_ERROR", "details": [{ "field": "phone", "message": "Enter a valid 10-digit Indian mobile number" }] } }
```

- Mobile clients send `X-Client-Type: mobile` to receive `refreshToken` in the body. Web clients receive cookies only.
- Cookie-authenticated `POST/PATCH/DELETE` requests must send `X-CSRF-Token` equal to the `ttms_csrf` cookie.
- Responses never contain password, OTP or refresh-token hashes.
- Roles, permissions and agency are always resolved server-side. Any `role`/`agencyId` in a request body is ignored or rejected.

## Endpoints

### Registration (public)
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/otp/send` | `{channel: SMS\|EMAIL, destination, purpose: REGISTRATION}`. 409 if already registered. Subject to the cooldown. |
| POST | `/auth/otp/resend` | Alias of send |
| POST | `/auth/otp/verify` | Returns `verificationToken`, single-use and valid for 15 min |
| POST | `/auth/register/agency` | Owner + agency (`PENDING_VERIFICATION`). Requires `acceptTerms: true` and `phoneVerificationToken`. |
| POST | `/auth/register/driver` | Requires an agency **invitation code** (DRIVER role only). Driver starts in `PENDING_VERIFICATION`. |
| POST | `/auth/register/customer` | `INDIVIDUAL` or `BUSINESS` (business name required) |

Registration signs the user in and returns the same payload as login (status 201).

### Login & session
| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/login` | – | `{identifier: phone or email, password}` |
| POST | `/auth/login/otp/send` | – | Same response whether or not the number exists |
| POST | `/auth/login/otp/verify` | – | `{phone, code}`. Also activates staff accounts created by an owner. |
| POST | `/auth/refresh` | refresh token | Rotates the token. Reuse of an old token revokes the session family. |
| POST | `/auth/logout` | refresh token | Current device |
| POST | `/auth/logout-all` | access | All devices |
| GET | `/auth/me` | access | User, roles, permissions, agency, `redirectTo` |
| GET | `/auth/sessions` | access | Active devices |
| DELETE | `/auth/sessions/:sessionId` | access | Revoke one device |

### Passwords & profile
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/forgot-password` | `{identifier}`. Sends a `PASSWORD_RESET` OTP. Generic response. |
| POST | `/auth/reset-password` | `{identifier, code, password, confirmPassword}`. Revokes all sessions. |
| POST | `/auth/change-password` | `currentPassword` is required if the account has a password. Signs out other devices. |
| GET | `/users/profile` | Profile including driver, customer or agency details |
| PATCH | `/users/profile` | `fullName`, `email` and `customer{…}` only (strict schema) |
| POST | `/users/email/send-otp`, `/users/email/verify` | Verify an email added later |

### Agency (tenant-scoped by membership)
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/agency/registration-status` | AGENCY_OWNER | Works while pending |
| GET/POST | `/agency/members` | `agency:members:read` / `:manage` | Staff roles: AGENCY_MANAGER, DISPATCHER, FINANCE_MANAGER |
| PATCH | `/agency/members/:memberId/status` | `agency:members:manage` | Deactivating also revokes sessions |
| GET/POST | `/agency/invitations` | `agency:invitations:manage` | The code is shown **once** and only its hash is stored |
| DELETE | `/agency/invitations/:id` | `agency:invitations:manage` | |
| GET | `/agency/drivers` | `agency:drivers:read` | |
| PATCH | `/agency/drivers/:driverId/verification` | `agency:drivers:verify` | Returns 404 for other agencies' drivers |

Everything except `registration-status` requires an **APPROVED** agency (`403 AGENCY_NOT_APPROVED`).

### Admin (SUPER_ADMIN)
| Method | Path | Notes |
|---|---|---|
| GET | `/admin/agencies?status=&page=&pageSize=` | |
| PATCH | `/admin/agencies/:agencyId/verification` | `{status, reason}`. A reason is required unless approving. |
| PATCH | `/admin/users/:userId/status` | Suspend, deactivate or reactivate. Non-active statuses revoke sessions. |

Super Admins are created only with `npm run create-super-admin`. There is no HTTP endpoint for it.

## Role → landing route (`redirectTo`)
| Role | Route |
|---|---|
| SUPER_ADMIN | `/admin/dashboard` |
| AGENCY_OWNER, AGENCY_MANAGER | `/agency/dashboard` |
| DISPATCHER | `/agency/operations` |
| FINANCE_MANAGER | `/finance/dashboard` |
| DRIVER | `/driver/app` (mobile: profile screen) |
| CUSTOMER | `/customer/dashboard` |
| Any agency role while the agency isn't approved, or a driver not yet approved | `/pending-verification` |

## Error codes
| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `details[]` holds per-field messages |
| 400 | `INVALID_OTP` | Wrong or already-used code (`details.attemptsRemaining`) |
| 400 | `OTP_EXPIRED` | Request a new code |
| 400 | `INVALID_VERIFICATION_TOKEN` | Verification expired, mismatched or already used |
| 400 | `INVALID_INVITATION` | Invitation code invalid, expired, used or revoked |
| 401 | `UNAUTHENTICATED` / `INVALID_TOKEN` / `TOKEN_EXPIRED` | Refresh, then retry on `TOKEN_EXPIRED` |
| 401 | `SESSION_REVOKED` / `REFRESH_TOKEN_REUSED` | Sign in again |
| 401 | `INVALID_CREDENTIALS` | Same message for unknown accounts |
| 403 | `FORBIDDEN`, `CSRF_FAILED`, `ACCOUNT_SUSPENDED`, `ACCOUNT_DEACTIVATED`, `ACCOUNT_NOT_VERIFIED`, `AGENCY_NOT_APPROVED`, `AGENCY_MEMBERSHIP_REQUIRED` | |
| 409 | `PHONE_ALREADY_REGISTERED`, `EMAIL_ALREADY_REGISTERED`, `CONFLICT` | |
| 409 | `REFRESH_CONFLICT` | A parallel request already refreshed; retry the original request |
| 423 | `ACCOUNT_LOCKED` | After `MAX_FAILED_LOGINS` failures (`details.retryAfterSeconds`) |
| 429 | `RATE_LIMITED`, `OTP_COOLDOWN` (Retry-After), `OTP_SEND_LIMIT`, `OTP_ATTEMPTS_EXCEEDED` | |
| 502 | `OTP_DELIVERY_FAILED` | SMS/email provider error |
