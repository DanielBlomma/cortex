import type { LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type StatCardDatum = {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
};

export function StatCards({ stats }: { stats: StatCardDatum[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="flex flex-col gap-1 p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {stat.icon ? <stat.icon className="h-3.5 w-3.5" /> : null}
              {stat.label}
            </div>
            <div className="text-2xl font-semibold tabular-nums tracking-tight">{stat.value}</div>
            {stat.hint ? <div className="text-xs text-muted-foreground">{stat.hint}</div> : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "ok") {
    return <Badge variant="success">ok</Badge>;
  }
  if (status === "embed_failed") {
    return <Badge variant="warning">embed failed</Badge>;
  }
  return <Badge variant="destructive">{status}</Badge>;
}
