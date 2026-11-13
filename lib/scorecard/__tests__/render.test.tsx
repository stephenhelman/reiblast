import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Scorecard from "@/components/scorecard/Scorecard";
import { buildScorecard, type StatsRow } from "../data";

const Z = { entered: 0, replied: 0, errored: 0, noResponse: 0, replied1: 0, replied2: 0, replied3: 0, replied4: 0, replied5: 0, replied6: 0, replied7: 0, errored1: 0, errored2: 0, errored3: 0, errored4: 0, errored5: 0, errored6: 0, errored7: 0, catInterested: 0, catNotNow: 0, catWrongNumber: 0, catOptOut: 0, catNeedsReply: 0, catOther: 0 };
const row = (o: Partial<StatsRow>): StatsRow => ({ listType: "Probate", listName: "Oct", variant: "probate-1", ...Z, ...o });
const html = (rows: StatsRow[]) => renderToStaticMarkup(<Scorecard data={buildScorecard(rows, [], new Date("2026-11-15T18:00:00Z"))} />);

describe("Scorecard render", () => {
  it("empty state when there are no stats rows", () => {
    const h = html([]);
    expect(h).toContain("No campaign data yet");
    expect(h).not.toContain("Cost per lead");
  });
  it("with data: lists, steps, no-snapshot message and the cost-per-lead placeholder; no categories section", () => {
    const h = html([row({ entered: 100, replied: 10 })]);
    expect(h).toContain("Oct");
    expect(h).toContain("SMS 7");
    expect(h).toContain("Month-over-month comparison starts");
    expect(h).toContain("Cost per lead");
    expect(h).toContain("Coming soon");
    expect(h).not.toContain("Reply categories");
    expect(h).not.toContain("Unlabeled</h2>");
  });
  it("shows the categories section only when a cat* is > 0, and the unlabeled nudge", () => {
    const h = html([row({ catInterested: 2 }), row({ listType: "", variant: "", entered: 5 })]);
    expect(h).toContain("Reply categories");
    expect(h).toContain("Pick a List Type");
  });
  it("leader badge only with enough data", () => {
    const two = (n: number) => [row({ entered: n, replied: 5 }), row({ listName: "b", variant: "probate-2", entered: n, replied: 20 })];
    expect(html(two(60))).toContain("Leader");
    expect(html(two(10))).not.toContain("Leader");
    expect(html(two(10))).toContain("Not enough data");
  });
});
