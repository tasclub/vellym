import { describe, expect, it } from "vitest";
import { returnViewForParent } from "../packages/ui-react/src/plugin/return-view.js";

describe("return to a plugin list view", () => {
  it("restores the Kanban view when returning from its card to its tracker", () => {
    expect(returnViewForParent({
      ticketName: "ticket-1",
      trackerName: "tracker",
      viewId: "ticket-kanban"
    }, "ticket-1", "tracker")).toEqual({ name: "tracker", viewId: "ticket-kanban" });
  });

  it("does not reuse an origin for another ticket, tracker, or a direct visit", () => {
    const origin = { ticketName: "ticket-1", trackerName: "tracker", viewId: "ticket-kanban" };
    expect(returnViewForParent(origin, "ticket-2", "tracker")).toBeUndefined();
    expect(returnViewForParent(origin, "ticket-1", "other-tracker")).toBeUndefined();
    expect(returnViewForParent(undefined, "ticket-1", "tracker")).toBeUndefined();
  });
});
