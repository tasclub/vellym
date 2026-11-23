import { describe, expect, it } from "vitest";
import { reviewSummary } from "../packages/ui-react/src/setup/setup-wizard.js";

describe("setup review summary", () => {
  it("counts files to create, keep, or treat as conflicts", () => {
    expect(
      reviewSummary([
        { status: "create" },
        { status: "create" },
        { status: "skip" },
        { status: "reuse" },
        { status: "reuse" },
        { status: "conflict" }
      ])
    ).toEqual({ create: 2, keep: 3, conflict: 1 });
  });

  it("returns zero counts for an empty plan", () => {
    expect(reviewSummary([])).toEqual({ create: 0, keep: 0, conflict: 0 });
  });
});
