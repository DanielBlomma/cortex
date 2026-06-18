export const TABS = [
  { key: "overview", label: "Overview" },
  { key: "dataset", label: "Dataset" },
  { key: "chunks", label: "Chunks & models" },
  { key: "graph", label: "Graph" },
  { key: "languages", label: "Languages" },
  { key: "repositories", label: "Repositories" },
  { key: "methodology", label: "Methodology" }
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export function TabBar({ active, onSelect }: { active: TabKey; onSelect: (tab: TabKey) => void }) {
  return (
    <nav className="scrollbar-hidden flex gap-1 overflow-x-auto border-b" aria-label="Metric sections">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onSelect(tab.key)}
          className={
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring " +
            (active === tab.key
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground")
          }
          aria-current={active === tab.key ? "page" : undefined}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
