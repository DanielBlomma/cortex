import type { ReactNode } from "react";

export function SectionShell({
  title,
  description,
  headerAside,
  children
}: {
  title: string;
  description?: string;
  headerAside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {headerAside}
      </div>
      {children}
    </section>
  );
}
