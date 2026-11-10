/**
 * OpenAPI 3.1 description of the TTMS authentication API, served at /api/docs.
 */
type Schema = Record<string, unknown>;

const str = (extra: Schema = {}): Schema => ({ type: 'string', ...extra });
const obj = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

const phone = str({ example: '9876543210', description: '10-digit Indian mobile number (+91 prefix accepted)' });
const password = str({ format: 'password', minLength: 8, description: 'Min 8 chars with upper, lower case and a digit' });

const success = (data: Schema, description = 'Success'): Schema => ({
  description,
  content: {
    'application/json': {
      schema: obj({ success: { type: 'boolean', const: true }, message: str(), data }, ['success', 'message', 'data']),
    },
  },
});
const error = (description: string): Schema => ({
  description,
  content: { 'application/json': { schema: ref('ErrorResponse') } },
});
const body = (schema: Schema): Schema => ({ required: true, content: { 'application/json': { schema } } });

const commonErrors = {
  400: error('Validation error (VALIDATION_ERROR) or bad request'),
  429: error('Rate limited (RATE_LIMITED, OTP_COOLDOWN, OTP_SEND_LIMIT)'),
};
const authErrors = {
  401: error('UNAUTHENTICATED / TOKEN_EXPIRED / INVALID_TOKEN / SESSION_REVOKED'),
  403: error('FORBIDDEN / ACCOUNT_SUSPENDED / CSRF_FAILED / AGENCY_NOT_APPROVED'),
};
const secured = [{ bearerAuth: [] }, { cookieAuth: [] }];

