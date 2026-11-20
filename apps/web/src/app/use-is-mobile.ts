import { useSyncExternalStore } from 'react';

const query = '(max-width: 767px)';

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const list = window.matchMedia(query);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function snapshot() {
  return typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
}

/** True below 768px: the shell swaps the icon rail for a top bar and a bottom tab bar. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
