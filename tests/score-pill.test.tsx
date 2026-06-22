import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScorePill } from "@/components/ScorePill";

describe("ScorePill", () => {
  it("renders a label, rounded score, and stable strong-tone styling", () => {
    render(<ScorePill label="Overall" value={0.8234} tone="strong" />);

    expect(screen.getByText("Overall")).toBeInTheDocument();
    expect(screen.getByText("0.82")).toBeInTheDocument();

    const pill = screen.getByTestId("score-pill");
    expect(pill).toHaveClass(
      "border-teal-200",
      "bg-teal-50",
      "text-teal-900",
      "min-w-[7rem]",
      "min-h-16"
    );
  });

  it("uses neutral styling by default", () => {
    render(<ScorePill label="Paper" value={0.5} />);

    expect(screen.getByText("Paper")).toBeInTheDocument();
    expect(screen.getByTestId("score-pill")).toHaveClass(
      "border-slate-200",
      "bg-white",
      "text-slate-900"
    );
  });

  it("uses warning styling when requested", () => {
    render(<ScorePill label="Dispatch" value={0.32} tone="warning" />);

    expect(screen.getByText("Dispatch")).toBeInTheDocument();
    expect(screen.getByTestId("score-pill")).toHaveClass(
      "border-amber-200",
      "bg-amber-50",
      "text-amber-900"
    );
  });
});
