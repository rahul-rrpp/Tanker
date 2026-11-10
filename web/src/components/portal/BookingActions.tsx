'use client';

import { useEffect, useState } from 'react';
import { Modal, TextArea, useToast } from '@/components/ui/kit';
import { Alert, Button, TextField } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { todayIST } from '@/lib/format';

export function CancelBookingDialog({ open, onClose, booking, onDone }: { open: boolean; onClose: () => void; booking: { id: string; bookingCode: string; status: string } | null; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);
  async function submit() {
    if (!booking) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/bookings/${booking.id}/cancel`, { reason });
      toast.success(`Booking ${booking.bookingCode} cancelled`);
      onDone();
      onClose();
    } catch (e) {
      setError(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Cancel ${booking?.bookingCode ?? 'booking'}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep booking
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={reason.trim().length < 5}>
            Cancel booking
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-muted">
          All open transporter offers will be closed.{booking?.status === 'CONFIRMED' ? ' The confirmed transporter will be released; any payment already made is marked for refund.' : ''}
        </p>
        <TextArea label="Reason for cancellation" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} placeholder="e.g. Production plan changed" />
      </div>
    </Modal>
  );
}

interface Editable {
  id: string;
  bookingCode: string;
  version: number;
  loadingDate: string;
  loadingTime: string;
  loadingContactName: string;
  loadingContactPhone: string;
  loadingInstructions: string | null;
  expectedDeliveryDate: string;
  deliveryContactName: string;
  deliveryContactPhone: string;
  deliveryInstructions: string | null;
  customerOffer: number;
  suggestedFreight: number;
  requirement: { specialRequirements: string | null } | null;
}

/** Edit while the booking is still searching with no offers (enforced by the backend too). */
export function EditBookingDialog({ open, onClose, booking, onDone }: { open: boolean; onClose: () => void; booking: Editable | null; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open && booking) {
      setF({
        loadingDate: booking.loadingDate.slice(0, 10),
        loadingTime: booking.loadingTime,
        loadingContactName: booking.loadingContactName,
        loadingContactPhone: booking.loadingContactPhone,
        loadingInstructions: booking.loadingInstructions ?? '',
        expectedDeliveryDate: booking.expectedDeliveryDate.slice(0, 10),
        deliveryContactName: booking.deliveryContactName,
        deliveryContactPhone: booking.deliveryContactPhone,
        deliveryInstructions: booking.deliveryInstructions ?? '',
        specialRequirements: booking.requirement?.specialRequirements ?? '',
        customerOffer: String(booking.customerOffer),
      });
      setError(null);
      setFieldErrors({});
    }
  }, [open, booking]);

  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    if (!booking) return;
    setBusy(true);
    setError(null);
    try {
      await api.put(`/bookings/${booking.id}`, {
        version: booking.version,
        loadingDate: f.loadingDate,
        loadingTime: f.loadingTime,
        loadingContactName: f.loadingContactName,
        loadingContactPhone: f.loadingContactPhone,
        loadingInstructions: f.loadingInstructions || undefined,
        expectedDeliveryDate: f.expectedDeliveryDate,
        deliveryContactName: f.deliveryContactName,
        deliveryContactPhone: f.deliveryContactPhone,
        deliveryInstructions: f.deliveryInstructions || undefined,
        specialRequirements: f.specialRequirements || undefined,
        customerOffer: Number(f.customerOffer),
      });
      toast.success(`Booking ${booking.bookingCode} updated`);
      onDone();
      onClose();
    } catch (e) {
      const err = parseApiError(e);
      setError(err.message);
      setFieldErrors(Object.fromEntries(err.fields.map((x) => [x.field, x.message])));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${booking?.bookingCode ?? ''}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-xs text-muted">Route, product and tanker size cannot be changed — cancel and re-book (or use Repeat) for that.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Loading date" type="date" min={todayIST()} value={f.loadingDate ?? ''} onChange={set('loadingDate')} error={fieldErrors.loadingDate} />
          <TextField label="Loading time" type="time" value={f.loadingTime ?? ''} onChange={set('loadingTime')} error={fieldErrors.loadingTime} />
          <TextField label="Loading contact" value={f.loadingContactName ?? ''} onChange={set('loadingContactName')} error={fieldErrors.loadingContactName} />
          <TextField label="Loading contact number" value={f.loadingContactPhone ?? ''} onChange={set('loadingContactPhone')} error={fieldErrors.loadingContactPhone} />
          <TextField label="Expected delivery date" type="date" min={f.loadingDate} value={f.expectedDeliveryDate ?? ''} onChange={set('expectedDeliveryDate')} error={fieldErrors.expectedDeliveryDate} />
          <TextField label="Your freight offer (₹)" type="number" value={f.customerOffer ?? ''} onChange={set('customerOffer')} error={fieldErrors.customerOffer} hint={booking ? `Suggested ₹${booking.suggestedFreight.toLocaleString('en-IN')}` : undefined} />
          <TextField label="Delivery contact" value={f.deliveryContactName ?? ''} onChange={set('deliveryContactName')} error={fieldErrors.deliveryContactName} />
          <TextField label="Delivery contact number" value={f.deliveryContactPhone ?? ''} onChange={set('deliveryContactPhone')} error={fieldErrors.deliveryContactPhone} />
        </div>
        <TextArea label="Loading instructions" value={f.loadingInstructions ?? ''} onChange={set('loadingInstructions')} />
        <TextArea label="Delivery instructions" value={f.deliveryInstructions ?? ''} onChange={set('deliveryInstructions')} />
        <TextArea label="Special requirements" value={f.specialRequirements ?? ''} onChange={set('specialRequirements')} />
      </div>
    </Modal>
  );
}
