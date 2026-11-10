// End-to-end check of the web auth flow through the Next.js proxy + middleware (as a browser would).
import { readFileSync } from 'node:fs';

const WEB = 'http://localhost:3000';
const BACKEND_LOG = process.argv[2];
const jar = new Map();
let pass = 0, fail = 0;

const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
function absorb(res) {
  for (const c of res.headers.getSetCookie()) {
    const [pair, ...attrs] = c.split(';');
    const i = pair.indexOf('=');
    const name = pair.slice(0, i), value = pair.slice(i + 1);
    const expired = attrs.some((a) => /expires=Thu, 01 Jan 1970/i.test(a) || /max-age=0/i.test(a.trim()));
    if (!value || expired) jar.delete(name); else jar.set(name, value);
  }
}
async function req(method, path, body) {
  const headers = { cookie: cookieHeader(), origin: WEB };
  if (body) headers['content-type'] = 'application/json';
  if (jar.get('ttms_csrf') && method !== 'GET') headers['x-csrf-token'] = decodeURIComponent(jar.get('ttms_csrf'));
  const res = await fetch(WEB + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  absorb(res);
  return res;
}
function check(name, cond, extra = '') {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
}
const otpFor = (dest) => {
  const m = [...readFileSync(BACKEND_LOG, 'utf8').matchAll(new RegExp(`code for ${dest}: (\\d{6})`, 'g'))];
  return m.at(-1)?.[1];
};
const rand = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loc = (r) => r.headers.get('location') ?? '';

async function verifyPhone(phone) {
  await req('POST', '/api/v1/auth/otp/send', { channel: 'SMS', destination: phone, purpose: 'REGISTRATION' });
  await sleep(300);
  const r = await req('POST', '/api/v1/auth/otp/verify', { channel: 'SMS', destination: phone, purpose: 'REGISTRATION', code: otpFor(phone) });
  return (await r.json()).data.verificationToken;
}

// 1. Unauthenticated access to a protected page
let r = await req('GET', '/agency/dashboard');
check('anonymous /agency/dashboard redirects to login', r.status === 307 && loc(r).includes('/login?next=%2Fagency%2Fdashboard'), `${r.status} ${loc(r)}`);
r = await req('GET', '/login');
check('login page renders', r.status === 200 && (await r.text()).includes('Welcome back'));
for (const p of ['/signup', '/signup/agency', '/signup/driver', '/signup/customer', '/forgot-password', '/unauthorized', '/terms']) {
  r = await req('GET', p);
  check(`${p} renders`, r.status === 200, String(r.status));
}

// 2. Customer signup through the proxy
const phone = rand();
const token = await verifyPhone(phone);
check('registration OTP verified via proxy', Boolean(token));
r = await req('POST', '/api/v1/auth/register/customer', {
  fullName: 'Web Tester', phone, password: 'Str0ngPass!', confirmPassword: 'Str0ngPass!', customerType: 'INDIVIDUAL',
  city: 'Pune', state: 'Maharashtra', phoneVerificationToken: token,
});
let body = await r.json();
check('customer registered', r.status === 201 && body.data.redirectTo === '/customer/dashboard', `${r.status} ${body.message}`);
check('refresh token not exposed to web JS', body.data.refreshToken === undefined && jar.has('ttms_rt') && jar.has('ttms_at') && jar.has('ttms_csrf'));

r = await req('GET', '/customer/dashboard');
check('customer dashboard renders server-side', r.status === 200 && (await r.text()).includes('Hello, Web'), String(r.status));
r = await req('GET', '/admin/dashboard');
check('customer blocked from admin → /unauthorized', r.status === 307 && loc(r).endsWith('/unauthorized'), `${r.status} ${loc(r)}`);
r = await req('GET', '/login');
check('signed-in user visiting /login is sent to dashboard', r.status === 307 && loc(r).endsWith('/customer/dashboard'), loc(r));

// 3. CSRF enforced through the proxy
r = await fetch(WEB + '/api/v1/auth/logout-all', { method: 'POST', headers: { cookie: cookieHeader() }, redirect: 'manual' });
check('mutation without CSRF header rejected', r.status === 403, String(r.status));

// 4. Expired access cookie → middleware refreshes transparently
const oldRt = jar.get('ttms_rt');
jar.delete('ttms_at');
r = await req('GET', '/customer/dashboard');
check('middleware refreshes session when access cookie expired', r.status === 200 && jar.has('ttms_at') && jar.get('ttms_rt') !== oldRt, String(r.status));
r = await req('GET', '/account');
check('account page lists sessions', r.status === 200 && (await r.text()).includes('Active sessions'));

// 5. Client-side refresh endpoint via proxy
r = await req('POST', '/api/v1/auth/refresh', {});
check('client refresh via proxy works', r.status === 200, String(r.status));

// 6. Password login + logout
jar.clear();
r = await req('POST', '/api/v1/auth/login', { identifier: phone, password: 'wrong-Pass1' });
check('wrong password rejected', r.status === 401);
r = await req('POST', '/api/v1/auth/login', { identifier: phone, password: 'Str0ngPass!' });
check('password login works', r.status === 200 && (await r.json()).data.redirectTo === '/customer/dashboard');
r = await req('POST', '/api/v1/auth/logout', {});
check('logout clears cookies', r.status === 200 && !jar.has('ttms_rt'));
r = await req('GET', '/customer/dashboard');
check('after logout protected page redirects to login', r.status === 307 && loc(r).includes('/login'), loc(r));

// 7. OTP login
await req('POST', '/api/v1/auth/login/otp/send', { phone });
await sleep(300);
r = await req('POST', '/api/v1/auth/login/otp/verify', { phone, code: otpFor(phone) });
check('OTP login works', r.status === 200, String(r.status));
r = await req('GET', '/verify-otp?phone=' + phone);
check('verify-otp page redirects signed-in user', r.status === 307);

// 8. Agency signup → pending verification
jar.clear();
const aPhone = rand();
const aToken = await verifyPhone(aPhone);
const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const pan = Array.from({ length: 5 }, () => L[Math.floor(Math.random() * 24)]).join('') + String(Math.floor(Math.random() * 1e4)).padStart(4, '0') + 'K';
r = await req('POST', '/api/v1/auth/register/agency', {
  companyName: 'E2E Water Tankers', ownerName: 'Agency Owner', phone: aPhone, email: `owner.${Date.now()}@example.com`,
  password: 'Str0ngPass!', confirmPassword: 'Str0ngPass!', panNumber: pan, address: '1 Ring Road', city: 'Nagpur',
  state: 'Maharashtra', pincode: '440001', acceptTerms: true, phoneVerificationToken: aToken,
});
body = await r.json();
check('agency registered as pending', r.status === 201 && body.data.redirectTo === '/pending-verification', body.message);
r = await req('GET', '/agency/dashboard');
check('pending agency kept out of agency dashboard', r.status === 307 && loc(r).endsWith('/pending-verification'), loc(r));
r = await req('GET', '/pending-verification');
const html = await r.text();
check('pending page shows registration status', r.status === 200 && html.includes('Verification in progress') && html.includes('E2E Water Tankers'));

// 9. Swagger docs
r = await fetch('http://localhost:4000/api/docs/openapi.json');
check('OpenAPI document served', r.status === 200 && Object.keys((await r.json()).paths).length >= 25);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
