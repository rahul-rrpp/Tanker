/**
 * Admin Portal permission matrix: every module x action is a Permission row with key "adm.<module>.<action>".
 * SUPER_ADMIN holds all of them. Employees receive them through configurable EmployeeRoles (plus per-employee
 * GRANT/DENY overrides). No employee role is ever created with full access by default.
 */

export const ADMIN_ACTIONS = ['view', 'create', 'edit', 'approve', 'reject', 'assign', 'export', 'delete'] as const;
export type AdminAction = (typeof ADMIN_ACTIONS)[number];

export const ADMIN_MODULES = {
  dashboard: { label: 'Dashboard', actions: ['view'] },
  companies: { label: 'Company Management', actions: ['view', 'create', 'edit', 'approve', 'reject', 'assign', 'export'] },
  transporters: { label: 'Transporter Management', actions: ['view', 'create', 'edit', 'approve', 'reject', 'assign', 'export'] },
  drivers: { label: 'Driver Management', actions: ['view', 'create', 'edit', 'approve', 'reject', 'export'] },
  tankers: { label: 'Tanker / Fleet Management', actions: ['view', 'create', 'edit', 'approve', 'reject', 'export'] },
  employees: { label: 'Employee Management', actions: ['view', 'create', 'edit', 'assign', 'export'] },
  roles: { label: 'Roles & Permissions', actions: ['view', 'create', 'edit', 'delete'] },
  leads: { label: 'Lead & Onboarding', actions: ['view', 'create', 'edit', 'assign', 'export', 'delete'] },
  tasks: { label: 'Tasks & Follow-ups', actions: ['view', 'create', 'edit', 'assign'] },
  bookings: { label: 'Booking Management', actions: ['view', 'create', 'edit', 'export'] },
  offers: { label: 'Offers & Negotiations', actions: ['view', 'edit', 'approve', 'export'] },
  trips: { label: 'Trip Management', actions: ['view', 'edit', 'export'] },
  tracking: { label: 'Live GPS Monitoring', actions: ['view', 'edit'] },
  payments: { label: 'Payment Management', actions: ['view', 'create', 'edit', 'approve', 'export'] },
  commissions: { label: 'Commission Management', actions: ['view', 'create', 'edit', 'approve', 'export'] },
  subscriptions: { label: 'Subscription & Revenue', actions: ['view', 'create', 'edit', 'assign', 'export'] },
  services: { label: 'Service & Product Management', actions: ['view', 'create', 'edit', 'assign', 'export'] },
  documents: { label: 'Document & KYC Verification', actions: ['view', 'edit', 'approve', 'reject'] },
  complaints: { label: 'Complaints & Disputes', actions: ['view', 'edit', 'assign', 'export'] },
  notifications: { label: 'Notifications', actions: ['view', 'create', 'edit', 'approve'] },
  reports: { label: 'Reports & Analytics', actions: ['view', 'export'] },
  performance: { label: 'MIS & Performance Scorecard', actions: ['view', 'edit'] },
  settings: { label: 'System Configuration', actions: ['view', 'edit'] },
  audit: { label: 'Audit Logs', actions: ['view', 'export'] },
  attendance: { label: 'Attendance (team)', actions: ['view', 'edit', 'export'] },
  leave: { label: 'Leave Approvals', actions: ['view', 'approve', 'reject'] },
  mis: { label: 'Daily MIS (team)', actions: ['view', 'edit', 'export'] },
} as const satisfies Record<string, { label: string; actions: readonly AdminAction[] }>;

export type AdminModule = keyof typeof ADMIN_MODULES;

export const adminPermissionKey = (module: AdminModule, action: AdminAction) => `adm.${module}.${action}`;

export const ADMIN_PERMISSION_KEYS: Record<string, string> = Object.fromEntries(
  (Object.entries(ADMIN_MODULES) as [AdminModule, { label: string; actions: readonly AdminAction[] }][]).flatMap(([m, def]) =>
    def.actions.map((a) => [adminPermissionKey(m, a), `${def.label}: ${a}`]),
  ),
);

type Grants = Partial<Record<AdminModule, readonly AdminAction[]>>;

