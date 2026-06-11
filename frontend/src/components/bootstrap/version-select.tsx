import { ChevronDown } from "lucide-react";

import type { VersionIndexEntry } from "@/data/bootstrap-types";
import { formatDate } from "@/lib/format";

/**
 * Cortex-version picker for the bootstrap pages. A styled native select keeps
 * keyboard/screen-reader behavior for free and avoids another Radix
 * dependency for what is a simple, flat list.
 */
export function VersionSelect({
  versions,
  selected,
  onSelect
}: {
  versions: VersionIndexEntry[];
  selected: string;
  onSelect: (version: string) => void;
}) {
  if (versions.length === 0) {
    return null;
  }
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Cortex version</span>
      <select
        value={selected}
        onChange={(event) => onSelect(event.target.value)}
        className="h-9 appearance-none rounded-md border border-input bg-background pl-3 pr-8 text-sm font-medium shadow-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-label="Cortex version"
      >
        {versions.map((entry) => (
          <option key={entry.version} value={entry.version}>
            cortex v{entry.version} — {formatDate(entry.generated_at)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-muted-foreground" />
    </label>
  );
}
