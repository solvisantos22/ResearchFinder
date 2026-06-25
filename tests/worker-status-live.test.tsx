import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WorkerStatusLive } from "@/components/WorkerStatusLive";

describe("WorkerStatusLive", () => {
  it("shows the offline restart callout when offline", () => {
    render(<WorkerStatusLive initialStatus="offline" />);
    expect(screen.getByText("Worker offline")).toBeInTheDocument();
    expect(screen.getByText("Worker not running")).toBeInTheDocument();
    expect(screen.getByText('schtasks /run /tn "ResearchFinder Worker"')).toBeInTheDocument();
  });

  it("hides the callout when online", () => {
    render(<WorkerStatusLive initialStatus="online" />);
    expect(screen.getByText("Worker online")).toBeInTheDocument();
    expect(screen.queryByText("Worker not running")).not.toBeInTheDocument();
  });
});
