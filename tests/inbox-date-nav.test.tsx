import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push })
}));

import { InboxDateNav } from "@/components/InboxDateNav";

describe("InboxDateNav", () => {
  it("lists available days and disables next on the newest day", () => {
    render(
      <InboxDateNav
        userId="u1"
        currentDate="2026-06-25"
        availableDates={["2026-06-25", "2026-06-24", "2026-06-23"]}
      />
    );

    expect(screen.getByLabelText("Inbox day")).toHaveValue("2026-06-25");
    expect(screen.getByRole("link", { name: "Newer day" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "Older day" })).toHaveAttribute(
      "href",
      "/inbox/u1?date=2026-06-24"
    );
  });

  it("disables older on the oldest day", () => {
    render(
      <InboxDateNav
        userId="u1"
        currentDate="2026-06-23"
        availableDates={["2026-06-25", "2026-06-24", "2026-06-23"]}
      />
    );

    expect(screen.getByRole("link", { name: "Older day" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("link", { name: "Newer day" })).toHaveAttribute(
      "href",
      "/inbox/u1?date=2026-06-24"
    );
  });
});
