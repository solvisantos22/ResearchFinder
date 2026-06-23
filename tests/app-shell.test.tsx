import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppShell } from "@/components/AppShell";

describe("AppShell", () => {
  it("renders left navigation, central content, and right status rail", () => {
    render(
      <AppShell
        currentUserName="Solvi"
        workerStatus="online"
        activeSection="inbox"
        navItems={[
          { id: "inbox", label: "Inbox", href: { pathname: "/inbox/user-solvi" } },
          { id: "profiles", label: "Profiles", href: "#profiles" },
          { id: "jobs", label: "Jobs", href: { pathname: "/jobs/recent" } },
          { id: "workers", label: "Workers", href: "#workers" }
        ]}
        rightRail={<div>Queue clear</div>}
      >
        <h1>{"Today's research inbox"}</h1>
      </AppShell>
    );

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Status and activity" })
    ).toBeInTheDocument();
    expect(screen.getByText("Solvi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute(
      "href",
      "/inbox/user-solvi"
    );
    expect(screen.getByRole("link", { name: "Profiles" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Jobs" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Workers" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Today's research inbox")).toBeInTheDocument();
    expect(screen.getByText("Queue clear")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Worker online");
    expect(screen.getByText("Worker online")).toBeInTheDocument();
  });
});
