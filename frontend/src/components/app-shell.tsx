import type { ReactNode } from "react";
import { Github } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Route } from "@/routes";

const GITHUB_REPO_URL = "https://github.com/DanielBlomma/cortex";

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  const onBootstrap = route.page === "bootstrap" || route.page === "repoDetail";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <nav className="mx-auto flex h-14 max-w-[96rem] items-center justify-between px-4" aria-label="Primary">
          <div className="flex items-center gap-6">
            <a
              href="#/"
              className="inline-flex min-h-9 items-center text-lg font-semibold tracking-tight text-foreground transition-colors hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              Cortex
            </a>
            <div className="flex items-center gap-1 text-sm">
              <NavLink href="#/" active={route.page === "overview"}>
                Overview
              </NavLink>
              <NavLink href="#/bootstrap" active={onBootstrap}>
                Bootstrap metrics
              </NavLink>
            </div>
          </div>
          <a
            href={GITHUB_REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            aria-label="Open cortex on GitHub"
          >
            <Github className="h-4 w-4" />
            <span>GitHub</span>
          </a>
        </nav>
      </header>
      {children}
    </div>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <a
      href={href}
      className={cn(
        "rounded-md px-3 py-1.5 font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </a>
  );
}
