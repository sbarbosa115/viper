import { platformSettings as settingsExample } from '@app/contracts/examples';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, test } from 'vitest';
import { server } from '../../../../test/setup';
import { handlers, resetSettingsState, settingsState } from './handlers';
import { renderSettings } from './render';

beforeEach(() => {
  resetSettingsState();
  server.use(...handlers);
});

const section = (name: string) => screen.findByRole('form', { name });

describe('FR-8: platform settings', () => {
  test('shows every section with its Save', async () => {
    renderSettings();
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    for (const name of [
      'AI models',
      'Data providers',
      'Email (SMTP)',
      'Stripe',
      'Analytics',
      'Landing page',
      'Ceilings for all flows',
      'Support',
    ]) {
      expect(await section(name)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `Save ${name}` })).toBeInTheDocument();
    }
  });

  test('shows an error with retry when settings fail to load', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('*/api/staff/settings', () =>
        HttpResponse.json({ error: { code: 'X', message: 'x' } }, { status: 500 }),
      ),
    );
    renderSettings();
    expect(await screen.findByText('Settings did not load')).toBeInTheDocument();
    server.resetHandlers();
    server.use(...handlers);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await section('AI models')).toBeInTheDocument();
  });

  describe('secrets are write-only', () => {
    test('a set secret shows only its status and last 4, with Replace and no value field', async () => {
      renderSettings();
      const ai = within(await section('AI models'));
      expect(ai.getByText(/Set · ••••a1f3 · updated Nov \d+/)).toBeInTheDocument();
      expect(ai.getByRole('button', { name: 'Replace Anthropic API key' })).toBeInTheDocument();
      expect(ai.queryByLabelText(/Anthropic API key new value/)).not.toBeInTheDocument();
      expect(ai.queryByDisplayValue(/a1f3/)).not.toBeInTheDocument();
    });

    test('a replaced secret is sent once and never displayed after saving', async () => {
      const user = userEvent.setup();
      renderSettings();
      const ai = within(await section('AI models'));
      await user.click(ai.getByRole('button', { name: 'Replace Anthropic API key' }));
      await user.type(ai.getByLabelText('Anthropic API key new value'), 'sk-ant-TOPSECRET-9999');
      await user.click(ai.getByRole('button', { name: 'Save AI models' }));

      expect(await ai.findByText('● AI models: Saved')).toBeInTheDocument();
      expect(settingsState.saved).toHaveLength(1);
      expect(settingsState.saved[0]?.body).toMatchObject({
        anthropicApiKey: 'sk-ant-TOPSECRET-9999',
      });
      expect(document.body.innerHTML).not.toContain('TOPSECRET');
      expect(ai.getByText(/Set · ••••9999 · updated/)).toBeInTheDocument();
      expect(ai.queryByLabelText(/new value/)).not.toBeInTheDocument();
    });

    test('an untouched secret is omitted from the save (keeps it)', async () => {
      const user = userEvent.setup();
      renderSettings();
      const ai = within(await section('AI models'));
      await user.clear(ai.getByLabelText('Chat model'));
      await user.type(ai.getByLabelText('Chat model'), 'claude-sonnet-x');
      await user.click(ai.getByRole('button', { name: 'Save AI models' }));
      await ai.findByText('● AI models: Saved');
      const body = settingsState.saved[0]?.body as Record<string, unknown>;
      expect(body).not.toHaveProperty('anthropicApiKey');
      expect(body.chatModel).toBe('claude-sonnet-x');
      expect(ai.getByText(/Set · ••••a1f3/)).toBeInTheDocument();
    });

    test('Remove sends an empty string and the secret shows as not set', async () => {
      const user = userEvent.setup();
      renderSettings();
      const ai = within(await section('AI models'));
      await user.click(ai.getByRole('button', { name: 'Remove Anthropic API key' }));
      expect(ai.getByText('Will be removed when you save')).toBeInTheDocument();
      await user.click(ai.getByRole('button', { name: 'Save AI models' }));
      await ai.findByText('● AI models: Saved');
      expect(settingsState.saved[0]?.body).toMatchObject({ anthropicApiKey: '' });
      expect(ai.getByText('Not set')).toBeInTheDocument();
      expect(ai.getByRole('button', { name: 'Add key Anthropic API key' })).toBeInTheDocument();
    });

    test('provider keys are nested per provider and saved with their own section only', async () => {
      const user = userEvent.setup();
      renderSettings();
      const providers = within(await section('Data providers'));
      await user.click(providers.getByRole('button', { name: 'Add key Hunter' }));
      await user.type(providers.getByLabelText('Hunter new value'), 'hunter-key-0c44');
      await user.click(providers.getByRole('button', { name: 'Save Data providers' }));
      await providers.findByText('● Data providers: Saved');
      expect(settingsState.saved).toHaveLength(1);
      expect(settingsState.saved[0]?.section).toBe('providers');
      const body = settingsState.saved[0]?.body as {
        hunter: unknown;
        apify: unknown;
        twilio: unknown;
      };
      expect(body.hunter).toEqual({ apiKey: 'hunter-key-0c44' });
      expect(body.apify).toEqual({});
      expect(body.twilio).toMatchObject({ accountSid: null });
      expect(document.body.innerHTML).not.toContain('hunter-key');
    });
  });

  describe('validation', () => {
    test('an invalid Analytics measurement ID shows the message and sends nothing', async () => {
      const user = userEvent.setup();
      renderSettings();
      const analytics = within(await section('Analytics'));
      await user.type(analytics.getByLabelText('Google Analytics measurement ID'), 'UA-123');
      await user.click(analytics.getByRole('button', { name: 'Save Analytics' }));
      expect(
        await analytics.findByText('Use G- followed by 4–12 letters or digits'),
      ).toBeInTheDocument();
      expect(settingsState.saved).toHaveLength(0);
    });

    test('a ceiling outside its range is rejected before saving', async () => {
      const user = userEvent.setup();
      renderSettings();
      const ceilings = within(await section('Ceilings for all flows'));
      await user.clear(ceilings.getByLabelText('Max attempts'));
      await user.type(ceilings.getByLabelText('Max attempts'), '50');
      await user.click(ceilings.getByRole('button', { name: 'Save Ceilings for all flows' }));
      expect(await ceilings.findByRole('alert')).toBeInTheDocument();
      expect(settingsState.saved).toHaveLength(0);
    });

    test('a required field left blank says so', async () => {
      const user = userEvent.setup();
      renderSettings();
      const ceilings = within(await section('Ceilings for all flows'));
      await user.clear(ceilings.getByLabelText('Max credits per run'));
      await user.click(ceilings.getByRole('button', { name: 'Save Ceilings for all flows' }));
      expect(await ceilings.findByText('Required')).toBeInTheDocument();
    });

    test('field errors from the API (400) appear on their field', async () => {
      const user = userEvent.setup();
      settingsState.fieldErrors = { supportEmail: 'That address is not allowed' };
      renderSettings();
      const support = within(await section('Support'));
      await user.clear(support.getByLabelText('Support email'));
      await user.type(support.getByLabelText('Support email'), 'help@example.com');
      await user.click(support.getByRole('button', { name: 'Save Support' }));
      expect(await support.findByText('That address is not allowed')).toBeInTheDocument();
      expect(support.queryByText(/Saved/)).not.toBeInTheDocument();
    });
  });

  describe('each section saves on its own', () => {
    test('Ceilings sends numbers and the cache shows the saved values', async () => {
      const user = userEvent.setup();
      renderSettings();
      const ceilings = within(await section('Ceilings for all flows'));
      await user.clear(ceilings.getByLabelText('Max total hours (including retries)'));
      await user.type(ceilings.getByLabelText('Max total hours (including retries)'), '2.5');
      await user.click(ceilings.getByRole('button', { name: 'Save Ceilings for all flows' }));
      await ceilings.findByText('● Ceilings for all flows: Saved');
      expect(settingsState.saved[0]?.body).toEqual({
        ...settingsExample.ceilings,
        maxTotalHours: 2.5,
      });
    });

    test('Email saves the TLS mode and clears blank optional fields to null', async () => {
      const user = userEvent.setup();
      renderSettings();
      const email = within(await section('Email (SMTP)'));
      await user.selectOptions(email.getByLabelText('TLS'), 'starttls');
      await user.click(email.getByRole('button', { name: 'Save Email (SMTP)' }));
      await email.findByText('● Email (SMTP): Saved');
      expect(settingsState.saved[0]?.body).toMatchObject({
        tls: 'starttls',
        port: 1025,
        username: null,
        replyTo: null,
      });
    });

    test('Stripe saves the Stripe Tax switch', async () => {
      const user = userEvent.setup();
      renderSettings();
      const stripe = within(await section('Stripe'));
      await user.click(stripe.getByRole('switch'));
      await user.click(stripe.getByRole('button', { name: 'Save Stripe' }));
      await stripe.findByText('● Stripe: Saved');
      expect(settingsState.saved[0]?.body).toEqual({ taxEnabled: false });
    });

    test('Landing page clears the video with an empty field', async () => {
      const user = userEvent.setup();
      renderSettings();
      const landing = within(await section('Landing page'));
      await user.clear(landing.getByLabelText('YouTube video ID'));
      await user.click(landing.getByRole('button', { name: 'Save Landing page' }));
      await landing.findByText('● Landing page: Saved');
      expect(settingsState.saved[0]?.body).toEqual({ youtubeVideoId: null });
    });

    test('a failed save without field errors shows a retry message and keeps the input', async () => {
      const user = userEvent.setup();
      server.use(
        http.put('*/api/staff/settings/support', () =>
          HttpResponse.json({ error: { code: 'INTERNAL', message: 'x' } }, { status: 500 }),
        ),
      );
      renderSettings();
      const support = within(await section('Support'));
      await user.click(support.getByRole('button', { name: 'Save Support' }));
      expect(
        await support.findByText('We could not save this section. Try again.'),
      ).toBeInTheDocument();
      expect(support.getByLabelText('Support email')).toHaveValue('support@demo.test');
    });
  });

  describe('Test actions', () => {
    test('Anthropic Test shows the result inline', async () => {
      const user = userEvent.setup();
      renderSettings();
      const ai = within(await section('AI models'));
      await user.click(ai.getByRole('button', { name: 'Test Anthropic API key' }));
      expect(await ai.findByText(/Connected/)).toBeInTheDocument();
      expect(settingsState.tests).toEqual([{ target: 'anthropic' }]);
    });

    test('a failed test shows the provider message', async () => {
      const user = userEvent.setup();
      settingsState.testResult = { ok: false, message: 'model not found: claude-x' };
      renderSettings();
      const ai = within(await section('AI models'));
      await user.click(ai.getByRole('button', { name: 'Test Anthropic API key' }));
      expect(await ai.findByText(/model not found: claude-x/)).toBeInTheDocument();
    });

    test('only keys that are set can be tested', async () => {
      renderSettings();
      const providers = within(await section('Data providers'));
      expect(providers.getByRole('button', { name: 'Test Apify' })).toBeInTheDocument();
      expect(providers.queryByRole('button', { name: 'Test Hunter' })).not.toBeInTheDocument();
    });

    test('the test email needs an address, then sends to it', async () => {
      const user = userEvent.setup();
      renderSettings();
      const email = within(await section('Email (SMTP)'));
      const send = email.getByRole('button', { name: 'Send test email' });
      expect(send).toBeDisabled();
      await user.type(email.getByLabelText('Send test email to'), 'sam@sweetsupply.example');
      await user.click(send);
      expect(await email.findByText(/Connected/)).toBeInTheDocument();
      expect(settingsState.tests).toEqual([{ target: 'smtp', to: 'sam@sweetsupply.example' }]);
    });

    test('a not-an-address entry is flagged and cannot be sent', async () => {
      const user = userEvent.setup();
      renderSettings();
      const email = within(await section('Email (SMTP)'));
      await user.type(email.getByLabelText('Send test email to'), 'nope');
      await user.tab();
      expect(
        await email.findByText('Enter the address to send the test email to'),
      ).toBeInTheDocument();
      expect(email.getByRole('button', { name: 'Send test email' })).toBeDisabled();
    });

    test('an API failure on Test shows an inline message', async () => {
      const user = userEvent.setup();
      server.use(
        http.post('*/api/staff/settings/test', () =>
          HttpResponse.json(
            { error: { code: 'INTERNAL', message: 'Provider timeout' } },
            { status: 500 },
          ),
        ),
      );
      settingsState.settings.stripe.secretKey = { set: true, last4: 'Lk2p', updatedAt: null };
      renderSettings();
      const stripe = within(await section('Stripe'));
      await user.click(stripe.getByRole('button', { name: 'Test Secret key' }));
      expect(await stripe.findByText(/Provider timeout/)).toBeInTheDocument();
    });
  });
});
