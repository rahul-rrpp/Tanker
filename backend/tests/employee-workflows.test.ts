import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/lib/prisma';
import { getMockOtp } from '../src/modules/otp/providers/mock.provider';
import { todayIstStr } from '../src/modules/employee/common';
import { buildGstin } from '../src/utils/gst';
import { createBooking, registerCompany } from './company-helpers';
import { api, bearer, createSuperAdmin, mobile, uniqueEmail, uniqueLicence, uniquePan, uniquePhone } from './helpers';

const E = '/api/v1/employee';
const A = '/api/v1/admin';
const PDF = Buffer.from('%PDF-1.4 test');
const setPortals = (v: string) => { (env as { ENABLED_PORTALS: string }).ENABLED_PORTALS = v; };
let previous: string;
let admin: string;

beforeAll(async () => {
  previous = env.ENABLED_PORTALS;
  setPortals('all');
  admin = (await createSuperAdmin()).token;
  setPortals('company,admin,transporter,driver,employee');
});
afterAll(() => setPortals(previous));

async function staff(roleCode: string, managerId?: string) {
  const role = await prisma.employeeRole.findUniqueOrThrow({ where: { code: roleCode } });
  const phone = uniquePhone();
  const r = await api().post(`${A}/employees`).set(bearer(admin)).send({ fullName: "Test Person", phone, email: uniqueEmail('st'), designation: 'Staff', department: 'Dept', roleId: role.id, joiningDate: '2026-01-05', reportingManagerId: managerId ?? null });
  expect(r.status).toBe(201);
  await api().post(`${E}/auth/otp/send`).send({ phone }).expect(200);
  const l = await api().post(`${E}/auth/otp/verify`).set(mobile).send({ phone, code: getMockOtp(phone)! }).expect(200);
  return { id: r.body.data.employee.id as string, token: l.body.data.accessToken as string };
}

const leadBody = (over: Record<string, unknown> = {}) => ({ leadType: 'COMPANY', name: `Acme Lubes ${Math.random().toString(36).slice(2, 8)}`, phone: uniquePhone(), source: 'TELECALLING', city: 'Pune', state: 'Maharashtra', ...over });
const addLead = async (token: string, over: Record<string, unknown> = {}) => (await api().post(`${E}/leads`).set(bearer(token)).send(leadBody(over)).expect(201)).body.data.lead as { id: string; phone: string; leadCode: string };
const companyInput = (lead: { phone: string }, pan = uniquePan()) => ({ companyName: 'Acme Lubricants Pvt Ltd', contactPersonName: 'Ravi Shah', phone: lead.phone, email: uniqueEmail('c'), gstNumber: buildGstin('27', pan), businessType: 'TRADER', address: '12 MIDC Road', city: 'Pune', state: 'Maharashtra', pincode: '411026' });
const transporterInput = (lead: { phone: string }, pan = uniquePan()) => ({ companyName: 'Acme Haulage', ownerName: 'Vijay Rao', phone: lead.phone, email: uniqueEmail('t'), panNumber: pan, gstNumber: buildGstin('27', pan), address: '5 Transport Nagar', city: 'Pune', state: 'Maharashtra', pincode: '411044' });

