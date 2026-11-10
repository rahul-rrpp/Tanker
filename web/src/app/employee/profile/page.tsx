'use client';

import { Section, useProfile } from '@/components/employee/kit';
import { KV, LoadingBlock, PageHeader } from '@/components/ui/kit';
import { dateIST, humanize } from '@/lib/format';

export default function Page() {
  const { data } = useProfile();
  if (!data) return <LoadingBlock />;
  const e = data.employee;
  return (
    <>
      <PageHeader title="My profile" subtitle="Employment details are maintained by HR" />
      <Section title={e.user.fullName}><dl className="divide-y divide-line"><KV label="Employee ID">{e.employeeCode}</KV><KV label="Designation">{e.designation}</KV><KV label="Department">{e.department}</KV><KV label="Role">{e.role.name}</KV><KV label="Manager">{e.reportingManager?.user.fullName}</KV><KV label="Joining date">{dateIST(e.joiningDate)}</KV><KV label="Employment">{e.employmentType ? humanize(e.employmentType) : null}</KV><KV label="Mobile">{e.user.phone}</KV><KV label="Email">{e.user.email}</KV><KV label="Branch">{e.branch}</KV><KV label="Territory">{e.territory}</KV></dl></Section>
    </>
  );
}
