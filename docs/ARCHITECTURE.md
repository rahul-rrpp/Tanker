# Architecture & security design

## Data model (backend/prisma/schema.prisma)

| Model | Purpose |
|---|---|
| `User` | Identity: phone (unique, 10 digits), email (unique, lower-case), argon2id `passwordHash` (optional for OTP-only users), verification flags, `accountStatus`, lockout counters |
| `Role`, `Permission`, `RolePermission`, `UserRole` | RBAC. Seeded from `src/config/rbac.ts` by `npm run db:seed` |
| `Agency` | Tenant. Unique PAN/GST, `verificationStatus` (PENDING_VERIFICATION → APPROVED / REJECTED / SUSPENDED), audit of who verified it |
| `AgencyMember` | User ↔ agency with the in-agency role. A user belongs to at most one agency |
| `AgencyInvitation` | Driver invitation codes (HMAC-hashed), with `maxUses`, expiry and revocation |
| `Driver`, `Customer` | Role profiles |
| `OTPVerification` | HMAC-hashed codes, attempts, expiry, `verifiedAt` / `consumedAt` / `invalidated` |
| `RefreshSession` | HMAC-hashed refresh tokens grouped in a rotation `familyId`, device/IP/UA, revocation reason |
| `LoginAudit` | Login success/failure, lockouts, logouts, refresh reuse, password changes, registrations |

Registrations run in a single DB transaction: consume the verification, create the user and role, then the profile, agency and membership.

## Tokens & sessions

- **Access token**: HS256 JWT, 15 min, claims `{sub, sid, typ:"access"}`. `sid` is the session family id. Every request checks that the family still has a live row and loads roles/permissions/agency **from the DB**, so suspensions, approvals and logouts take effect immediately.
- **Refresh token**: 48 random bytes, stored as `HMAC-SHA256(JWT_REFRESH_SECRET, token)`. Every refresh rotates it and links old → new.
  - Presenting a rotated token **more than 10 s** later is treated as theft: the whole family is revoked, an audit row is written, and the response is `401 REFRESH_TOKEN_REUSED`.
  - Within 10 s it is treated as a benign race (two tabs): `409 REFRESH_CONFLICT`, nothing is revoked, and the client retries.
- **Logout** revokes the family. **Logout-all** revokes every family for the user. Password change revokes other families. Password reset, suspension and membership deactivation revoke all of them.
- **Web**: Next.js rewrites `/api/v1/*` to the backend, so cookies are first-party. `middleware.ts` redirects anonymous users and rotates the session server-side when the access cookie has expired. Protected layouts call `/auth/me` server-side and enforce roles and agency approval. The axios client does a single-flight refresh on 401.
- **Mobile**: refresh token in `expo-secure-store` (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), access token in memory only (never AsyncStorage). A single-flight refresh promise is shared by all concurrent 401s. Network errors never wipe the session, and `SESSION_REVOKED` / `REFRESH_TOKEN_REUSED` clear it. The session is restored at launch, with a retry screen when offline.

## OTP

- 6-digit codes from `crypto.randomInt`, stored as `HMAC(OTP_HASH_SECRET, otpId:code)` and compared in constant time.
- 5 min expiry, 45 s resend cooldown (`Retry-After`), 5 sends per destination per hour, 5 attempts. Attempts are reserved atomically so parallel guesses can't exceed the limit.
- Sending a new code invalidates the previous one. A verified code can't be verified again. Registration verifications issue a short-lived JWT that is **consumed** inside the registration transaction (`consumedAt`), so it can't be replayed.
- Provider abstraction: `SmsOtpProvider` / `EmailOtpProvider` with `msg91`, `twilio`, `smtp` and a clearly marked `mock`. The mock is rejected by env validation in production and refuses to construct there.

## Middleware

`authenticateUser`, `authorizeRoles(...)`, `authorizePermissions(...)`, `requireAgencyMembership({requireApproved})`, `requireVerifiedAccount`, `validateRequest({body,query,params})`, `csrfProtection`, rate limiters, and the centralised `errorHandler` (including mapping Prisma unique violations to 409 codes).

## Other controls

Helmet, a strict CORS allow-list, a 100 kB body limit, argon2id (OWASP params) with a timing-equalised check for unknown users, account lockout, IP rate limiting, generic responses for login, OTP-login and forgot-password (no account enumeration), strict profile schema (no mass assignment), tenant-scoped queries (`where: {id, agencyId}`) returning 404 across tenants, pino log redaction of auth headers, cookies, passwords and codes, and open-redirect protection on `?next=`.
