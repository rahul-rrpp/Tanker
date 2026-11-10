import { z } from 'zod';
import {
  deviceInfoSchema,
  emailSchema,
  fullNameSchema,
  gstSchema,
  optionalEmailSchema,
  optionalGstSchema,
  otpCodeSchema,
  panSchema,
  passwordSchema,
  phoneSchema,
  pincodeSchema,
} from '../../utils/validators';
import { validateGstin } from '../../utils/gst';

const tokenString = z.string().min(10).max(2000);
const place = (label: string) => z.string().trim().min(2, `${label} is required`).max(80);

const passwordsMatch = <T extends { password?: string; confirmPassword?: string }>(v: T, ctx: z.RefinementCtx) => {
  if ((v.password ?? '') !== (v.confirmPassword ?? '')) {
    ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match' });
  }
};

// ---- OTP (registration / email verification) -------------------------------------------

export const sendOtpSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('SMS'), destination: phoneSchema, purpose: z.literal('REGISTRATION') }),
  z.object({ channel: z.literal('EMAIL'), destination: emailSchema, purpose: z.literal('REGISTRATION') }),
]);

export const verifyOtpSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('SMS'), destination: phoneSchema, purpose: z.literal('REGISTRATION'), code: otpCodeSchema }),
  z.object({ channel: z.literal('EMAIL'), destination: emailSchema, purpose: z.literal('REGISTRATION'), code: otpCodeSchema }),
]);

// ---- Registration --------------------------------------------------------------------

const verificationTokens = {
  phoneVerificationToken: tokenString,
  emailVerificationToken: tokenString.optional(),
  deviceInfo: deviceInfoSchema,
};

export const registerAgencySchema = z
  .object({
    // Step 1 — company
    companyName: z.string().trim().min(2, 'Company name is required').max(160),
    ownerName: fullNameSchema,
    phone: phoneSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    // Step 2 — business
    gstNumber: optionalGstSchema,
    panNumber: panSchema,
    address: z.string().trim().min(5, 'Business address is required').max(300),
    city: place('City'),
    state: place('State'),
    pincode: pincodeSchema,
    // Step 3 — verification
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms and Conditions' }) }),
    ...verificationTokens,
  })
  .superRefine(passwordsMatch)
  .superRefine((v, ctx) => {
    if (v.gstNumber && v.gstNumber.slice(2, 12) !== v.panNumber) {
      ctx.addIssue({ code: 'custom', path: ['gstNumber'], message: 'GSTIN does not match the PAN' });
    }
  });

export const LICENCE_TYPES = ['LMV', 'HMV', 'HGMV', 'HTV', 'TRANS'] as const;

export const registerDriverSchema = z
  .object({
    fullName: fullNameSchema,
    phone: phoneSchema,
    email: optionalEmailSchema,
    password: passwordSchema.optional(),
    confirmPassword: z.string().optional(),
    invitationCode: z.string().trim().min(8, 'Enter the invitation code from your agency').max(12),
    licenceNumber: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => v.replace(/[\s-]/g, ''))
      .pipe(z.string().regex(/^[A-Z]{2}\d{2}\d{4}\d{7}$/, 'Enter a valid licence number, e.g. MH1420110012345')),
    licenceType: z.enum(LICENCE_TYPES),
    licenceExpiry: z.coerce
      .date({ errorMap: () => ({ message: 'Enter a valid expiry date' }) })
      .refine((d) => d.getTime() > Date.now(), 'Licence has expired'),
    ...verificationTokens,
  })
  .superRefine(passwordsMatch);

export const registerCustomerSchema = z
  .object({
    fullName: fullNameSchema,
    phone: phoneSchema,
    email: optionalEmailSchema,
    password: passwordSchema.optional(),
    confirmPassword: z.string().optional(),
    customerType: z.enum(['INDIVIDUAL', 'BUSINESS']),
    businessName: z.string().trim().max(160).optional(),
    gstNumber: optionalGstSchema,
    city: place('City'),
    state: place('State'),
    ...verificationTokens,
  })
  .superRefine(passwordsMatch)
  .superRefine((v, ctx) => {
    if (v.customerType === 'BUSINESS' && (!v.businessName || v.businessName.length < 2)) {
      ctx.addIssue({ code: 'custom', path: ['businessName'], message: 'Business name is required' });
    }
    if (v.customerType === 'INDIVIDUAL' && v.gstNumber) {
      ctx.addIssue({ code: 'custom', path: ['gstNumber'], message: 'GST number applies to business customers only' });
    }
  });

/** Simple signup: name + mobile number + password. Creates an individual customer, no OTP. */
export const registerSimpleSchema = z.object({
  fullName: fullNameSchema,
  phone: phoneSchema,
  password: passwordSchema,
  deviceInfo: deviceInfoSchema,
});

// ---- Login ---------------------------------------------------------------------------

export const loginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your mobile number or email').max(254),
  password: z.string().min(1, 'Password is required').max(128),
  rememberMe: z.boolean().optional(),
  deviceInfo: deviceInfoSchema,
});

