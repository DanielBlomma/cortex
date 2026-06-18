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

export const AXIS_TICK = { fontSize: 11, fill: "hsl(var(--muted-foreground))" } as const;

export const TOOLTIP_STYLE = {
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  fontSize: 12,
  background: "hsl(var(--background))"
} as const;

export function ChartLegend({
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

export function EmptyChart({ height }: { height: number }) {
  return (
    <div
      style={{ height }}
      className="flex items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground"
    >
      No data
    </div>
  );
}
