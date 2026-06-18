import type { LucideIcon } from "lucide-react";

export type StageKey = "resolve" | "ingest" | "embed" | "graph" | "serve";

export type Stage = {
  key: StageKey;
  label: string;
  icon: LucideIcon;
  /** HSL triple (no `hsl(...)` wrapper) so we can compose alpha variants. */
  accent: string;
  tagline: string;
  blurb: string;
  facts: readonly string[];
};