describe('CRM', () => {
  it('blocks duplicates, warns first, and isolates leads between executives', async () => {
    const [a, b] = [await staff('SALES_EXECUTIVE'), await staff('SALES_EXECUTIVE')];
    const lead = await addLead(a.token);
    const warn = await api().post(`${E}/leads/check-duplicates`).set(bearer(a.token)).send({ phone: lead.phone }).expect(200);
    expect(warn.body.data.leads[0].leadCode).toBe(lead.leadCode);
    const dup = await api().post(`${E}/leads`).set(bearer(b.token)).send(leadBody({ phone: lead.phone }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.leads).toHaveLength(1);
    expect((await api().get(`${E}/leads/${lead.id}`).set(bearer(b.token))).status).toBe(404);
    expect((await api().put(`${E}/leads/${lead.id}`).set(bearer(b.token)).send({ remarks: 'x' })).status).toBe(404);
    expect((await api().get(`${E}/leads`).set(bearer(b.token)).expect(200)).body.data.items.map((l: { id: string }) => l.id)).not.toContain(lead.id);
  });

  it('records calls and follow-ups through to completion', async () => {
    const a = await staff('SALES_EXECUTIVE');
    const lead = await addLead(a.token);
    await api().post(`${E}/call-logs`).set(bearer(a.token)).send({ leadId: lead.id, outcome: 'INTERESTED', durationSeconds: 120 }).expect(201);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe('CONTACTED');
    const f = await api().post(`${E}/follow-ups`).set(bearer(a.token)).send({ leadId: lead.id, dueAt: new Date(Date.now() + 3600_000).toISOString() }).expect(201);
    const id = f.body.data.followUp.id;
    await api().post(`${E}/follow-ups/${id}/reschedule`).set(bearer(a.token)).send({ dueAt: new Date(Date.now() + 7200_000).toISOString() }).expect(200);
    await api().post(`${E}/follow-ups/${id}/complete`).set(bearer(a.token)).send({ callOutcome: 'MEETING_FIXED', remarks: 'Visit fixed' }).expect(200);
    expect((await api().post(`${E}/follow-ups/${id}/complete`).set(bearer(a.token)).send({ callOutcome: 'BUSY' })).status).toBe(409);
    const done = await api().get(`${E}/follow-ups?tab=completed`).set(bearer(a.token)).expect(200);
    expect(done.body.data.items[0].callOutcome).toBe('MEETING_FIXED');
    const hist = await api().get(`${E}/leads/${lead.id}`).set(bearer(a.token)).expect(200);
    expect(hist.body.data.activities.length).toBeGreaterThanOrEqual(3);
  });

  it('assign needs permission; managers can, and the new owner is notified', async () => {
    const [mgr, a, b] = [await staff('SALES_MANAGER'), await staff('SALES_EXECUTIVE'), await staff('SALES_EXECUTIVE')];
    const lead = await addLead(a.token);
    expect((await api().post(`${E}/leads/${lead.id}/assign`).set(bearer(a.token)).send({ employeeId: b.id })).status).toBe(403);
    await api().post(`${E}/leads/${lead.id}/assign`).set(bearer(mgr.token)).send({ employeeId: b.id }).expect(200);
    expect((await api().get(`${E}/leads/${lead.id}`).set(bearer(b.token))).status).toBe(200);
    expect((await api().get(`${E}/notifications`).set(bearer(b.token))).body.data.items[0].type).toBe('LEAD_ASSIGNED');
  });
});

describe('Onboarding and verification', () => {
  it('converts leads once, records attribution, and registers drivers only under a transporter', async () => {
    const a = await staff('SALES_EXECUTIVE');
    const lead = await addLead(a.token);
    const conv = await api().post(`${E}/leads/${lead.id}/convert`).set(bearer(a.token)).send(companyInput(lead)).expect(201);
    expect(conv.body.data.entityType).toBe('COMPANY');
    expect((await api().post(`${E}/leads/${lead.id}/convert`).set(bearer(a.token)).send(companyInput(lead))).status).toBe(409);
    const detail = await api().get(`${E}/companies/${conv.body.data.entityId}`).set(bearer(a.token)).expect(200);
    expect(detail.body.data.attribution.leadCode).toBe(lead.leadCode);
    expect(detail.body.data.attribution.employeeCode).toMatch(/^EMP/);

    const tLead = await addLead(a.token, { leadType: 'TRANSPORTER' });
    const tc = await api().post(`${E}/leads/${tLead.id}/convert`).set(bearer(a.token)).send(transporterInput(tLead)).expect(201);
    expect(await prisma.agency.count({ where: { id: tc.body.data.entityId } })).toBe(1);

    const ver = await staff('OPERATIONS_MANAGER');
    const driverPayload = { fullName: 'Santosh More', phone: uniquePhone(), address: 'Bhosari, Pune', licenceNumber: uniqueLicence(), licenceExpiry: '2030-01-01', emergencyContactName: 'Sunita', emergencyContactPhone: '9822334455' };
    expect((await api().post(`${E}/drivers`).set(bearer(ver.token)).send({ ...driverPayload, transporterId: tc.body.data.entityId })).status).toBe(403);
    expect((await api().post(`${E}/drivers`).set(bearer(a.token)).send(driverPayload)).status).toBe(403);
    await prisma.driver.count();
    const dup = await api().post(`${E}/companies`).set(bearer(a.token)).send(companyInput({ phone: lead.phone }));
    expect(dup.status).toBe(409);
  });

  it('approves and rejects only with explicit permission, keeping history', async () => {
    const [sales, verifier] = [await staff('SALES_EXECUTIVE'), await staff('VERIFICATION_EXECUTIVE')];
    const lead = await addLead(sales.token);
    const c = await api().post(`${E}/companies`).set(bearer(sales.token)).send(companyInput(lead)).expect(201);
    const companyId = c.body.data.company.id as string;
    await prisma.employeeAssignment.count();
    const doc = await api().post(`${E}/companies/${companyId}/documents`).set(bearer(sales.token)).field('type', 'GST_CERTIFICATE').attach('file', PDF, 'gst.pdf').expect(201);
    const docKey = `COMPANY_DOC:${doc.body.data.document.id}`;
    expect((await api().post(`${E}/verifications/${docKey}/approve`).set(bearer(sales.token)).send({})).status).toBe(403);
    const q = await api().get(`${E}/verifications`).set(bearer(verifier.token)).expect(200);
    expect(q.body.data.items.map((i: { id: string }) => i.id)).toEqual(expect.arrayContaining([docKey, `COMPANY:${companyId}`]));
    await api().get(`${E}/verifications/${docKey}/file`).set(bearer(verifier.token)).expect(200);
    expect((await api().post(`${E}/verifications/${docKey}/reject`).set(bearer(verifier.token)).send({ reason: 'x' })).status).toBe(400);
    await api().post(`${E}/verifications/${docKey}/reject`).set(bearer(verifier.token)).send({ reason: 'Blurred image', reupload: true }).expect(200);
    expect((await api().post(`${E}/verifications/${docKey}/approve`).set(bearer(verifier.token)).send({})).status).toBe(409);
    await api().post(`${E}/verifications/COMPANY:${companyId}/approve`).set(bearer(verifier.token)).send({}).expect(200);
    expect((await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).status).toBe('VERIFIED');
    const h = await api().get(`${E}/verifications/COMPANY:${companyId}/history`).set(bearer(verifier.token)).expect(200);
    expect(h.body.data.history[0].toStatus).toBe('VERIFIED');
    expect(await prisma.auditLog.count({ where: { action: 'verification.approved', entityId: companyId } })).toBe(1);
  });
});

describe('Operations, support and finance', () => {
  it('monitors bookings and negotiations but cannot accept offers or change price', async () => {
    const company = await registerCompany();
    const b = (await createBooking(company.token)).body.data.booking;
    const ops = await staff('OPERATIONS_MANAGER');
    const list = await api().get(`${E}/bookings?unallocated=1`).set(bearer(ops.token)).expect(200);
    expect(list.body.data.items.map((x: { id: string }) => x.id)).toContain(b.id);
    await api().get(`${E}/bookings/${b.id}`).set(bearer(ops.token)).expect(200);
    await api().post(`${E}/bookings/${b.id}/flag-delayed`).set(bearer(ops.token)).send({ reason: 'Loading slot unclear' }).expect(200);
    const issue = await api().post(`${E}/bookings/${b.id}/issue`).set(bearer(ops.token)).send({ subject: 'Slot issue', description: 'Loading slot is not confirmed.' }).expect(201);
    expect(issue.body.data.ticket.ticketNumber).toMatch(/^TKT/);
    expect((await api().post(`${E}/negotiations/${b.id}/accept`).set(bearer(ops.token)).send({})).status).toBe(404);
    expect((await api().put(`${E}/bookings/${b.id}`).set(bearer(ops.token)).send({ acceptedFreight: 1 })).status).toBe(404);
  });

  it('confines assigned-scope staff and keeps sales out of finance', async () => {
    const company = await registerCompany();
    const b = (await createBooking(company.token)).body.data.booking;
    const sales = await staff('SALES_EXECUTIVE');
    expect((await api().get(`${E}/payments`).set(bearer(sales.token))).status).toBe(403);
    expect((await api().get(`${E}/bookings/${b.id}`).set(bearer(sales.token))).status).toBeGreaterThanOrEqual(403);
    const acct = await staff('ACCOUNTS_EXECUTIVE');
    await api().get(`${E}/payments`).set(bearer(acct.token)).expect(200);
    const sum = await api().get(`${E}/payments/summary`).set(bearer(acct.token)).expect(200);
    expect(sum.body.data).toHaveProperty('pendingCollection');
    for (const [m, p] of [['post', `/payments/${b.id}/mark-paid`], ['put', `/payments/${b.id}`], ['delete', `/payments/${b.id}`]] as const) {
      expect([401, 403, 404]).toContain((await api()[m](`${E}${p}`).set(bearer(acct.token)).send({})).status);
    }
  });

  it('runs a ticket from creation to resolution', async () => {
    const company = await registerCompany();
    const s = await staff('CUSTOMER_SUPPORT_EXECUTIVE');
    const lead = await prisma.employee.findUniqueOrThrow({ where: { id: s.id } });
    await prisma.employeeAssignment.create({ data: { employeeId: lead.id, entityType: 'COMPANY', entityId: company.companyId } });
    const t = await api().post(`${E}/support/tickets`).set(bearer(s.token)).field('companyId', company.companyId).field('category', 'PAYMENT_PROBLEM').field('subject', 'Invoice mismatch').field('description', 'Invoice total does not match.').expect(201);
    const id = t.body.data.ticket.id;
    await api().post(`${E}/support/tickets/${id}/respond`).set(bearer(s.token)).send({ message: 'Internal check', internal: true }).expect(200);
    await api().post(`${E}/support/tickets/${id}/respond`).set(bearer(s.token)).send({ message: 'Corrected invoice issued', status: 'RESOLVED' }).expect(200);
    await api().post(`${E}/support/tickets/${id}/respond`).set(bearer(s.token)).send({ message: 'Closing', status: 'CLOSED' }).expect(200);
    expect((await api().post(`${E}/support/tickets/${id}/respond`).set(bearer(s.token)).send({ message: 'Again' })).status).toBe(409);
  });
});

describe('Productivity', () => {
  it('runs tasks, and only managers assign to others', async () => {
    const [mgr, a, b] = [await staff('SALES_MANAGER'), await staff('SALES_EXECUTIVE'), await staff('SALES_EXECUTIVE')];
    expect((await api().post(`${E}/tasks`).set(bearer(a.token)).send({ title: 'Call back', assigneeId: b.id })).status).toBe(403);
    const t = await api().post(`${E}/tasks`).set(bearer(mgr.token)).send({ title: 'Visit Chakan plant', assigneeId: a.id, dueAt: new Date(Date.now() + 3600_000).toISOString() }).expect(201);
    const id = t.body.data.task.id;
    expect((await api().get(`${E}/tasks/${id}`).set(bearer(b.token))).status).toBe(404);
    expect((await api().put(`${E}/tasks/${id}`).set(bearer(a.token)).send({ status: 'DONE' })).status).toBe(400);
    await api().put(`${E}/tasks/${id}`).set(bearer(a.token)).send({ status: 'DONE', completionRemarks: 'Visited' }).expect(200);
    expect((await api().get(`${E}/tasks/${id}`).set(bearer(a.token))).body.data.activities.map((x: { type: string }) => x.type)).toEqual(['CREATED', 'STATUS']);
  });

  it('checks in once, handles breaks and checks out once; location needs consent', async () => {
    const a = await staff('SALES_EXECUTIVE');
    expect((await api().post(`${E}/attendance/check-out`).set(bearer(a.token))).status).toBe(409);
    const i = await api().post(`${E}/attendance/check-in`).set(bearer(a.token)).send({ consent: false, latitude: 18.5, longitude: 73.8 }).expect(201);
    expect(i.body.data.attendance.checkInLatitude).toBeNull();
    expect((await api().post(`${E}/attendance/check-in`).set(bearer(a.token)).send({})).status).toBe(409);
    await api().post(`${E}/attendance/break-start`).set(bearer(a.token)).expect(200);
    expect((await api().post(`${E}/attendance/break-start`).set(bearer(a.token))).status).toBe(409);
    await api().post(`${E}/attendance/break-end`).set(bearer(a.token)).expect(200);
    await api().post(`${E}/attendance/check-out`).set(bearer(a.token)).expect(200);
    expect((await api().post(`${E}/attendance/check-out`).set(bearer(a.token))).status).toBe(409);
    expect((await api().get(`${E}/attendance/team`).set(bearer(a.token))).status).toBe(403);
  });

  it('routes leave through the manager, never the applicant, and updates balance', async () => {
    const mgr = await staff('SALES_MANAGER');
    const a = await staff('SALES_EXECUTIVE', mgr.id);
    const other = await staff('SALES_EXECUTIVE');
    const y = Number(todayIstStr().slice(0, 4)) + 1;
    const apply = () => api().post(`${E}/leaves`).set(bearer(a.token)).field('leaveType', 'CASUAL').field('startDate', `${y}-03-02`).field('endDate', `${y}-03-03`).field('reason', 'Family function');
    const l = await apply().expect(201);
    expect((await apply()).status).toBe(409);
    const id = l.body.data.leave.id;
    expect((await api().post(`${E}/leaves/${id}/approve`).set(bearer(a.token)).send({})).status).toBe(403);
    expect((await api().post(`${E}/leaves/${id}/approve`).set(bearer(other.token)).send({})).status).toBe(404);
    await api().post(`${E}/leaves/${id}/approve`).set(bearer(mgr.token)).send({}).expect(200);
    const b = await prisma.leaveBalance.findFirstOrThrow({ where: { employeeId: a.id, leaveType: 'CASUAL', year: y } });
    expect(b.used.toNumber()).toBe(2);
    expect((await api().post(`${E}/leaves/${id}/cancel`).set(bearer(a.token))).status).toBe(409);
  });

  it('accepts one MIS per day, revises only with authority, and shows who is missing', async () => {
    const mgr = await staff('SALES_MANAGER');
    const [a, b] = [await staff('SALES_EXECUTIVE', mgr.id), await staff('SALES_EXECUTIVE', mgr.id)];
    const r = await api().post(`${E}/mis`).set(bearer(a.token)).send({ data: { callsMade: 30, challenges: 'None' } }).expect(201);
    expect(r.body.data.report.reportType).toBe('SALES');
    expect((await api().post(`${E}/mis`).set(bearer(a.token)).send({ data: { callsMade: 31 } })).status).toBe(409);
    expect((await api().put(`${E}/mis/${r.body.data.report.id}`).set(bearer(a.token)).send({ data: { callsMade: 99 }, reason: 'Oops typo' })).status).toBe(403);
    const team = await api().get(`${E}/mis-team`).set(bearer(mgr.token)).expect(200);
    expect(team.body.data.missing.map((m: { id: string }) => m.id)).toContain(b.id);
    expect(team.body.data.submitted.map((s: { employeeId: string }) => s.employeeId)).toContain(a.id);
  });
});

describe('Performance and Admin control', () => {
  it('calculates the scorecard from activity and Admin-set targets', async () => {
    const mgr = await staff('SALES_MANAGER');
    const a = await staff('SALES_EXECUTIVE', mgr.id);
    const b = await staff('SALES_EXECUTIVE');
    const lead = await addLead(a.token);
    await api().post(`${E}/call-logs`).set(bearer(a.token)).send({ leadId: lead.id, outcome: 'CONNECTED' }).expect(201);
    const before = await api().get(`${E}/performance`).set(bearer(a.token)).expect(200);
    const row = before.body.data.rows.find((x: { code: string }) => x.code === 'CALLS_MADE');
    expect(row.actual).toBe(1);
    expect(row.monthlyTarget).toBe(300);
    await api().put(`${A}/hr/kpi-targets`).set(bearer(admin)).send({ kpiCode: 'CALLS_MADE', employeeId: a.id, monthlyTarget: 2, weightage: 40 }).expect(200);
    const after = await api().get(`${E}/performance`).set(bearer(a.token)).expect(200);
    const r2 = after.body.data.rows.find((x: { code: string }) => x.code === 'CALLS_MADE');
    expect(r2.monthlyTarget).toBe(2);
    expect(r2.weight).toBe(40);
    await api().get(`${E}/performance?employeeId=${a.id}`).set(bearer(mgr.token)).expect(200);
    expect((await api().get(`${E}/performance?employeeId=${a.id}`).set(bearer(b.token))).status).toBe(404);
    expect((await api().put(`${A}/hr/kpi-targets`).set(bearer(a.token)).send({ kpiCode: 'CALLS_MADE', employeeId: a.id, monthlyTarget: 0, weightage: 40 })).status).toBe(403);
  });

  it('lets Admin read activity logs, read-only', async () => {
    const a = await staff('SALES_EXECUTIVE');
    await addLead(a.token);
    const logs = await api().get(`${A}/hr/activity-logs?employeeId=${a.id}`).set(bearer(admin)).expect(200);
    expect(logs.body.data.items.map((x: { action: string }) => x.action)).toEqual(expect.arrayContaining(['employee.login', 'lead.created']));
    expect((await api().get(`${A}/hr/activity-logs`).set(bearer(a.token))).status).toBe(403);
    expect((await api().delete(`${A}/hr/activity-logs/${logs.body.data.items[0].id}`).set(bearer(admin))).status).toBe(404);
  });

  it('lets Admin change attendance rules and leave policy', async () => {
    await api().put(`${A}/hr/attendance-rules`).set(bearer(admin)).send({ lateGraceMinutes: 20 }).expect(200);
    expect((await api().get(`${A}/hr/attendance-rules`).set(bearer(admin))).body.data.lateGraceMinutes).toBe(20);
    await api().put(`${A}/hr/leave-policies/CASUAL`).set(bearer(admin)).send({ name: 'Casual Leave', daysPerYear: 8 }).expect(200);
  });
});
