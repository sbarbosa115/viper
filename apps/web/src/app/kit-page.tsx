import { useState } from 'react';
import { t } from '../shared/i18n';
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
  iconNames,
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
  useToast,
  type SortState,
  type StatusKind,
} from '../shared/ui';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t border-line py-6">
      <h2 className="m-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

const rows = [
  { id: 'a', name: 'Acme Bakery', score: 91, credits: 120 },
  { id: 'b', name: 'Birch Cafe', score: 72, credits: 80 },
];

/** Dev-only gallery at /app/__kit: every UI kit component in one place. */
export function KitPage() {
  const toast = useToast();
  const [dialog, setDialog] = useState(false);
  const [on, setOn] = useState(true);
  const [chip, setChip] = useState(true);
  const [selected, setSelected] = useState('a');
  const [sort, setSort] = useState<SortState>({ key: 'name', direction: 'asc' });
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-7">
      <h1 className="m-0 mb-4 text-[26px] font-semibold tracking-tight text-fg">
        {t('product.name')} · {t('kit.title')}
      </h1>
      <Section title="Logo and icons">
        <Logo />
        {iconNames.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 text-xs text-muted">
            <Icon name={n} /> {n}
          </span>
        ))}
      </Section>
      <Section title="Buttons">
        <Button variant="primary" hint="⌘↵">
          Find leads
        </Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger-text">Cancel run</Button>
        <Button variant="primary" loading>
          Saving
        </Button>
        <Button size="sm">Small</Button>
        <Button size="lg" variant="primary">
          Large
        </Button>
        <IconButton aria-label="Retry" icon="retry" variant="secondary" />
        <KeyboardHint>⌘K</KeyboardHint>
      </Section>
      <Section title="Form">
        <div className="grid w-full max-w-md gap-4">
          <Field label="Email" hint="We never share it">
            {(p) => <Input {...p} type="email" />}
          </Field>
          <Field label="Password" error="At least 10 characters">
            {(p) => <Input {...p} type="password" />}
          </Field>
          <Field label="Goal">{(p) => <Textarea {...p} />}</Field>
          <Field label="Country">
            {(p) => (
              <Select {...p}>
                <option>United States</option>
              </Select>
            )}
          </Field>
          <Checkbox label="Notify me when it is ready" />
          <Switch checked={on} onCheckedChange={setOn} label="Email me" />
        </div>
      </Section>
      <Section title="Chips, badges, status">
        <Chip selected={chip} onSelectedChange={setChip}>
          Filter
        </Chip>
        <Chip kind="choice" selected onSelectedChange={() => undefined}>
          Choice
        </Chip>
        <Chip onRemove={() => undefined}>Bakeries</Chip>
        <Badge>Draft</Badge>
        <Badge tone="warn">Staff</Badge>
        {(['ok', 'running', 'retrying', 'failed', 'cancelled', 'new', 'staff'] as StatusKind[]).map(
          (k) => (
            <StatusPill key={k} kind={k} />
          ),
        )}
        <ScoreBadge score={91} />
        <ScoreBadge score={72} />
        <ScoreBadge score={40} variant="pill" />
      </Section>
      <Section title="Cards and stats">
        <Card className="w-64">Card</Card>
        <Card tone="accent" className="w-64">
          Pitch card
        </Card>
        <div className="grid w-full grid-cols-1 rounded-card border border-line-strong sm:grid-cols-3">
          <StatTile label="Leads" value="64" previous="52" sparkline={[2, 4, 3, 6, 8]} />
          <StatTile label="Cost per lead" value="3.2 cr" highlight />
          <StatTile label="Revenue" value={null} />
        </div>
      </Section>
      <Section title="Table">
        <div className="w-full">
          <Table
            caption="Leads"
            rowKey={(r) => r.id}
            rows={rows}
            sort={sort}
            onSortChange={setSort}
            columns={[
              { key: 'name', header: 'Name', cell: (r) => r.name, sortable: true },
              {
                key: 'score',
                header: 'Score',
                cell: (r) => <ScoreBadge score={r.score} variant="pill" />,
                numeric: true,
              },
              {
                key: 'credits',
                header: 'Credits',
                cell: (r) => r.credits,
                numeric: true,
                sortable: true,
              },
            ]}
          />
        </div>
      </Section>
      <Section title="List and split view">
        <div className="flex h-56 w-full overflow-hidden rounded-card border border-line-strong">
          <SplitView
            listLabel="Kit leads"
            previewLabel="Kit preview"
            list={rows.map((r) => (
              <ListRow
                key={r.id}
                selected={selected === r.id}
                onSelect={() => setSelected(r.id)}
                leading={<ScoreBadge score={r.score} />}
                title={r.name}
                meta="Bakery · 0.8 mi"
              />
            ))}
            preview={<p className="m-0 p-4 text-sm">Preview of {selected}</p>}
          />
        </div>
      </Section>
      <Section title="Tabs">
        <div className="w-full">
          <Tabs
            label="Kit tabs"
            items={[
              { id: 'a', label: 'Evidence', panel: 'Evidence panel' },
              { id: 'b', label: 'Pitch', panel: 'Pitch panel' },
            ]}
          />
        </div>
      </Section>
      <Section title="Feedback">
        <div className="grid w-full gap-3">
          <Banner title="Heads up">Info banner</Banner>
          <Banner tone="warn" title="Low balance">
            Warn banner
          </Banner>
        </div>
        <Spinner />
        <Skeleton className="h-6 w-40" />
        <div className="w-full">
          <EmptyState
            title="No plans yet"
            description="Tell us who you want to find"
            action={<Button variant="primary">New plan</Button>}
          />
        </div>
        <div className="w-full">
          <ErrorState onRetry={() => undefined} />
        </div>
        <Button onClick={() => toast({ message: 'Saved' })}>Show toast</Button>
        <Button onClick={() => setDialog(true)}>Open dialog</Button>
        <Dialog
          open={dialog}
          onClose={() => setDialog(false)}
          title="Not enough credits"
          footer={
            <Button variant="primary" onClick={() => setDialog(false)}>
              Buy credits
            </Button>
          }
        >
          You need 120 cr and have 80 cr available.
        </Dialog>
      </Section>
    </main>
  );
}
