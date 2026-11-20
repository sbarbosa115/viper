import type { Dashboard, DashboardPeriod } from '@app/contracts/reporting';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  Button,
  Card,
  ErrorState,
  Skeleton,
  StatTile,
  Table,
  Tabs,
  type Column,
} from '../../../../shared/ui';
import { useActAs, useDashboard } from '../api/hooks';
import { BarChart } from '../components/bar-chart';
import { copy, periodLabels } from '../copy';
import {
  formatCount,
  formatDecimal,
  formatDuration,
  formatPct,
  formatShortDate,
  formatStamp,
  formatUsdCents,
  moneyTile,
  tile,
} from '../lib/format';

const periods = ['7d', '30d', '90d'] as const satisfies readonly DashboardPeriod[];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="m-0 text-sm font-semibold uppercase tracking-[0.08em] text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Tiles({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 overflow-hidden rounded-card border border-line-strong bg-surface sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-b [&>*]:border-line">
      {children}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3">
      <h3 className="m-0 text-base font-semibold text-fg">{title}</h3>
      {children}
    </Card>
  );
}

function Customers({ data }: { data: Dashboard }) {
  const c = data.customers;
  const signups = c.newSignups.byDay;
  return (
    <Section title={copy.customers}>
      <Tiles>
        <StatTile label={copy.total} {...tile(c.total, formatCount)} />
        <StatTile
          label={copy.newSignups}
          {...tile(c.newSignups, formatCount)}
          sparkline={signups.map((d) => d.count)}
        />
        <StatTile label={copy.verified} {...tile(c.verified, formatCount)} />
        <StatTile label={copy.active} {...tile(c.active, formatCount)} />
        <StatTile label={copy.paying} {...tile(c.paying, formatCount)} />
        <StatTile label={copy.trialToPaid} {...tile(c.trialToPaidPct, formatPct)} />
      </Tiles>
      <Panel title={copy.signupsChart}>
        {signups.length === 0 ? (
          <p className="m-0 text-sm text-muted">{copy.signupsEmpty}</p>
        ) : (
          <BarChart
            data={signups}
            label={copy.signupsChart}
            xTitle={copy.chartDate}
            yTitle={`${copy.chartCount} (0 to ${Math.max(...signups.map((d) => d.count))})`}
          />
        )}
      </Panel>
    </Section>
  );
}

function Revenue({ data }: { data: Dashboard }) {
  const r = data.revenue;
  return (
    <Section title={copy.revenue}>
      <Tiles>
        <StatTile label={copy.packRevenue} {...moneyTile(r.packRevenue)} />
        <StatTile label={copy.granted} {...tile(r.creditsGranted, formatCount)} />
        <StatTile label={copy.purchased} {...tile(r.creditsPurchased, formatCount)} />
        <StatTile label={copy.spent} {...tile(r.creditsSpent, formatCount)} />
        <StatTile label={copy.unspent} {...tile(r.unspentCredits, formatCount)} />
      </Tiles>
    </Section>
  );
}

