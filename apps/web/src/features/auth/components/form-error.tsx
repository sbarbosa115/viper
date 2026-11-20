import type { ReactNode } from 'react';
import { Banner } from '../../../shared/ui';

/** A form-level problem (wrong password, rate limit) shown above the submit button. */
export function FormError({ children }: { children: ReactNode }) {
  return <Banner tone="warn">{children}</Banner>;
}
