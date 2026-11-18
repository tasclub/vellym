import { describe, expect, it } from "vitest";
import { returnViewForParent } from "../packages/ui-react/src/plugin/return-view.js";

describe("return to a plugin list view", () => {
  it("restores the list view when returning from a detail to the resource that hosts the list", () => {
    expect(returnViewForParent({
      detailName: "detail-1",
      hostName: "host",
      viewId: "board-view"
    }, "detail-1", "host")).toEqual({ name: "host", viewId: "board-view" });
  });

  it("does not reuse an origin for another detail, another host, or a direct visit", () => {
    const origin = { detailName: "detail-1", hostName: "host", viewId: "board-view" };
    expect(returnViewForParent(origin, "detail-2", "host")).toBeUndefined();
    expect(returnViewForParent(origin, "detail-1", "other-host")).toBeUndefined();
    expect(returnViewForParent(undefined, "detail-1", "host")).toBeUndefined();
  });
});
