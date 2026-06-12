import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

import { StatusBadge } from "@/components/bootstrap/stat-cards";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { RepoRow } from "@/data/bootstrap-types";
import { formatCount, formatDuration, formatNumber, formatPercent } from "@/lib/format";
import { repoDetailHash } from "@/routes";
import { cn } from "@/lib/utils";

type SortKey =
  | "name"
  | "tracked_files"
  | "chunks"
  | "chunk_p50_lines"
  | "edges"
  | "avg_degree"
  | "isolated_pct"
  | "total_ms";

const COLUMNS: Array<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: "name", label: "Repository", numeric: false },
  { key: "tracked_files", label: "Tracked files", numeric: true },
  { key: "chunks", label: "Chunks", numeric: true },
  { key: "chunk_p50_lines", label: "P50 lines", numeric: true },
  { key: "edges", label: "Edges", numeric: true },
  { key: "avg_degree", label: "Avg degree", numeric: true },
  { key: "isolated_pct", label: "Isolated", numeric: true },
  { key: "total_ms", label: "Bootstrap", numeric: true }
];

export function RepoTable({ rows, version }: { rows: RepoRow[]; version?: string }) {
  const [sortKey, setSortKey] = useState<SortKey>("chunks");
  const [descending, setDescending] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((left, right) => {
      if (sortKey === "name") {
        return descending ? right.name.localeCompare(left.name) : left.name.localeCompare(right.name);
      }
      const a = left[sortKey] ?? -Infinity;
      const b = right[sortKey] ?? -Infinity;
      return descending ? (b as number) - (a as number) : (a as number) - (b as number);
    });
    return copy;
  }, [rows, sortKey, descending]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((value) => !value);
    } else {
      setSortKey(key);
      setDescending(key !== "name");
    }
  };

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((column) => (
              <TableHead key={column.key} className={cn(column.numeric && "text-right")}>
                <button
                  type="button"
                  onClick={() => toggleSort(column.key)}
                  className={cn(
                    "inline-flex items-center gap-1 font-medium transition-colors hover:text-foreground",
                    column.numeric && "flex-row-reverse"
                  )}
                >
                  {column.label}
                  {sortKey === column.key ? (
                    descending ? (
                      <ArrowDown className="h-3 w-3" />
                    ) : (
                      <ArrowUp className="h-3 w-3" />
                    )
                  ) : null}
                </button>
              </TableHead>
            ))}
            <TableHead className="text-right">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((row) => (
            <TableRow
              key={`${row.key}-${row.model ?? "default"}`}
              className="cursor-pointer"
              onClick={() => {
                window.location.hash = repoDetailHash(row.key, version);
              }}
            >
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{row.name}</span>
                  <span className="flex flex-wrap gap-1">
                    {row.languages.map((language) => (
                      <Badge key={language} variant="secondary" className="px-1.5 text-[10px]">
                        {language}
                      </Badge>
                    ))}
                  </span>
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(row.tracked_files)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(row.chunks)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.chunk_p50_lines, 0)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(row.edges)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.avg_degree)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatPercent(row.isolated_pct, 0)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatDuration(row.total_ms)}</TableCell>
              <TableCell className="text-right">
                <StatusBadge status={row.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
