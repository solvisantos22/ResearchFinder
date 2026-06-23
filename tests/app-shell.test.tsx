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
        rightRail={<div>Queue clear</div>}
      >
        <h1>{"Today's research inbox"}</h1>
      </AppShell>
    );

    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByText("Today's research inbox")).toBeInTheDocument();
    expect(screen.getByText("Queue clear")).toBeInTheDocument();
    expect(screen.getByText("Worker online")).toBeInTheDocument();
  });
});
