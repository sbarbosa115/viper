import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, test } from 'vitest';
import { server } from '../../../test/setup';
import { authState, resetAuthState, staffMe } from './handlers';
import { renderAuth } from './render';

/** POST /api/auth/two-factor/verify answers 429 TWO_FACTOR_LOCKED, with `details` when given. */
function lockedVerify(details?: Record<string, unknown>) {
  server.use(
    http.post('*/api/auth/two-factor/verify', () =>
      HttpResponse.json(
        {
          error: {
            code: 'TWO_FACTOR_LOCKED',
            message: 'Too many wrong codes. Two-factor sign-in is locked for an hour.',
            ...(details ? { details } : {}),
          },
        },
        { status: 429 },
      ),
    ),
  );
}

beforeEach(resetAuthState);

async function typeCode(code: string) {
  const user = userEvent.setup();
  const first = await screen.findByLabelText('Digit 1');
  await user.click(first);
  await user.keyboard(code);
  await user.click(screen.getByRole('button', { name: 'Verify' }));
}

describe('FR-5: two-factor code', () => {
  test('a signed-out visitor is sent to log in', async () => {
    const { where } = renderAuth('/login/two-factor');
    await waitFor(() => expect(where()).toBe('/login'));
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });

  test('shows six digit boxes and the Staff email', async () => {
    authState.session = staffMe();
    renderAuth('/login/two-factor');
    expect(await screen.findByRole('group', { name: 'Six-digit code' })).toBeInTheDocument();
    for (let n = 1; n <= 6; n += 1) expect(screen.getByLabelText(`Digit ${n}`)).toBeInTheDocument();
    expect(screen.getByText(/staff@llyner\.example/)).toBeInTheDocument();
    expect(screen.getByText('STAFF')).toBeInTheDocument();
  });

  test('a valid code lets Staff in to the back office', async () => {
    authState.session = staffMe();
    const { where } = renderAuth('/login/two-factor');
    await typeCode('123456');
    await waitFor(() => expect(where()).toBe('/staff'));
  });

  test('goes to ?next= after the code', async () => {
    authState.session = staffMe();
    const { where } = renderAuth('/login/two-factor?next=%2Fstaff%2Fcustomers');
    await typeCode('123456');
    await waitFor(() => expect(where()).toBe('/staff/customers'));
  });

  test('a wrong code shows inline and keeps the page', async () => {
    authState.session = staffMe();
    renderAuth('/login/two-factor');
    await typeCode('654321');
    expect(await screen.findByText(/That code is not right/)).toBeInTheDocument();
    expect(screen.getByLabelText('Digit 1')).toBeInvalid();
  });

  test('an incomplete code is refused without calling the API', async () => {
    authState.session = staffMe();
    renderAuth('/login/two-factor');
    await typeCode('123');
    expect(await screen.findByText(/That code is not right/)).toBeInTheDocument();
  });

  test('pasting six digits fills every box', async () => {
    authState.session = staffMe();
    renderAuth('/login/two-factor');
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText('Digit 1'));
    await user.paste('482913');
    expect(screen.getByLabelText('Digit 6')).toHaveValue('3');
    expect(screen.getByLabelText('Digit 1')).toHaveValue('4');
  });

  test('too many wrong codes says to log in again', async () => {
    authState.session = staffMe();
    renderAuth('/login/two-factor');
    await typeCode('999999');
    expect(await screen.findByText(/Log in again to start over/)).toBeInTheDocument();
  });

  test('TWO_FACTOR_LOCKED says sign-in is locked for an hour, with the time to retry', async () => {
    authState.session = staffMe();
    lockedVerify({ retryAfterSeconds: 3600 });
    renderAuth('/login/two-factor');
    await typeCode('123456');
    const message = await screen.findByText(
      /^Too many wrong codes\. Two-factor sign-in is locked for an hour\./,
    );
    expect(message).toHaveTextContent(/Try again after \d{1,2}[:.]\d{2}/);
    expect(screen.queryByText(/Log in again to start over/)).not.toBeInTheDocument();
  });

  test('TWO_FACTOR_LOCKED without a retry time shows the lock message alone', async () => {
    authState.session = staffMe();
    lockedVerify();
    renderAuth('/login/two-factor');
    await typeCode('123456');
    const message = await screen.findByText(
      'Too many wrong codes. Two-factor sign-in is locked for an hour.',
    );
    expect(message).not.toHaveTextContent(/Try again after/);
  });

  test('"Use a different account" logs out and returns to log in', async () => {
    authState.session = staffMe();
    const { where } = renderAuth('/login/two-factor');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Use a different account' }));
    await waitFor(() => expect(where()).toBe('/login'));
    expect(authState.session).toBeNull();
  });
});

describe('FR-5: first-time setup', () => {
  test('renders the API QR code and the key, then confirms with a code', async () => {
    authState.session = staffMe({ setUp: false });
    const { where } = renderAuth('/login/two-factor');
    const qr = await screen.findByRole('img', { name: 'QR code' });
    expect(qr.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Enter the 6-digit code'), '123 456');
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    await waitFor(() => expect(where()).toBe('/staff'));
  });

  test('a wrong code shows inline on the field', async () => {
    authState.session = staffMe({ setUp: false });
    renderAuth('/login/two-factor');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Enter the 6-digit code'), '000111');
    await user.click(screen.getByRole('button', { name: 'Confirm and continue' }));
    expect(await screen.findByText(/That code is not right/)).toBeInTheDocument();
  });
});
