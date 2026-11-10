/**
 * Employee Portal demo data (development only):  npm run db:seed:employee
 * Run after db:seed and db:seed:demo. Additive: inserts new rows only, refuses production, runs once.
 *   Mobile 9300000001-7, password Demo@12345 (see docs/EMPLOYEE_PORTAL.md).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/password.service';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const prisma = new PrismaClient();
const DAY = 86400_000;
const dayCol = (offset: number) => new Date(new Date(Date.now() + 5.5 * 3600_000 + offset * DAY).toISOString().slice(0, 10) + 'T00:00:00Z');
const seq = async (name: string, prefix: string, pad: number) => `${prefix}${String((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('${name}') AS n`))[0].n).padStart(pad, '0')}`;

const STAFF = [['SALES_MANAGER', 'Meera Iyer', 'Sales Manager', 'Sales'], ['SALES_EXECUTIVE', 'Arjun Patil', 'Sales Executive', 'Sales'], ['SALES_EXECUTIVE', 'Neha Joshi', 'Sales Executive', 'Sales'], ['OPERATIONS_EXECUTIVE', 'Imran Shaikh', 'Operations Executive', 'Operations'], ['VERIFICATION_EXECUTIVE', 'Divya Nair', 'Verification Executive', 'Verification'], ['ACCOUNTS_EXECUTIVE', 'Kiran Rao', 'Accounts Executive', 'Accounts'], ['MIS_EXECUTIVE', 'Sanjay Gupta', 'MIS Executive', 'MIS']] as const;
const STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP', 'MEETING_SCHEDULED', 'REGISTRATION_PENDING', 'NOT_INTERESTED', 'LOST'];
const CITIES = [['Pune', 'Maharashtra'], ['Mumbai', 'Maharashtra'], ['Surat', 'Gujarat'], ['Vadodara', 'Gujarat'], ['Nagpur', 'Maharashtra']];

async function main() {
  if (await prisma.user.findUnique({ where: { phone: '9300000001' } })) return console.log('Employee demo data already present. Nothing to do.');
  const sysRole = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
  const passwordHash = await hashPassword('Demo@12345');
  const created: { id: string; userId: string }[] = [];
  let i = 0;
  for (const [code, name, designation, department] of STAFF) {
    i++;
    const role = await prisma.employeeRole.findUniqueOrThrow({ where: { code } });
    const user = await prisma.user.create({ data: { fullName: name, phone: `930000000${i}`, email: `demo.staff${i}@tankerlink.example`, passwordHash, passwordChangedAt: new Date(), isPhoneVerified: true, isEmailVerified: true, accountStatus: 'ACTIVE', roles: { create: { roleId: sysRole.id } } } });
    created.push(await prisma.employee.create({ data: { employeeCode: await seq('employee_code_seq', 'EMP', 4), userId: user.id, roleId: role.id, designation, department, joiningDate: new Date('2026-01-05T00:00:00Z'), employmentType: 'FULL_TIME', branch: 'Pune', territory: 'West', reportingManagerId: i > 1 && i <= 3 ? created[0].id : null } }));
  }
  const [, a, b] = created;
  const makeLead = async (leadType: string, n: number, base: number) => {
    const [city, state] = CITIES[n % CITIES.length];
    const owner = n % 2 ? a : b;
    const name = `${leadType === 'DRIVER' ? 'Driver' : leadType === 'COMPANY' ? 'Sample Industries' : 'Sample Roadways'} ${n + 1} (Demo)`;
    return prisma.lead.create({ data: { leadCode: await seq('lead_code_seq', 'LD', 6), leadType, name, normalizedName: `${name}`.toLowerCase().replace(/[^a-z0-9]/g, ''), contactPerson: `Contact ${n + 1}`, phone: `93${String(base + n).padStart(8, '0')}`, city, state, source: 'TELECALLING', status: STATUSES[n % STATUSES.length], priority: n % 3 ? 'MEDIUM' : 'HIGH', assignedEmployeeId: owner.id, createdById: owner.userId } });
  };
  const leads = [];
  for (let n = 0; n < 30; n++) leads.push(await makeLead('COMPANY', n, 10000));
  for (let n = 0; n < 30; n++) leads.push(await makeLead('TRANSPORTER', n, 20000));
  for (let n = 0; n < 20; n++) leads.push(await makeLead('DRIVER', n, 30000));
  for (let n = 0; n < 20; n++) {
    const l = leads[n];
    await prisma.followUp.create({ data: { leadId: l.id, employeeId: l.assignedEmployeeId, dueAt: new Date(Date.now() + (n - 8) * DAY / 2), notes: 'Demo follow-up' } });
    await prisma.leadActivity.create({ data: { leadId: l.id, type: 'CALL', connected: n % 2 === 0, outcome: n % 2 ? 'BUSY' : 'INTERESTED', actorId: (n % 2 ? a : b).userId, durationSeconds: 90 } });
  }
  for (let n = 0; n < 20; n++) {
    const owner = n % 2 ? a : b;
    await prisma.employeeTask.create({ data: { taskCode: await seq('task_code_seq', 'TSK', 6), title: `Demo task ${n + 1}`, assigneeId: owner.id, createdById: created[0].userId, dueAt: new Date(Date.now() + (n - 6) * DAY), status: n % 5 === 0 ? 'DONE' : 'OPEN', completedAt: n % 5 === 0 ? new Date() : null, completionRemarks: n % 5 === 0 ? 'Done (demo)' : null, priority: 'MEDIUM' } });
  }
  for (const e of created) {
    for (let d = 1; d <= 10; d++) {
      const date = dayCol(-d);
      if (date.getUTCDay() === 0) continue;
      const checkInAt = new Date(date.getTime() + (3.5 + (d % 3) * 0.2) * 3600_000);
      await prisma.employeeAttendance.create({ data: { employeeId: e.id, date, checkInAt, checkOutAt: new Date(checkInAt.getTime() + 9 * 3600_000), workingMinutes: 510, breakMinutes: 30, status: d % 3 === 2 ? 'LATE' : 'PRESENT' } });
    }
    await prisma.dailyMisReport.create({ data: { employeeId: e.id, date: dayCol(-1), reportType: 'GENERAL', data: { tasksCompleted: 3, pendingTasks: 2 } } });
  }
  await prisma.leaveApplication.create({ data: { employeeId: a.id, leaveType: 'CASUAL', startDate: dayCol(7), endDate: dayCol(8), days: 2, reason: 'Family function (demo)' } });
  await prisma.leaveApplication.create({ data: { employeeId: b.id, leaveType: 'SICK', startDate: dayCol(-20), endDate: dayCol(-20), days: 1, reason: 'Unwell (demo)', status: 'APPROVED', decidedById: created[0].userId, decidedAt: new Date() } });
  console.log(`Seeded ${created.length} employees, ${leads.length} leads, 20 follow-ups, 20 tasks, attendance, leave and MIS. Bookings, trips and verification items come from db:seed:demo and db:seed:transporter.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
