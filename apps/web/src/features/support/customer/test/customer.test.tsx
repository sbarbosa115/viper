import { SUPPORT_AUTHOR_NAME } from '@app/contracts/support';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { server } from '../../../../test/setup';
import {
  customerState,
  handlers,
  makeMessage,
  makeRun,
  makeTicket,
  resetCustomerState,
  runIds,
  sessionHandlers,
} from '../../test/customer-handlers';
import { renderSupport } from './render';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
  resetCustomerState();
  server.use(...handlers, ...sessionHandlers);
});
afterEach(() => vi.useRealTimers());

const serverError = () =>
  HttpResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'x' } }, { status: 500 });
const rows = async () =>
  within(await screen.findByRole('list', { name: 'Tickets' })).getAllByRole('listitem');
const location = () => screen.getByTestId('location').textContent;

describe('FR-1: Your tickets', () => {
  test('lists tickets with statuses as words, preview, linked run and counts', async () => {
    renderSupport('/support');
    expect(await screen.findByRole('heading', { level: 1, name: 'Your tickets' })).toBeVisible();
    const open = await rows();
    expect(open).toHaveLength(2);
    expect(open[0]).toHaveTextContent('#1042');
    expect(open[0]).toHaveTextContent('Run stopped at Website reader');
    expect(open[0]).toHaveTextContent("We're on it");
    expect(open[0]).toHaveTextContent('Research run / leads');
    expect(open[0]).toHaveTextContent('Linked run: Bakeries & cafés');
    expect(open[0]).toHaveTextContent(`${SUPPORT_AUTHOR_NAME}: "Thanks Sam.`);
    expect(open[0]).toHaveTextContent('10:42');
    expect(open[1]).toHaveTextContent('Waiting on you');
    expect(open[1]).toHaveTextContent('20 Nov');
    expect(screen.getByRole('button', { name: 'Open 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Closed 1' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'All 3' })).toBeVisible();
    expect(screen.getByText(/within 4 business hours/)).toBeVisible();
    expect(screen.getByText('Up to 5 open tickets at a time.')).toBeVisible();
  });

  test('a non-Owner sees no From column; the Owner does', async () => {
    renderSupport('/support');
    await rows();
    expect(screen.queryByText('From Jo Kim')).not.toBeInTheDocument();
    expect(screen.queryByText(/As the Owner/)).not.toBeInTheDocument();
  });

  test('the Owner view shows who opened each ticket', async () => {
    customerState.showFrom = true;
    renderSupport('/support');
    const open = await rows();
    expect(open[1]).toHaveTextContent('From Jo Kim');
    expect(
      screen.getByText('As the Owner you see every ticket from Sweet Supply Co.'),
    ).toBeVisible();
  });

  test('Closed and All filter the list; a row links to its thread', async () => {
    renderSupport('/support');
    await rows();
    await userEvent.click(screen.getByRole('button', { name: 'Closed 1' }));
    await waitFor(async () => expect(await rows()).toHaveLength(1));
    const closed = (await rows())[0]!;
    expect(closed).toHaveTextContent('Closed');
    expect(closed).toHaveTextContent('14 Nov');
    await userEvent.click(screen.getByRole('button', { name: 'All 3' }));
    await waitFor(async () => expect(await rows()).toHaveLength(3));
    await userEvent.click(within((await rows())[0]!).getByRole('link'));
    expect(await screen.findByRole('heading', { level: 1, name: /Run stopped/ })).toBeVisible();
    expect(location()).toBe('/support/1042');
  });

  test('shows 25 per page with Show more', async () => {
    customerState.pageSize = 1;
    renderSupport('/support');
    expect(await rows()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(async () => expect(await rows()).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  test('empty state offers New ticket', async () => {
    customerState.tickets = [];
    renderSupport('/support');
    expect(await screen.findByRole('heading', { name: 'No tickets yet' })).toBeVisible();
    expect(screen.getByText("If something's not working, we're here to help.")).toBeVisible();
    await userEvent.click(screen.getAllByRole('link', { name: 'New ticket' })[0]!);
    expect(await screen.findByRole('heading', { level: 1, name: 'New ticket' })).toBeVisible();
  });

  test('shows a skeleton while loading', async () => {
    renderSupport('/support');
    expect(screen.getByRole('status', { name: 'Loading tickets' })).toBeVisible();
    await rows();
  });

  test('a load error offers Retry', async () => {
    server.use(http.get('*/api/support/tickets', serverError));
    renderSupport('/support');
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load your tickets");
    server.use(...handlers);
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await rows()).toHaveLength(2);
  });

  test('while Acting as, New ticket is disabled with the reason', async () => {
    customerState.actingAs = true;
    renderSupport('/support');
    await rows();
    const button = await screen.findByRole('button', { name: 'New ticket' });
    expect(button).toBeDisabled();
    expect(screen.getByText("Staff can't open tickets while Acting as")).toBeVisible();
    expect(screen.queryByRole('link', { name: 'New ticket' })).not.toBeInTheDocument();
  });
});

const fillForm = async (
  subject = 'Run stopped early',
  message = 'My run stopped at step three.',
) => {
  await userEvent.type(screen.getByLabelText('Subject'), subject);
  await userEvent.type(screen.getByLabelText('Message'), message);
};

describe('FR-2: open a ticket', () => {
  test('sends the ticket, toasts and goes to the thread', async () => {
    renderSupport('/support/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Billing and credits' }));
    await fillForm('Invoice please', 'I need an invoice for my pack.');
    await userEvent.click(screen.getByRole('button', { name: /Send ticket/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Invoice please' })).toBeVisible();
    expect(customerState.requests[0]?.body).toEqual({
      category: 'billing',
      subject: 'Invoice please',
      message: 'I need an invoice for my pack.',
      source: 'help',
    });
    expect(location()).toBe('/support/1043');
    expect(screen.getByText("Ticket #1043 sent. We'll reply by email too.")).toBeVisible();
  });

  test('Report a problem arrives prefilled: run selected, category preset, source and page sent', async () => {
    renderSupport(
      `/support/new?runId=${runIds.failed}&source=run&from=${encodeURIComponent(`/app/runs/${runIds.failed}`)}`,
    );
    const run = await screen.findByLabelText(/Which run/);
    await waitFor(() => expect(run).toHaveValue(runIds.failed));
    expect(screen.getByRole('button', { name: 'Research run / leads' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('Subject')).toHaveValue('');
    expect(screen.getByText(`/app/runs/${runIds.failed}`)).toBeVisible();
    expect(await screen.findByText('214 cr')).toBeVisible();
    expect(screen.getByText('Sweet Supply Co')).toBeVisible();
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /Send ticket/ }));
    await screen.findByRole('heading', { level: 1, name: 'Run stopped early' });
    expect(customerState.requests[0]?.body).toMatchObject({
      category: 'run',
      runId: runIds.failed,
      source: 'run',
      pagePath: `/app/runs/${runIds.failed}`,
    });
  });

  test('ignores a "from" that is not an app path', async () => {
    renderSupport('/support/new?from=https%3A%2F%2Fevil.test%2F');
    await screen.findByLabelText('Subject');
    expect(screen.queryByText('Page')).not.toBeInTheDocument();
  });

  test('a run that is not in the picker is dropped', async () => {
    renderSupport('/support/new?runId=0193a1b2-0000-7000-8000-0000000000ff&source=run');
    const run = await screen.findByLabelText(/Which run/);
    await waitFor(() => expect(run).toHaveValue(''));
  });

  test('lists runs newest first with plan, date and status; or says there are none', async () => {
    renderSupport('/support/new');
    const run = await screen.findByLabelText(/Which run/);
    await within(run).findByRole('option', { name: /Bakeries & cafés · .* · FAILED/ });
    const options = within(run).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'No run',
      expect.stringContaining('Bakeries & cafés'),
      expect.stringContaining('Florists'),
    ]);
  });

  test('no runs in 90 days: the select says so', async () => {
    customerState.runs = [];
    renderSupport('/support/new');
    const run = await screen.findByLabelText(/Which run/);
    expect(
      await within(run).findByRole('option', { name: 'No runs in the last 90 days' }),
    ).toBeVisible();
    expect(run).toBeDisabled();
  });

  test('shows field errors under the fields and sends nothing', async () => {
    renderSupport('/support/new');
    await userEvent.click(await screen.findByRole('button', { name: /Send ticket/ }));
    expect(await screen.findByText('Choose what it is about')).toBeVisible();
    expect(screen.getByText('Use at least 5 characters')).toBeVisible();
    expect(screen.getByText('Tell us a bit more: at least 10 characters')).toBeVisible();
    expect(customerState.requests).toHaveLength(0);
  });

  test('the message counter follows the text', async () => {
    renderSupport('/support/new');
    await userEvent.type(await screen.findByLabelText('Message'), 'Hello there');
    expect(screen.getByText('11 / 10000')).toBeVisible();
  });

  test('⌘↵ sends from the keyboard', async () => {
    renderSupport('/support/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Other' }));
    await fillForm();
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Run stopped early' }),
    ).toBeVisible();
  });

  test('a double submit sends one ticket', async () => {
    renderSupport('/support/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Other' }));
    await fillForm();
    const send = screen.getByRole('button', { name: /Send ticket/ });
    await userEvent.dblClick(send);
    await screen.findByRole('heading', { level: 1, name: 'Run stopped early' });
    expect(customerState.requests).toHaveLength(1);
  });

  test('OPEN_TICKET_LIMIT: banner with a link, and the text is kept', async () => {
    customerState.tickets = [1, 2, 3, 4, 5].map((n) =>
      makeTicket({ number: 2000 + n, status: 'open' }),
    );
    renderSupport('/support/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Bug' }));
    await fillForm('Something broke', 'It broke when I clicked the thing.');
    await userEvent.click(screen.getByRole('button', { name: /Send ticket/ }));
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent(
      'You have 5 open tickets. Reply on one of them or close one first.',
    );
    expect(within(banner).getByRole('link', { name: 'Go to Your tickets' })).toHaveAttribute(
      'href',
      '/support',
    );
    expect(screen.getByLabelText('Subject')).toHaveValue('Something broke');
    expect(screen.getByLabelText('Message')).toHaveValue('It broke when I clicked the thing.');
    expect(screen.getByRole('button', { name: /Send ticket/ })).toBeEnabled();
  });

  test('429: a rate-limit message, text kept', async () => {
    server.use(
      http.post('*/api/support/tickets', () =>
        HttpResponse.json(
          { error: { code: 'TOO_MANY_REQUESTS', message: 'slow down' } },
          { status: 429, headers: { 'Retry-After': '60' } },
        ),
      ),
    );
    renderSupport('/support/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Other' }));
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /Send ticket/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent("You're sending tickets too fast");
    expect(screen.getByLabelText('Subject')).toHaveValue('Run stopped early');
  });

  test('UNKNOWN_RUN and API field errors show on their fields', async () => {
    server.use(
      http.post('*/api/support/tickets', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'x', fields: { subject: 'Too vague' } } },
          { status: 400 },
        ),
      ),
    );
    renderSupport('/support/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Other' }));
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /Send ticket/ }));
    expect(await screen.findByText('Too vague')).toBeVisible();
  });

  test('a server error says it could not send, and keeps the text', async () => {
    server.use(http.post('*/api/support/tickets', serverError));
    renderSupport('/support/new');
    await userEvent.click(await screen.findByRole('button', { name: 'Other' }));
    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /Send ticket/ }));
    expect(await screen.findByText("Couldn't send. Try again.")).toBeVisible();
    expect(screen.getByLabelText('Message')).toHaveValue('My run stopped at step three.');
  });

  test('while Acting as the form is disabled with the reason', async () => {
    customerState.actingAs = true;
    renderSupport('/support/new');
    expect(await screen.findByText(/Staff can't open tickets while Acting as/)).toBeVisible();
    expect(screen.getByLabelText('Subject')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send ticket/ })).toBeDisabled();
  });
});

