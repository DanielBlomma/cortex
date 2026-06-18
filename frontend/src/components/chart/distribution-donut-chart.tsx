import { Cell, Label, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";

import { formatCount } from "@/lib/format";

import { ChartLegend, EmptyChart, TOOLTIP_STYLE, chartColor } from "./chart-core";
import type { DistributionSlice } from "./types";

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
