import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test } from 'vitest';
import { renderApp } from '../../../app/test-utils';
import { resetAuthState } from './handlers';

beforeEach(resetAuthState);

describe('AJ-1 in the real app shell', () => {
  test('sign up lands on the welcome chat inside the app shell', async () => {
    renderApp('/signup');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Business name'), 'Sweet Supply Co');
    await user.type(screen.getByLabelText('Your name'), 'Sam Rivera');
    await user.type(screen.getByLabelText('Work email'), 'sam@sweetsupply.example');
    await user.type(screen.getByLabelText('Password'), 'correct-horse-9');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument();
  });
});
