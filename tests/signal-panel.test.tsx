import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SignalPanel } from "@/components/SignalPanel";

describe("SignalPanel", () => {
  it("renders signal status and evidence", () => {
    render(
      <SignalPanel
        title="Prototype signal"
        status="pass"
        summary="A minimal test exists"
        evidence="The prototype can be bounded to one dataset slice."
      />
    );

    expect(screen.getByText("Prototype signal")).toBeInTheDocument();
    expect(screen.getByText("PASS")).toBeInTheDocument();
    expect(
      screen.getByText("The prototype can be bounded to one dataset slice.")
    ).toBeInTheDocument();
  });

  it.each([
    {
      status: "pass",
      badge: "PASS",
      classes: ["border-rf-success/40", "bg-rf-success/10", "text-rf-success"]
    },
    {
      status: "warning",
      badge: "WARNING",
      classes: ["border-rf-warning/40", "bg-rf-warning/10", "text-rf-warning"]
    },
    {
      status: "fail",
      badge: "FAIL",
      classes: ["border-rf-danger/40", "bg-rf-danger/10", "text-rf-danger"]
    }
  ] as const)("renders $status status styling and badge", ({ status, badge, classes }) => {
    render(
      <SignalPanel
        title={`${badge} signal`}
        status={status}
        summary="A bounded summary"
        evidence="A cited evidence note"
      />
    );

    const panel = screen.getByTestId("signal-panel");
    expect(panel).toHaveClass(...classes);
    expect(panel).toHaveClass("[overflow-wrap:anywhere]");
    expect(screen.getByText(badge)).toHaveClass("uppercase");
  });
});