export const loginOtpSendSchema = z.object({ phone: phoneSchema });

export const loginOtpVerifySchema = z.object({ phone: phoneSchema, code: otpCodeSchema, rememberMe: z.boolean().optional(), deviceInfo: deviceInfoSchema });

// ---- Session -------------------------------------------------------------------------

/** Mobile clients send the refresh token in the body; web clients rely on the httpOnly cookie. */
export const refreshSchema = z.object({ refreshToken: tokenString.optional() });

// ---- Password ------------------------------------------------------------------------

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().max(128).optional(),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .superRefine(passwordsMatch);

export const forgotPasswordSchema = z.object({ identifier: z.string().trim().min(3).max(254) });

export const resetPasswordSchema = z
  .object({
    identifier: z.string().trim().min(3).max(254),
    code: otpCodeSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .superRefine(passwordsMatch);

// ---- Company (Phase 1 portal) --------------------------------------------------------

export const BUSINESS_TYPES = [
  'MANUFACTURER',
  'TRADER',
  'DISTRIBUTOR',
  'OIL_MARKETING_COMPANY',
  'REFINERY',
  'PETROL_PUMP_DEALER',
  'INDUSTRIAL_CONSUMER',
  'LOGISTICS_PROVIDER',
  'OTHER',
] as const;

export const registerCompanySchema = z
  .object({
    companyName: z.string().trim().min(2, 'Company name is required').max(160),
    contactPersonName: fullNameSchema,
    phone: phoneSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    gstNumber: gstSchema,
    businessType: z.enum(BUSINESS_TYPES, { errorMap: () => ({ message: 'Select a business type' }) }),
    state: place('State'),
    city: place('City'),
    address: z.string().trim().min(5, 'Business address is required').max(300),
    pincode: pincodeSchema,
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms and Conditions' }) }),
    phoneVerificationToken: tokenString,
    emailVerificationToken: tokenString,
    deviceInfo: deviceInfoSchema,
  })
  .superRefine(passwordsMatch)
  .superRefine((v, ctx) => {
    const gst = validateGstin(v.gstNumber, v.state);
    if (!gst.valid) ctx.addIssue({ code: 'custom', path: ['gstNumber'], message: gst.reason });
  });

export const contactChangeSendSchema = z.union([z.object({ phone: phoneSchema }).strict(), z.object({ email: emailSchema }).strict()]);
export const contactChangeVerifySchema = z.union([
  z.object({ phone: phoneSchema, code: otpCodeSchema }).strict(),
  z.object({ email: emailSchema, code: otpCodeSchema }).strict(),
]);

export type RegisterCompanyInput = z.infer<typeof registerCompanySchema>;

const shortList = (max: number) => z.array(z.string().trim().min(1).max(120)).max(max).default([]);

export const registerTransporterSchema = z
  .object({
    companyName: z.string().trim().min(2, 'Transport company name is required').max(160),
    ownerName: fullNameSchema,
    phone: phoneSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    gstNumber: gstSchema,
    panNumber: panSchema,
    businessType: z.string().trim().min(2, 'Select a business type').max(40),
    address: z.string().trim().min(5, 'Registered address is required').max(300),
    city: place('City'),
    state: place('State'),
    pincode: pincodeSchema,
    operatingCities: shortList(100),
    operatingStates: z.array(z.string().trim().min(2).max(80)).min(1, 'Select at least one operating state').max(40),
    preferredRoutes: shortList(100),
    numberOfTankers: z.number().int().min(1, 'Enter your number of tankers').max(100000),
    capacityCategories: shortList(30),
    productCategories: shortList(50),
    bank: z.object({
      accountHolder: z.string().trim().min(2, 'Account holder is required').max(120),
      bankName: z.string().trim().min(2, 'Bank name is required').max(120),
      accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'Enter a valid account number'),
      ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC'),
      accountType: z.enum(['SAVINGS', 'CURRENT']),
    }).strict(),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms and Conditions' }) }),
    phoneVerificationToken: tokenString,
    emailVerificationToken: tokenString,
    deviceInfo: deviceInfoSchema,
  })
  .strict()
  .superRefine(passwordsMatch)
  .superRefine((v, ctx) => {
    const gst = validateGstin(v.gstNumber, v.state);
    if (!gst.valid) ctx.addIssue({ code: 'custom', path: ['gstNumber'], message: gst.reason });
    if (v.gstNumber.slice(2, 12) !== v.panNumber) ctx.addIssue({ code: 'custom', path: ['panNumber'], message: 'PAN must match the PAN inside the GST number' });
  });
export type RegisterTransporterInput = z.infer<typeof registerTransporterSchema>;
export type RegisterAgencyInput = z.infer<typeof registerAgencySchema>;
export type RegisterDriverInput = z.infer<typeof registerDriverSchema>;
export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;
export type RegisterSimpleInput = z.infer<typeof registerSimpleSchema>;
export { gstSchema };
