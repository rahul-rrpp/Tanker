'use client';

import { useState } from 'react';
import { DataTable } from '@/components/DataTable';
import { useCan } from '@/components/Shell';
import { Alert, Badge, Button, ErrorState, Input, Loading, Modal, PageHeader, Section, Select, Textarea, useToast } from '@/components/ui';
import { api, parseApiError, useApi } from '@/lib/api';
import { humanize } from '@/lib/format';

type Role = { id: string; code: string; name: string; description: string | null; dataScope: 'ALL' | 'ASSIGNED'; isActive: boolean; isSystem: boolean; permissions: string[]; employees: number };
type Matrix = { modules: { key: string; label: string; actions: string[] }[] };
type Draft = { id?: string; code: string; name: string; description: string; dataScope: 'ALL' | 'ASSIGNED'; isActive: boolean; permissions: Set<string> };

const key = (m: string, a: string) => `adm.${m}.${a}`;

function RoleEditor({ draft, matrix, onClose, onSaved }: { draft: Draft; matrix: Matrix; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [d, setD] = useState(draft);
  const [fail, setFail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setD((x) => { const p = new Set(x.permissions); if (p.has(k)) p.delete(k); else p.add(k); return { ...x, permissions: p }; });
  const toggleModule = (m: Matrix['modules'][number]) => setD((x) => {
    const p = new Set(x.permissions);
    const all = m.actions.every((a) => p.has(key(m.key, a)));
    m.actions.forEach((a) => (all ? p.delete(key(m.key, a)) : p.add(key(m.key, a))));
    return { ...x, permissions: p };
  });
  const save = async () => {
    setBusy(true);
    setFail(null);
    try {
      const body = { name: d.name.trim(), description: d.description.trim() || undefined, dataScope: d.dataScope, isActive: d.isActive, permissions: [...d.permissions] };
      const r = d.id ? await api.put(`/admin/roles/${d.id}`, body) : await api.post('/admin/roles', { ...body, code: d.code.trim() });
      toast.success(r.data.message ?? 'Saved');
      onSaved();
    } catch (e) {
      setFail(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open wide onClose={onClose} title={d.id ? `Edit role: ${draft.name}` : 'New role'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={d.name.trim().length < 3 || (!d.id && !/^[A-Z][A-Z0-9_]{2,39}$/.test(d.code.trim()))} onClick={() => void save()}>Save role</Button></>}>
      <div className="space-y-4">
        {fail && <Alert tone="error">{fail}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          {!d.id && <Input label="Code" required hint="Capitals, digits and _ (e.g. REGIONAL_MANAGER). Cannot be changed later." value={d.code} onChange={(e) => setD({ ...d, code: e.target.value.toUpperCase() })} />}
          <Input label="Name" required value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
          <Select label="Sees" value={d.dataScope} onChange={(e) => setD({ ...d, dataScope: e.target.value as Draft['dataScope'] })}><option value="ASSIGNED">Only records assigned to them</option><option value="ALL">All records</option></Select>
          <label className="flex items-center gap-2 self-end py-2 text-sm"><input type="checkbox" checked={d.isActive} onChange={(e) => setD({ ...d, isActive: e.target.checked })} className="h-4 w-4" />Active</label>
          <div className="sm:col-span-2"><Textarea label="Description" value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></div>
        </div>
        <div>
          <p className="mb-2 text-sm font-semibold text-ink">Permissions <span className="font-normal text-muted">({d.permissions.size} selected)</span></p>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {matrix.modules.map((m) => (
                  <tr key={m.key}>
                    <td className="w-48 px-3 py-2 align-top"><button type="button" onClick={() => toggleModule(m)} className="text-left font-medium text-ink hover:text-brand-700">{m.label}</button></td>
                    <td className="px-3 py-2"><div className="flex flex-wrap gap-x-4 gap-y-1">{m.actions.map((a) => <label key={a} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={d.permissions.has(key(m.key, a))} onChange={() => toggle(key(m.key, a))} className="h-3.5 w-3.5" />{humanize(a)}</label>)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">Click a module name to tick or clear all its actions. Employees never get Super Admin rights, whatever their role.</p>
        </div>
      </div>
    </Modal>
  );
}

export default function RolesPage() {
  const can = useCan();
  const toast = useToast();
  const roles = useApi<{ roles: Role[] }>('/admin/roles');
  const matrix = useApi<Matrix>('/admin/roles/matrix');
  const [editing, setEditing] = useState<Draft | null>(null);
  const remove = async (r: Role) => {
    if (!window.confirm(`Delete the role "${r.name}"?`)) return;
    try {
      await api.delete(`/admin/roles/${r.id}`);
      toast.success('Role deleted');
      void roles.mutate();
    } catch (e) {
      toast.error(e);
    }
  };
  const open = (r?: Role) => setEditing(r ? { id: r.id, code: r.code, name: r.name, description: r.description ?? '', dataScope: r.dataScope, isActive: r.isActive, permissions: new Set(r.permissions) } : { code: '', name: '', description: '', dataScope: 'ASSIGNED', isActive: true, permissions: new Set() });
  return (
    <>
      <PageHeader title="Roles & permissions" subtitle="A role decides which admin modules an employee can use and whether they see all records or only their assigned ones." actions={can('roles.create') && <Button onClick={() => open()}>New role</Button>} />
      <Section>
        {roles.error ? <ErrorState error={roles.error} /> : !roles.data ? <Loading /> : (
          <DataTable
            rows={roles.data.roles}
            columns={[
              { key: 'name', label: 'Role', render: (r) => <div><p className="font-medium">{r.name}</p><p className="text-xs text-muted">{r.code}{r.isSystem ? ' · built-in' : ''}</p></div> },
              { key: 'dataScope', label: 'Sees', render: (r) => (r.dataScope === 'ALL' ? 'All records' : 'Assigned records') },
              { key: 'permissions', label: 'Permissions', render: (r) => r.permissions.length },
              { key: 'employees', label: 'Employees' },
              { key: 'isActive', label: 'Status', render: (r) => <Badge tone={r.isActive ? 'success' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge> },
            ]}
            actions={(r) => (
              <>
                {can('roles.edit') && <Button size="sm" variant="secondary" disabled={!matrix.data} onClick={() => open(r as Role)}>Edit</Button>}
                {can('roles.delete') && !r.isSystem && <Button size="sm" variant="ghost" onClick={() => void remove(r as Role)}>Delete</Button>}
              </>
            )}
          />
        )}
      </Section>
      {editing && matrix.data && <RoleEditor draft={editing} matrix={matrix.data} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void roles.mutate(); }} />}
    </>
  );
}
