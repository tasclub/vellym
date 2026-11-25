import type { DesignCanvasSpec } from "../model/types.js";

export function Notes({ notes }: { notes: NonNullable<DesignCanvasSpec["notes"]> }) {
  return <>{notes.map((note, index) => <div key={index} data-testid="design-note" data-note-kind={note.kind ?? "sticky"}
    style={{ position: "absolute", left: note.x, top: note.y, whiteSpace: "pre-wrap", overflowWrap: "anywhere",
      maxWidth: 280, padding: note.kind === "title" ? 0 : 12,
      background: note.kind === "title" ? "transparent" : "#fef3c7", color: "#1f2937",
      fontSize: note.kind === "title" ? 24 : 14, fontWeight: note.kind === "title" ? 700 : 400 }}>
    {note.text}
  </div>)}</>;
}
