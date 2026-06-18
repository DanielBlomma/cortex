import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts";

import { formatCount } from "@/lib/format";

import { AXIS_TICK, ChartLegend, EmptyChart, TOOLTIP_STYLE, chartColor } from "./chart-core";
import type { ScatterPoint } from "./types";

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
