import { ids, profile as profileExample } from '@app/contracts/examples';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { server } from '../../../test/setup';
import { assistantState, resetAssistantState } from './handlers';
import { renderAssistant } from './render';

const incomplete = {
  ...profileExample,
  complete: false,
  products: [],
  location: null,
  deliveryRadiusMiles: null,
};
const asProfile = (profile: typeof profileExample) =>
  server.use(http.get('*/api/profile', () => HttpResponse.json(profile)));

beforeEach(() => {
  resetAssistantState();
  asProfile(incomplete);
});

describe('FR-14: welcome chat', () => {
  test('shows the stored history, quick replies and the profile panel', async () => {
    renderAssistant();
    const log = await screen.findByRole('log', { name: 'Conversation' });
    expect(within(log).getByText('What do you sell?')).toBeInTheDocument();
    expect(within(log).getByRole('button', { name: 'Sugar' })).toBeInTheDocument();
    expect(within(log).getByRole('button', { name: 'Flour' })).toBeInTheDocument();
    const panel = await screen.findByRole('complementary', { name: 'Business Profile' });
    expect(within(panel).getByText('Sweet Supply Co')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Edit profile' })).toHaveAttribute(
      'href',
      '/profile',
    );
  });

  test('on mobile a "Business Profile N of 6" link above the chat opens the profile', async () => {
    asProfile({ ...incomplete, priceRange: null, currentCustomers: null });
    renderAssistant();
    const link = await screen.findByRole('link', { name: /^Business Profile \d of 6$/ });
    // The panel is hidden below lg and this link is hidden from lg up (CSS, not jsdom).
    expect(link.parentElement).toHaveClass('lg:hidden');
    expect(link).toHaveAccessibleName(/^Business Profile [0-5] of 6$/);
    expect(link).toHaveAttribute('href', '/profile');
    const form = screen.getByLabelText('Your answer').closest('form');
    expect(link.compareDocumentPosition(form!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(link);
    expect(await screen.findByText('Profile page')).toBeInTheDocument();
  });

  test('a quick reply sends its text, shows the typing indicator, then the reply', async () => {
    let open!: () => void;
    assistantState.gate = new Promise((r) => (open = r));
    assistantState.next = { status: 200, reply: { text: 'Great, where are you located?' } };
    renderAssistant();
    await userEvent.click(await screen.findByRole('button', { name: 'Sugar' }));

    expect(await screen.findByText('Llyner is typing…')).toBeInTheDocument();
    expect(screen.getByText('Sugar', { selector: 'p' })).toBeInTheDocument();
    open();

    expect(await screen.findByText('Great, where are you located?')).toBeInTheDocument();
    expect(screen.queryByText('Llyner is typing…')).not.toBeInTheDocument();
    expect(assistantState.received).toEqual([{ text: 'Sugar' }]);
    expect(screen.queryByRole('button', { name: 'Flour' })).not.toBeInTheDocument();
  });

  test('typing an answer and pressing Send clears the box', async () => {
    renderAssistant();
    const input = await screen.findByLabelText('Your answer');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.type(input, 'Cane sugar in 50 lb bags');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Thanks. Where are you located?')).toBeInTheDocument();
    expect(input).toHaveValue('');
    expect(assistantState.received).toEqual([{ text: 'Cane sugar in 50 lb bags' }]);
  });

  test('the profile panel updates from the reply', async () => {
    renderAssistant();
    const panel = await screen.findByRole('complementary', { name: 'Business Profile' });
    await waitFor(() => expect(within(panel).queryByText(/Cane sugar/)).not.toBeInTheDocument());
    assistantState.next = { status: 200, reply: {}, complete: true };
    await userEvent.click(await screen.findByRole('button', { name: 'Sugar' }));
    expect(await within(panel).findByText('Cane sugar, 50 lb')).toBeInTheDocument();
    expect(within(panel).getByText('3 miles')).toBeInTheDocument();
  });

  test('a failed reply keeps the message and Retry resends it with retryOfMessageId', async () => {
    assistantState.next = { status: 503 };
    renderAssistant();
    await userEvent.type(await screen.findByLabelText('Your answer'), 'Cane sugar');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("I couldn't reply just now");
    expect(screen.getByText('Cane sugar', { selector: 'p' })).toBeInTheDocument();

    assistantState.next = { status: 200, reply: { text: 'Got it.' } };
    await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Got it.')).toBeInTheDocument();
    const stored = assistantState.conversation.messages.find((m) => m.text === 'Cane sugar');
    expect(assistantState.received.at(-1)).toEqual({
      text: 'Cane sugar',
      retryOfMessageId: stored?.id,
    });
    expect(screen.getAllByText('Cane sugar', { selector: 'p' })).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('the daily limit shows a message and keeps the typed text', async () => {
    assistantState.next = { status: 429 };
    renderAssistant();
    const input = await screen.findByLabelText('Your answer');
    await userEvent.type(input, 'One more thing');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/today's message limit/);
    expect(input).toHaveValue('One more thing');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  test('a reply that created a Plan opens it', async () => {
    assistantState.next = { status: 200, reply: {}, planId: ids.plan, complete: true };
    renderAssistant();
    await userEvent.click(await screen.findByRole('button', { name: 'Sugar' }));
    expect(await screen.findByText(`Plan page ${ids.plan}`)).toBeInTheDocument();
  });

  test('an unverified Owner sending the goal gets the verify-email reply and stays in the chat', async () => {
    const goal = 'Bakeries within 3 miles that could buy our sugar';
    const verify =
      "Before I draft your plan, please verify your email. Open the link we sent you (you can resend it from the banner above). Your 50 free credits arrive once you've verified. Then send your goal again and I'll draft the plan.";
    assistantState.next = {
      status: 200,
      reply: { text: verify, quickReplies: [goal] },
      planId: null,
      complete: true,
    };
    renderAssistant();
    await userEvent.type(await screen.findByLabelText('Your answer'), goal);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const log = screen.getByRole('log', { name: 'Conversation' });
    expect(await within(log).findByText(verify)).toBeInTheDocument();
    expect(within(log).getByRole('button', { name: goal })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Plan page/)).not.toBeInTheDocument();
  });

  test('the chat shows an error state with Try again when it cannot load', async () => {
    server.use(
      http.get('*/api/conversations/welcome', () => new HttpResponse(null, { status: 500 })),
    );
    renderAssistant();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('PRD 6b: /app routing', () => {
  test('an incomplete profile stays on the welcome chat', async () => {
    renderAssistant('/');
    expect(await screen.findByRole('log', { name: 'Conversation' })).toBeInTheDocument();
  });

  test('a complete profile redirects to Plans', async () => {
    asProfile(profileExample);
    renderAssistant('/');
    expect(await screen.findByText('Plans page')).toBeInTheDocument();
  });

  test('completing the profile mid-chat does not pull the Member away', async () => {
    renderAssistant('/');
    assistantState.next = { status: 200, reply: { text: 'All set.' }, complete: true };
    await userEvent.click(await screen.findByRole('button', { name: 'Sugar' }));
    expect(await screen.findByText('All set.')).toBeInTheDocument();
    expect(screen.queryByText('Plans page')).not.toBeInTheDocument();
  });
});

describe('chat layout: the answer box stays in reach', () => {
  const scrolled = vi.fn();
  beforeEach(() => {
    scrolled.mockClear();
    window.scrollTo = scrolled;
  });
  afterEach(() => {
    window.scrollTo = () => undefined; // the setup's no-op
  });

  test('the answer form is pinned to the bottom of the screen, above the mobile tab bar', async () => {
    renderAssistant();
    const form = (await screen.findByLabelText('Your answer')).closest('form');
    // Sticky positioning is CSS (not laid out by jsdom): assert the classes that pin it.
    expect(form).toHaveClass('sticky', 'bg-bg');
    expect(form?.className).toMatch(/bottom-\[calc\(3\.5rem\+env\(safe-area-inset-bottom\)\)\]/);
    expect(form).toHaveClass('md:bottom-0');
  });

  test('a new message scrolls the page to the newest one', async () => {
    assistantState.next = { status: 200, reply: { text: 'Great, where are you located?' } };
    let open!: () => void;
    assistantState.gate = new Promise((r) => (open = r));
    renderAssistant();
    const sugar = await screen.findByRole('button', { name: 'Sugar' });
    await waitFor(() => expect(scrolled).toHaveBeenCalled()); // opens at the newest message
    scrolled.mockClear();
    await userEvent.click(sugar);
    open();
    await screen.findByText('Great, where are you located?');
    await waitFor(() =>
      expect(scrolled).toHaveBeenCalledWith(expect.objectContaining({ top: expect.any(Number) })),
    );
  });

  test('a reply that arrives while the reader has scrolled up does not move the page', async () => {
    assistantState.next = { status: 200, reply: { text: 'Great, where are you located?' } };
    let open!: () => void;
    assistantState.gate = new Promise((r) => (open = r));
    renderAssistant();
    const sugar = await screen.findByRole('button', { name: 'Sugar' });
    await userEvent.click(sugar);
    await waitFor(() => expect(scrolled).toHaveBeenCalled()); // sending follows to the bottom
    // The reader scrolls up to reread while the reply is on its way (jsdom has no layout: fake it).
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 3000,
    });
    window.scrollY = 200;
    window.dispatchEvent(new Event('scroll'));
    scrolled.mockClear();
    open();
    await screen.findByText('Great, where are you located?');
    expect(scrolled).not.toHaveBeenCalled();
    // Undo the fake layout.
    delete (document.documentElement as { scrollHeight?: number }).scrollHeight;
    window.scrollY = 0;
  });
});
