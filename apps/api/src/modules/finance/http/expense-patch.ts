import {
  oneOffExpensePatch,
  recurringExpensePatch,
  type UpdateExpenseBody,
} from '@app/contracts/finance';
import type { z } from 'zod';
import type { ExpensePatch, KindPatch } from '../application/expenses.js';

/** One kind's parse of the PATCH body: a field of the other kind is "Can't be changed on a …". */
function parseFor<S extends z.ZodType>(
  schema: S,
  body: UpdateExpenseBody,
  kindLabel: string,
): KindPatch<z.infer<S>> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, patch: parsed.data };
  const fields: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) fields[key] = `Can't be changed on a ${kindLabel}`;
    } else {
      fields[issue.path.map(String).join('.') || '_'] = issue.message;
    }
  }
  return { ok: false, fields };
}

/** FR-3, FR-4: the PATCH body as each kind's edit; the use case applies the Expense's kind. */
export function expensePatch(body: UpdateExpenseBody): ExpensePatch {
  return {
    recurring: parseFor(recurringExpensePatch, body, 'Recurring bill'),
    oneOff: parseFor(oneOffExpensePatch, body, 'One-off expense'),
  };
}
