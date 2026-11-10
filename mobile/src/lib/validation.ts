import { z } from 'zod';

// Client-side mirrors of the backend rules (the backend re-validates everything).

export const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^(\+91|0091|91(?=\d{10}$)|0(?=\d{10}$))/, ''))
  .pipe(z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'));

export const email = z.string().trim().toLowerCase().email('Enter a valid email address');
export const optionalEmail = z.union([email, z.literal('')]).optional();

export const password = z
  .string()
  .min(8, 'At least 8 characters')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/\d/, 'Include a number');

export const fullName = z
  .string()
  .trim()
  .min(2, 'Enter your full name')
  .max(120)
  .regex(/^[\p{L} .'-]+$/u, 'Name contains invalid characters');

export const pan = z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN, e.g. ABCDE1234F');
export const gst = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN');
export const optionalGst = z.union([gst, z.literal('')]).optional();
export const pincode = z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code');
export const place = (label: string) => z.string().trim().min(2, `${label} is required`).max(80);

export const identifier = z
  .string()
  .trim()
  .min(1, 'Enter your mobile number or email')
  .refine((v) => (v.includes('@') ? email.safeParse(v).success : phone.safeParse(v).success), 'Enter a valid mobile number or email');

const matchPasswords = (v: { password?: string; confirmPassword?: string }, ctx: z.RefinementCtx) => {
  if ((v.password ?? '') !== (v.confirmPassword ?? '')) ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'Passwords do not match' });
};

/** Optional password used by OTP-first roles: empty means "sign in with OTP only". */
const optionalPassword = z.union([password, z.literal('')]).optional();

export const loginSchema = z.object({ identifier, password: z.string().min(1, 'Enter your password') });

export const simpleSignupSchema = z.object({ fullName, phone, password });

export const agencyStep1 = z
  .object({
    companyName: z.string().trim().min(2, 'Company name is required').max(160),
    ownerName: fullName,
    phone,
    email,
    password,
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .superRefine(matchPasswords);

export const agencyStep2 = z
  .object({
    gstNumber: optionalGst,
    panNumber: pan,
    address: z.string().trim().min(5, 'Business address is required').max(300),
    city: place('City'),
    state: place('State'),
    pincode,
  })
  .superRefine((v, ctx) => {
    if (v.gstNumber && v.gstNumber.slice(2, 12) !== v.panNumber) {
      ctx.addIssue({ code: 'custom', path: ['gstNumber'], message: 'GSTIN does not match the PAN' });
    }
  });

export const agencyStep3 = z.object({
  acceptTerms: z.boolean().refine((v) => v, 'You must accept the Terms and Conditions'),
});

export const LICENCE_TYPES = [
  { value: 'LMV', label: 'LMV — Light Motor Vehicle' },
  { value: 'HMV', label: 'HMV — Heavy Motor Vehicle' },
  { value: 'HGMV', label: 'HGMV — Heavy Goods Motor Vehicle' },
  { value: 'HTV', label: 'HTV — Heavy Transport Vehicle' },
  { value: 'TRANS', label: 'TRANS — Transport (Hazardous goods)' },
] as const;

export const driverSchema = z
  .object({
    fullName,
    phone,
    email: optionalEmail,
    password: optionalPassword,
    confirmPassword: z.string().optional(),
    invitationCode: z.string().trim().min(8, 'Enter the 8-character code from your agency').max(12),
    licenceNumber: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => v.replace(/[\s-]/g, ''))
      .pipe(z.string().regex(/^[A-Z]{2}\d{13}$/, 'Enter a valid licence number, e.g. MH1420110012345')),
    licenceType: z.enum(['LMV', 'HMV', 'HGMV', 'HTV', 'TRANS'], { errorMap: () => ({ message: 'Select a licence type' }) }),
    licenceExpiry: z
      .string()
      .min(1, 'Enter the expiry date')
      .refine((d) => new Date(d).getTime() > Date.now(), 'Licence has expired'),
  })
  .superRefine(matchPasswords);

export const forgotSchema = z.object({ identifier });

export const resetSchema = z
  .object({ password, confirmPassword: z.string().min(1, 'Confirm your password') })
  .superRefine(matchPasswords);

export const changePasswordSchema = z
  .object({ currentPassword: z.string().optional(), password, confirmPassword: z.string().min(1, 'Confirm your password') })
  .superRefine(matchPasswords);

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
].map((s) => ({ value: s, label: s }));
