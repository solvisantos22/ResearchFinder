import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LauncherPanel } from "@/components/LauncherPanel";

describe("LauncherPanel", () => {
  it("renders 'offline' status and a Register launcher button with no install command", () => {
    render(
      <LauncherPanel
        appUrl="https://research.example.com"
        initialStatus="offline"
        initialDesired={{ inbox: false, research: false }}
        registerLauncherAction={vi.fn()}
        setLaneDesiredAction={vi.fn()}
        restartLauncherAction={vi.fn()}
      />
    );

    expect(screen.getByText("offline")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Register launcher" })).toBeInTheDocument();
    expect(screen.queryByText(/install-launcher\.ps1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/install-launcher\.sh/)).not.toBeInTheDocument();
  });

  it("shows macOS and Windows install commands after registering", async () => {
    const registerLauncherAction = vi.fn().mockResolvedValue({ token: "plain-launcher-token" });

    render(
      <LauncherPanel
        appUrl="https://research.example.com"
        initialStatus="offline"
        initialDesired={{ inbox: false, research: false }}
        registerLauncherAction={registerLauncherAction}
        setLaneDesiredAction={vi.fn()}
        restartLauncherAction={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Register launcher" }));

    await screen.findByText(
      "bash scripts/install-launcher.sh --app-url 'https://research.example.com' --launcher-token 'plain-launcher-token'"
    );
    await screen.findByText(
      "powershell -ExecutionPolicy Bypass -File scripts/install-launcher.ps1 -AppUrl 'https://research.example.com' -LauncherToken 'plain-launcher-token'"
    );
  });

  it("renders Inbox and Research toggles and calls setLaneDesiredAction on change", async () => {
    const setLaneDesiredAction = vi.fn().mockResolvedValue({ inbox: true, research: false });

    render(
      <LauncherPanel
        appUrl="https://research.example.com"
        initialStatus="offline"
        initialDesired={{ inbox: false, research: false }}
        registerLauncherAction={vi.fn()}
        setLaneDesiredAction={setLaneDesiredAction}
        restartLauncherAction={vi.fn()}
      />
    );

    const inboxCheckbox = screen.getByRole("checkbox", { name: "Inbox" });
    const researchCheckbox = screen.getByRole("checkbox", { name: "Research" });

    expect(inboxCheckbox).toBeInTheDocument();
    expect(researchCheckbox).toBeInTheDocument();

    fireEvent.click(inboxCheckbox);

    await screen.findByRole("checkbox", { name: "Inbox" });
    expect(setLaneDesiredAction).toHaveBeenCalledWith("inbox", true);
  });

  it("calls restartLauncherAction and shows a notice when Restart workers is clicked", async () => {
    const restartLauncherAction = vi.fn().mockResolvedValue(undefined);

    render(
      <LauncherPanel
        appUrl="https://research.example.com"
        initialStatus="online"
        initialDesired={{ inbox: false, research: false }}
        registerLauncherAction={vi.fn()}
        setLaneDesiredAction={vi.fn()}
        restartLauncherAction={restartLauncherAction}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Restart workers" }));

    await screen.findByText("Restart requested — workers bounce within ~20s.");
    expect(restartLauncherAction).toHaveBeenCalledTimes(1);
  });

  it("polls overviewAction and flips the status dot to online", async () => {
    vi.useFakeTimers();
    try {
      const overviewAction = vi
        .fn()
        .mockResolvedValue({ status: "online", desired: { inbox: false, research: false } });

      render(
        <LauncherPanel
          appUrl="https://research.example.com"
          initialStatus="offline"
          initialDesired={{ inbox: false, research: false }}
          registerLauncherAction={vi.fn()}
          setLaneDesiredAction={vi.fn()}
          restartLauncherAction={vi.fn()}
          overviewAction={overviewAction}
        />
      );

      expect(screen.getByText("offline")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });

      expect(overviewAction).toHaveBeenCalled();
      expect(screen.getByText("online")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