function FailedRuns({ runs }: { runs: Dashboard['runs']['failed'] }) {
  return (
    <Panel title={copy.failedRuns}>
      {runs.length === 0 ? (
        <p className="m-0 text-sm text-muted">{copy.failedRunsEmpty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {runs.map((run) => (
            <li key={run.runId} className="flex flex-wrap items-center gap-x-3 text-sm">
              <span className="font-mono text-xs font-medium uppercase tracking-wider text-danger">
                <span aria-hidden="true">✕ </span>Failed
              </span>
              <span className="text-fg-2">
                {run.businessName} · {run.failureReason ?? copy.none}
              </span>
              <span className="font-mono text-xs text-faint">{formatStamp(run.at)}</span>
              <Link
                to={`/staff/runs/${run.runId}`}
                aria-label={`${copy.openRun}: ${run.businessName}`}
                className="ml-auto text-accent hover:underline"
              >
                {copy.openRun}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Runs({ data }: { data: Dashboard }) {
  const r = data.runs;
  return (
    <Section title={copy.runs}>
      <Tiles>
        <StatTile label={copy.started} {...tile(r.started, formatCount)} />
        <StatTile label={copy.completed} {...tile(r.completedPct, formatPct)} />
        <StatTile label={copy.withinLimits} {...tile(r.withinLimitsPct, formatPct)} />
        <StatTile label={copy.medianDuration} {...tile(r.medianDurationS, formatDuration)} />
        <StatTile label={copy.avgCredits} {...tile(r.avgCredits, formatCount)} />
      </Tiles>
      <FailedRuns runs={r.failed} />
    </Section>
  );
}

function Leads({ data }: { data: Dashboard }) {
  const l = data.leads;
  return (
    <Section title={copy.leads}>
      <Tiles>
        <StatTile label={copy.delivered} {...tile(l.delivered, formatCount)} />
        <StatTile label={copy.goodLead} {...tile(l.goodPct, formatPct)} />
        <StatTile label={copy.verifiedContacts} {...tile(l.verifiedPct, formatPct)} />
        <StatTile
          label={copy.costPerLead}
          {...tile(l.providerCostPerLeadCents, formatUsdCents)}
          highlight
        />
        <StatTile label={copy.creditsPerLead} {...tile(l.creditsPerLead, formatDecimal)} />
        <StatTile label={copy.grossMargin} {...tile(data.leads.grossMarginPct, formatPct)} />
        <StatTile label={copy.noIcpEdits} {...tile(data.plans.noIcpEditPct, formatPct)} />
      </Tiles>
    </Section>
  );
}

function NorthStar({ data }: { data: Dashboard }) {
  const m = data.northStar.goodLeadsPerActiveBusinessPerWeek;
  return (
    <Section title={copy.northStar}>
      <Tiles>
        <StatTile label={copy.northStarHint} {...tile(m, formatDecimal)} highlight />
      </Tiles>
    </Section>
  );
}

const providerColumns: Column<Dashboard['providers'][number]>[] = [
  {
    key: 'tool',
    header: copy.colTool,
    cell: (p) => <code className="font-mono text-[13px]">{p.toolKey}</code>,
  },
  { key: 'spend', header: copy.colSpend, numeric: true, cell: (p) => formatUsdCents(p.spendCents) },
  {
    key: 'errors',
    header: copy.colErrors,
    numeric: true,
    cell: (p) => formatPct(p.errorRatePct) ?? copy.none,
  },
];

function ActAsButton({ id, name }: { id: string; name: string }) {
  const actAs = useActAs();
  return (
    <>
      <Button
        size="sm"
        aria-label={`${copy.actAs} ${name}`}
        loading={actAs.isPending}
        onClick={() => actAs.mutate(id)}
      >
        {copy.actAs}
      </Button>
      {actAs.isError && (
        <span role="alert" className="ml-2 text-xs text-danger">
          {copy.actAsFailed}
        </span>
      )}
    </>
  );
}

const topColumns: Column<Dashboard['topBusinesses'][number]>[] = [
  { key: 'name', header: copy.colBusiness, cell: (b) => <span className="text-fg">{b.name}</span> },
  {
    key: 'credits',
    header: copy.colCredits,
    numeric: true,
    cell: (b) => formatCount(b.creditsSpent),
  },
];

const signupColumns: Column<Dashboard['latestSignups'][number]>[] = [
  { key: 'name', header: copy.colBusiness, cell: (s) => <span className="text-fg">{s.name}</span> },
  { key: 'owner', header: copy.colOwner, cell: (s) => s.ownerEmail },
  { key: 'at', header: copy.colSignedUp, cell: (s) => formatShortDate(s.createdAt) },
  { key: 'act', header: '', cell: (s) => <ActAsButton id={s.id} name={s.name} /> },
];

function Tables({ data }: { data: Dashboard }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Section title={copy.providers}>
        <Table
          caption={copy.providers}
          columns={providerColumns}
          rows={data.providers}
          rowKey={(p) => p.toolKey}
          emptyTitle={copy.providersEmpty}
        />
      </Section>
      <Section title={copy.topBusinesses}>
        <Table
          caption={copy.topBusinesses}
          columns={topColumns}
          rows={data.topBusinesses}
          rowKey={(b) => b.id}
        />
      </Section>
      <div className="lg:col-span-2">
        <Section title={copy.latestSignups}>
          <Table
            caption={copy.latestSignups}
            columns={signupColumns}
            rows={data.latestSignups}
            rowKey={(s) => s.id}
          />
        </Section>
      </div>
    </div>
  );
}

function Body({ period }: { period: DashboardPeriod }) {
  const query = useDashboard(period);
  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Loading dashboard">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  if (query.isError) {
    return <ErrorState title={copy.loadFailed} onRetry={() => void query.refetch()} />;
  }
  const data = query.data;
  return (
    <div className="flex flex-col gap-8">
      <Customers data={data} />
      <Revenue data={data} />
      <Runs data={data} />
      <Leads data={data} />
      <NorthStar data={data} />
      <Tables data={data} />
    </div>
  );
}

/** FR-30: Staff dashboard with period tabs and previous-period comparison. */
export function DashboardPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 md:px-7">
      <h1 className="m-0 text-[26px] font-semibold tracking-tight text-fg">{copy.title}</h1>
      <Tabs
        label={copy.period}
        defaultId="30d"
        items={periods.map((p) => ({ id: p, label: periodLabels[p], panel: <Body period={p} /> }))}
      />
    </div>
  );
}
