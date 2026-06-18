import { useEffect, useState, type CSSProperties } from "react";

import { StageCanvas } from "@/components/bootstrap-pipeline/stage-canvas";
import { StageDetail } from "@/components/bootstrap-pipeline/stage-detail";
import { StageRail } from "@/components/bootstrap-pipeline/stage-rail";
import { CYCLE_MS, STAGES } from "@/components/bootstrap-pipeline/stages";
import { usePrefersReducedMotion } from "@/components/bootstrap-pipeline/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

export function BootstrapPipeline() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced || paused) return;
    const timer = setTimeout(() => {
      setActive((current) => (current + 1) % STAGES.length);
    }, CYCLE_MS);
    return () => clearTimeout(timer);
  }, [active, paused, reduced]);

  const stage = STAGES[active];
  const rootStyle = { "--accent-hsl": stage.accent } as CSSProperties;

  return (
    <div
      className="rounded-xl border bg-card p-5 shadow-sm transition-colors sm:p-6"
      style={rootStyle}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <StageRail active={active} onSelect={setActive} />

      {!reduced && !paused ? (
        <div className="mt-4 h-0.5 w-full overflow-hidden rounded-full bg-border/60">
          <div
            key={active}
            className="cortex-progress h-full rounded-full"
            style={{ background: `hsl(${stage.accent})`, animationDuration: `${CYCLE_MS}ms` }}
          />
        </div>
      ) : (
        <div className="mt-4 h-0.5 w-full rounded-full bg-border/60" />
      )}

      <div className="mt-6 grid items-stretch gap-6 md:grid-cols-[1.25fr_1fr]">
        <div className="relative min-h-[220px] overflow-hidden rounded-lg border bg-muted/30 p-4">
          <StageCanvas key={active} stageKey={stage.key} accent={stage.accent} />
        </div>
        <div className="grid">
          {STAGES.map((item, index) => (
            <div
              key={item.key}
              className={cn("[grid-area:1/1]", index === active ? "" : "invisible pointer-events-none")}
              aria-hidden={index !== active}
            >
              <StageDetail stage={item} index={index} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
