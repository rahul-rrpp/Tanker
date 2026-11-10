'use client';

import clsx from 'clsx';
import { CreditCard, FlaskConical, Landmark, ShieldCheck, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Modal, useToast } from '@/components/ui/kit';
import { Alert, Button } from '@/components/ui/primitives';
import { api, parseApiError } from '@/lib/api';
import { inr } from '@/lib/format';

interface Order {
  paymentId: string;
  provider: 'RAZORPAY' | 'MOCK';
  orderId: string;
  amount: number;
  amountPaise: number;
  keyId: string | null;
  description: string;
  prefill: { name: string; email: string; contact: string };
  testMode: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function loadRazorpay(): Promise<any> {
  const w = window as any;
  if (w.Razorpay) return Promise.resolve(w.Razorpay);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(w.Razorpay);
    s.onerror = () => reject(new Error('Could not load Razorpay checkout'));
    document.body.appendChild(s);
  });
}

/**
 * Payment flow. The browser never decides that a payment succeeded: after checkout it sends the gateway's
 * signed response to /payments/verify, and only the backend (signature + gateway lookup) marks it PAID.
 */
export function PayButton({ bookingId, purpose, amount, label, onDone, variant = 'primary' }: { bookingId: string; purpose: 'ADVANCE' | 'BALANCE' | 'FULL'; amount: number; label: string; onDone: () => void; variant?: 'primary' | 'secondary' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [mockOrder, setMockOrder] = useState<Order | null>(null);
  const [method, setMethod] = useState<'upi' | 'netbanking' | 'debit_card' | 'credit_card'>('upi');
  const [mockBusy, setMockBusy] = useState<'success' | 'failure' | null>(null);
  const [mockError, setMockError] = useState<string | null>(null);

  async function verify(orderId: string, paymentId: string, signature: string) {
    await api.post('/payments/verify', { orderId, paymentId, signature });
    toast.success('Payment verified. Receipt generated.');
    onDone();
  }

  async function start() {
    setBusy(true);
    try {
      const { data } = await api.post('/payments/create-order', { bookingId, purpose });
      const order: Order = data.data.order;
      if (order.provider === 'MOCK') {
        setMockError(null);
        setMockOrder(order);
        return;
      }
      const Razorpay = await loadRazorpay();
      const rzp = new Razorpay({
        key: order.keyId,
        order_id: order.orderId,
        amount: order.amountPaise,
        currency: 'INR',
        name: 'TankerLink',
        description: order.description,
        prefill: order.prefill,
        theme: { color: '#2563eb' },
        handler: async (resp: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
          try {
            await verify(resp.razorpay_order_id, resp.razorpay_payment_id, resp.razorpay_signature);
          } catch (e) {
            toast.error(e);
          }
        },
        modal: {
          ondismiss: () => {
            void api.post('/payments/failed', { orderId: order.orderId, reason: 'Checkout closed by user' }).finally(onDone);
          },
        },
      });
      rzp.on('payment.failed', (r: { error?: { description?: string } }) => {
        void api.post('/payments/failed', { orderId: order.orderId, reason: r.error?.description ?? 'Payment failed' }).finally(onDone);
      });
      rzp.open();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function simulate(outcome: 'success' | 'failure') {
    if (!mockOrder) return;
    setMockBusy(outcome);
    setMockError(null);
    try {
      const { data } = await api.post('/payments/mock/checkout', { orderId: mockOrder.orderId, outcome, method });
      const r = data.data;
      if (r.outcome === 'success') {
        await verify(r.orderId, r.paymentId, r.signature);
      } else {
        await api.post('/payments/failed', { orderId: r.orderId, reason: r.error });
        toast.error('Payment failed (simulated). No amount was captured.');
        onDone();
      }
      setMockOrder(null);
    } catch (e) {
      setMockError(parseApiError(e).message);
    } finally {
      setMockBusy(null);
    }
  }

  const METHODS = [
    { v: 'upi', label: 'UPI', icon: Smartphone },
    { v: 'netbanking', label: 'Net Banking', icon: Landmark },
    { v: 'debit_card', label: 'Debit card', icon: CreditCard },
    { v: 'credit_card', label: 'Credit card', icon: CreditCard },
  ] as const;

  return (
    <>
      <Button size="sm" variant={variant} onClick={start} loading={busy}>
        <CreditCard className="h-4 w-4" /> {label} {inr(amount)}
      </Button>
      <Modal
        open={Boolean(mockOrder)}
        onClose={() => !mockBusy && setMockOrder(null)}
        title="Development payment simulator"
        footer={
          <>
            <Button variant="secondary" onClick={() => simulate('failure')} loading={mockBusy === 'failure'} disabled={Boolean(mockBusy)}>
              Simulate failure
            </Button>
            <Button onClick={() => simulate('success')} loading={mockBusy === 'success'} disabled={Boolean(mockBusy)}>
              Simulate successful payment
            </Button>
          </>
        }
      >
        <div className="space-y-4 text-sm">
          <div className="flex items-start gap-2 rounded-xl border border-dashed border-fuchsia-300 bg-fuchsia-50 p-3 text-fuchsia-900">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              No money moves. This simulates the hosted gateway checkout (PAYMENT_PROVIDER=mock). The result is still verified by the server
              with a signed callback, exactly like Razorpay.
            </p>
          </div>
          {mockError && <Alert>{mockError}</Alert>}
          <div className="flex items-center justify-between rounded-xl bg-canvas p-3">
            <span className="text-muted">{mockOrder?.description}</span>
            <span className="text-lg font-bold">{mockOrder ? inr(mockOrder.amount, { decimals: true }) : ''}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {METHODS.map(({ v, label: l, icon: Icon }) => (
              <button key={v} type="button" onClick={() => setMethod(v)} className={clsx('flex items-center gap-2 rounded-xl border p-3 text-left text-sm font-medium', method === v ? 'border-brand-600 bg-brand-50' : 'border-line')}>
                <Icon className="h-4 w-4" /> {l}
              </button>
            ))}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5" /> Order {mockOrder?.orderId}
          </p>
        </div>
      </Modal>
    </>
  );
}
