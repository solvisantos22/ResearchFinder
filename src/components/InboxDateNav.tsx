"use client";

import React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";

type InboxDateNavProps = {
  userId: string;
  currentDate: string;
  availableDates: string[];
};

function hrefForDate(userId: string, date: string): Route {
  return `/inbox/${userId}?date=${date}` as Route;
}

export function InboxDateNav({ userId, currentDate, availableDates }: InboxDateNavProps) {
  const router = useRouter();
  const index = availableDates.indexOf(currentDate);
  // availableDates is newest-first: "newer" is the previous index, "older" is the next index.
  const newerDate = index > 0 ? availableDates[index - 1] : null;
  const olderDate = index >= 0 && index < availableDates.length - 1 ? availableDates[index + 1] : null;

  const arrowBase =
    "rounded-md border border-rf-border px-3 py-2 text-sm font-medium text-rf-white transition-colors hover:bg-rf-surface aria-disabled:cursor-not-allowed aria-disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link
        aria-disabled={newerDate ? undefined : "true"}
        className={arrowBase}
        href={newerDate ? hrefForDate(userId, newerDate) : hrefForDate(userId, currentDate)}
        aria-label="Newer day"
      >
        ◀
      </Link>

      <label className="grid gap-1 text-xs font-semibold uppercase tracking-wide text-rf-muted">
        Inbox day
        <select
          aria-label="Inbox day"
          className="rounded-md border border-rf-border bg-rf-surface px-3 py-2 text-sm text-rf-white focus:border-rf-violetSoft focus:outline-none"
          value={currentDate}
          onChange={(event) => router.push(hrefForDate(userId, event.target.value))}
        >
          {availableDates.length === 0 ? <option value={currentDate}>{currentDate}</option> : null}
          {availableDates.map((date) => (
            <option key={date} value={date}>
              {date}
            </option>
          ))}
        </select>
      </label>

      <Link
        aria-disabled={olderDate ? undefined : "true"}
        className={arrowBase}
        href={olderDate ? hrefForDate(userId, olderDate) : hrefForDate(userId, currentDate)}
        aria-label="Older day"
      >
        ▶
      </Link>
    </div>
  );
}