/** Seeded starting points; administrators can change every role's matrix and scope afterwards. */
export const DEFAULT_EMPLOYEE_ROLES: { code: string; name: string; description: string; dataScope: 'ALL' | 'ASSIGNED'; grants: Grants }[] = [
  {
    code: 'SALES_EXECUTIVE',
    name: 'Sales Executive',
    description: 'Works assigned leads, registers companies and transporters, updates follow-ups.',
    dataScope: 'ASSIGNED',
    grants: { dashboard: ['view'], leads: ['view', 'create', 'edit'], companies: ['view', 'create'], transporters: ['view', 'create'], tasks: ['view', 'edit'], performance: ['view'] },
  },
  {
    code: 'FIELD_SALES_EXECUTIVE',
    name: 'Field Sales Executive',
    description: 'Field visits and meetings for assigned leads; registers businesses on site.',
    dataScope: 'ASSIGNED',
    grants: { dashboard: ['view'], leads: ['view', 'create', 'edit'], companies: ['view', 'create'], transporters: ['view', 'create'], drivers: ['view', 'create'], tasks: ['view', 'edit'], performance: ['view'] },
  },
  {
    code: 'OPERATIONS_EXECUTIVE',
    name: 'Operations Executive',
    description: 'Manages bookings and trips, assists allocation, handles trip exceptions.',
    dataScope: 'ALL',
    grants: {
      dashboard: ['view'], bookings: ['view', 'create', 'edit'], offers: ['view'], trips: ['view', 'edit'], tracking: ['view', 'edit'],
      companies: ['view'], transporters: ['view'], drivers: ['view'], tankers: ['view'], complaints: ['view', 'edit'], tasks: ['view', 'edit'], performance: ['view'],
    },
  },
  {
    code: 'VERIFICATION_EXECUTIVE',
    name: 'Verification Executive',
    description: 'Reviews KYC documents and approves or rejects within assigned authority.',
    dataScope: 'ALL',
    grants: {
      dashboard: ['view'], documents: ['view', 'edit', 'approve', 'reject'], companies: ['view', 'approve', 'reject'], transporters: ['view', 'approve', 'reject'],
      drivers: ['view', 'approve', 'reject'], tankers: ['view', 'approve', 'reject'], tasks: ['view', 'edit'], performance: ['view'],
    },
  },
  {
    code: 'ACCOUNTS_EXECUTIVE',
    name: 'Accounts Executive',
    description: 'Views authorised payments, reconciles transactions, manages permitted settlements.',
    dataScope: 'ALL',
    grants: {
      dashboard: ['view'], payments: ['view', 'create', 'edit', 'export'], commissions: ['view', 'approve', 'export'], subscriptions: ['view'], services: ['view'],
      bookings: ['view'], reports: ['view', 'export'], tasks: ['view', 'edit'], performance: ['view'],
    },
  },
  {
    code: 'CUSTOMER_SUPPORT_EXECUTIVE',
    name: 'Customer Support Executive',
    description: 'Handles complaints and customer queries about bookings and trips.',
    dataScope: 'ALL',
    grants: { dashboard: ['view'], complaints: ['view', 'edit'], bookings: ['view'], trips: ['view'], tracking: ['view'], companies: ['view'], notifications: ['view'], tasks: ['view', 'edit'], performance: ['view'] },
  },
  {
    code: 'MIS_EXECUTIVE',
    name: 'MIS Executive',
    description: 'Prepares MIS reports and performance dashboards.',
    dataScope: 'ALL',
    grants: { dashboard: ['view'], reports: ['view', 'export'], performance: ['view'], tasks: ['view', 'edit'] },
  },
  {
    code: 'TELE_SALES_EXECUTIVE',
    name: 'Tele Sales Executive',
    description: 'Calls and converts assigned leads.',
    dataScope: 'ASSIGNED',
    grants: { dashboard: ['view'], leads: ['view', 'create', 'edit'], companies: ['view', 'create'], transporters: ['view', 'create'], tasks: ['view', 'edit'], performance: ['view'] },
  },
  {
    code: 'HR_EXECUTIVE',
    name: 'HR Executive',
    description: 'Manages attendance and leave.',
    dataScope: 'ALL',
    grants: { dashboard: ['view'], employees: ['view'], attendance: ['view', 'edit', 'export'], leave: ['view', 'approve', 'reject'], tasks: ['view', 'edit'] },
  },
  {
    code: 'OPERATIONS_MANAGER',
    name: 'Operations Manager',
    description: 'Leads operations: bookings, trips, complaints, freight adjustments and team targets.',
    dataScope: 'ALL',
    grants: {
      dashboard: ['view'], bookings: ['view', 'create', 'edit', 'export'], offers: ['view', 'edit', 'approve', 'export'], trips: ['view', 'edit', 'export'], tracking: ['view', 'edit'],
      companies: ['view', 'assign'], transporters: ['view', 'assign'], drivers: ['view'], tankers: ['view'], complaints: ['view', 'edit', 'assign', 'export'],
      employees: ['view'], tasks: ['view', 'create', 'edit', 'assign'], reports: ['view', 'export'], performance: ['view', 'edit'],
    },
  },
  {
    code: 'SALES_MANAGER',
    name: 'Sales Manager',
    description: 'Leads the sales team: lead allocation, onboarding and sales targets.',
    dataScope: 'ALL',
    grants: {
      dashboard: ['view'], leads: ['view', 'create', 'edit', 'assign', 'export'], companies: ['view', 'create', 'assign', 'export'], transporters: ['view', 'create', 'assign', 'export'],
      subscriptions: ['view', 'assign'], services: ['view', 'assign'], employees: ['view'], tasks: ['view', 'create', 'edit', 'assign'], reports: ['view', 'export'], performance: ['view', 'edit'],
    },
  },
];

