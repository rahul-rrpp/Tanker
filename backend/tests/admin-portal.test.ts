import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { getMockOtp } from '../src/modules/otp/providers/mock.provider';
import { createBooking, createDemoTransporter, registerCompany } from './company-helpers';
import { api, bearer, createSuperAdmin, mobile, uniqueEmail, uniquePhone } from './helpers';

/** Smoke + guard tests for the Admin Portal routers served to admin-web. */
const V1 = '/api/v1';
const setPortals = (v: string) => { (env as { ENABLED_PORTALS: string }).ENABLED_PORTALS = v; };
let previous: string;
let admin: string;
let companyId: string;
let transporterId: string;

beforeAll(async () => {
  previous = env.ENABLED_PORTALS;
  setPortals('all');
  admin = (await createSuperAdmin()).token;
  setPortals('company,admin,transporter,driver,employee');
  const c = await registerCompany();
  companyId = c.companyId;
  transporterId = (await createDemoTransporter()).id;
  const b = await createBooking(c.token);
  expect(b.status).toBe(201);
});
afterAll(() => setPortals(previous));

const get = (path: string, token = admin) => api().get(`${V1}${path}`).set(bearer(token));

const LISTS = [
  '/admin/dashboard', '/admin/companies', '/admin/transporters', '/admin/drivers', '/admin/tankers', '/admin/bookings', '/admin/offers', '/admin/offers/adjustments/list',
  '/admin/trips', '/admin/trips/alerts', '/admin/tracking', '/admin/payments', '/admin/payments/summary', '/admin/payments/refunds/list', '/admin/commissions/rules',
  '/admin/commissions/bookings', '/admin/commissions/summary', '/admin/commissions/settlements', '/admin/subscriptions', '/admin/subscriptions/plans', '/admin/services',
  '/admin/services/orders', '/admin/leads', '/admin/leads/report/employees', '/admin/work/tasks', '/admin/work/follow-ups', '/admin/employees', '/admin/roles', '/admin/roles/matrix',
  '/admin/hr/kpi-targets', '/admin/hr/leave-policies', '/admin/hr/attendance-rules', '/admin/hr/activity-logs', '/admin/transporter-tickets', '/admin/auth/me',
];

describe('Admin Portal API', () => {
  it.each(LISTS)('serves %s to the Super Admin', async (path) => {
    const r = await get(path);
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
  });

  it('opens details and every tab of a company and a transporter', async () => {
    await get(`/admin/companies/${companyId}`).expect(200);
    for (const tab of ['bookings', 'payments', 'complaints', 'activity', 'notes']) {
      const r = await get(`/admin/companies/${companyId}/tab/${tab}`);
      expect(r.status, `company tab ${tab}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
    }
    await get(`/admin/transporters/${transporterId}`).expect(200);
    for (const tab of ['fleet', 'drivers', 'documents', 'offers', 'trips', 'payments', 'commission', 'performance', 'activity', 'notes']) {
      const r = await get(`/admin/transporters/${transporterId}/tab/${tab}`);
      expect(r.status, `transporter tab ${tab}: ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
    }
  });

  it('opens the first record of each list that has a detail page', async () => {
    for (const base of ['/admin/drivers', '/admin/tankers', '/admin/bookings']) {
      const list = await get(base).expect(200);
      const first = list.body.data.items?.[0];
      expect(first, base).toBeTruthy();
      const r = await get(`${base}/${first.id}`);
      expect(r.status, `${base}/:id ${JSON.stringify(r.body).slice(0, 200)}`).toBe(200);
    }
  });

  it('exports a list to Excel', async () => {
    const r = await get('/admin/companies?format=xlsx');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
  });

  it('adds a note and suspends then reactivates a company', async () => {
    await api().post(`${V1}/admin/companies/${companyId}/notes`).set(bearer(admin)).send({ note: 'Called the owner about GST.' }).expect(201);
    expect((await api().post(`${V1}/admin/companies/${companyId}/suspend`).set(bearer(admin)).send({ reason: 'Documents under dispute' })).status).toBe(200);
    expect((await api().post(`${V1}/admin/companies/${companyId}/reactivate`).set(bearer(admin)).send({})).status).toBe(200);
  });

  it('refuses non-admin users and employees without the permission', async () => {
    const c = await registerCompany();
    expect((await get('/admin/companies', c.token)).status).toBe(403);
    const role = await prisma.employeeRole.findUniqueOrThrow({ where: { code: 'MIS_EXECUTIVE' } });
    const phone = uniquePhone();
    await api().post(`${V1}/admin/employees`).set(bearer(admin)).send({ fullName: 'Ravi Menon', phone, email: uniqueEmail('mis'), designation: 'Analyst', department: 'MIS', roleId: role.id, joiningDate: '2026-02-01' }).expect(201);
    await api().post(`${V1}/employee/auth/otp/send`).send({ phone }).expect(200);
    const login = await api().post(`${V1}/employee/auth/otp/verify`).set(mobile).send({ phone, code: getMockOtp(phone)! }).expect(200);
    const r = await api().post(`${V1}/admin/commissions/rules`).set(bearer(login.body.data.accessToken)).send({});
    expect(r.status).toBe(403);
  });

  it('rejects an unknown payment status filter with a validation error', async () => {
    expect((await get('/admin/payments?status=PENDING')).status).toBe(400);
    expect((await get('/admin/payments?status=PAID')).status).toBe(200);
  });

  it('requires a session', async () => {
    expect((await api().get(`${V1}/admin/dashboard`)).status).toBe(401);
  });
});
