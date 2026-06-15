import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Label,
  Line,
  LineChart,
  Pie,
  PieChart,
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

export type HistogramSeries = { name: string; histogram: HistogramBucket[]; color?: string };

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
  const hasLegend = present.length > 1;

  return (
    <div className="flex flex-col" style={{ height }}>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 32, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              label={{
                value: `chunk size (${unit})`,
                position: "insideBottom",
                offset: -12,
                fontSize: 11,
                fill: "hsl(var(--muted-foreground))"
              }}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatCount}
              label={{
                value: "chunks",
                angle: -90,
                position: "insideLeft",
                fontSize: 11,
                fill: "hsl(var(--muted-foreground))"
              }}
            />
            <RechartsTooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, name: string) => [`${formatCount(value)} chunks`, name]}
              labelFormatter={(label: string) => `${label} ${unit}`}
            />
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
      </div>
      {hasLegend ? (
        <ChartLegend
          items={present.map((entry, index) => ({
            label: entry.name,
            color: entry.color ?? chartColor(index)
          }))}
          marker="square"
        />
      ) : null}
    </div>
  );
}

export function DistributionLineChart({
  series,
  height = 320,
  unit,
  valueLabel = "chunks"
}: {
  series: HistogramSeries[];
  height?: number;
  unit: string;
  valueLabel?: string;
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
  const hasLegend = present.length > 1;

  return (
    <div className="flex flex-col" style={{ height }}>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 32, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis
              dataKey="label"
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              label={{
                value: `chunk size (${unit})`,
                position: "insideBottom",
                offset: -12,
                fontSize: 11,
                fill: "hsl(var(--muted-foreground))"
              }}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatCount}
              label={{
                value: valueLabel,
                angle: -90,
                position: "insideLeft",
                fontSize: 11,
                fill: "hsl(var(--muted-foreground))"
              }}
            />
            <RechartsTooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, name: string) => [`${formatCount(value)} ${valueLabel}`, name]}
              labelFormatter={(label: string) => `${label} ${unit}`}
            />
            {present.map((entry, index) => (
              <Line
                key={entry.name}
                type="monotone"
                dataKey={entry.name}
                stroke={entry.color ?? chartColor(index)}
                strokeWidth={2}
                dot={{ r: 2 }}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {hasLegend ? (
        <ChartLegend
          items={present.map((entry, index) => ({
            label: entry.name,
            color: entry.color ?? chartColor(index)
          }))}
          marker="circle"
        />
      ) : null}
    </div>
  );
}

export type CategoryDatum = { name: string; value: number };
export type DistributionSlice = { id: string; label: string; count: number; fill?: string };

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
  height = 300,
  xValueFormatter = formatCount,
  yValueFormatter = formatCount
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  height?: number;
  xValueFormatter?: (value: number) => string;
  yValueFormatter?: (value: number) => string;
}) {
  if (points.length === 0) {
    return <EmptyChart height={height} />;
  }
  const groups = [...new Set(points.map((point) => point.group ?? "repos"))].sort();
  const hasLegend = groups.length > 1;
  return (
    <div className="flex flex-col" style={{ height }}>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 12, right: 20, bottom: 48, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              type="number"
              dataKey="x"
              name={xLabel}
              tick={AXIS_TICK}
              tickLine={false}
              tickFormatter={xValueFormatter}
              label={{
                value: xLabel,
                position: "insideBottom",
                offset: -28,
                fontSize: 11,
                fill: "hsl(var(--muted-foreground))"
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name={yLabel}
              width={72}
              tick={AXIS_TICK}
              tickLine={false}
              tickFormatter={yValueFormatter}
              label={{
                value: yLabel,
                angle: -90,
                position: "insideLeft",
                offset: -2,
                fontSize: 11,
                fill: "hsl(var(--muted-foreground))"
              }}
            />
            <ZAxis range={[70, 71]} />
            <RechartsTooltip
              contentStyle={TOOLTIP_STYLE}
              cursor={{ strokeDasharray: "3 3" }}
              formatter={(value: number, name: string) => [
                name === xLabel ? xValueFormatter(value) : yValueFormatter(value),
                name
              ]}
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
                      {xLabel}: {xValueFormatter(point.x)} · {yLabel}: {yValueFormatter(point.y)}
                    </div>
                  </div>
                );
              }}
            />
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
      </div>
      {hasLegend ? (
        <ChartLegend
          items={groups.map((group, index) => ({
            label: group,
            color: chartColor(index)
          }))}
          marker="circle"
        />
      ) : null}
    </div>
  );
}

