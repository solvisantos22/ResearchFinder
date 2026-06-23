import React from "react";
import Link, { type LinkProps } from "next/link";

import { WorkerStatusPanel, type WorkerStatus } from "@/components/WorkerStatusPanel";

type AppShellSection = "inbox" | "profiles" | "jobs" | "workers";

type AppShellNavItem = {
  id: AppShellSection;
  label: string;
  href: LinkProps<string>["href"];
};

type AppShellProps = {
  currentUserName: string;
  workerStatus: WorkerStatus;
  activeSection: AppShellSection;
  navItems?: AppShellNavItem[];
  rightRailLabel?: string;
  rightRail: React.ReactNode;
  children: React.ReactNode;
};

const defaultNavItems: AppShellNavItem[] = [
  { id: "inbox", label: "Inbox", href: "#inbox" },
  { id: "profiles", label: "Profiles", href: "#profiles" },
  { id: "jobs", label: "Jobs", href: "#jobs" },
  { id: "workers", label: "Workers", href: "#workers" }
];

export function AppShell({
  currentUserName,
  workerStatus,
  activeSection,
  navItems = defaultNavItems,
  rightRailLabel = "Status and activity",
  rightRail,
  children
}: AppShellProps) {
  return (
    <div className="min-h-screen bg-rf-black text-rf-white">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-[224px_minmax(0,1fr)_320px]">
        <nav
          aria-label="Primary"
          className="border-b border-rf-border bg-rf-panel px-4 py-4 lg:border-b-0 lg:border-r"
        >
          <div className="min-w-0">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-rf-muted">
                Research Finder
              </p>
              <p className="mt-1 break-words text-sm font-medium text-rf-white">
                Command center
              </p>
            </div>
          </div>

          <div className="mt-5 flex gap-2 overflow-x-auto lg:grid lg:gap-2 lg:overflow-visible">
            {navItems.map((item) => {
              const isActive = item.id === activeSection;

              return (
                <Link
                  aria-current={isActive ? "page" : undefined}
                  className={`whitespace-nowrap rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "border-rf-violetSoft bg-rf-violet text-rf-white"
                      : "border-transparent text-rf-muted hover:border-rf-border hover:bg-rf-surface hover:text-rf-white"
                  }`}
                  href={item.href}
                  key={item.id}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        <main className="min-w-0 bg-rf-black px-5 py-5 md:px-8 md:py-7">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-rf-border pb-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-rf-muted">
                Signed in
              </p>
              <p className="mt-1 break-words text-base font-semibold text-rf-white">
                {currentUserName}
              </p>
            </div>
            <div className="min-w-0">
              <WorkerStatusPanel status={workerStatus} />
            </div>
          </header>

          <div className="min-w-0 [overflow-wrap:anywhere]">{children}</div>
        </main>

        <aside
          aria-label={rightRailLabel}
          className="min-w-0 border-t border-rf-border bg-rf-panel px-5 py-5 lg:border-l lg:border-t-0"
        >
          <div className="min-w-0 [overflow-wrap:anywhere]">{rightRail}</div>
        </aside>
      </div>
    </div>
  );
}
