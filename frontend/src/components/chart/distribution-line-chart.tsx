import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis
} from "recharts";

import { formatCount } from "@/lib/format";

import { AXIS_TICK, ChartLegend, EmptyChart, TOOLTIP_STYLE, chartColor } from "./chart-core";
import type { HistogramSeries } from "./types";

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
