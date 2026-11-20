import { ZodError } from 'zod';
import { AppError } from '../shared/domain/errors.js';
import {
  emptyCard,
  siteCopy,
  type CardState,
  type CardTab,
  type LoginField,
  type SignupField,
} from '../../../web/src/site/index.js';

const e = siteCopy.errors;

/** What went wrong with a card form, ready for the HTML card or the JSON reply (FR-35). */
export interface FormFailure {
  status: number;
  code: string;
  /** The message shown above the form (also the JSON `error.message`). */
  message: string;
  /** Inline field messages, by input name. */
  fields: Record<string, string>;
  card: CardState;
}

/** A form body as strings: the first value of each field, nothing else. */
export function parseForm(body: unknown): Record<string, string> {
  const form: Record<string, string> = {};
  if (!body || typeof body !== 'object') return form;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    const first: unknown = Array.isArray(value) ? value[0] : value;
    if (typeof first === 'string') form[key] = first;
  }
  return form;
}

const signupMessages: Record<SignupField, string> = {
  businessName: e.businessName,
  name: e.name,
  email: e.email,
  password: e.password,
};
const loginMessages: Record<LoginField, string> = { email: e.email, password: e.loginPassword };

interface Values {
  businessName?: string;
  name?: string;
  email?: string;
}

/** The card re-rendered on `tab` with what the visitor typed (never the password). */
export function formFailure(
  tab: CardTab,
  status: number,
  code: string,
  message: string,
  values: Values,
  fields: Record<string, string> = {},
): FormFailure {
  const card = emptyCard(tab);
  if (tab === 'signup') {
    card.signup.values = {
      businessName: values.businessName ?? '',
      name: values.name ?? '',
      email: values.email ?? '',
    };
    card.signup.errors = fields;
    card.signup.message = Object.keys(fields).length ? null : message;
  } else {
    card.login.values = { email: values.email ?? '' };
    card.login.errors = fields;
    card.login.message = Object.keys(fields).length ? null : message;
  }
  return { status, code, message, fields, card };
}

/** Field names from a Zod error or a domain ValidationError, with the site's messages. */
function invalidFields<F extends string>(
  err: unknown,
  messages: Record<F, string>,
): Record<string, string> | null {
  const fields: Record<string, string> = {};
  const add = (name: unknown, domainMessage?: string) => {
    if (typeof name !== 'string' || !(name in messages)) return;
    // The domain's "too common" password rule says more than the generic length hint.
    const specific = domainMessage && /common/i.test(domainMessage) ? domainMessage : undefined;
    fields[name] ??= specific ?? messages[name as F];
  };
  if (err instanceof ZodError) {
    for (const issue of err.issues) add(issue.path[0]);
  } else if (err instanceof AppError && err.code === 'VALIDATION_ERROR') {
    for (const [name, message] of Object.entries(err.details ?? {})) add(name, String(message));
  } else {
    return null;
  }
  return fields;
}

function codeOf(err: unknown): string | null {
  return err instanceof AppError ? err.code : null;
}

/** The sign-up form did not pass the contract's schema. */
export function signupInvalid(err: ZodError, values: Values): FormFailure {
  const fields = invalidFields(err, signupMessages) ?? {};
  return formFailure('signup', 400, 'VALIDATION_ERROR', e.generic, values, fields);
}

/** The log-in form did not pass the contract's schema. */
export function loginInvalid(err: ZodError, values: Values): FormFailure {
  const fields = invalidFields(err, loginMessages) ?? {};
  return formFailure('login', 400, 'VALIDATION_ERROR', e.generic, values, fields);
}

/** FR-1 failures in the card: invalid fields, email taken (→ Log in tab), too many sign-ups. */
export function signupFailure(err: unknown, values: Values): FormFailure | null {
  const fields = invalidFields(err, signupMessages);
  if (fields) {
    return formFailure('signup', 400, 'VALIDATION_ERROR', e.generic, values, fields);
  }
  switch (codeOf(err)) {
    case 'EMAIL_TAKEN':
      return formFailure('login', 409, 'EMAIL_TAKEN', e.emailTaken, { email: values.email ?? '' });
    case 'TOO_MANY_REQUESTS':
      return formFailure('signup', 429, 'TOO_MANY_REQUESTS', e.signupTooMany, values);
    default:
      return null;
  }
}

/** FR-3 failures in the card: invalid fields, wrong email or password, too many attempts. */
export function loginFailure(err: unknown, values: Values): FormFailure | null {
  const fields = invalidFields(err, loginMessages);
  if (fields) return formFailure('login', 400, 'VALIDATION_ERROR', e.generic, values, fields);
  switch (codeOf(err)) {
    case 'INVALID_CREDENTIALS':
      return formFailure('login', 401, 'INVALID_CREDENTIALS', e.invalidCredentials, values);
    case 'TOO_MANY_REQUESTS':
      return formFailure('login', 429, 'TOO_MANY_REQUESTS', e.loginTooMany, values);
    default:
      return null;
  }
}
