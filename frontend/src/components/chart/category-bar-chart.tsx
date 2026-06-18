import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis
} from "recharts";

import { formatCount } from "@/lib/format";

import { AXIS_TICK, EmptyChart, TOOLTIP_STYLE, chartColor } from "./chart-core";
import type { CategoryDatum } from "./types";

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