export const KPI_DEFINITIONS = [
  { code: 'LEADS_ASSIGNED', name: 'Leads assigned', category: 'SALES' },
  { code: 'CALLS_MADE', name: 'Calls made', category: 'SALES' },
  { code: 'CONNECTED_CALLS', name: 'Connected calls', category: 'SALES' },
  { code: 'MEETINGS', name: 'Meetings conducted', category: 'SALES' },
  { code: 'FOLLOW_UPS_DONE', name: 'Follow-ups completed', category: 'SALES' },
  { code: 'NEW_COMPANIES', name: 'New company registrations', category: 'SALES' },
  { code: 'NEW_TRANSPORTERS', name: 'New transporter registrations', category: 'SALES' },
  { code: 'VERIFIED_REGISTRATIONS', name: 'Verified registrations', category: 'SALES' },
  { code: 'FIRST_BOOKINGS', name: 'First booking activations', category: 'SALES' },
  { code: 'REPEAT_BOOKINGS', name: 'Repeat booking activations', category: 'SALES' },
  { code: 'BOOKINGS_MANAGED', name: 'Bookings managed', category: 'OPERATIONS' },
  { code: 'TRIPS_COMPLETED', name: 'Trips completed', category: 'OPERATIONS' },
  { code: 'DELAYED_TRIPS', name: 'Delayed trips', category: 'OPERATIONS', higherIsBetter: false },
  { code: 'COMPLAINTS_RESOLVED', name: 'Complaints resolved', category: 'OPERATIONS' },
  { code: 'AVG_RESOLUTION_HOURS', name: 'Average resolution time (hours)', category: 'OPERATIONS', unit: 'hours', higherIsBetter: false },
  { code: 'DOCS_REVIEWED', name: 'Documents reviewed', category: 'VERIFICATION' },
  { code: 'APPROVALS', name: 'Approvals', category: 'VERIFICATION' },
  { code: 'REJECTIONS', name: 'Rejections', category: 'VERIFICATION' },
  { code: 'PENDING_VERIFICATION', name: 'Pending verification', category: 'VERIFICATION', higherIsBetter: false },
  { code: 'AVG_VERIFICATION_HOURS', name: 'Average verification time (hours)', category: 'VERIFICATION', unit: 'hours', higherIsBetter: false },
] as const;

/** Default monthly targets per role: [kpiCode, target, weightage]. */
export const DEFAULT_KPI_TARGETS: Record<string, [string, number, number][]> = {
  SALES_EXECUTIVE: [
    ['CALLS_MADE', 300, 15], ['CONNECTED_CALLS', 150, 10], ['MEETINGS', 20, 15], ['FOLLOW_UPS_DONE', 120, 10],
    ['NEW_COMPANIES', 10, 20], ['NEW_TRANSPORTERS', 6, 15], ['FIRST_BOOKINGS', 5, 15],
  ],
  FIELD_SALES_EXECUTIVE: [['MEETINGS', 40, 30], ['NEW_COMPANIES', 12, 25], ['NEW_TRANSPORTERS', 8, 25], ['FIRST_BOOKINGS', 5, 20]],
  OPERATIONS_EXECUTIVE: [['BOOKINGS_MANAGED', 80, 30], ['TRIPS_COMPLETED', 70, 30], ['DELAYED_TRIPS', 5, 20], ['COMPLAINTS_RESOLVED', 20, 20]],
  VERIFICATION_EXECUTIVE: [['DOCS_REVIEWED', 300, 35], ['APPROVALS', 200, 20], ['PENDING_VERIFICATION', 10, 20], ['AVG_VERIFICATION_HOURS', 24, 25]],
  CUSTOMER_SUPPORT_EXECUTIVE: [['COMPLAINTS_RESOLVED', 60, 60], ['AVG_RESOLUTION_HOURS', 24, 40]],
};
