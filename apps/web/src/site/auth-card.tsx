/** @jsxRuntime automatic */
import { siteCopy } from './copy.js';
import type { CardState, CardTab } from './types.js';

const c = siteCopy.card;

interface FieldProps {
  form: CardTab;
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password';
  autoComplete: string;
  value?: string | undefined;
  error?: string | undefined;
  hint?: string;
  minLength?: number;
  maxLength?: number;
}

/** A labelled input with its hint and inline error (ids `<form>-<name>`, `…-error`). */
function Field({
  form,
  name,
  label,
  type = 'text',
  autoComplete,
  value,
  error,
  hint,
  minLength,
  maxLength,
}: FieldProps) {
  const id = `${form}-${name}`;
  const describedBy = [hint ? `${id}-hint` : null, `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        className="input"
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required
        minLength={minLength}
        maxLength={maxLength}
        defaultValue={value}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      {hint ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      <span className="field-error" id={`${id}-error`} data-field-error={name}>
        {error ?? ''}
      </span>
    </div>
  );
}

function Tab({
  tab,
  current,
  label,
  href,
}: {
  tab: CardTab;
  current: CardTab;
  label: string;
  href: string;
}) {
  const selected = tab === current;
  return (
    <a
      className="tab"
      role="tab"
      id={`tab-${tab}`}
      href={href}
      aria-selected={selected}
      aria-controls={`panel-${tab}`}
      tabIndex={selected ? 0 : -1}
      data-tab-link={tab}
    >
      {label}
    </a>
  );
}

/**
 * FR-35: one card, two tabs. Both forms are plain HTML posts to `/site/signup` and
 * `/site/login`; the client script switches tabs in place and submits with fetch.
 */
export function AuthCard({ card }: { card: CardState }) {
  const { signup, login } = card;
  return (
    <div className="card" id="signup" data-card="">
      <div className="tabs" role="tablist" aria-label={c.tabsLabel}>
        <Tab tab="signup" current={card.tab} label={c.signupTab} href="/#signup" />
        <Tab tab="login" current={card.tab} label={c.loginTab} href="/?tab=login#signup" />
      </div>

      <div
        className="panel"
        role="tabpanel"
        id="panel-signup"
        aria-labelledby="tab-signup"
        hidden={card.tab !== 'signup'}
      >
        <div>
          <h2 className="card-title">{c.signupTitle}</h2>
          <p className="card-sub">{c.signupSubtitle}</p>
        </div>
        <p className="form-error" role="alert" data-form-error="signup">
          {signup.message ?? ''}
        </p>
        <form className="form" method="post" action="/site/signup" data-site-form="signup">
          <Field
            form="signup"
            name="businessName"
            label={c.businessName}
            autoComplete="organization"
            value={signup.values.businessName}
            error={signup.errors.businessName}
            minLength={2}
            maxLength={120}
          />
          <Field
            form="signup"
            name="name"
            label={c.name}
            autoComplete="name"
            value={signup.values.name}
            error={signup.errors.name}
            maxLength={80}
          />
          <Field
            form="signup"
            name="email"
            label={c.workEmail}
            type="email"
            autoComplete="email"
            value={signup.values.email}
            error={signup.errors.email}
            maxLength={254}
          />
          <Field
            form="signup"
            name="password"
            label={c.password}
            type="password"
            autoComplete="new-password"
            error={signup.errors.password}
            hint={c.passwordHint}
            minLength={10}
            maxLength={128}
          />
          <button
            className="btn btn-primary btn-block"
            type="submit"
            data-busy-label={c.creatingAccount}
          >
            {c.createAccount}
          </button>
        </form>
        <p className="legal-note">
          {c.legalPrefix} <a href="/terms">{c.terms}</a> {c.and} <a href="/privacy">{c.privacy}</a>.
        </p>
      </div>

      <div
        className="panel"
        role="tabpanel"
        id="panel-login"
        aria-labelledby="tab-login"
        hidden={card.tab !== 'login'}
      >
        <div>
          <h2 className="card-title">{c.loginTitle}</h2>
          <p className="card-sub">{c.loginSubtitle}</p>
        </div>
        <p className="form-error" role="alert" data-form-error="login">
          {login.message ?? ''}
        </p>
        <form className="form" method="post" action="/site/login" data-site-form="login">
          <Field
            form="login"
            name="email"
            label={c.email}
            type="email"
            autoComplete="email"
            value={login.values.email}
            error={login.errors.email}
            maxLength={254}
          />
          <Field
            form="login"
            name="password"
            label={c.password}
            type="password"
            autoComplete="current-password"
            error={login.errors.password}
            maxLength={128}
          />
          <div className="form-row">
            <a href="/app/forgot-password">{c.forgotPassword}</a>
          </div>
          <button className="btn btn-primary btn-block" type="submit" data-busy-label={c.loggingIn}>
            {c.logIn}
          </button>
        </form>
      </div>
    </div>
  );
}

/** FR-34: a signed-in visitor gets a way back into the app instead of the forms. */
export function SignedInCard() {
  return (
    <div className="card signed-in" id="signup">
      <h2 className="card-title">{c.signedInTitle}</h2>
      <p className="card-sub">{c.signedInSubtitle}</p>
      <a className="btn btn-primary" href="/app">
        {c.openApp}
      </a>
    </div>
  );
}
