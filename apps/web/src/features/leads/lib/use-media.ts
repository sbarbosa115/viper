import { useSyncExternalStore } from 'react';

const query = '(max-width: 767px)';

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const list = window.matchMedia(query);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

/** True below 768px, where the preview becomes its own view. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
    () => false,
  );
}
