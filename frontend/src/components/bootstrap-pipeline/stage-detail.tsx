import { STAGES } from "./stages";
import type { Stage } from "./types";

export function StageDetail({ stage, index }: { stage: Stage; index: number }) {
  return (
    <div className="flex flex-col justify-center gap-3">
      <div className="flex items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ background: `hsl(${stage.accent} / 0.12)`, color: `hsl(${stage.accent})` }}
        >
          Step {index + 1} / {STAGES.length}
        </span>
        <span className="text-xs text-muted-foreground">{stage.tagline}</span>
      </div>
      <h3 className="text-lg font-semibold tracking-tight">{stage.label}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{stage.blurb}</p>
      <div className="flex flex-wrap gap-1.5">
        {stage.facts.map((fact) => (
          <span
            key={fact}
            className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
            style={{ borderColor: `hsl(${stage.accent} / 0.35)` }}
          >
            {fact}
          </span>
        ))}
      </div>
    </div>
  );
}
