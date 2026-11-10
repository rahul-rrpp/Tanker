import { useEffect, useState } from 'react';

/** A seconds countdown for "Resend code in Ns" buttons. */
export function useCountdown() {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining]);
  return { remaining, start: (s: number) => setRemaining(Math.ceil(s)) };
}