export function DistributionDonutChart({
  data,
  height = 260,
  variant = "donut",
  centerValue,
  centerLabel,
  valueLabel = "repos"
}: {
  data: DistributionSlice[];
  height?: number;
  variant?: "donut" | "label";
  centerValue?: number;
  centerLabel?: string;
  valueLabel?: string;
}) {
  if (data.length === 0) {
    return <EmptyChart height={height} />;
  }

  const total = data.reduce((sum, entry) => sum + entry.count, 0);
  const displayedCenterValue = centerValue ?? total;
  const displayedCenterLabel = centerLabel ?? valueLabel;
  const outerRadius = variant === "label" ? 74 : 76;
  const innerRadius = variant === "donut" ? 48 : 0;

  return (
    <div className="flex flex-col" style={{ height }}>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 16, right: 16, bottom: 8, left: 16 }}>
            <RechartsTooltip
              contentStyle={TOOLTIP_STYLE}
              formatter={(value: number, name: string, item) => {
                const payload = item.payload as DistributionSlice | undefined;
                const percent = total > 0 ? (value / total) * 100 : 0;
                return [`${formatCount(value)} ${valueLabel} (${percent.toFixed(1)}%)`, payload?.label ?? name];
              }}
            />
            <Pie
              data={data}
              dataKey="count"
              nameKey="id"
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              stroke="none"
              labelLine={false}
              label={variant === "label" ? renderPieLabel : false}
            >
              {data.map((entry, index) => (
                <Cell key={entry.id} fill={entry.fill ?? chartColor(index)} />
              ))}
              {variant === "donut" ? (
                <Label
                  content={({ viewBox }) => {
                    if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) {
                      return null;
                    }
                    return (
                      <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                        <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-semibold">
                          {formatCount(displayedCenterValue)}
                        </tspan>
                        <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 20} className="fill-muted-foreground text-xs">
                          {displayedCenterLabel}
                        </tspan>
                      </text>
                    );
                  }}
                />
              ) : null}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ChartLegend
        items={data.map((entry, index) => ({
          label: entry.label,
          color: entry.fill ?? chartColor(index)
        }))}
        marker="circle"
      />
    </div>
  );
}

function renderPieLabel({
  cx,
  cy,
  midAngle,
  outerRadius,
  payload
}: {
  cx?: number;
  cy?: number;
  midAngle?: number;
  outerRadius?: number;
  payload?: DistributionSlice;
}) {
  if (
    !payload ||
    typeof cx !== "number" ||
    typeof cy !== "number" ||
    typeof midAngle !== "number" ||
    typeof outerRadius !== "number"
  ) {
    return null;
  }

  const radius = outerRadius + 20;
  const angle = -midAngle * (Math.PI / 180);
  const x = cx + radius * Math.cos(angle);
  const y = cy + radius * Math.sin(angle);

  return (
    <text
      x={x}
      y={y}
      textAnchor={x > cx ? "start" : "end"}
      dominantBaseline="central"
      className="fill-foreground text-xs"
    >
      {payload.label}
    </text>
  );
}

function ChartLegend({
  items,
  marker
}: {
  items: { label: string; color: string }[];
  marker: "circle" | "square";
}) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-2 pt-2 text-xs text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            className={marker === "circle" ? "h-2.5 w-2.5 rounded-full" : "h-2.5 w-2.5 rounded-sm"}
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          {item.label}
        </span>
      ))}
    </div>
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
