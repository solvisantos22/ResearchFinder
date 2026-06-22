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
    expect(screen.getByText("pass")).toBeInTheDocument();
    expect(
      screen.getByText("The prototype can be bounded to one dataset slice.")
    ).toBeInTheDocument();
  });
});
