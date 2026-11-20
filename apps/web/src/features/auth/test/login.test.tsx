import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { resetAuthState } from './handlers';
import { renderAuth } from './render';

beforeEach(resetAuthState);

async function logIn(email: string, password = 'correct-horse-9') {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('FR-3: log in', () => {
  test('shows the form, the forgot link and the Staff hint', async () => {
    renderAuth('/login');
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup',
    );
    expect(screen.getByText(/Signing in as Staff/)).toBeInTheDocument();
  });

  test('an Owner goes home', async () => {
    const { where } = renderAuth('/login');
    await logIn('owner@demo.test');
    await waitFor(() => expect(where()).toBe('/'));
  });

  test('goes to ?next= when given', async () => {
    const { where } = renderAuth('/login?next=%2Fcredits%3Fpurchase%3Dsuccess');
    await logIn('owner@demo.test');
    await waitFor(() => expect(where()).toBe('/credits?purchase=success'));
  });

  test('ignores an off-site ?next=', async () => {
    const { where } = renderAuth('/login?next=%2F%2Fevil.example');
    await logIn('owner@demo.test');
    await waitFor(() => expect(where()).toBe('/'));
  });

  test('Staff with two-factor required go to the code step, keeping next', async () => {
    const { where } = renderAuth('/login?next=%2Fstaff');
    await logIn('staff@llyner.example');
    await waitFor(() => expect(where()).toBe('/login/two-factor?next=%2Fstaff'));
  });

  test('wrong email or password shows one generic message', async () => {
    renderAuth('/login');
    await logIn('owner@demo.test', 'wrong-password');
    expect(await screen.findByText('Wrong email or password.')).toBeInTheDocument();
  });

  test('429 shows the 15 minute message', async () => {
    renderAuth('/login');
    await logIn('limited@example.com');
    expect(
      await screen.findByText('Too many attempts, try again in 15 minutes.'),
    ).toBeInTheDocument();
  });

  test('client validation: empty email', async () => {
    renderAuth('/login');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Log in' }));
    expect(await screen.findAllByText('Required')).not.toHaveLength(0);
  });
});
