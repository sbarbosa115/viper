import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, test } from 'vitest';
import { server } from '../../../test/setup';
import { authState, resetAuthState } from './handlers';
import { renderAuth } from './render';

beforeEach(resetAuthState);

async function fill(email = 'sam@sweetsupply.example', password = 'correct-horse-9') {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Business name'), 'Sweet Supply Co');
  await user.type(screen.getByLabelText('Your name'), 'Sam Rivera');
  await user.type(screen.getByLabelText('Work email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('FR-1: sign up', () => {
  test('shows labelled fields and the Terms and Privacy links', async () => {
    renderAuth('/signup');
    expect(await screen.findByLabelText('Business name')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('At least 10 characters');
    expect(screen.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(screen.getByText(/By signing up you agree to the/)).toBeInTheDocument();
  });

  test('a 9-character password is refused in the browser and names the password field', async () => {
    renderAuth('/signup');
    await fill('sam@sweetsupply.example', 'nine-char');
    expect(await screen.findByText('Use at least 10 characters')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInvalid();
    expect(authState.session).toBeNull();
  });

  test('empty fields show Required', async () => {
    renderAuth('/signup');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    expect(await screen.findAllByText('Required')).toHaveLength(4);
  });

  test('valid details sign Sam in and land on the app home', async () => {
    const { client, where } = renderAuth('/signup');
    await fill();
    await waitFor(() => expect(where()).toBe('/'));
    expect(client.getQueryData(['me'])).toMatchObject({ business: { name: 'Sweet Supply Co' } });
  });

  test('an email that is taken shows the message and a login link', async () => {
    renderAuth('/signup');
    await fill('taken@example.com');
    expect(
      await screen.findByText(/An account with this email already exists\. Log in or reset your password\./),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Log in' })[0]).toHaveAttribute('href', '/login');
  });

  test('429 says to try again later', async () => {
    renderAuth('/signup');
    await fill('limited@example.com');
    expect(await screen.findByText(/Too many sign-up attempts/)).toBeInTheDocument();
  });

  test('API field errors land on their inputs', async () => {
    server.use(
      http.post('*/api/auth/signup', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Invalid', fields: { businessName: 'Pick another name' } } },
          { status: 400 },
        ),
      ),
    );
    renderAuth('/signup');
    await fill();
    expect(await screen.findByText('Pick another name')).toBeInTheDocument();
    expect(screen.getByLabelText('Business name')).toBeInvalid();
  });
});
