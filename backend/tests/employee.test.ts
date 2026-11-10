import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { getMockOtp } from '../src/modules/otp/providers/mock.provider';
import { registerCompany } from './company-helpers';
import { api, bearer, createSuperAdmin, mobile, uniqueEmail, uniquePhone } from './helpers';

const V1 = '/api/v1';
const RELEASED = 'company,admin,transporter,driver,employee';
const setPortals = (v: string) => { (env as { ENABLED_PORTALS: string }).ENABLED_PORTALS = v; };
let previous: string;
let adminToken: string;

beforeAll(async () => {
  previous = env.ENABLED_PORTALS;
  setPortals('all');
  adminToken = (await createSuperAdmin()).token;
  setPortals(RELEASED);
});
afterAll(() => setPortals(previous));

async function createEmployee(roleCode: string) {
  const role = await prisma.employeeRole.findUniqueOrThrow({ where: { code: roleCode } });
  const phone = uniquePhone();
  const res = await api().post(`${V1}/admin/employees`).set(bearer(adminToken)).send({ fullName: 'Asha Kulkarni', phone, email: uniqueEmail('emp'), designation: 'Executive', department: 'Sales', roleId: role.id, joiningDate: '2026-01-05', employmentType: 'FULL_TIME', branch: 'Pune', territory: 'West' });
  expect(res.status).toBe(201);
  return { id: res.body.data.employee.id as string, phone };
}

async function otpLogin(phone: string) {
  await api().post(`${V1}/employee/auth/otp/send`).send({ phone }).expect(200);
  return api().post(`${V1}/employee/auth/otp/verify`).set(mobile).send({ phone, code: getMockOtp(phone)! });
}

const tokenFor = async (roleCode: string) => {
  const e = await createEmployee(roleCode);
  const r = await otpLogin(e.phone);
  expect(r.status).toBe(200);
  return { ...e, token: r.body.data.accessToken as string, redirectTo: r.body.data.redirectTo as string };
};

describe('Phase A: employee access', () => {
  it('lets Admin create an employee who then signs in to the portal', async () => {
    const e = await tokenFor('SALES_EXECUTIVE');
    expect(e.redirectTo).toBe('/employee/dashboard');
    const p = await api().get(`${V1}/employee/auth/profile`).set(bearer(e.token)).expect(200);
    expect(p.body.data.employee.employeeCode).toMatch(/^EMP/);
    expect(p.body.data.employee.branch).toBe('Pune');
    const row = await prisma.employee.findUniqueOrThrow({ where: { id: e.id }, select: { userId: true } });
    expect(await prisma.auditLog.count({ where: { action: 'employee.login', actorUserId: row.userId } })).toBe(1);
  });

  it('has no self-registration route', async () => {
    expect((await api().post(`${V1}/employee/auth/register`).send({})).status).toBe(401);
    const e = await tokenFor('SALES_EXECUTIVE');
    expect((await api().post(`${V1}/employee/auth/register`).set(bearer(e.token)).send({})).status).toBe(404);
  });

  it('shows only authorised modules and a role-specific dashboard', async () => {
    const sales = await tokenFor('SALES_EXECUTIVE');
    const verifier = await tokenFor('VERIFICATION_EXECUTIVE');
    const sp = (await api().get(`${V1}/employee/auth/profile`).set(bearer(sales.token))).body.data.modules as string[];
    expect(sp).toContain('leads');
    expect(sp).not.toContain('payments');
    expect(sp).not.toContain('team-attendance');
    const sd = (await api().get(`${V1}/employee/dashboard`).set(bearer(sales.token)).expect(200)).body.data.sections;
    expect(sd.sales).toBeDefined();
    expect(sd.accounts).toBeUndefined();
    const vd = (await api().get(`${V1}/employee/dashboard`).set(bearer(verifier.token)).expect(200)).body.data.sections;
    expect(vd.verification).toBeDefined();
    expect(vd.sales).toBeUndefined();
  });

  it.each(['ON_LEAVE', 'INACTIVE', 'SUSPENDED', 'RESIGNED', 'TERMINATED'] as const)('blocks a %s employee at sign-in and on live sessions', async (status) => {
    const e = await tokenFor('SALES_EXECUTIVE');
    await prisma.employee.update({ where: { id: e.id }, data: { employmentStatus: status } });
    expect((await api().get(`${V1}/employee/dashboard`).set(bearer(e.token))).status).toBe(403);
    await prisma.oTPVerification.deleteMany({ where: { destination: e.phone } }); // skip the resend cooldown
    expect((await otpLogin(e.phone)).status).toBe(403);
  });

  it('rejects non-employees and keeps Super Admin out', async () => {
    const company = await registerCompany();
    expect((await api().get(`${V1}/employee/dashboard`).set(bearer(company.token))).status).toBe(403);
    expect((await api().get(`${V1}/employee/dashboard`).set(bearer(adminToken))).status).toBe(403);
    expect((await api().get(`${V1}/employee/dashboard`)).status).toBe(401);
    expect((await otpLogin(company.phone)).status).toBe(401);
  });

  it('never gives an employee control of roles or other employees', async () => {
    const e = await tokenFor('SALES_EXECUTIVE');
    expect((await api().get(`${V1}/admin/roles`).set(bearer(e.token))).status).toBe(403);
    expect((await api().post(`${V1}/admin/employees`).set(bearer(e.token)).send({})).status).toBe(403);
  });

  it('stays closed unless released', async () => {
    const e = await createEmployee('SALES_EXECUTIVE');
    setPortals('company,admin');
    try {
      expect((await api().post(`${V1}/employee/auth/otp/send`).send({ phone: e.phone })).status).toBe(404);
    } finally {
      setPortals(RELEASED);
    }
  });
});
