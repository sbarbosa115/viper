import { useEffect, useState } from 'react';

/** The current time, refreshed every `everyMs` while `active`. */
export function useNow(active: boolean, everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs]);
  return now;
}
