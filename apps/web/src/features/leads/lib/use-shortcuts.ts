import { useEffect, useRef } from 'react';

export type ShortcutMap = Partial<Record<string, () => void>>;

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null
  );
}

/**
 * Single-letter shortcuts for a page. They live only while the page is mounted, never fire while
 * typing in a field, with a modifier held, or while a dialog is open. Keys are matched in lowercase.
 */
export function useShortcuts(map: ShortcutMap, enabled = true): void {
  const latest = useRef(map);
  useEffect(() => {
    latest.current = map;
  });
  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (isEditable(event.target) || document.querySelector('[role="dialog"]')) return;
      const action = latest.current[event.key.toLowerCase()];
      if (!action) return;
      event.preventDefault();
      action();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