const op = (tag: string, summary: string, o: Schema = {}): Schema => ({ tags: [tag], summary, ...o });

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'TTMS Authentication API',
    version: '1.0.0',
    description: [
      'Centralised authentication for the Tanker Transport Management System (web and mobile).',
      '',
      '**Web clients** receive tokens as httpOnly cookies (`ttms_at`, `ttms_rt`) plus a readable `ttms_csrf` cookie. State-changing requests that rely on cookies must send `X-CSRF-Token` equal to the `ttms_csrf` cookie.',
      '',
      '**Mobile clients** send `X-Client-Type: mobile` and receive `accessToken` + `refreshToken` in the response body. Send the access token as `Authorization: Bearer <token>` and the refresh token in the body of `/auth/refresh` and `/auth/logout`.',
      '',
      'All responses use the envelope `{ success, message, data }` or `{ success: false, message, error: { code, details? } }`.',
    ].join('\n'),
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    { name: 'Registration' },
    { name: 'OTP' },
    { name: 'Login' },
    { name: 'Session' },
    { name: 'Password' },
    { name: 'Profile' },
    { name: 'Agency' },
    { name: 'Admin' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'ttms_at' },
    },
    parameters: {
      ClientType: {
        name: 'X-Client-Type',
        in: 'header',
        required: false,
        schema: { type: 'string', enum: ['web', 'mobile'] },
        description: 'Send "mobile" to receive tokens in the body instead of cookies',
      },
    },
    schemas: {
      ErrorResponse: obj(
        {
          success: { type: 'boolean', const: false },
          message: str(),
          error: obj({ code: str({ example: 'INVALID_CREDENTIALS' }), details: {} }, ['code']),
        },
        ['success', 'message', 'error'],
      ),
      RoleName: { type: 'string', enum: ['SUPER_ADMIN', 'AGENCY_OWNER', 'AGENCY_MANAGER', 'DISPATCHER', 'FINANCE_MANAGER', 'DRIVER', 'CUSTOMER'] },
      VerificationStatus: { type: 'string', enum: ['PENDING_VERIFICATION', 'APPROVED', 'REJECTED', 'SUSPENDED'] },
      User: obj({
        id: str({ format: 'uuid' }),
        fullName: str(),
        email: str({ nullable: true }),
        phone: str(),
        roles: { type: 'array', items: ref('RoleName') },
        permissions: { type: 'array', items: str() },
        accountStatus: { type: 'string', enum: ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] },
        isPhoneVerified: { type: 'boolean' },
        isEmailVerified: { type: 'boolean' },
        agency: {
          oneOf: [
            { type: 'null' },
            obj({ id: str(), companyName: str(), verificationStatus: ref('VerificationStatus'), memberRole: ref('RoleName') }),
          ],
        },
        driverVerificationStatus: { oneOf: [{ type: 'null' }, ref('VerificationStatus')] },
      }),
      AuthData: obj(
        {
          accessToken: str(),
          accessTokenExpiresIn: { type: 'integer', description: 'seconds' },
          refreshToken: str({ description: 'Mobile clients only' }),
          refreshTokenExpiresAt: str({ format: 'date-time', description: 'Mobile clients only' }),
          sessionId: str({ format: 'uuid' }),
          user: ref('User'),
          redirectTo: str({ example: '/agency/dashboard' }),
        },
        ['accessToken', 'user', 'redirectTo'],
      ),
      OtpSent: obj({
        destination: str({ example: '******3210' }),
        channel: str(),
        expiresInSeconds: { type: 'integer' },
        resendAfterSeconds: { type: 'integer' },
      }),
    },
  },
  paths: {
    '/auth/otp/send': {
      post: op('OTP', 'Send a registration OTP (SMS or email). Also used to resend, subject to cooldown.', {
        requestBody: body(obj({ channel: { enum: ['SMS', 'EMAIL'] }, destination: str(), purpose: { enum: ['REGISTRATION'] } }, ['channel', 'destination', 'purpose'])),
        responses: { 200: success(ref('OtpSent')), 409: error('PHONE_ALREADY_REGISTERED / EMAIL_ALREADY_REGISTERED'), 502: error('OTP_DELIVERY_FAILED'), ...commonErrors },
      }),
    },
    '/auth/otp/resend': { post: op('OTP', 'Alias of /auth/otp/send', { responses: { 200: success(ref('OtpSent')) } }) },
    '/auth/otp/verify': {
      post: op('OTP', 'Verify a registration OTP and obtain a single-use verification token', {
        requestBody: body(obj({ channel: { enum: ['SMS', 'EMAIL'] }, destination: str(), purpose: { enum: ['REGISTRATION'] }, code: str({ example: '123456' }) }, ['channel', 'destination', 'purpose', 'code'])),
        responses: {
          200: success(obj({ verificationToken: str() })),
          400: error('INVALID_OTP (details.attemptsRemaining) / OTP_EXPIRED'),
          429: error('OTP_ATTEMPTS_EXCEEDED'),
        },
      }),
    },
    '/auth/register/agency': {
      post: op('Registration', 'Register a transport agency (owner account + agency in PENDING_VERIFICATION)', {
        parameters: [{ $ref: '#/components/parameters/ClientType' }],
        requestBody: body(
          obj(
            {
              companyName: str(), ownerName: str(), phone, email: str({ format: 'email' }), password, confirmPassword: str(),
              gstNumber: str({ example: '27ABCDE1234F1Z5' }), panNumber: str({ example: 'ABCDE1234F' }), address: str(), city: str(), state: str(), pincode: str({ example: '400001' }),
              acceptTerms: { type: 'boolean', const: true }, phoneVerificationToken: str(), emailVerificationToken: str(), deviceInfo: str(),
            },
            ['companyName', 'ownerName', 'phone', 'email', 'password', 'confirmPassword', 'panNumber', 'address', 'city', 'state', 'pincode', 'acceptTerms', 'phoneVerificationToken'],
          ),
        ),
        responses: { 201: success(ref('AuthData')), 409: error('Duplicate phone/email/PAN/GST'), ...commonErrors },
      }),
    },
    '/auth/register/driver': {
      post: op('Registration', 'Register a driver using an agency invitation code', {
        parameters: [{ $ref: '#/components/parameters/ClientType' }],
        requestBody: body(
          obj(
            {
              fullName: str(), phone, email: str(), password: { ...password, description: 'Optional — omit for OTP-only login' }, confirmPassword: str(),
              invitationCode: str({ example: 'K7QM-2XPA' }), licenceNumber: str({ example: 'MH1420110012345' }),
              licenceType: { enum: ['LMV', 'HMV', 'HGMV', 'HTV', 'TRANS'] }, licenceExpiry: str({ format: 'date' }),
              phoneVerificationToken: str(), emailVerificationToken: str(), deviceInfo: str(),
            },
            ['fullName', 'phone', 'invitationCode', 'licenceNumber', 'licenceType', 'licenceExpiry', 'phoneVerificationToken'],
          ),
        ),
        responses: { 201: success(ref('AuthData')), 400: error('INVALID_INVITATION / validation'), 409: error('Duplicate phone/email/licence') },
      }),
    },
    '/auth/register': {
      post: op('Registration', 'Simple signup: name + mobile number + password (creates an individual customer, no OTP)', {
        parameters: [{ $ref: '#/components/parameters/ClientType' }],
        requestBody: body(obj({ fullName: str(), phone, password, deviceInfo: str() }, ['fullName', 'phone', 'password'])),
        responses: { 201: success(ref('AuthData')), 409: error('Duplicate phone'), ...commonErrors },
      }),
    },
    '/auth/register/customer': {
      post: op('Registration', 'Register a customer (individual or business)', {
        parameters: [{ $ref: '#/components/parameters/ClientType' }],
        requestBody: body(
          obj(
            {
              fullName: str(), phone, email: str(), password, confirmPassword: str(), customerType: { enum: ['INDIVIDUAL', 'BUSINESS'] },
              businessName: str(), gstNumber: str(), city: str(), state: str(), phoneVerificationToken: str(), emailVerificationToken: str(), deviceInfo: str(),
            },
            ['fullName', 'phone', 'customerType', 'city', 'state', 'phoneVerificationToken'],
          ),
        ),
        responses: { 201: success(ref('AuthData')), 409: error('Duplicate phone/email'), ...commonErrors },
      }),
    },
    '/auth/login': {
      post: op('Login', 'Login with email or mobile number + password', {
        parameters: [{ $ref: '#/components/parameters/ClientType' }],
        requestBody: body(obj({ identifier: str({ example: '9876543210' }), password: str(), deviceInfo: str() }, ['identifier', 'password'])),
        responses: {
          200: success(ref('AuthData'), 'Login successful'),
          401: error('INVALID_CREDENTIALS'),
          403: error('ACCOUNT_SUSPENDED / ACCOUNT_DEACTIVATED'),
          423: error('ACCOUNT_LOCKED (details.retryAfterSeconds)'),
          ...commonErrors,
        },
      }),
    },
    '/auth/login/otp/send': {
      post: op('Login', 'Send a login OTP to a registered mobile number (response is identical for unknown numbers)', {
        requestBody: body(obj({ phone }, ['phone'])),
        responses: { 200: success(obj({ expiresInSeconds: { type: 'integer' }, resendAfterSeconds: { type: 'integer' } })), ...commonErrors },
      }),
    },
    '/auth/login/otp/verify': {
      post: op('Login', 'Login with mobile number + OTP', {
        parameters: [{ $ref: '#/components/parameters/ClientType' }],
        requestBody: body(obj({ phone, code: str(), deviceInfo: str() }, ['phone', 'code'])),
        responses: { 200: success(ref('AuthData')), 400: error('INVALID_OTP / OTP_EXPIRED'), 403: error('ACCOUNT_SUSPENDED'), 429: error('OTP_ATTEMPTS_EXCEEDED') },
      }),
    },
    '/auth/refresh': {
      post: op('Session', 'Rotate the refresh token and obtain a new access token', {
        description: 'Web: uses the `ttms_rt` cookie (send X-CSRF-Token). Mobile: send `refreshToken` in the body. Re-using a rotated token revokes the whole session (REFRESH_TOKEN_REUSED). A 409 REFRESH_CONFLICT means a parallel request already refreshed — retry the original request.',
        requestBody: { content: { 'application/json': { schema: obj({ refreshToken: str() }) } } },
        responses: { 200: success(ref('AuthData')), 401: error('INVALID_TOKEN / SESSION_REVOKED / REFRESH_TOKEN_REUSED'), 409: error('REFRESH_CONFLICT') },
      }),
    },
    '/auth/logout': {
      post: op('Session', 'Log out the current device', {
        requestBody: { content: { 'application/json': { schema: obj({ refreshToken: str() }) } } },
        responses: { 200: success({ type: 'null' }) },
      }),
    },
    '/auth/logout-all': { post: op('Session', 'Log out from all devices', { security: secured, responses: { 200: success(obj({ sessionsRevoked: { type: 'integer' } })), ...authErrors } }) },
    '/auth/me': { get: op('Session', 'Current user, roles, permissions and landing route', { security: secured, responses: { 200: success(obj({ user: ref('User'), redirectTo: str(), sessionId: str() })), ...authErrors } }) },
    '/auth/sessions': { get: op('Session', 'List active sessions/devices', { security: secured, responses: { 200: success(obj({ sessions: { type: 'array', items: obj({ id: str(), clientType: str(), deviceInfo: str(), ipAddress: str(), createdAt: str(), current: { type: 'boolean' } }) } })), ...authErrors } }) },
    '/auth/sessions/{sessionId}': {
      delete: op('Session', 'Revoke one of your sessions', {
        security: secured,
        parameters: [{ name: 'sessionId', in: 'path', required: true, schema: str({ format: 'uuid' }) }],
        responses: { 200: success({ type: 'null' }), 404: error('Not found'), ...authErrors },
      }),
    },
    '/auth/change-password': {
      post: op('Password', 'Change password (signs out all other devices)', {
        security: secured,
        requestBody: body(obj({ currentPassword: str(), password, confirmPassword: str() }, ['password', 'confirmPassword'])),
        responses: { 200: success(obj({ otherSessionsRevoked: { type: 'integer' } })), 400: error('INVALID_CREDENTIALS / validation'), ...authErrors },
      }),
    },
    '/auth/forgot-password': {
      post: op('Password', 'Send a password reset code to a registered phone/email', {
        requestBody: body(obj({ identifier: str() }, ['identifier'])),
        responses: { 200: success(obj({ expiresInSeconds: { type: 'integer' } })), ...commonErrors },
      }),
    },
    '/auth/reset-password': {
      post: op('Password', 'Reset password with the OTP (signs out all devices)', {
        requestBody: body(obj({ identifier: str(), code: str(), password, confirmPassword: str() }, ['identifier', 'code', 'password', 'confirmPassword'])),
        responses: { 200: success({ type: 'null' }), 400: error('INVALID_OTP / OTP_EXPIRED') },
      }),
    },
    '/users/profile': {
      get: op('Profile', 'Get own profile (user, agency, driver or customer details)', { security: secured, responses: { 200: success(obj({ profile: {} })), ...authErrors } }),
      patch: op('Profile', 'Update own profile (name, email, customer details). Phone, roles and agency cannot be changed.', {
        security: secured,
        requestBody: body(obj({ fullName: str(), email: str(), customer: obj({ businessName: str(), gstNumber: str(), city: str(), state: str() }) })),
        responses: { 200: success(obj({ profile: {} })), 409: error('EMAIL_ALREADY_REGISTERED'), ...authErrors },
      }),
    },
    '/users/email/send-otp': { post: op('Profile', 'Send a code to verify the email on your profile', { security: secured, responses: { 200: success(ref('OtpSent')), ...authErrors } }) },
    '/users/email/verify': { post: op('Profile', 'Verify your email with the code', { security: secured, requestBody: body(obj({ code: str() }, ['code'])), responses: { 200: success(obj({ profile: {} })), ...authErrors } }) },
    '/agency/registration-status': {
      get: op('Agency', 'Agency registration/verification status (agency owner)', {
        security: secured,
        responses: { 200: success(obj({ agency: obj({ id: str(), companyName: str(), verificationStatus: ref('VerificationStatus'), rejectionReason: str() }), statusMessage: str() })), ...authErrors },
      }),
    },
    '/agency/members': {
      get: op('Agency', 'List agency staff (approved agencies only)', { security: secured, responses: { 200: success(obj({ members: { type: 'array', items: {} } })), ...authErrors } }),
      post: op('Agency', 'Create a staff account (AGENCY_MANAGER, DISPATCHER, FINANCE_MANAGER). Staff activate by OTP login.', {
        security: secured,
        requestBody: body(obj({ fullName: str(), phone, email: str(), role: { enum: ['AGENCY_MANAGER', 'DISPATCHER', 'FINANCE_MANAGER'] } }, ['fullName', 'phone', 'role'])),
        responses: { 201: success(obj({ member: {} })), 409: error('Duplicate'), ...authErrors },
      }),
    },
    '/agency/members/{memberId}/status': {
      patch: op('Agency', 'Activate/deactivate a staff member in your agency', {
        security: secured,
        parameters: [{ name: 'memberId', in: 'path', required: true, schema: str({ format: 'uuid' }) }],
        requestBody: body(obj({ status: { enum: ['ACTIVE', 'INACTIVE'] } }, ['status'])),
        responses: { 200: success(obj({ member: {} })), 404: error('Not found (or another agency\'s member)'), ...authErrors },
      }),
    },
    '/agency/invitations': {
      get: op('Agency', 'List driver invitation codes (hints only)', { security: secured, responses: { 200: success(obj({ invitations: { type: 'array', items: {} } })), ...authErrors } }),
      post: op('Agency', 'Create a driver invitation code (shown once)', {
        security: secured,
        requestBody: body(obj({ maxUses: { type: 'integer', minimum: 1, maximum: 50 }, expiresInDays: { type: 'integer', minimum: 1, maximum: 30 } })),
        responses: { 201: success(obj({ invitation: obj({ id: str(), code: str({ example: 'K7QM-2XPA' }), expiresAt: str() }) })), ...authErrors },
      }),
    },
    '/agency/invitations/{invitationId}': {
      delete: op('Agency', 'Revoke an invitation code', { security: secured, parameters: [{ name: 'invitationId', in: 'path', required: true, schema: str({ format: 'uuid' }) }], responses: { 200: success({ type: 'null' }), 404: error('Not found'), ...authErrors } }),
    },
    '/agency/drivers': { get: op('Agency', 'List drivers in your agency', { security: secured, responses: { 200: success(obj({ drivers: { type: 'array', items: {} } })), ...authErrors } }) },
    '/agency/drivers/{driverId}/verification': {
      patch: op('Agency', 'Approve, reject or suspend a driver in your agency', {
        security: secured,
        parameters: [{ name: 'driverId', in: 'path', required: true, schema: str({ format: 'uuid' }) }],
        requestBody: body(obj({ status: { enum: ['APPROVED', 'REJECTED', 'SUSPENDED'] } }, ['status'])),
        responses: { 200: success(obj({ driver: {} })), 404: error('Not found (or another agency\'s driver)'), ...authErrors },
      }),
    },
    '/admin/agencies': {
      get: op('Admin', 'List agencies (Super Admin)', {
        security: secured,
        parameters: [
          { name: 'status', in: 'query', schema: ref('VerificationStatus') },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { 200: success(obj({ agencies: { type: 'array', items: {} }, total: { type: 'integer' } })), ...authErrors },
      }),
    },
    '/admin/agencies/{agencyId}/verification': {
      patch: op('Admin', 'Approve, reject or suspend an agency (Super Admin)', {
        security: secured,
        parameters: [{ name: 'agencyId', in: 'path', required: true, schema: str({ format: 'uuid' }) }],
        requestBody: body(obj({ status: { enum: ['APPROVED', 'REJECTED', 'SUSPENDED'] }, reason: str() }, ['status'])),
        responses: { 200: success(obj({ agency: {} })), 404: error('Not found'), ...authErrors },
      }),
    },
    '/admin/users/{userId}/status': {
      patch: op('Admin', 'Suspend, deactivate or reactivate a user (Super Admin)', {
        security: secured,
        parameters: [{ name: 'userId', in: 'path', required: true, schema: str({ format: 'uuid' }) }],
        requestBody: body(obj({ accountStatus: { enum: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] } }, ['accountStatus'])),
        responses: { 200: success(obj({ userId: str(), accountStatus: str() })), ...authErrors },
      }),
    },
  },
} as const;
