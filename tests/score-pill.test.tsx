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

    const pill = screen.getByText("Overall").parentElement;
    expect(pill).toHaveClass("border-teal-200", "bg-teal-50", "min-w-[7rem]");
  });
});