const replyBox = () => screen.findByRole('textbox', { name: 'Reply' });

describe('FR-4: ticket thread', () => {
  test('shows the header, an ordered thread, status events and the linked run', async () => {
    renderSupport('/support/1042');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Run stopped at Website reader' }),
    ).toBeVisible();
    const thread = within(await screen.findByRole('list', { name: 'Conversation' }));
    const items = thread.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Was I charged?');
    expect(items[0]).toHaveTextContent('Sam Rivera');
    expect(items[1]).toHaveTextContent("STATUS → WE'RE ON IT");
    expect(items[2]).toHaveTextContent(`${SUPPORT_AUTHOR_NAME} ·`);
    expect(items[2]).toHaveTextContent('you paid 0 cr');
    const details = within(screen.getByRole('complementary', { name: 'Details' }));
    expect(details.getByText('Research run / leads')).toBeVisible();
    const run = details.getByRole('link', { name: /Bakeries & cafés/ });
    expect(run).toHaveTextContent('stopped at 03 Website reader');
    expect(run).toHaveTextContent('failed · 0 cr charged · Open run');
    expect(run).toHaveAttribute('href', `/runs/${runIds.failed}`);
  });

  test('message text is shown as text, never as HTML', async () => {
    customerState.tickets = [
      makeTicket({ messages: [makeMessage({ body: '<img src=x onerror=alert(1)> **bold**' })] }),
    ];
    renderSupport('/support/1042');
    expect(await screen.findByText('<img src=x onerror=alert(1)> **bold**')).toBeVisible();
    expect(document.querySelector('img')).toBeNull();
  });

  test('a reply is sent, the box clears and focus moves to the new message', async () => {
    renderSupport('/support/1042');
    await userEvent.type(await replyBox(), 'Thanks, that helps.');
    await userEvent.click(screen.getByRole('button', { name: /Send reply/ }));
    const thread = await screen.findByRole('list', { name: 'Conversation' });
    await waitFor(() => expect(within(thread).getAllByRole('listitem')).toHaveLength(4));
    const last = within(thread).getAllByRole('listitem')[3]!;
    expect(last).toHaveTextContent('Thanks, that helps.');
    await waitFor(() => expect(last).toHaveFocus());
    expect(await replyBox()).toHaveValue('');
    expect(customerState.requests[0]?.body).toEqual({ message: 'Thanks, that helps.' });
  });

  test('⌘↵ sends the reply', async () => {
    renderSupport('/support/1042');
    await userEvent.type(await replyBox(), 'Sent with the keyboard');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(await screen.findByText('Sent with the keyboard')).toBeVisible();
  });

  test('an empty reply shows a message and sends nothing', async () => {
    renderSupport('/support/1042');
    await replyBox();
    await userEvent.click(screen.getByRole('button', { name: /Send reply/ }));
    expect(await screen.findByText('Write a reply first')).toBeVisible();
    expect(customerState.requests).toHaveLength(0);
  });

  test('a send failure keeps the text and says so', async () => {
    server.use(http.post('*/api/support/tickets/:number/replies', serverError));
    renderSupport('/support/1042');
    await userEvent.type(await replyBox(), 'Please keep me');
    await userEvent.click(screen.getByRole('button', { name: /Send reply/ }));
    expect(await screen.findByText("Couldn't send. Try again.")).toBeVisible();
    expect(await replyBox()).toHaveValue('Please keep me');
  });

  test('429 on a reply says to wait, and keeps the text', async () => {
    server.use(
      http.post('*/api/support/tickets/:number/replies', () =>
        HttpResponse.json({ error: { code: 'TOO_MANY_REQUESTS', message: 'x' } }, { status: 429 }),
      ),
    );
    renderSupport('/support/1042');
    await userEvent.type(await replyBox(), 'Many replies');
    await userEvent.click(screen.getByRole('button', { name: /Send reply/ }));
    expect(await screen.findByText(/replying too fast/)).toBeVisible();
    expect(await replyBox()).toHaveValue('Many replies');
  });

  test('a ticket closed within 30 days can be replied to and says it reopens', async () => {
    renderSupport('/support/1031');
    expect(await screen.findByText(/A reply reopens it until/)).toBeVisible();
    await userEvent.type(await replyBox(), 'Still wrong after all');
    await userEvent.click(screen.getByRole('button', { name: /Send reply/ }));
    await waitFor(() => expect(screen.getAllByText('Open').length).toBeGreaterThan(0));
  });

  test('closed more than 30 days ago: "Open a new ticket" with category and run prefilled', async () => {
    customerState.tickets = [
      makeTicket({
        number: 1001,
        subject: 'Old one',
        category: 'billing',
        status: 'closed',
        run: makeRun(),
        closedAt: '2026-10-14T12:00:00.000Z',
        canReply: false,
        canClose: false,
        reopenUntil: '2026-11-13T12:00:00.000Z',
      }),
    ];
    renderSupport('/support/1001');
    expect(await screen.findByText(/This ticket was closed on 14 Oct/)).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Reply' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Open a new ticket' }));
    const run = await screen.findByLabelText(/Which run/);
    await waitFor(() => expect(run).toHaveValue(runIds.failed));
    expect(screen.getByRole('button', { name: 'Billing and credits' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('a 409 TICKET_CLOSED_TOO_LONG on send switches to the new-ticket prompt', async () => {
    server.use(
      http.post('*/api/support/tickets/:number/replies', () =>
        HttpResponse.json(
          {
            error: {
              code: 'TICKET_CLOSED_TOO_LONG',
              message: 'x',
              details: { closedAt: '2026-10-14T12:00:00.000Z' },
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderSupport('/support/1042');
    await userEvent.type(await replyBox(), 'Anyone there?');
    await userEvent.click(screen.getByRole('button', { name: /Send reply/ }));
    expect(await screen.findByText(/This ticket was closed on 14 Oct/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open a new ticket' })).toBeVisible();
  });

  test('Acting as: read-only, the reply box and buttons are disabled', async () => {
    customerState.actingAs = true;
    renderSupport('/support/1042');
    expect(await replyBox()).toBeDisabled();
    expect(screen.getByRole('button', { name: /Send reply/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close ticket' })).toBeDisabled();
    expect(screen.getByText(/Read-only while Acting as/)).toBeVisible();
  });

  test('a ticket that is not yours or does not exist says "Ticket not found"', async () => {
    renderSupport('/support/4242');
    expect(await screen.findByRole('heading', { name: 'Ticket not found' })).toBeVisible();
    await userEvent.click(screen.getByRole('link', { name: 'Back to Your tickets' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Your tickets' })).toBeVisible();
  });

  test('a load error offers Retry; loading shows a skeleton', async () => {
    server.use(http.get('*/api/support/tickets/:number', serverError));
    renderSupport('/support/1042');
    expect(screen.getByRole('status', { name: 'Loading ticket' })).toBeVisible();
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load this ticket");
    server.use(...handlers);
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('heading', { level: 1, name: /Run stopped/ })).toBeVisible();
  });
});

describe('FR-5: close a ticket', () => {
  test('asks for confirmation, then shows Closed and no reply prompt change', async () => {
    renderSupport('/support/1042');
    await userEvent.click(await screen.findByRole('button', { name: 'Close ticket' }));
    const dialog = await screen.findByRole('dialog', { name: 'Close #1042?' });
    expect(within(dialog).getByText('You can reopen it by replying within 30 days.')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close ticket' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText('Closed').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Close ticket' })).not.toBeInTheDocument();
    expect(customerState.requests.at(-1)?.path).toBe('/support/tickets/1042/close');
  });

  test('Keep it open closes the dialog and sends nothing', async () => {
    renderSupport('/support/1042');
    await userEvent.click(await screen.findByRole('button', { name: 'Close ticket' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep it open' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(customerState.requests).toHaveLength(0);
  });

  test('ALREADY_CLOSED refreshes the thread', async () => {
    renderSupport('/support/1042');
    await userEvent.click(await screen.findByRole('button', { name: 'Close ticket' }));
    // Someone closed it in the meantime.
    customerState.tickets[0]!.status = 'closed';
    customerState.tickets[0]!.canClose = false;
    customerState.tickets[0]!.closedAt = '2026-11-21T11:00:00.000Z';
    customerState.tickets[0]!.reopenUntil = '2026-12-21T11:00:00.000Z';
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close ticket' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText('Closed').length).toBeGreaterThan(0));
  });

  test('a failure to close is shown in the dialog', async () => {
    server.use(http.post('*/api/support/tickets/:number/close', serverError));
    renderSupport('/support/1042');
    await userEvent.click(await screen.findByRole('button', { name: 'Close ticket' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close ticket' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent("Couldn't close the ticket");
  });
});
