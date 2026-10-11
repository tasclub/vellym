/** A detail opened from a list remembers that exact list view until the parent link is used. */
export interface DetailViewOrigin {
  ticketName: string;
  trackerName: string;
  viewId: string;
}

export function returnViewForParent(
  origin: DetailViewOrigin | undefined,
  ticketName: string | undefined,
  trackerName: string
): { name: string; viewId: string } | undefined {
  return origin && origin.ticketName === ticketName && origin.trackerName === trackerName
    ? { name: trackerName, viewId: origin.viewId }
    : undefined;
}
