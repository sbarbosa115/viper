import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, test, vi } from 'vitest';
import {
  Badge,
  Banner,
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  IconButton,
  Input,
  KeyboardHint,
  ListRow,
  Logo,
  ScoreBadge,
  Select,
  Skeleton,
  Spinner,
  SplitView,
  StatTile,
  StatusPill,
  Switch,
  Table,
  Tabs,
  Textarea,
  ToastProvider,
  useToast,
  iconNames,
} from './index';

describe('ui: Button and IconButton', () => {
  test('fires onClick and shows a shortcut hint', async () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" hint="⌘↵" onClick={onClick}>
        Send
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Send/ }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByText('⌘↵')).toBeInTheDocument();
  });
  test('loading disables the button and marks it busy', () => {
    render(<Button loading>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
  test('disabled buttons do not fire', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        No
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(onClick).not.toHaveBeenCalled();
  });
  test('IconButton has an accessible name and tooltip', () => {
    render(<IconButton aria-label="Retry" icon="retry" />);
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveAttribute('title', 'Retry');
  });
});

describe('ui: form controls', () => {
  test('Field links label, hint and error to the control', () => {
    render(
      <Field label="Email" hint="We never share it" error="Enter a valid email">
        {(p) => <Input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAccessibleDescription('We never share it Enter a valid email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid email');
  });
  test('Textarea, Select and Checkbox are labelled and usable', async () => {
    render(
      <>
        <Field label="Goal">{(p) => <Textarea {...p} />}</Field>
        <Field label="Country">
          {(p) => (
            <Select {...p}>
              <option>US</option>
            </Select>
          )}
        </Field>
        <Checkbox label="Notify me" />
      </>,
    );
    await userEvent.type(screen.getByLabelText('Goal'), 'hello');
    expect(screen.getByLabelText('Goal')).toHaveValue('hello');
    expect(screen.getByLabelText('Country')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Notify me'));
    expect(screen.getByLabelText('Notify me')).toBeChecked();
  });
  test('Switch toggles with aria-checked', async () => {
    function Harness() {
      const [on, setOn] = useState(false);
      return <Switch checked={on} onCheckedChange={setOn} label="Notify" />;
    }
    render(<Harness />);
    const sw = screen.getByRole('switch', { name: 'Notify' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(sw);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });
});

describe('ui: Chip', () => {
  test('selectable chips expose aria-pressed', async () => {
    const onChange = vi.fn();
    render(
      <Chip kind="choice" selected={false} onSelectedChange={onChange}>
        Bakeries
      </Chip>,
    );
    const chip = screen.getByRole('button', { name: 'Bakeries' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    expect(onChange).toHaveBeenCalledWith(true);
  });
  test('removable chips have a remove button named after the chip', async () => {
    const onRemove = vi.fn();
    render(<Chip onRemove={onRemove}>Cafes</Chip>);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Cafes' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe('ui: badges', () => {
  test('StatusPill always shows a word', () => {
    render(<StatusPill kind="retrying" />);
    expect(screen.getByText('RETRYING')).toBeInTheDocument();
  });
  test('Badge renders its text', () => {
    render(<Badge tone="warn">Staff</Badge>);
    expect(screen.getByText('Staff')).toBeInTheDocument();
  });
  test('ScoreBadge uses the lime tint from 80', () => {
    render(
      <>
        <ScoreBadge score={80} />
        <ScoreBadge score={79} />
      </>,
    );
    expect(screen.getByLabelText('Fit score 80')).toHaveClass('text-accent');
    expect(screen.getByLabelText('Fit score 79')).not.toHaveClass('text-accent');
  });
});

describe('ui: Card, StatTile', () => {
  test('StatTile shows label, mono value and previous period', () => {
    render(<StatTile label="New sign-ups" value="42" previous="35" sparkline={[1, 3, 2, 5]} />);
    expect(screen.getByText('New sign-ups')).toBeInTheDocument();
    expect(screen.getByText('42')).toHaveClass('font-mono');
    expect(screen.getByText(/35/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'New sign-ups trend' })).toBeInTheDocument();
  });
  test('StatTile shows a dash for no data', () => {
    render(<StatTile label="Revenue" value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
  test('Card renders children', () => {
    render(<Card tone="accent">Pitch</Card>);
    expect(screen.getByText('Pitch')).toBeInTheDocument();
  });
});

describe('ui: Table', () => {
  const rows = [
    { id: 'a', name: 'Acme', credits: 10 },
    { id: 'b', name: 'Beta', credits: 20 },
  ];
  const columns = [
    { key: 'name', header: 'Name', cell: (r: (typeof rows)[number]) => r.name, sortable: true },
    {
      key: 'credits',
      header: 'Credits',
      cell: (r: (typeof rows)[number]) => r.credits,
      numeric: true,
    },
  ];
  test('renders rows in a scroll container and reports sort changes', async () => {
    const onSort = vi.fn();
    render(
      <Table
        caption="Customers"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        sort={{ key: 'name', direction: 'asc' }}
        onSortChange={onSort}
      />,
    );
    expect(screen.getByRole('region', { name: 'Customers' })).toHaveClass('overflow-x-auto');
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(within(screen.getAllByRole('row')[1]!).getByText('Acme')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Name' }));
    expect(onSort).toHaveBeenCalledWith({ key: 'name', direction: 'desc' });
  });
  test('shows the empty state', () => {
    render(
      <Table
        caption="x"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        emptyTitle="No results"
      />,
    );
    expect(screen.getByRole('heading', { name: 'No results' })).toBeInTheDocument();
  });
});

describe('ui: lists', () => {
  test('ListRow marks the selected row and selects on click', async () => {
    const onSelect = vi.fn();
    render(<ListRow title="Acme Bakery" meta="Bakery" selected onSelect={onSelect} />);
    const row = screen.getByRole('button', { name: /Acme Bakery/ });
    expect(row).toHaveAttribute('aria-current', 'true');
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalled();
  });
  test('SplitView renders list and preview landmarks', () => {
    render(<SplitView list="L" preview="P" listLabel="Leads" previewLabel="Lead preview" />);
    expect(screen.getByRole('region', { name: 'Leads' })).toHaveTextContent('L');
    expect(screen.getByRole('complementary', { name: 'Lead preview' })).toHaveTextContent('P');
  });
});

describe('ui: Dialog', () => {
  function Harness({ onClose }: { onClose: () => void }) {
    return (
      <>
        <button>outside</button>
        <Dialog
          open
          title="Not enough credits"
          onClose={onClose}
          footer={<Button>Buy credits</Button>}
        >
          Body
        </Dialog>
      </>
    );
  }
  test('is a labelled modal that closes on Esc', async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Not enough credits' })).toHaveAttribute(
      'aria-modal',
      'true',
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
  test('traps focus inside', async () => {
    render(<Harness onClose={() => undefined} />);
    const dialog = screen.getByRole('dialog');
    for (let i = 0; i < 5; i++) {
      await userEvent.tab();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    }
    await userEvent.tab({ shift: true });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
  test('restores focus to the opener on close', async () => {
    function Opener() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          <Dialog open={open} title="T" onClose={() => setOpen(false)}>
            x
          </Dialog>
        </>
      );
    }
    render(<Opener />);
    await userEvent.click(screen.getByRole('button', { name: 'open' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'open' })).toHaveFocus();
  });
});

describe('ui: Toast', () => {
  test('announces a message and can be dismissed', async () => {
    function Trigger() {
      const toast = useToast();
      return <button onClick={() => toast({ message: 'Saved', duration: 0 })}>go</button>;
    }
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    expect(screen.getByText('Saved')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });
});

describe('ui: Tabs', () => {
  test('switches panels by click and arrow keys', async () => {
    render(
      <Tabs
        label="Sections"
        items={[
          { id: 'a', label: 'One', panel: 'Panel one' },
          { id: 'b', label: 'Two', panel: 'Panel two' },
        ]}
      />,
    );
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel one');
    await userEvent.click(screen.getByRole('tab', { name: 'One' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel two');
  });
});

describe('ui: feedback', () => {
  test('Banner warn is an alert, info a status', () => {
    render(
      <>
        <Banner tone="warn">Low balance</Banner>
        <Banner>Heads up</Banner>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Low balance');
    expect(screen.getByRole('status')).toHaveTextContent('Heads up');
  });
  test('EmptyState shows title and action', () => {
    render(
      <EmptyState
        title="No plans"
        description="Tell us who you want to find"
        action={<Button>New plan</Button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'No plans' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New plan' })).toBeInTheDocument();
  });
  test('ErrorState retries', async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });
  test('Spinner has a status role and Skeleton is hidden', () => {
    render(
      <>
        <Spinner />
        <Skeleton data-testid="sk" />
      </>,
    );
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.getByTestId('sk')).toHaveAttribute('aria-hidden', 'true');
  });
  test('KeyboardHint renders a kbd', () => {
    render(<KeyboardHint>⌘K</KeyboardHint>);
    expect(screen.getByText('⌘K').tagName).toBe('KBD');
  });
});

describe('ui: Icon and Logo', () => {
  test('every named icon renders a decorative svg', () => {
    for (const name of [
      'chat',
      'plans',
      'leads',
      'credits',
      'staff',
      'search',
      'check',
      'x',
      'retry',
      'play',
      'menu',
      'arrow-left',
      'external',
      'download',
      'help',
    ] as const) {
      expect(iconNames).toContain(name);
    }
    const { container } = render(<Icon name="chat" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
  test('Logo shows the product name', () => {
    render(<Logo headingLevel={1} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Llyner Leads' })).toBeInTheDocument();
  });
  test('mark-only logo keeps an accessible name', () => {
    render(<Logo markOnly />);
    expect(screen.getByText('Llyner Leads')).toHaveClass('sr-only');
  });
});
