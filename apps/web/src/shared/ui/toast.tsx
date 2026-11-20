import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { t } from '../i18n';
import { IconButton } from './button';

export interface ToastOptions {
  message: string;
  tone?: 'info' | 'warn';
  /** Milliseconds before it disappears; 0 keeps it until dismissed. */
  duration?: number;
}

interface ToastItem extends ToastOptions {
  id: number;
}

const ToastContext = createContext<((options: ToastOptions) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(0);
  const dismiss = useCallback(
    (id: number) => setItems((all) => all.filter((i) => i.id !== id)),
    [],
  );
  const show = useCallback(
    (options: ToastOptions) => {
      const id = next.current++;
      setItems((all) => [...all, { ...options, id }]);
      const duration = options.duration ?? 5000;
      if (duration > 0) setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-20 right-4 z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 md:bottom-4"
      >
        {items.map((item) => (
          <div
            key={item.id}
            className="viper-fade flex items-center gap-2 rounded-row border border-line-strong bg-surface-raised py-2 pl-4 pr-1 text-sm text-fg shadow-overlay"
          >
            <span className={item.tone === 'warn' ? 'text-warn' : 'text-accent'} aria-hidden="true">
              ●
            </span>
            <span className="flex-1">{item.message}</span>
            <IconButton aria-label={t('common.close')} icon="x" onClick={() => dismiss(item.id)} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
