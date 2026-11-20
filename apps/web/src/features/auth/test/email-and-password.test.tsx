import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { me as meExample } from '@app/contracts/examples';
import { UnverifiedNotice } from '../index';
import { authState, resetAuthState } from './handlers';
import { renderAuth, renderWithClient } from './render';

beforeEach(resetAuthState);

describe('FR-2: verify email page', () => {
  test('a valid token verifies and offers to continue', async () => {
    const { client } = renderAuth('/verify-email?token=valid');
    expect(await screen.findByRole('heading', { name: 'Email verified' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue setting up' })).toHaveAttribute('href', '/');
    expect(client.getQueryState(['verify-email', 'valid'])?.status).toBe('success');
  });

  test('an expired or used token offers "Send a new link", which sends one', async () => {
    authState.session = meExample;
    renderAuth('/verify-email?token=used');
    expect(await screen.findByText(/This link has expired/, { selector: 'p' })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByText('We sent a new link. Check your inbox.')).toBeInTheDocument();
  });

  test('a resend within 60 s shows the rate limit message', async () => {
    authState.resendStatus = 429;
    renderAuth('/verify-email?token=used');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByText(/one email a minute and five a day/)).toBeInTheDocument();
  });

  test('a signed-out visitor is asked to log in to get a new link', async () => {
    authState.resendStatus = 401;
    renderAuth('/verify-email?token=used');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Send a new link' }));
    expect(await screen.findByRole('link', { name: 'Log in' })).toHaveAttribute(
      'href',
      '/login?next=%2Fverify-email',
    );
  });

  test('a link without a token shows the expired state', async () => {
    renderAuth('/verify-email');
    expect(await screen.findByRole('button', { name: 'Send a new link' })).toBeInTheDocument();
  });
});

describe('FR-2: unverified notice', () => {
  const unverified = { ...meExample, member: { ...meExample.member, emailVerified: false } };

  test('shows for an unverified Member and resends', async () => {
    authState.session = unverified;
    renderWithClient(<UnverifiedNotice />);
    expect(
      await screen.findByText(/Verify your email to get 50 free credits and start research/),
    ).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Resend' }));
    expect(await screen.findByText(/Link sent/)).toBeInTheDocument();
  });

  test('a resend too soon shows the wait message', async () => {
    authState.session = unverified;
    authState.resendStatus = 429;
    renderWithClient(<UnverifiedNotice />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Resend' }));
    expect(await screen.findByText(/wait a minute/)).toBeInTheDocument();
  });

  test('is absent once verified, signed out, or while Acting as', async () => {
    authState.session = meExample;
    renderWithClient(<UnverifiedNotice />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument();
  });

  test('is absent while Acting as', async () => {
    authState.session = {
      ...unverified,
      actingAs: { businessId: meExample.business.id, businessName: 'Acme' },
    };
    renderWithClient(<UnverifiedNotice />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument();
  });
});

describe('FR-4: forgot and reset password', () => {
  test('requesting a link always shows the same message', async () => {
    renderAuth('/forgot-password');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'nobody@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(
      await screen.findByText(
        "If an account exists for that email, we've sent a link. It works for 1 hour.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login');
  });

  test('an invalid email is refused', async () => {
    renderAuth('/forgot-password');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
  });

  test('rate limiting shows a message', async () => {
    renderAuth('/forgot-password');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email'), 'limited@example.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/Too many requests/)).toBeInTheDocument();
  });

  test('a valid token sets the password and signs in', async () => {
    const { where } = renderAuth('/reset-password?token=valid');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'a-brand-new-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-brand-new-pass');
    expect(screen.getByText('This signs you out on other devices.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save and log in' }));
    await waitFor(() => expect(where()).toBe('/'));
  });

  test('a short password and a mismatch are shown inline', async () => {
    renderAuth('/reset-password?token=valid');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'other');
    await user.click(screen.getByRole('button', { name: 'Save and log in' }));
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
  });

  test('passwords that do not match are refused', async () => {
    renderAuth('/reset-password?token=valid');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'a-brand-new-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-brand-new-pasx');
    await user.click(screen.getByRole('button', { name: 'Save and log in' }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
  });

  test('an expired token shows the expired state with a link to request another', async () => {
    renderAuth('/reset-password?token=old');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'a-brand-new-pass');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-brand-new-pass');
    await user.click(screen.getByRole('button', { name: 'Save and log in' }));
    expect(await screen.findByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  test('no token shows the expired state', async () => {
    renderAuth('/reset-password');
    expect(await screen.findByRole('link', { name: 'Request a new link' })).toBeInTheDocument();
  });
});
