import { cn } from "@/lib/utils";

import { STAGES } from "./stages";

export function StageRail({ active, onSelect }: { active: number; onSelect: (index: number) => void }) {
  return (
    <div className="flex items-start">
      {STAGES.map((stage, index) => {
        const isActive = index === active;
        const Icon = stage.icon;
        return (
          <button
            key={stage.key}
            type="button"
            onClick={() => onSelect(index)}
            aria-pressed={isActive}
            aria-label={`Stage ${index + 1}: ${stage.label}`}
            className="group relative flex flex-1 flex-col items-center gap-2 rounded-md px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {index < STAGES.length - 1 ? (
              <span aria-hidden className="absolute left-1/2 top-1 z-0 flex h-11 w-full items-center">
                <span className="cortex-track h-0.5 w-full rounded-full bg-border">
                  <span className="cortex-track-dot absolute inset-y-0 left-0 w-8 rounded-full bg-gradient-to-r from-transparent via-foreground/50 to-transparent" />
                </span>
              </span>
            ) : null}
            <span
              className={cn(
                "relative z-10 flex h-11 w-11 items-center justify-center rounded-full border-2 bg-card transition-all duration-300",
                isActive ? "scale-110" : "border-border text-muted-foreground group-hover:text-foreground"
              )}
              style={
                isActive
                  ? {
                      borderColor: `hsl(${stage.accent})`,
                      color: `hsl(${stage.accent})`,
                      background: `hsl(${stage.accent} / 0.08)`,
                      boxShadow: `0 0 0 4px hsl(${stage.accent} / 0.12)`
                    }
                  : undefined
              }
            >
              <Icon className="h-5 w-5" />
              <span
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold text-primary-foreground"
                style={{ background: isActive ? `hsl(${stage.accent})` : "hsl(var(--muted-foreground))" }}
              >
                {index + 1}
              </span>
            </span>
            <span
              className={cn(
                "text-center text-xs font-medium transition-colors",
                isActive ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {stage.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
