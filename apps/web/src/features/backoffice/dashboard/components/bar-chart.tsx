import { formatShortDate } from '../lib/format';

export interface BarChartProps {
  data: { date: string; count: number }[];
  label: string;
  xTitle: string;
  yTitle: string;
}

const W = 640;
const H = 160;
const LEFT = 40;
const BOTTOM = 28;

/** Bars from tokens, labelled axes and a title per bar; values are also in the sr-only summary. */
export function BarChart({ data, label, xTitle, yTitle }: BarChartProps) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const slot = (W - LEFT) / data.length;
  const peak = data.reduce((best, d) => (d.count > best.count ? d : best), data[0]!);
  return (
    <figure className="m-0">
      <svg
        role="img"
        aria-label={`${label}: peak ${peak.count} on ${formatShortDate(peak.date)}`}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full text-accent"
      >
        <line x1={LEFT} y1={H - BOTTOM} x2={W} y2={H - BOTTOM} className="stroke-line-strong" />
        <line x1={LEFT} y1={4} x2={LEFT} y2={H - BOTTOM} className="stroke-line-strong" />
        <text x={LEFT - 6} y={12} textAnchor="end" className="fill-muted font-mono text-[10px]">
          {max}
        </text>
        <text
          x={LEFT - 6}
          y={H - BOTTOM}
          textAnchor="end"
          className="fill-muted font-mono text-[10px]"
        >
          0
        </text>
        {data.map((d, i) => {
          const h = (d.count / max) * (H - BOTTOM - 8);
          return (
            <rect
              key={d.date}
              x={LEFT + i * slot + slot * 0.15}
              y={H - BOTTOM - h}
              width={slot * 0.7}
              height={h}
              rx={2}
              fill="currentColor"
            >
              <title>{`${formatShortDate(d.date)}: ${d.count}`}</title>
            </rect>
          );
        })}
        <text x={LEFT} y={H - 10} className="fill-muted font-mono text-[10px]">
          {formatShortDate(data[0]!.date)}
        </text>
        <text x={W} y={H - 10} textAnchor="end" className="fill-muted font-mono text-[10px]">
          {formatShortDate(data[data.length - 1]!.date)}
        </text>
        <text x={(W + LEFT) / 2} y={H - 1} textAnchor="middle" className="fill-faint text-[10px]">
          {xTitle}
        </text>
      </svg>
      <figcaption className="text-xs text-faint">{yTitle}</figcaption>
    </figure>
  );
}
