import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { isAllPortals } from '../../config/portals';
import { AppError } from '../../utils/errors';
import { authenticateUser } from '../../middleware/auth';
import { loginLimiter, otpLimiter, registrationLimiter } from '../../middleware/rateLimit';
import { validateRequest } from '../../middleware/validate';
import * as c from './auth.controller';
import * as s from './auth.schemas';

export const authRouter = Router();

/** Registration flows for portals that are not part of the current release respond 404. */
const legacyPortal: RequestHandler = (_req, _res, next) =>
  isAllPortals() ? next() : next(AppError.notFound('This registration is not available'));

/**
 * POST /auth/register — Company registration (Phase 1). For backward compatibility with the existing
 * mobile client, a body without `companyName` is treated as the legacy individual signup, which is
 * only available when ENABLED_PORTALS=all.
 */
const registerDispatch: RequestHandler = (req, res, next) => {
  const isCompany = typeof (req.body as { companyName?: unknown } | undefined)?.companyName === 'string';
  if (isCompany) return validateRequest({ body: s.registerCompanySchema })(req, res, (err?: unknown) => (err ? next(err) : Promise.resolve(c.registerCompany(req, res)).catch(next)));
  return legacyPortal(req, res, (err?: unknown) =>
    err ? next(err) : validateRequest({ body: s.registerSimpleSchema })(req, res, (e?: unknown) => (e ? next(e) : Promise.resolve(c.registerSimple(req, res)).catch(next))),
  );
};

// Registration
authRouter.post('/register', registrationLimiter, registerDispatch);
authRouter.post('/register/company', registrationLimiter, validateRequest({ body: s.registerCompanySchema }), c.registerCompany);
authRouter.post('/register/agency', registrationLimiter, legacyPortal, validateRequest({ body: s.registerAgencySchema }), c.registerAgency);
authRouter.post('/register/driver', registrationLimiter, legacyPortal, validateRequest({ body: s.registerDriverSchema }), c.registerDriver);
authRouter.post('/register/customer', registrationLimiter, legacyPortal, validateRequest({ body: s.registerCustomerSchema }), c.registerCustomer);

// OTP (registration verification). Re-sending is the same call, subject to the cooldown.
authRouter.post('/otp/send', otpLimiter, validateRequest({ body: s.sendOtpSchema }), c.sendOtp);
authRouter.post('/otp/resend', otpLimiter, validateRequest({ body: s.sendOtpSchema }), c.sendOtp);
authRouter.post('/otp/verify', otpLimiter, validateRequest({ body: s.verifyOtpSchema }), c.verifyOtpHandler);
// Spec aliases (same behaviour as /otp/send and /otp/verify).
authRouter.post('/send-otp', otpLimiter, validateRequest({ body: s.sendOtpSchema }), c.sendOtp);
authRouter.post('/verify-otp', otpLimiter, validateRequest({ body: s.verifyOtpSchema }), c.verifyOtpHandler);

// Login
authRouter.post('/login', loginLimiter, validateRequest({ body: s.loginSchema }), c.login);
authRouter.post('/login/otp/send', otpLimiter, validateRequest({ body: s.loginOtpSendSchema }), c.loginOtpSend);
authRouter.post('/login/otp/verify', loginLimiter, validateRequest({ body: s.loginOtpVerifySchema }), c.loginOtpVerify);

// Session
authRouter.post('/refresh', loginLimiter, validateRequest({ body: s.refreshSchema }), c.refresh);
authRouter.post('/logout', validateRequest({ body: s.refreshSchema }), c.logout);
authRouter.post('/logout-all', authenticateUser, c.logoutAll);
authRouter.get('/me', authenticateUser, c.me);
authRouter.get('/profile', authenticateUser, c.me);
authRouter.get('/login-history', authenticateUser, c.loginHistory);
authRouter.post('/contact/send-otp', otpLimiter, authenticateUser, validateRequest({ body: s.contactChangeSendSchema }), c.contactChangeSend);
authRouter.post('/contact/verify', otpLimiter, authenticateUser, validateRequest({ body: s.contactChangeVerifySchema }), c.contactChangeVerify);
authRouter.get('/sessions', authenticateUser, c.sessions);
authRouter.delete(
  '/sessions/:sessionId',
  authenticateUser,
  validateRequest({ params: z.object({ sessionId: z.string().uuid() }) }),
  c.revokeSession,
);

// Passwords
authRouter.post('/change-password', authenticateUser, validateRequest({ body: s.changePasswordSchema }), c.changePassword);
authRouter.post('/forgot-password', otpLimiter, validateRequest({ body: s.forgotPasswordSchema }), c.forgotPassword);
authRouter.post('/reset-password', loginLimiter, validateRequest({ body: s.resetPasswordSchema }), c.resetPassword);
