'use client';

import { ActionButton } from '@/components/Actions';
import { DataTable } from '@/components/DataTable';
import { ErrorState, KV, Loading, PageHeader, Section } from '@/components/ui';
import type { Rec } from '@/config/types';
import { useApi } from '@/lib/api';

type Kpi = { definitions: Rec[]; targets: Rec[] };
type Rules = { shiftStart: string; shiftEnd: string; lateGraceMinutes: number; fullDayMinutes: number; halfDayMinutes: number; weeklyOffDays: number[]; holidays: string[] };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function HrSettingsPage() {
  const kpi = useApi<Kpi>('/admin/hr/kpi-targets');
  const leave = useApi<{ items: Rec[] }>('/admin/hr/leave-policies');
  const rules = useApi<Rules>('/admin/hr/attendance-rules');
  const kpiName = new Map((kpi.data?.definitions ?? []).map((d) => [d.code as string, d.name as string]));

  return (
    <>
      <PageHeader title="HR settings" subtitle="Monthly KPI targets per role, leave entitlements and attendance rules used across the Employee Portal." />
      <div className="space-y-6">
        <Section
          title="Attendance rules"
          actions={rules.data && (
            <ActionButton
              size="md"
              record={rules.data}
              onDone={() => void rules.mutate()}
              action={{
                label: 'Edit rules', method: 'put', path: () => '/admin/hr/attendance-rules', perm: 'settings.edit',
                fields: [
                  { name: 'shiftStart', label: 'Shift starts (HH:MM)', required: true, initial: (r) => r.shiftStart },
                  { name: 'shiftEnd', label: 'Shift ends (HH:MM)', required: true, initial: (r) => r.shiftEnd },
                  { name: 'lateGraceMinutes', label: 'Late after (minutes of grace)', type: 'number', required: true, initial: (r) => r.lateGraceMinutes },
                  { name: 'fullDayMinutes', label: 'Full day (minutes worked)', type: 'number', required: true, initial: (r) => r.fullDayMinutes },
                  { name: 'halfDayMinutes', label: 'Half day (minutes worked)', type: 'number', required: true, initial: (r) => r.halfDayMinutes },
                  { name: 'weeklyOffDays', label: 'Weekly off days', type: 'numberList', hint: '0 = Sunday … 6 = Saturday, comma separated', initial: (r) => r.weeklyOffDays },
                  { name: 'holidays', label: 'Holidays (one YYYY-MM-DD per line)', type: 'lines', initial: (r) => r.holidays },
                ],
              }}
            />
          )}
        >
          {rules.error ? <ErrorState error={rules.error} /> : !rules.data ? <Loading /> : (
            <KV items={[
              { label: 'Shift', value: `${rules.data.shiftStart} – ${rules.data.shiftEnd}` },
              { label: 'Late after', value: `${rules.data.lateGraceMinutes} min grace` },
              { label: 'Full day / half day', value: `${rules.data.fullDayMinutes / 60} h / ${rules.data.halfDayMinutes / 60} h` },
              { label: 'Weekly off', value: rules.data.weeklyOffDays.map((d) => DAYS[d]).join(', ') || 'None' },
              { label: 'Holidays', value: rules.data.holidays.length ? rules.data.holidays.join(', ') : 'None set' },
            ]} />
          )}
        </Section>

        <Section title="Leave policies">
          {leave.error ? <ErrorState error={leave.error} /> : !leave.data ? <Loading /> : (
            <DataTable
              rows={leave.data.items}
              columns={[{ key: 'code', label: 'Code' }, { key: 'name', label: 'Leave type' }, { key: 'daysPerYear', label: 'Days per year' }, { key: 'isActive', label: 'Active', render: (r) => (r.isActive ? 'Yes' : 'No') }]}
              actions={(r) => (
                <ActionButton
                  record={r}
                  onDone={() => void leave.mutate()}
                  action={{ label: 'Edit', method: 'put', path: (x) => `/admin/hr/leave-policies/${x.code}`, perm: 'settings.edit', fields: [{ name: 'name', label: 'Name', required: true, initial: (x) => x.name }, { name: 'daysPerYear', label: 'Days per year', type: 'number', required: true, initial: (x) => x.daysPerYear }, { name: 'isActive', label: 'Active', type: 'checkbox', initial: (x) => x.isActive }] }}
                />
              )}
            />
          )}
        </Section>

        <Section
          title="KPI targets"
          actions={kpi.data && (
            <ActionButton
              size="md"
              record={{}}
              onDone={() => void kpi.mutate()}
              action={{
                label: 'Set a target', variant: 'primary', method: 'put', path: () => '/admin/hr/kpi-targets', perm: 'performance.edit',
                fields: [
                  { name: 'kpiCode', label: 'KPI', type: 'select', required: true, options: kpi.data.definitions.map((d) => ({ value: d.code as string, label: `${d.name} (${d.unit})` })) },
                  { name: 'roleId', label: 'Role', type: 'select', required: true, optionsFrom: { path: '/admin/roles', dataKey: 'roles', value: (r) => r.id, label: (r) => r.name } },
                  { name: 'monthlyTarget', label: 'Monthly target', type: 'number', required: true },
                  { name: 'weightage', label: 'Weightage (%)', type: 'number', required: true, hint: 'Share of the monthly score, 0–100' },
                ],
              }}
            />
          )}
        >
          {kpi.error ? <ErrorState error={kpi.error} /> : !kpi.data ? <Loading /> : (
            <DataTable
              rows={kpi.data.targets}
              columns={[
                { key: 'role', label: 'Role', render: (r) => r.role?.name ?? r.employee?.user?.fullName ?? '—' },
                { key: 'kpiCode', label: 'KPI', render: (r) => kpiName.get(r.kpiCode) ?? r.kpiCode },
                { key: 'monthlyTarget', label: 'Monthly target', format: 'number' },
                { key: 'weightage', label: 'Weightage', render: (r) => `${r.weightage}%` },
              ]}
            />
          )}
        </Section>
      </div>
    </>
  );
}
