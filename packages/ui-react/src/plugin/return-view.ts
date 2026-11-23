/** A detail opened from a list remembers that exact list view until the parent link is used. */
export interface DetailViewOrigin {
  /** The resource whose detail was opened. */
  detailName: string;
  /** The resource that hosts the list view it was opened from. */
  hostName: string;
  viewId: string;
}

export function returnViewForParent(
  origin: DetailViewOrigin | undefined,
  detailName: string | undefined,
  hostName: string
): { name: string; viewId: string } | undefined {
  return origin && origin.detailName === detailName && origin.hostName === hostName
    ? { name: hostName, viewId: origin.viewId }
    : undefined;
}
