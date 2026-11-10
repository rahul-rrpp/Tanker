/**
 * GSTIN validation (format + check digit + state code).
 * Format: 2-digit state code, 10-char PAN, entity number (1-9/A-Z), 'Z', check character.
 */

export const INDIAN_STATES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
];

const STATE_BY_CODE = new Map(INDIAN_STATES.map((s) => [s.code, s.name]));
const CODE_BY_STATE = new Map(INDIAN_STATES.map((s) => [s.name.toLowerCase(), s.code]));
// Legacy codes still present on older registrations.
STATE_BY_CODE.set('25', 'Dadra and Nagar Haveli and Daman and Diu');
STATE_BY_CODE.set('28', 'Andhra Pradesh');

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const GSTIN_PATTERN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Computes the GSTIN check character for the first 14 characters. */
export function gstCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const value = CHARS.indexOf(first14[i]);
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function stateCodeFor(stateName: string): string | undefined {
  return CODE_BY_STATE.get(stateName.trim().toLowerCase());
}

export function stateNameFor(code: string): string | undefined {
  return STATE_BY_CODE.get(code);
}

export type GstCheck = { valid: true; stateCode: string; stateName: string; pan: string } | { valid: false; reason: string };

export function validateGstin(raw: string, expectedState?: string): GstCheck {
  const gst = raw.trim().toUpperCase();
  if (!GSTIN_PATTERN.test(gst)) return { valid: false, reason: 'Enter a valid 15-character GSTIN, e.g. 27AAPFU0939F1ZV' };
  const stateCode = gst.slice(0, 2);
  const stateName = STATE_BY_CODE.get(stateCode);
  if (!stateName) return { valid: false, reason: 'GSTIN has an invalid state code' };
  if (gstCheckChar(gst.slice(0, 14)) !== gst[14]) return { valid: false, reason: 'GSTIN check digit is invalid. Please re-check the number.' };
  if (expectedState) {
    const expectedCode = stateCodeFor(expectedState);
    if (expectedCode && expectedCode !== stateCode && !(stateCode === '28' && expectedCode === '37') && !(stateCode === '25' && expectedCode === '26')) {
      return { valid: false, reason: `GSTIN is registered in ${stateName}, not ${expectedState}` };
    }
  }
  return { valid: true, stateCode, stateName, pan: gst.slice(2, 12) };
}

/** Builds a checksum-valid GSTIN (used by seeds and tests). */
export function buildGstin(stateCode: string, pan: string, entity = '1'): string {
  const first14 = `${stateCode}${pan}${entity}Z`;
  return first14 + gstCheckChar(first14);
}
