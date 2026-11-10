'use client';

import { useEffect, useState } from 'react';

/** Seconds-remaining countdown used for OTP resend cooldowns. */
export function useCountdown() {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining]);
  return { remaining, start: (seconds: number) => setRemaining(Math.max(0, Math.ceil(seconds))) };
}
