import type { ActionDef, FieldDef, Option, PageDef, Rec } from './types';

/**
 * Every admin section, declared against the backend's /api/v1/admin/* contract.
 * Pages with bespoke layouts (dashboard, roles, HR settings) live in their own routes.
 */

const tabs = (values: string[], all = true): Option[] => [...(all ? [{ value: '', label: 'All' }] : []), ...values.map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') }))];

const reason = (label = 'Reason', required = true, hint?: string): FieldDef => ({ name: 'reason', label, type: 'textarea', required, hint });
const note: FieldDef = { name: 'note', label: 'Note', type: 'textarea', required: true };

const employeeOptions = { path: '/admin/employees?pageSize=200&status=ACTIVE', dataKey: 'items', value: (r: Rec) => r.id as string, label: (r: Rec) => `${r.name} (${r.employeeCode}, ${r.role})` };
const transporterOptions = { path: '/admin/transporters?pageSize=200&status=APPROVED', dataKey: 'items', value: (r: Rec) => r.id as string, label: (r: Rec) => `${r.companyName} (${r.code})` };
const roleOptions = { path: '/admin/roles', dataKey: 'roles', value: (r: Rec) => r.id as string, label: (r: Rec) => r.name as string };

/** Approve / reject flow shared by companies, transporters, drivers and tankers. */
function reviewActions(base: string, perm: string, statusOf: (r: Rec) => string): ActionDef[] {
  const open = (r: Rec) => ['PENDING_VERIFICATION', 'UNDER_REVIEW', 'REJECTED'].includes(statusOf(r));
  return [
    { label: 'Start review', path: (r) => `${base}/${r.id}/review`, body: () => ({ action: 'START_REVIEW' }), when: (r) => statusOf(r) === 'PENDING_VERIFICATION', confirm: 'Mark this as under review? The applicant is told it is being checked.', perm: `${perm}.edit` },
    { label: 'Approve', variant: 'primary', path: (r) => `${base}/${r.id}/review`, fields: [{ ...reason('Note (optional)', false), name: 'reason' }], body: (v) => ({ action: 'APPROVE', ...v }), when: open, perm: `${perm}.approve` },
    { label: 'Reject', variant: 'danger', path: (r) => `${base}/${r.id}/review`, fields: [reason('Reason for rejection', true, 'Shown to the applicant')], body: (v) => ({ action: 'REJECT', ...v }), when: open, perm: `${perm}.reject` },
  ];
}

function accountActions(base: string, perm: string, accountOf: (r: Rec) => string): ActionDef[] {
  return [
    { label: 'Suspend', variant: 'danger', path: (r) => `${base}/${r.id}/suspend`, fields: [reason('Reason for suspension', true, 'At least 5 characters')], when: (r) => accountOf(r) !== 'SUSPENDED', perm: `${perm}.approve` },
    { label: 'Reactivate', variant: 'primary', path: (r) => `${base}/${r.id}/reactivate`, confirm: 'Reactivate this account?', when: (r) => accountOf(r) === 'SUSPENDED', perm: `${perm}.approve` },
    { label: 'Assign employee', path: (r) => `${base}/${r.id}/assign`, fields: [{ name: 'employeeId', label: 'Account manager', type: 'select', optionsFrom: employeeOptions, nullable: true, hint: 'Leave empty to remove the assignment' }], perm: `${perm}.assign` },
    { label: 'Add note', path: (r) => `${base}/${r.id}/notes`, fields: [{ name: 'note', label: 'Note', type: 'textarea', required: true }], perm: `${perm}.edit` },
  ];
}

const STATES_HINT = 'Leave empty for any';

export const PAGES: Record<string, PageDef> = {
  companies: {
    title: 'Companies',
    subtitle: 'Customer companies that book tankers. Review registrations, manage accounts and see their activity.',
    sections: [{ kind: 'table', path: '/admin/companies', filter: { param: 'status', tabs: tabs(['PENDING_VERIFICATION', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED']) }, rowHref: (r) => `/companies/${r.id}` }],
    detail: {
      path: (id) => `/admin/companies/${id}`,
      title: (d) => d.company.name,
      subtitle: (d) => `${d.company.companyCode} · GSTIN ${d.company.gstNumber ?? '—'} · ${d.company.contactPersonName ?? ''} ${d.company.contactPhone ?? ''}`,
      status: (d) => d.company.accountStatus === 'SUSPENDED' ? 'SUSPENDED' : d.company.verificationStatus,
      record: (d) => d.company,
      actions: [...reviewActions('/admin/companies', 'companies', (r) => r.verificationStatus ?? r.status), ...accountActions('/admin/companies', 'companies', (r) => r.accountStatus)],
      tabs: ['bookings', 'payments', 'complaints', 'activity', 'notes'].map((t) => ({ label: t.charAt(0).toUpperCase() + t.slice(1), path: (id: string) => `/admin/companies/${id}/tab/${t}` })),
    },
  },

  transporters: {
    title: 'Transporters',
    subtitle: 'Tanker fleet owners. Verify businesses, watch their fleet, trips, settlements and performance.',
    sections: [{ kind: 'table', path: '/admin/transporters', filter: { param: 'status', tabs: tabs(['PENDING_VERIFICATION', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']) }, rowHref: (r) => `/transporters/${r.id}` }],
    detail: {
      path: (id) => `/admin/transporters/${id}`,
      title: (d) => d.transporter.companyName,
      subtitle: (d) => `${d.transporter.transporterCode ?? d.transporter.code} · Owner ${d.transporter.owner?.fullName ?? '—'} ${d.transporter.owner?.phone ?? ''}`,
      status: (d) => d.transporter.accountStatus === 'SUSPENDED' ? 'SUSPENDED' : d.transporter.verificationStatus,
      record: (d) => d.transporter,
      actions: [...reviewActions('/admin/transporters', 'transporters', (r) => r.verificationStatus), ...accountActions('/admin/transporters', 'transporters', (r) => r.accountStatus)],
      tabs: ['fleet', 'drivers', 'documents', 'offers', 'trips', 'payments', 'commission', 'performance', 'activity', 'notes'].map((t) => ({ label: t.charAt(0).toUpperCase() + t.slice(1), path: (id: string) => `/admin/transporters/${id}/tab/${t}` })),
    },
  },

  drivers: {
    title: 'Drivers',
    subtitle: 'Drivers added by transporters. Verify licences and hazardous-goods training.',
    sections: [{ kind: 'table', path: '/admin/drivers', filter: { param: 'status', tabs: tabs(['PENDING_VERIFICATION', 'UNDER_REVIEW', 'APPROVED', 'REJECTED']) }, rowHref: (r) => `/drivers/${r.id}` }],
    detail: {
      path: (id) => `/admin/drivers/${id}`,
      title: (d) => d.driver.name,
      subtitle: (d) => `${d.driver.phone} · ${d.driver.transporter?.companyName ?? 'No transporter'} · Licence ${d.driver.licenceNumber}`,
      status: (d) => d.driver.verificationStatus,
      record: (d) => d.driver,
      actions: [
        ...reviewActions('/admin/drivers', 'drivers', (r) => r.verificationStatus),
        { label: 'Transfer to transporter', path: (r) => `/admin/drivers/${r.id}/transfer`, fields: [{ name: 'transporterId', label: 'New transporter', type: 'select', optionsFrom: transporterOptions, required: true }, reason('Reason', true)], perm: 'drivers.edit' },
      ],
    },
  },

  tankers: {
    title: 'Tankers',
    subtitle: 'Every registered tanker with its compliance documents, availability and verification.',
    sections: [{ kind: 'table', path: '/admin/tankers', filter: { param: 'verification', tabs: tabs(['PENDING_VERIFICATION', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']) }, rowHref: (r) => `/tankers/${r.id}` }],
    detail: {
      path: (id) => `/admin/tankers/${id}`,
      title: (d) => d.tanker.registrationNumber,
      subtitle: (d) => `${d.tanker.transporter?.companyName ?? ''} · ${d.tanker.capacityKl} KL ${d.tanker.tankerType?.name ?? ''}`,
      status: (d) => d.tanker.verificationStatus,
      record: (d) => d.tanker,
      actions: [
        ...reviewActions('/admin/tankers', 'tankers', (r) => r.verificationStatus),
        { label: 'Change availability', path: (r) => `/admin/tankers/${r.id}/status`, fields: [{ name: 'status', label: 'Status', type: 'select', required: true, options: ['AVAILABLE', 'MAINTENANCE', 'UNAVAILABLE', 'SUSPENDED'] }, reason('Reason', true)], perm: 'tankers.edit' },
      ],
    },
  },

  bookings: {
    title: 'Bookings',
    subtitle: 'Every booking request across companies, with its offers, trips and payments.',
    sections: [{ kind: 'table', path: '/admin/bookings', filter: { param: 'status', tabs: tabs(['SEARCHING', 'OFFERS_RECEIVED', 'NEGOTIATION', 'CONFIRMED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'DISPUTED']) }, rowHref: (r) => `/bookings/${r.id}` }],
    detail: {
      path: (id) => `/admin/bookings/${id}`,
      title: (d) => d.booking.bookingCode,
      subtitle: (d) => `${d.booking.company?.name ?? ''} · ${d.booking.product?.name ?? ''} · ${(d.booking.locations as Rec[] | undefined)?.map((l) => l.city).join(' → ') ?? ''}`,
      status: (d) => d.booking.status,
      record: (d) => d.booking,
      actions: [
        { label: 'Cancel booking', variant: 'danger', path: (r) => `/admin/bookings/${r.id}/cancel`, fields: [reason('Reason for cancellation', true, 'Shared with the company and transporter')], when: (r) => !['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(r.status), perm: 'bookings.edit' },
        { label: 'Resolve dispute', variant: 'primary', path: (r) => `/admin/bookings/${r.id}/resolve`, fields: [{ ...note, label: 'Resolution' }], when: (r) => r.status === 'DISPUTED', perm: 'bookings.edit' },
        { label: 'Add note', path: (r) => `/admin/bookings/${r.id}/notes`, fields: [note], perm: 'bookings.edit' },
      ],
    },
  },

  offers: {
    title: 'Offers & negotiation',
    subtitle: 'Transporter offers and counter-offers, plus freight corrections that need approval.',
    sections: [
      { kind: 'table', title: 'Offers', path: '/admin/offers', filter: { param: 'status', tabs: tabs(['PENDING', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'UNSUCCESSFUL']) }, rowHref: (r) => `/offers/${r.id}` },
      {
        kind: 'items', title: 'Freight adjustments', path: '/admin/offers/adjustments/list',
        rowActions: [
          { label: 'Approve', variant: 'primary', path: (r) => `/admin/offers/adjustments/${r.id}/review`, fields: [{ ...note, hint: 'At least 3 characters' }], body: (v) => ({ approve: true, ...v }), when: (r) => r.status === 'PENDING', perm: 'offers.approve' },
          { label: 'Reject', variant: 'danger', path: (r) => `/admin/offers/adjustments/${r.id}/review`, fields: [note], body: (v) => ({ approve: false, ...v }), when: (r) => r.status === 'PENDING', perm: 'offers.approve' },
        ],
      },
    ],
    detail: { path: (id) => `/admin/offers/${id}`, title: () => 'Offer', status: (d) => d.offer?.status },
  },

  trips: {
    title: 'Trips',
    subtitle: 'Trips in progress and completed, with delay and emergency alerts.',
    sections: [
      { kind: 'table', path: '/admin/trips', filter: { param: 'scope', tabs: [{ value: 'active', label: 'Active' }, { value: 'completed', label: 'Completed' }, { value: 'all', label: 'All' }] }, rowHref: (r) => `/trips/${r.id}` },
      { kind: 'items', title: 'Open alerts', path: '/admin/trips/alerts', rowActions: [{ label: 'Resolve', variant: 'primary', path: (r) => `/admin/trips/alerts/${r.id}/resolve`, fields: [{ ...note, hint: 'What was done' }], perm: 'trips.edit' }] },
    ],
    detail: {
      path: (id) => `/admin/trips/${id}`,
      title: (d) => d.trip?.tripCode ?? 'Trip',
      status: (d) => d.trip?.status,
      record: (d) => d.trip ?? d,
      actions: [
        {
          label: 'Correct status', variant: 'secondary', path: (r) => `/admin/trips/${r.id}/correct-status`, perm: 'trips.edit',
          fields: [{ name: 'status', label: 'Correct status', type: 'select', required: true, options: ['SCHEDULED', 'VEHICLE_ASSIGNED', 'DRIVER_ASSIGNED', 'REACHED_PICKUP', 'LOADING', 'LOADING_COMPLETED', 'IN_TRANSIT', 'REACHED_DESTINATION', 'UNLOADING_STARTED', 'UNLOADING_COMPLETED', 'DELIVERED', 'COMPLETED', 'CANCELLED'] }, reason('Why the correction is needed', true)],
        },
      ],
    },
  },

  tracking: {
    title: 'Live tracking',
    subtitle: 'Tankers on the road right now, refreshed every 30 seconds.',
    sections: [
      {
        kind: 'items', path: '/admin/tracking', dataKey: 'trips', rowHref: (r) => `/trips/${r.id}`,
        rowActions: [{ label: 'Raise emergency', variant: 'danger', path: (r) => `/admin/tracking/${r.id}/emergency`, fields: [{ name: 'message', label: 'What happened', type: 'textarea', required: true }], perm: 'tracking.edit' }],
      },
    ],
  },

  support: {
    title: 'Support tickets',
    subtitle: 'Tickets raised by transporters. Replies are visible to the transporter unless marked internal.',
    sections: [
      {
        kind: 'items', path: '/admin/transporter-tickets', rowHref: (r) => `/support/${r.id}`,
        filter: { param: 'status', tabs: tabs(['OPEN', 'ASSIGNED', 'UNDER_INVESTIGATION', 'AWAITING_RESPONSE', 'RESOLVED', 'CLOSED']) },
        columns: [
          { key: 'ticketNumber', label: 'Ticket' },
          { key: 'transporter', label: 'Transporter' },
          { key: 'subject', label: 'Subject' },
          { key: 'category', label: 'Category' },
          { key: 'priority', label: 'Priority' },
          { key: 'status', label: 'Status' },
          { key: 'createdAt', label: 'Raised', format: 'datetime' },
        ],
      },
    ],
    detail: {
      path: (id) => `/admin/transporter-tickets/${id}`,
      title: (d) => `${d.ticket.ticketNumber} · ${d.ticket.subject ?? ''}`,
      subtitle: (d) => d.ticket.transporter?.companyName,
      status: (d) => d.ticket.status,
      record: (d) => d.ticket,
      actions: [
        {
          label: 'Reply', variant: 'primary', path: (r) => `/admin/transporter-tickets/${r.id}/respond`, perm: 'complaints.edit',
          fields: [{ name: 'message', label: 'Message', type: 'textarea', required: true }, { name: 'status', label: 'Change status to', type: 'select', options: ['ASSIGNED', 'UNDER_INVESTIGATION', 'AWAITING_RESPONSE', 'RESOLVED', 'CLOSED'] }, { name: 'internal', label: 'Internal note (not shown to the transporter)', type: 'checkbox' }],
        },
      ],
    },
  },

  payments: {
    title: 'Payments',
    subtitle: 'Collections from companies, refunds and offline receipts.',
    sections: [
      { kind: 'kv', title: 'Summary', path: '/admin/payments/summary' },
      {
        kind: 'table', title: 'Payments', path: '/admin/payments', rowHref: (r) => `/payments/${r.id}`,
        filter: { param: 'status', tabs: [{ value: '', label: 'All' }, { value: 'CREATED', label: 'Awaiting payment' }, ...tabs(['PAID', 'FAILED', 'REFUND_PENDING', 'REFUNDED'], false)] },
        actions: [
          {
            label: 'Record offline payment', variant: 'primary', path: () => '/admin/payments/offline', perm: 'payments.create',
            fields: [
              { name: 'bookingId', label: 'Booking', type: 'select', required: true, optionsFrom: { path: '/admin/bookings?pageSize=200', dataKey: 'items', value: (r) => r.id, label: (r) => `${r.bookingCode} · ${r.company}` } },
              { name: 'amount', label: 'Amount (₹)', type: 'number', required: true },
              { name: 'purpose', label: 'Purpose', type: 'select', required: true, options: ['ADVANCE', 'BALANCE', 'FULL'] },
              { name: 'reference', label: 'Bank / UTR reference', required: true },
              { name: 'paidOn', label: 'Paid on', type: 'date', required: true },
              { name: 'note', label: 'Note', type: 'textarea' },
            ],
          },
        ],
      },
      {
        kind: 'items', title: 'Refund requests', path: '/admin/payments/refunds/list',
        rowActions: (['APPROVE', 'REJECT', 'MARK_PROCESSED'] as const).map((decision) => ({
          label: decision === 'MARK_PROCESSED' ? 'Mark processed' : decision.charAt(0) + decision.slice(1).toLowerCase(),
          variant: decision === 'REJECT' ? ('danger' as const) : ('secondary' as const),
          path: (r: Rec) => `/admin/payments/refunds/${r.id}/review`,
          fields: [note],
          body: (v: Rec) => ({ decision, ...v }),
          perm: 'payments.approve',
        })),
      },
    ],
    detail: {
      path: (id) => `/admin/payments/${id}`,
      title: (d) => d.payment?.paymentRef ?? 'Payment',
      status: (d) => d.payment?.status,
      record: (d) => d.payment ?? d,
      actions: [
        { label: 'Reconcile with gateway', path: (r) => `/admin/payments/${r.id}/reconcile`, confirm: 'Check this payment against the gateway and update its status?', perm: 'payments.edit' },
        { label: 'Request refund', variant: 'danger', path: (r) => `/admin/payments/${r.id}/refunds`, fields: [{ name: 'amount', label: 'Amount (₹)', type: 'number', required: true }, reason('Reason', true, 'At least 10 characters')], perm: 'payments.edit' },
      ],
    },
  },

  commissions: {
    title: 'Commissions & settlements',
    subtitle: 'Platform commission rules, commission earned per booking and payouts to transporters.',
    sections: [
      {
        kind: 'items', title: 'Commission rules', path: '/admin/commissions/rules', dataKey: 'rules',
        columns: [
          { key: 'ruleCode', label: 'Rule' }, { key: 'name', label: 'Name' }, { key: 'calcType', label: 'Type' },
          { key: 'value', label: 'Value', render: (r) => (r.calcType === 'PERCENT' ? `${r.value}%` : `₹${r.value}`) },
          { key: 'priority', label: 'Priority' }, { key: 'effectiveFrom', label: 'From', format: 'date' }, { key: 'effectiveTo', label: 'To', format: 'date' },
          { key: 'isActive', label: 'Active', render: (r) => (r.isActive ? 'Yes' : 'No') },
        ],
        actions: [{ label: 'New rule', variant: 'primary', path: () => '/admin/commissions/rules', fields: ruleFields(), perm: 'commissions.create' }],
        rowActions: [
          { label: 'Edit', method: 'put', path: (r) => `/admin/commissions/rules/${r.id}`, fields: ruleFields(), perm: 'commissions.edit' },
          { label: 'Turn on/off', path: (r) => `/admin/commissions/rules/${r.id}/toggle`, confirm: (r) => `${r.isActive ? 'Deactivate' : 'Activate'} ${r.name}?`, perm: 'commissions.edit' },
        ],
      },
      { kind: 'table', title: 'Commission per booking', path: '/admin/commissions/bookings' },
      {
        kind: 'items', title: 'Transporter settlements', path: '/admin/commissions/settlements',
        rowActions: [{ label: 'Mark paid', variant: 'primary', path: (r) => `/admin/commissions/settlements/${r.id}/settle`, fields: [{ name: 'reference', label: 'Payout reference (UTR)', required: true }], when: (r) => r.status === 'PENDING', perm: 'commissions.approve' }],
      },
      { kind: 'kv', title: 'Summary by transporter and month', path: '/admin/commissions/summary' },
    ],
  },

  subscriptions: {
    title: 'Subscriptions',
    subtitle: 'Plans offered to companies and transporters, and who is subscribed.',
    sections: [
      {
        kind: 'items', title: 'Plans', path: '/admin/subscriptions/plans', dataKey: 'plans',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Plan' }, { key: 'userCategory', label: 'For' }, { key: 'price', label: 'Price', format: 'currency' },
          { key: 'validityDays', label: 'Days' }, { key: 'bookingLimit', label: 'Booking limit' }, { key: 'isActive', label: 'Active', render: (r) => (r.isActive ? 'Yes' : 'No') },
        ],
        actions: [{ label: 'New plan', variant: 'primary', path: () => '/admin/subscriptions/plans', fields: planFields(true), perm: 'subscriptions.create' }],
        rowActions: [{ label: 'Edit', method: 'put', path: (r) => `/admin/subscriptions/plans/${r.id}`, fields: planFields(false), perm: 'subscriptions.edit' }],
      },
      {
        kind: 'items', title: 'Subscribers', path: '/admin/subscriptions',
        filter: { param: 'status', tabs: tabs(['ACTIVE', 'EXPIRED', 'CANCELLED']) },
        stats: (d) => [{ label: 'Subscription revenue', value: `₹${Number(d.revenue ?? 0).toLocaleString('en-IN')}` }, { label: 'Up for renewal (15 days)', value: d.upForRenewal ?? 0 }],
        columns: [{ key: 'subscriber', label: 'Subscriber' }, { key: 'plan', label: 'Plan' }, { key: 'amount', label: 'Amount', format: 'currency' }, { key: 'startAt', label: 'Start', format: 'date' }, { key: 'endAt', label: 'End', format: 'date' }, { key: 'status', label: 'Status' }],
        rowActions: [{ label: 'Cancel', variant: 'danger', path: (r) => `/admin/subscriptions/${r.id}/cancel`, fields: [reason('Reason', true)], when: (r) => r.status === 'ACTIVE', perm: 'subscriptions.edit' }],
        actions: [
          {
            label: 'Assign plan', variant: 'primary', path: () => '/admin/subscriptions', perm: 'subscriptions.assign',
            fields: [
              { name: 'planId', label: 'Plan', type: 'select', required: true, optionsFrom: { path: '/admin/subscriptions/plans', dataKey: 'plans', value: (r) => r.id, label: (r) => `${r.name} (${r.userCategory}, ₹${r.price})` } },
              { name: 'subscriberId', label: 'Company or transporter ID', required: true, hint: 'Open the company or transporter page and copy its ID from the address bar' },
              { name: 'startAt', label: 'Start date', type: 'date' },
              { name: 'autoRenew', label: 'Renew automatically', type: 'checkbox' },
            ],
          },
        ],
      },
    ],
  },

  services: {
    title: 'Value-added services',
    subtitle: 'GPS devices, insurance, recruitment and other services sold to companies and transporters.',
    sections: [
      {
        kind: 'items', title: 'Service catalogue', path: '/admin/services', dataKey: 'services',
        columns: [
          { key: 'serviceCode', label: 'Code' }, { key: 'name', label: 'Service' }, { key: 'category', label: 'Category' }, { key: 'sellingPrice', label: 'Price', format: 'currency' },
          { key: 'costPrice', label: 'Cost', format: 'currency' }, { key: 'marginPercent', label: 'Margin', format: 'percent' }, { key: 'availability', label: 'Availability' }, { key: 'isActive', label: 'Active', render: (r) => (r.isActive ? 'Yes' : 'No') },
        ],
        actions: [{ label: 'New service', variant: 'primary', path: () => '/admin/services', fields: serviceFields(), perm: 'services.create' }],
        rowActions: [{ label: 'Edit', method: 'put', path: (r) => `/admin/services/${r.id}`, fields: serviceFields(), perm: 'services.edit' }],
      },
      {
        kind: 'items', title: 'Orders', path: '/admin/services/orders', dataKey: 'orders',
        stats: (d) => [{ label: 'Gross', value: `₹${Number(d.revenue?.gross ?? 0).toLocaleString('en-IN')}` }, { label: 'Net of tax', value: `₹${Number(d.revenue?.net ?? 0).toLocaleString('en-IN')}` }, { label: 'Margin', value: `₹${Number(d.revenue?.margin ?? 0).toLocaleString('en-IN')}` }],
        columns: [{ key: 'service', label: 'Service' }, { key: 'customer', label: 'Customer' }, { key: 'quantity', label: 'Qty' }, { key: 'totalAmount', label: 'Total', format: 'currency' }, { key: 'status', label: 'Status' }, { key: 'createdAt', label: 'Ordered', format: 'date' }],
        rowActions: [{ label: 'Update status', method: 'put', path: (r) => `/admin/services/orders/${r.id}`, fields: [{ name: 'status', label: 'Status', type: 'select', required: true, options: ['REQUESTED', 'CONFIRMED', 'FULFILLED', 'CANCELLED'], initial: (r) => r.status }], perm: 'services.edit' }],
        actions: [
          {
            label: 'Create order', variant: 'primary', path: () => '/admin/services/orders', perm: 'services.assign',
            fields: [
              { name: 'serviceId', label: 'Service', type: 'select', required: true, optionsFrom: { path: '/admin/services', dataKey: 'services', value: (r) => r.id, label: (r) => `${r.name} (₹${r.sellingPrice})` } },
              { name: 'customerType', label: 'Customer type', type: 'select', required: true, options: ['COMPANY', 'TRANSPORTER'] },
              { name: 'customerId', label: 'Customer ID', required: true, hint: 'Copy from the company or transporter page address' },
              { name: 'quantity', label: 'Quantity', type: 'number', initial: () => 1 },
              { name: 'notes', label: 'Notes', type: 'textarea' },
            ],
          },
        ],
      },
    ],
  },

  leads: {
    title: 'Leads',
    subtitle: 'Sales pipeline of prospective companies, transporters and drivers.',
    sections: [
      {
        kind: 'table', path: '/admin/leads', rowHref: (r) => `/leads/${r.id}`,
        filter: { param: 'status', tabs: tabs(['NEW', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP', 'REGISTRATION_PENDING', 'REGISTERED', 'NOT_INTERESTED', 'LOST']) },
        actions: [
          {
            label: 'Add lead', variant: 'primary', path: () => '/admin/leads', perm: 'leads.create',
            fields: [
              { name: 'leadType', label: 'Type', type: 'select', required: true, options: ['COMPANY', 'TRANSPORTER', 'DRIVER'] },
              { name: 'name', label: 'Business or person name', required: true },
              { name: 'contactPerson', label: 'Contact person' },
              { name: 'phone', label: 'Mobile number', required: true },
              { name: 'email', label: 'Email' },
              { name: 'gstNumber', label: 'GSTIN' },
              { name: 'city', label: 'City' },
              { name: 'state', label: 'State', hint: STATES_HINT },
              { name: 'source', label: 'Source', type: 'select', required: true, options: ['WEBSITE', 'REFERRAL', 'FIELD_VISIT', 'COLD_CALL', 'EXHIBITION', 'SOCIAL_MEDIA', 'PARTNER', 'INBOUND_CALL', 'OTHER'] },
              { name: 'assignedEmployeeId', label: 'Assign to', type: 'select', optionsFrom: employeeOptions },
              { name: 'nextFollowUpAt', label: 'Next follow-up', type: 'datetime' },
              { name: 'remarks', label: 'Remarks', type: 'textarea' },
            ],
          },
        ],
      },
      { kind: 'kv', title: 'Lead report by employee and source', path: '/admin/leads/report/employees' },
    ],
    detail: {
      path: (id) => `/admin/leads/${id}`,
      title: (d) => d.lead?.name ?? 'Lead',
      subtitle: (d) => `${d.lead?.leadCode ?? ''} · ${d.lead?.phone ?? ''}`,
      status: (d) => d.lead?.status,
      record: (d) => d.lead ?? d,
      actions: [
        { label: 'Log activity', variant: 'primary', path: (r) => `/admin/leads/${r.id}/activities`, perm: 'leads.edit', fields: [{ name: 'type', label: 'Type', type: 'select', required: true, options: ['CALL', 'MEETING', 'NOTE'] }, { name: 'connected', label: 'Call connected', type: 'checkbox' }, { name: 'outcome', label: 'Outcome' }, { name: 'notes', label: 'Notes', type: 'textarea' }, { name: 'status', label: 'New status', type: 'select', options: ['NEW', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP', 'REGISTRATION_PENDING', 'REGISTERED', 'VERIFIED', 'ACTIVE', 'NOT_INTERESTED', 'LOST'] }, { name: 'nextFollowUpAt', label: 'Next follow-up', type: 'datetime' }] },
        { label: 'Schedule follow-up', path: (r) => `/admin/leads/${r.id}/follow-ups`, perm: 'leads.edit', fields: [{ name: 'dueAt', label: 'When', type: 'datetime', required: true }, { name: 'notes', label: 'Notes', type: 'textarea' }] },
        { label: 'Reassign', path: (r) => `/admin/leads/${r.id}/assign`, perm: 'leads.assign', fields: [{ name: 'employeeId', label: 'Employee', type: 'select', required: true, optionsFrom: employeeOptions }, { name: 'reason', label: 'Reason', type: 'textarea' }] },
        { label: 'Delete', variant: 'danger', method: 'delete', path: (r) => `/admin/leads/${r.id}`, confirm: 'Delete this lead? This cannot be undone.', perm: 'leads.delete' },
      ],
    },
  },

  tasks: {
    title: 'Tasks & follow-ups',
    subtitle: 'Work assigned to employees and their scheduled follow-ups.',
    sections: [
      {
        kind: 'items', title: 'Tasks', path: '/admin/work/tasks',
        actions: [
          {
            label: 'New task', variant: 'primary', path: () => '/admin/work/tasks', perm: 'tasks.create',
            fields: [{ name: 'title', label: 'Title', required: true }, { name: 'assigneeId', label: 'Assign to', type: 'select', required: true, optionsFrom: employeeOptions }, { name: 'priority', label: 'Priority', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] }, { name: 'dueAt', label: 'Due', type: 'datetime' }, { name: 'description', label: 'Description', type: 'textarea' }],
          },
        ],
        rowActions: [{ label: 'Update', method: 'put', path: (r) => `/admin/work/tasks/${r.id}`, perm: 'tasks.edit', fields: [{ name: 'status', label: 'Status', type: 'select', options: ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'], initial: (r) => r.status }, { name: 'priority', label: 'Priority', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], initial: (r) => r.priority }, { name: 'dueAt', label: 'Due', type: 'datetime' }] }],
      },
      { kind: 'items', title: 'Follow-ups', path: '/admin/work/follow-ups' },
    ],
  },

  employees: {
    title: 'Employees',
    subtitle: 'TankerLink staff accounts. Employees cannot sign up themselves; their role decides what they can do.',
    sections: [
      {
        kind: 'table', path: '/admin/employees', rowHref: (r) => `/employees/${r.id}`,
        filter: { param: 'status', tabs: tabs(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ON_LEAVE', 'RESIGNED', 'TERMINATED']) },
        actions: [
          {
            label: 'Add employee', variant: 'primary', path: () => '/admin/employees', perm: 'employees.create',
            fields: [
              { name: 'fullName', label: 'Full name', required: true },
              { name: 'phone', label: 'Mobile number', required: true },
              { name: 'email', label: 'Email', required: true, hint: 'They activate access with "Forgot password"' },
              { name: 'roleId', label: 'Role', type: 'select', required: true, optionsFrom: roleOptions },
              { name: 'designation', label: 'Designation', required: true },
              { name: 'department', label: 'Department', required: true },
              { name: 'joiningDate', label: 'Joining date', type: 'date', required: true, initial: () => new Date().toISOString().slice(0, 10) },
              { name: 'employmentType', label: 'Employment type', type: 'select', options: ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] },
              { name: 'reportingManagerId', label: 'Reporting manager', type: 'select', optionsFrom: employeeOptions },
              { name: 'branch', label: 'Branch' },
              { name: 'territory', label: 'Territory' },
            ],
          },
        ],
      },
    ],
    detail: {
      path: (id) => `/admin/employees/${id}`,
      title: (d) => d.employee?.user?.fullName ?? d.employee?.name ?? 'Employee',
      subtitle: (d) => `${d.employee?.employeeCode ?? ''} · ${d.employee?.role?.name ?? ''} · ${d.employee?.user?.phone ?? ''}`,
      status: (d) => d.employee?.employmentStatus,
      record: (d) => d.employee ?? d,
      actions: [
        { label: 'Disable login', variant: 'danger', path: (r) => `/admin/employees/${r.id}/login-status`, fields: [{ name: 'reason', label: 'Reason', type: 'textarea' }], body: (v) => ({ enabled: false, ...v }), when: (r) => r.loginEnabled !== false, perm: 'employees.edit' },
        { label: 'Enable login', variant: 'primary', path: (r) => `/admin/employees/${r.id}/login-status`, confirm: 'Allow this employee to sign in again?', body: () => ({ enabled: true }), when: (r) => r.loginEnabled === false, perm: 'employees.edit' },
        { label: 'Reset access', path: (r) => `/admin/employees/${r.id}/reset-access`, confirm: 'End all sessions and clear the password? The employee must use "Forgot password" to sign in again.', perm: 'employees.edit' },
        {
          label: 'Edit', method: 'put', path: (r) => `/admin/employees/${r.id}`, perm: 'employees.edit',
          fields: [
            { name: 'designation', label: 'Designation', initial: (r) => r.designation },
            { name: 'department', label: 'Department', initial: (r) => r.department },
            { name: 'roleId', label: 'Role', type: 'select', optionsFrom: roleOptions, initial: (r) => r.roleId ?? r.role?.id },
            { name: 'employmentStatus', label: 'Employment status', type: 'select', options: ['ACTIVE', 'ON_LEAVE', 'RESIGNED', 'TERMINATED'], initial: (r) => r.employmentStatus },
            { name: 'branch', label: 'Branch', initial: (r) => r.branch },
            { name: 'territory', label: 'Territory', initial: (r) => r.territory },
          ],
        },
      ],
    },
  },

  activity: {
    title: 'Employee activity',
    subtitle: 'Every change made by an employee. This log is append-only and cannot be edited or deleted.',
    sections: [
      {
        kind: 'items', path: '/admin/hr/activity-logs', paged: true,
        columns: [{ key: 'at', label: 'When', format: 'datetime' }, { key: 'employeeName', label: 'Employee' }, { key: 'employeeCode', label: 'Code' }, { key: 'action', label: 'Action' }, { key: 'module', label: 'Module' }, { key: 'ipAddress', label: 'IP address' }],
      },
    ],
  },
};

function ruleFields(): FieldDef[] {
  return [
    { name: 'name', label: 'Rule name', required: true, initial: (r) => r.name },
    { name: 'calcType', label: 'Type', type: 'select', required: true, options: ['PERCENT', 'FIXED'], initial: (r) => r.calcType },
    { name: 'value', label: 'Value (% or ₹)', type: 'number', required: true, initial: (r) => r.value },
    { name: 'priority', label: 'Priority (higher wins)', type: 'number', initial: (r) => r.priority ?? 0 },
    { name: 'effectiveFrom', label: 'Effective from', type: 'date', required: true, initial: (r) => r.effectiveFrom ?? new Date().toISOString() },
    { name: 'effectiveTo', label: 'Effective to', type: 'date', nullable: true, initial: (r) => r.effectiveTo },
    { name: 'originState', label: 'Pickup state', hint: STATES_HINT, nullable: true, initial: (r) => r.originState },
    { name: 'destState', label: 'Delivery state', hint: STATES_HINT, nullable: true, initial: (r) => r.destState },
    { name: 'bookingType', label: 'Booking type', type: 'select', options: ['PORTAL', 'ADMIN_ASSISTED'], nullable: true, initial: (r) => r.bookingType },
    { name: 'promoCode', label: 'Promo code', nullable: true, initial: (r) => r.promoCode },
    { name: 'isActive', label: 'Active', type: 'checkbox', initial: (r) => r.isActive ?? true },
  ];
}

function planFields(withCode: boolean): FieldDef[] {
  return [
    ...(withCode ? [{ name: 'code', label: 'Code', required: true, hint: 'Capitals, digits and _' } as FieldDef] : []),
    { name: 'name', label: 'Name', required: true, initial: (r) => r.name },
    { name: 'userCategory', label: 'For', type: 'select', required: true, options: ['COMPANY', 'TRANSPORTER'], initial: (r) => r.userCategory },
    { name: 'price', label: 'Price (₹)', type: 'number', required: true, initial: (r) => r.price },
    { name: 'validityDays', label: 'Validity (days)', type: 'number', required: true, initial: (r) => r.validityDays ?? 365 },
    { name: 'priorityLevel', label: 'Priority level (0-10)', type: 'number', required: true, initial: (r) => r.priorityLevel ?? 0 },
    { name: 'bookingLimit', label: 'Booking limit', type: 'number', nullable: true, hint: 'Empty for unlimited', initial: (r) => r.bookingLimit },
    { name: 'isActive', label: 'Active', type: 'checkbox', initial: (r) => r.isActive ?? true },
    { name: 'features', label: 'Features (one per line)', type: 'lines', initial: (r) => r.features ?? [] },
  ];
}

function serviceFields(): FieldDef[] {
  return [
    { name: 'name', label: 'Name', required: true, initial: (r) => r.name },
    { name: 'category', label: 'Category', type: 'select', required: true, options: ['GPS_TRACKING_DEVICES', 'GPS_SUBSCRIPTIONS', 'VEHICLE_INSURANCE', 'DRIVER_RECRUITMENT', 'DRIVER_TRAINING', 'TYRES', 'BATTERIES', 'VEHICLE_MAINTENANCE', 'FLEET_SOFTWARE', 'PREMIUM_LISTING', 'ADVERTISING', 'LOGISTICS_CONSULTANCY'], initial: (r) => r.category },
    { name: 'sellingPrice', label: 'Selling price (₹)', type: 'number', required: true, initial: (r) => r.sellingPrice },
    { name: 'costPrice', label: 'Cost price (₹)', type: 'number', required: true, initial: (r) => r.costPrice },
    { name: 'taxRate', label: 'GST %', type: 'number', required: true, initial: (r) => r.taxRate ?? 18 },
    { name: 'availability', label: 'Availability', type: 'select', required: true, options: ['AVAILABLE', 'LIMITED', 'UNAVAILABLE'], initial: (r) => r.availability ?? 'AVAILABLE' },
    { name: 'partnerName', label: 'Partner name', initial: (r) => r.partnerName },
    { name: 'requiresLicensedPartner', label: 'Needs a licensed partner (required for insurance)', type: 'checkbox', initial: (r) => r.requiresLicensedPartner },
    { name: 'isActive', label: 'Active', type: 'checkbox', initial: (r) => r.isActive ?? true },
    { name: 'description', label: 'Description', type: 'textarea', initial: (r) => r.description },
  ];
}
