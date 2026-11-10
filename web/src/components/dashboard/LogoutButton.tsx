'use client';

import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '../ui/primitives';

export function LogoutButton({ all, variant = 'secondary' }: { all?: boolean; variant?: 'secondary' | 'ghost' | 'danger' }) {
  const [loading, setLoading] = useState(false);
  async function logout() {
    setLoading(true);
    try {
      await api.post(all ? '/auth/logout-all' : '/auth/logout', {});
    } finally {
      // Full navigation so middleware and server components see the cleared cookies.
      window.location.assign('/login?reason=logout');
    }
  }
  return (
    <Button variant={variant} size="sm" onClick={logout} loading={loading}>
      <LogOut className="h-4 w-4" aria-hidden />
      {all ? 'Sign out of all devices' : 'Sign out'}
    </Button>
  );
}
