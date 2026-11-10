'use client';

import { Mail, Pencil, Phone, Plus, Star, Trash2, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EmptyState, Modal, SectionTitle, useToast } from '@/components/ui/kit';
import { Alert, Button, Card, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { useApi } from '@/lib/useApi';

interface Contact {
  id: string;
  name: string;
  designation: string | null;
  department: string | null;
  phone: string;
  email: string | null;
  isPrimary: boolean;
}

const blank = { name: '', designation: '', department: '', phone: '', email: '' };

/** Authorized contacts: add, edit and delete (the primary contact is managed in Business information). */
export function ContactsCard() {
  const toast = useToast();
  const { data, mutate } = useApi<{ contacts: Contact[] }>('/companies/contacts');
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [f, setF] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setErrors({});
    setError(null);
    if (editing === 'new') setF(blank);
    else if (editing) setF({ name: editing.name, designation: editing.designation ?? '', department: editing.department ?? '', phone: editing.phone, email: editing.email ?? '' });
  }, [editing]);

  async function save() {
    setBusy(true);
    setErrors({});
    setError(null);
    try {
      if (editing === 'new') await api.post('/companies/contacts', f);
      else if (editing) await api.put(`/companies/contacts/${editing.id}`, f);
      toast.success(editing === 'new' ? 'Contact added' : 'Contact updated');
      setEditing(null);
      void mutate();
    } catch (e) {
      const err = parseApiError(e);
      setError(err.message);
      setErrors(Object.fromEntries(err.fields.map((x) => [x.field, x.message])));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/companies/contacts/${deleting.id}`);
      toast.success(`${deleting.name} removed`);
      setDeleting(null);
      void mutate();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const contacts = data?.contacts ?? [];

  return (
    <Card>
      <SectionTitle
        action={
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" /> Add contact
          </Button>
        }
      >
        Authorized contacts
      </SectionTitle>
      {contacts.length === 0 ? (
        <EmptyState title="No contacts yet" icon={<Users className="h-6 w-6" />} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {contacts.map((c) => (
            <li key={c.id} className="rounded-xl border border-line p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 font-semibold text-ink">
                    {c.name} {c.isPrimary && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Primary contact" />}
                  </p>
                  <p className="text-xs text-muted">{[c.designation, c.department].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                {!c.isPrimary && (
                  <div className="flex gap-1">
                    <button onClick={() => setEditing(c)} className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink" aria-label={`Edit ${c.name}`}>
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button onClick={() => setDeleting(c)} className="rounded-lg p-1.5 text-muted hover:bg-red-50 hover:text-danger" aria-label={`Delete ${c.name}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
              <p className="mt-2 flex items-center gap-1.5 text-sm text-ink">
                <Phone className="h-3.5 w-3.5 text-muted" />
                <a href={`tel:+91${c.phone}`} className="hover:text-brand-700">
                  +91 {c.phone}
                </a>
              </p>
              {c.email && (
                <p className="flex items-center gap-1.5 text-sm text-ink">
                  <Mail className="h-3.5 w-3.5 text-muted" />
                  <a href={`mailto:${c.email}`} className="truncate hover:text-brand-700">
                    {c.email}
                  </a>
                </p>
              )}
              {c.isPrimary && <p className="mt-2 text-xs text-muted">Primary contact — edit it under Business information.</p>}
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Add authorized contact' : 'Edit contact'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} loading={busy}>
              Save contact
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert>{error}</Alert>}
          <TextField label="Name" value={f.name} onChange={set('name')} error={errors.name} required />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Designation" value={f.designation} onChange={set('designation')} error={errors.designation} placeholder="e.g. Logistics Manager" />
            <TextField label="Department" value={f.department} onChange={set('department')} error={errors.department} placeholder="e.g. Supply chain" />
            <TextField label="Mobile" prefix="+91" inputMode="numeric" value={f.phone} onChange={set('phone')} error={errors.phone} required />
            <TextField label="Email" type="email" value={f.email} onChange={set('email')} error={errors.email} />
          </div>
        </div>
      </Modal>
      <Modal
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        title={`Remove ${deleting?.name}?`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove} loading={busy}>
              Remove contact
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">This contact will no longer appear on your company profile.</p>
      </Modal>
    </Card>
  );
}
