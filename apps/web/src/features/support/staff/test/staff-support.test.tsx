import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, test } from 'vitest';
import { server } from '../../../../test/setup';
import {
  resetStaffState,
  staffHandlers,
  staffMe,
  staffState,
  ticketFixture,
} from '../../test/staff-handlers';
import { useSupportWaitingCount } from '../index';
import { renderStaff } from './render';

beforeEach(() => {
  resetStaffState();
  server.use(...staffHandlers);
});

const replyButton = () => screen.getByRole('button', { name: /^Reply\s*⌘↵$/ });
const rowOf = (name: RegExp) => screen.getByRole('row', { name });

describe('FR-6: Support desk', () => {
  test('shows stats, view counts and the Waiting queue, longest wait first', async () => {
    renderStaff('/staff/support');
    expect(await screen.findByRole('heading', { level: 1, name: 'Support' })).toBeInTheDocument();
    const table = await screen.findByRole('table', { name: 'Support tickets' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]?.textContent)).toEqual([
      '1043',
      '1042',
      '1044',
    ]);
    expect(screen.getAllByText('2 h 10 m')).toHaveLength(2);
    expect(screen.getByText('1 h 48 m')).toBeInTheDocument();
    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Waiting 3' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Mine 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Waiting on customer 1' })).toBeInTheDocument();
    expect(within(rowOf(/1043/)).getByText('nobody')).toBeInTheDocument();
  });

  test('Mine shows the new-reply marker and "you"; Closed and All switch the list', async () => {
    renderStaff('/staff/support');
    await userEvent.click(await screen.findByRole('button', { name: 'Mine 1' }));
    const row = within(await screen.findByRole('row', { name: /1042/ }));
    expect(row.getByText(/new customer reply/)).toBeInTheDocument();
    expect(row.getByText('you')).toBeInTheDocument();
    expect(staffState.listQueries.at(-1)).toMatchObject({ view: 'mine' });
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(await screen.findByRole('row', { name: /1046/ })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });

  test('category and assignee filters go to the API', async () => {
    renderStaff('/staff/support?view=all');
    await screen.findByRole('table');
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'billing');
    await waitFor(() =>
      expect(staffState.listQueries.at(-1)).toMatchObject({ category: 'billing' }),
    );
    expect(await screen.findByRole('row', { name: /1044/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /1043/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Assignee'), 'nobody');
    await waitFor(() =>
      expect(staffState.listQueries.at(-1)).toMatchObject({ assignee: 'nobody' }),
    );
  });

  test('"Show more" loads the next page', async () => {
    staffState.pageSize = 1;
    renderStaff('/staff/support');
    await screen.findByRole('row', { name: /1043/ });
    expect(screen.queryByRole('row', { name: /1042/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await screen.findByRole('row', { name: /1042/ })).toBeInTheDocument();
  });

  test('empty Waiting says "Nothing waiting. Nice." with a link to All', async () => {
    staffState.tickets = [
      ticketFixture(1050, {
        status: 'closed',
        waitMinutes: null,
        closedAt: '2026-11-20T10:00:00.000Z',
      }),
    ];
    renderStaff('/staff/support');
    expect(await screen.findByText('Nothing waiting. Nice.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'See all tickets' }));
    expect(await screen.findByRole('row', { name: /1050/ })).toBeInTheDocument();
  });

  test('shows an error with Retry', async () => {
    server.use(
      http.get('*/api/staff/support/tickets', () => new HttpResponse(null, { status: 500 })),
    );
    renderStaff('/staff/support');
    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't load the tickets");
    server.use(...staffHandlers);
    await userEvent.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByRole('row', { name: /1043/ })).toBeInTheDocument();
  });

  test('a row opens the ticket', async () => {
    const { router } = renderStaff('/staff/support');
    await userEvent.click(await screen.findByRole('link', { name: 'Charged twice for a pack?' }));
    expect(router.state.location.pathname).toBe('/staff/support/1044');
  });
});

describe('FR-6: waiting count hook', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );

  test('returns the waiting number for Staff', async () => {
    const { result } = renderHook(() => useSupportWaitingCount(), { wrapper });
    await waitFor(() => expect(result.current.data).toBe(3));
  });

  test('does not call the API when disabled', async () => {
    renderHook(() => useSupportWaitingCount({ enabled: false }), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(staffState.countCalls).toBe(0);
  });
});

describe('FR-7: Staff ticket view', () => {
  test('shows the thread, internal note, events and the side panel', async () => {
    renderStaff('/staff/support/1042');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Run stopped at Website reader' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Taken by you')).toBeInTheDocument();
    const thread = screen.getByRole('list', { name: 'Conversation' });
    expect(within(thread).getByText(/INTERNAL NOTE · only Staff see this/)).toBeInTheDocument();
    expect(within(thread).getByText(/TAKEN BY YOU/)).toBeInTheDocument();
    expect(within(thread).getByText(/You, as Llyner Leads Support/)).toHaveTextContent('emailed');
    expect(screen.getByText('first reply after 50 m', { exact: false })).toBeInTheDocument();
    const panel = screen.getByRole('complementary', { name: 'CUSTOMER' });
    expect(within(panel).getByText('Maria Lopez · Owner')).toBeInTheDocument();
    expect(within(panel).getByText('214 cr')).toBeInTheDocument();
    expect(within(panel).getByText('220 cr')).toBeInTheDocument();
    expect(within(panel).getByText('Bakeries & cafés · 5 mi')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /Open in Runs/ })).toHaveAttribute(
      'href',
      expect.stringMatching(/\/staff\/runs\//),
    );
  });

  test('Open as this Business starts Acting as with the ticket number', async () => {
    const { router } = renderStaff('/staff/support/1042');
    await userEvent.click(await screen.findByRole('button', { name: 'Open as this Business' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/plans'));
    expect(staffState.actedAs).toEqual([
      expect.objectContaining({ ticketNumber: 1042, businessId: expect.any(String) }),
    ]);
  });

  test('an unknown ticket says so', async () => {
    renderStaff('/staff/support/1999');
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not find that ticket');
  });
});

describe('FR-8: take, assign, status', () => {
  test('Take it assigns the ticket to you and marks it in progress', async () => {
    renderStaff('/staff/support/1043');
    await userEvent.click(await screen.findByRole('button', { name: 'Take it' }));
    expect(await screen.findByText('Taken by you')).toBeInTheDocument();
    expect(staffState.writes[0]).toEqual({ path: 'take', body: { version: 1 } });
    expect(screen.getByLabelText('Status')).toHaveValue('in_progress');
    expect(screen.getByText(/TAKEN BY YOU/)).toBeInTheDocument();
  });

  test('assigning to another Staff Member and back to Nobody', async () => {
    renderStaff('/staff/support/1043');
    const select = await screen.findByLabelText('Assignee');
    await within(select).findByRole('option', { name: 'Lee Ortiz' });
    await userEvent.selectOptions(select, 'Lee Ortiz');
    expect(await screen.findByText('Assigned to Lee Ortiz')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Assignee'), 'Nobody');
    expect(await screen.findByRole('button', { name: 'Take it' })).toBeInTheDocument();
    expect(staffState.writes.map((w) => w.body)).toEqual([
      { version: 1, assigneeId: expect.any(String) },
      { version: 2, assigneeId: null },
    ]);
  });

  test('changing the status sends the version', async () => {
    renderStaff('/staff/support/1042');
    await userEvent.selectOptions(await screen.findByLabelText('Status'), 'Waiting on customer');
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('waiting_on_customer'));
    expect(staffState.writes[0]).toEqual({
      path: 'status',
      body: { version: 3, status: 'waiting_on_customer' },
    });
  });

  test('a version conflict shows the banner and the latest ticket', async () => {
    renderStaff('/staff/support/1043');
    const take = await screen.findByRole('button', { name: 'Take it' });
    staffState.conflictOnNext = true;
    await userEvent.click(take);
    expect(
      await screen.findByText("Someone changed this ticket. Here's the latest."),
    ).toBeInTheDocument();
    expect(await screen.findByText('Assigned to Lee Ortiz')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take it' })).not.toBeInTheDocument();
  });
});

describe('FR-9: replies', () => {
  test('Reply sends the text, clears the box and shows the reply as emailed', async () => {
    renderStaff('/staff/support/1043');
    const box = await screen.findByRole('textbox', { name: 'Reply to Maria' });
    expect(replyButton()).toBeDisabled();
    await userEvent.type(box, 'Hello there');
    await userEvent.click(replyButton());
    expect(await screen.findByText('Hello there')).toBeInTheDocument();
    expect(box).toHaveValue('');
    expect(staffState.writes[0]).toEqual({ path: 'replies', body: { message: 'Hello there' } });
  });

  test('⌘↵ sends the reply', async () => {
    renderStaff('/staff/support/1043');
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Reply to Maria' }),
      'Quick one{Meta>}{Enter}{/Meta}',
    );
    await waitFor(() => expect(staffState.writes).toHaveLength(1));
    expect(staffState.writes[0]?.body).toEqual({ message: 'Quick one' });
  });

  test('Reply & wait on customer sends then: wait_on_customer', async () => {
    renderStaff('/staff/support/1043');
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Reply to Maria' }),
      'Send us the file',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Reply & wait on customer' }));
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('waiting_on_customer'));
    expect(staffState.writes[0]?.body).toEqual({
      message: 'Send us the file',
      then: 'wait_on_customer',
    });
  });

  test('Close ticket with text replies and closes; with an empty box it only closes', async () => {
    renderStaff('/staff/support/1043');
    await userEvent.type(
      await screen.findByRole('textbox', { name: 'Reply to Maria' }),
      'All done',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Close ticket' }));
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('closed'));
    expect(staffState.writes[0]).toEqual({
      path: 'replies',
      body: { message: 'All done', then: 'close' },
    });
  });

  test('Close ticket with an empty box sets the status', async () => {
    renderStaff('/staff/support/1044');
    await userEvent.click(await screen.findByRole('button', { name: 'Close ticket' }));
    await waitFor(() => expect(screen.getByLabelText('Status')).toHaveValue('closed'));
    expect(staffState.writes[0]).toEqual({
      path: 'status',
      body: { version: 1, status: 'closed' },
    });
  });

  test('a failed send keeps the text; TICKET_CLOSED_TOO_LONG has its own message', async () => {
    renderStaff('/staff/support/1046');
    const box = await screen.findByRole('textbox', { name: 'Reply to Maria' });
    await userEvent.type(box, 'Please keep me');
    staffState.failNextWrite = true;
    await userEvent.click(replyButton());
    expect(await screen.findByText(/Your text is still in the box/)).toBeInTheDocument();
    expect(box).toHaveValue('Please keep me');
    staffState.closedTooLongOnNext = true;
    await userEvent.click(replyButton());
    expect(await screen.findByText(/closed more than 30 days ago/)).toBeInTheDocument();
    expect(box).toHaveValue('Please keep me');
  });
});

describe('FR-10: internal notes', () => {
  test('the note tab adds a warn-styled note and sends no reply', async () => {
    renderStaff('/staff/support/1043');
    await userEvent.click(await screen.findByRole('tab', { name: 'Internal note' }));
    expect(
      screen.getByText(/Only Staff see this\. The customer is not emailed/),
    ).toBeInTheDocument();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Internal note' }),
      'Check billing logs',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const thread = screen.getByRole('list', { name: 'Conversation' });
    expect(await within(thread).findByText('Check billing logs')).toBeInTheDocument();
    expect(within(thread).getByText(/INTERNAL NOTE · only Staff see this/)).toBeInTheDocument();
    expect(staffState.writes).toEqual([{ path: 'notes', body: { note: 'Check billing logs' } }]);
    expect(staffMe.name).toBeTruthy();
  });
});
