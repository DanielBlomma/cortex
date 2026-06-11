import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts";

import type { HistogramBucket } from "@/data/bootstrap-types";
import { formatCount } from "@/lib/format";

export const CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))"
] as const;

export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" } as const;
const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  fontSize: 12,
  background: "hsl(var(--background))"
} as const;

type HistogramSeries = { name: string; histogram: HistogramBucket[]; color?: string };

/**
 * Fixed-bucket histogram as a (optionally grouped) bar chart. All series must
 * share the bucket layout produced by the harness, which makes them directly
 * comparable across repos and embedding models.
 */
export function HistogramChart({
  series,
  height = 260,
  unit
}: {
  series: HistogramSeries[];
  height?: number;
  unit: string;
}) {
  const present = series.filter((entry) => entry.histogram.length > 0);
  if (present.length === 0) {
    return <EmptyChart height={height} />;
  }
  const labels = present[0].histogram.map((bucket) => bucket.label);
  const data = labels.map((label, bucketIndex) => {
    const row: Record<string, string | number> = { label };
    for (const entry of present) {
      row[entry.name] = entry.histogram[bucketIndex]?.count ?? 0;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} label={undefined} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={formatCount} />
        <RechartsTooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value: number, name: string) => [`${formatCount(value)} chunks`, name]}
          labelFormatter={(label: string) => `${label} ${unit}`}
        />
        {present.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {present.map((entry, index) => (
          <Bar
            key={entry.name}
            dataKey={entry.name}
            fill={entry.color ?? chartColor(index)}
            radius={[3, 3, 0, 0]}
            maxBarSize={48}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export type CategoryDatum = { name: string; value: number };

/** Horizontal bar chart for categorical breakdowns (relation types, languages). */
export function CategoryBarChart({
  data,
  height,
  valueLabel,
  colorByIndex = false
}: {
  data: CategoryDatum[];
  height?: number;
  valueLabel: string;
  colorByIndex?: boolean;
}) {
  if (data.length === 0) {
    return <EmptyChart height={height ?? 240} />;
  }
  const computedHeight = height ?? Math.max(180, data.length * 36 + 40);
  return (
    <ResponsiveContainer width="100%" height={computedHeight}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={formatCount} />
        <YAxis
          type="category"
          dataKey="name"
          width={130}
          tick={{ ...AXIS_TICK, fill: "hsl(var(--foreground))" }}
          tickLine={false}
          axisLine={false}
        />
        <RechartsTooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(value: number) => [formatCount(value), valueLabel]}
        />
        <Bar dataKey="value" fill={chartColor(0)} radius={[0, 3, 3, 0]} maxBarSize={22}>
          {colorByIndex
            ? data.map((entry, index) => <Cell key={entry.name} fill={chartColor(index)} />)
            : null}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export type ScatterPoint = {
  x: number;
  y: number;
  name: string;
  group?: string;
};

/** Scatter plot of repos with optional grouping (e.g. by primary language). */
export function RepoScatterChart({
  points,
  xLabel,
  yLabel,
  height = 300
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  height?: number;
}) {
  if (points.length === 0) {
    return <EmptyChart height={height} />;
  }
  const groups = [...new Set(points.map((point) => point.group ?? "repos"))].sort();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          type="number"
          dataKey="x"
          name={xLabel}
          tick={AXIS_TICK}
          tickLine={false}
          tickFormatter={formatCount}
          label={{ value: xLabel, position: "insideBottom", offset: -10, fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name={yLabel}
          tick={AXIS_TICK}
          tickLine={false}
          tickFormatter={formatCount}
          label={{ value: yLabel, angle: -90, position: "insideLeft", fontSize: 11 }}
        />
        <ZAxis range={[70, 71]} />
        <RechartsTooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ strokeDasharray: "3 3" }}
          formatter={(value: number, name: string) => [formatCount(value), name]}
          labelFormatter={() => ""}
          content={({ payload }) => {
            const point = payload?.[0]?.payload as ScatterPoint | undefined;
            if (!point) {
              return null;
            }
            return (
              <div style={TOOLTIP_STYLE} className="px-3 py-2">
                <div className="text-xs font-medium">{point.name}</div>
                <div className="text-xs text-muted-foreground">
                  {xLabel}: {formatCount(point.x)} · {yLabel}: {formatCount(point.y)}
                </div>
              </div>
            );
          }}
        />
        {groups.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
        {groups.map((group, index) => (
          <Scatter
            key={group}
            name={group}
            data={points.filter((point) => (point.group ?? "repos") === group)}
            fill={chartColor(index)}
          />
        ))}
      </ScatterChart>
    </ResponsiveContainer>
  );
}

function EmptyChart({ height }: { height: number }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground"
    >
      No data
    </div>
  );
}
