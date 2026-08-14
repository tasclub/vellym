import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isUnknownKind,
  knownRichTextBlocks,
  validatePage,
  validateResource,
  type Page
} from "../packages/core/src/index.js";
import { extractPageEntry } from "../packages/runtime-node/src/repository-entry.js";
import {
  loadRepository,
  localizedPageSummaries,
  unknownKindGroups
} from "../packages/runtime-node/src/repository.js";
import { searchRepositoryEntries } from "../packages/runtime-node/src/repository-entry.js";

const TICKET = `apiVersion: vellym.tasclub.com/v1alpha1
kind: Ticket
metadata:
  name: ticket-01jxyz
  title: 言語切り替えを追加する
spec:
  status: in-progress
  fields:
    priority: high
    dueDate: 2026-09-30
  blocks:
    - id: description
      type: rich-text
      content: |
        ## 内容

        ページ上部から表示言語を切り替えられるようにする。[[welcome]]も参照。
`;

function extract(source: string, relativePath = "page.yaml") {
  return extractPageEntry({
    sourcePath: `/project/${relativePath}`,
    relativePath,
    source,
    mtimeMs: 0,
    size: Buffer.byteLength(source)
  });
}

describe("kind dispatch", () => {
  it("treats kinds without a Core schema as unknown", () => {
    expect(isUnknownKind({ kind: "Ticket" })).toBe(true);
    expect(isUnknownKind({ kind: "Page" })).toBe(false);
    expect(isUnknownKind({ kind: "Folder" })).toBe(false);
    expect(isUnknownKind({})).toBe(false);
  });

  it("reads an unknown kind as a warning, never as an error", () => {
    const result = extract(TICKET, "ticket.yaml");
    expect(result.kind).toBe("entry");
    if (result.kind !== "entry") return;
    expect(result.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_RESOURCE_KIND", severity: "warning" })
    );
    expect(result.entry.kind).toBe("Ticket");
    expect(result.entry.title).toBe("言語切り替えを追加する");
  });

  it("keeps the body searchable and linkable for an unknown kind", () => {
    const result = extract(TICKET, "ticket.yaml");
    if (result.kind !== "entry") throw new Error("fixture failed");
    expect(result.entry.base.normalizedText).toContain("ページ上部から表示言語");
    expect(result.entry.outgoingReferences?.map(({ target }) => target)).toEqual(["welcome"]);
  });

  it("does not interpret kind-specific spec but preserves it", () => {
    const validated = validateResource(
      {
        apiVersion: "vellym.tasclub.com/v1alpha1",
        kind: "Ticket",
        metadata: { name: "t", title: "T" },
        spec: { status: "open", fields: { priority: "high" } }
      },
      "t.yaml"
    );
    expect(validated.diagnostics).toEqual([]);
    expect(validated.resource?.spec.status).toBe("open");
  });

  it("rejects an unknown kind that breaks the common contract", () => {
    const broken = extract(
      `apiVersion: vellym.tasclub.com/v1alpha1
kind: Ticket
metadata: { title: タイトルだけ }
spec: {}
`,
      "broken.yaml"
    );
    expect(broken.kind).toBe("invalid");
    expect(broken.diagnostics[0]?.code).toBe("RESOURCE_SCHEMA");
  });
});

describe("unknown kinds in the repository", () => {
  async function repository() {
    const root = await mkdtemp(path.join(tmpdir(), "vellym-kind-"));
    await writeFile(
      path.join(root, "welcome.yaml"),
      `apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata: { name: welcome, title: ようこそ }
spec:
  blocks:
    - { id: body, type: rich-text, content: "本文" }
`
    );
    await writeFile(path.join(root, "ticket.yaml"), TICKET);
    return loadRepository(root);
  }

  it("loads without any error diagnostic", async () => {
    const snapshot = await repository();
    expect(snapshot.diagnostics.filter(({ severity }) => severity === "error")).toEqual([]);
  });

  it("keeps unknown kinds out of the document tree", async () => {
    const snapshot = await repository();
    expect(localizedPageSummaries(snapshot, "ja", "ja").map(({ name }) => name))
      .toEqual(["welcome"]);
  });

  it("aggregates unknown kinds so the user can see what is unhandled", async () => {
    const snapshot = await repository();
    expect(unknownKindGroups(snapshot)).toEqual([
      {
        kind: "Ticket",
        count: 1,
        resources: [
          {
            name: "ticket-01jxyz",
            title: "言語切り替えを追加する",
            relativePath: "ticket.yaml"
          }
        ]
      }
    ]);
  });

  it("still finds an unknown kind through full-text search", async () => {
    const snapshot = await repository();
    const found = searchRepositoryEntries(snapshot.entryIndex, "表示言語");
    expect(found.results.map(({ pageId }) => pageId)).toContain("ticket-01jxyz");
  });

  it("resolves internal links pointing out of an unknown kind", async () => {
    const snapshot = await repository();
    expect(
      snapshot.entryIndex.backlinksByTarget.get("welcome")?.map(({ sourcePageId }) => sourcePageId)
    ).toEqual(["ticket-01jxyz"]);
  });
});

describe("retired fields", () => {
  it("accepts a rich-text block without format", () => {
    const page = {
      apiVersion: "vellym.tasclub.com/v1alpha1",
      kind: "Page",
      metadata: { name: "p", title: "P" },
      spec: { blocks: [{ id: "body", type: "rich-text", content: "本文" }] }
    };
    expect(validatePage(page, "p.yaml").diagnostics).toEqual([]);
    expect(knownRichTextBlocks(page as Page, "p.yaml").blocks).toHaveLength(1);
  });

  it("keeps a legacy format value as an ignored extra property", () => {
    const page = {
      apiVersion: "vellym.tasclub.com/v1alpha1",
      kind: "Page",
      metadata: { name: "p", title: "P" },
      spec: {
        documentType: "guide",
        blocks: [{ id: "body", type: "rich-text", format: "commonmark", content: "本文" }]
      }
    };
    expect(validatePage(page, "p.yaml").diagnostics).toEqual([]);
    expect(knownRichTextBlocks(page as Page, "p.yaml").blocks).toHaveLength(1);
  });

  it("accepts a resource without blocks", () => {
    const view = {
      apiVersion: "vellym.tasclub.com/v1alpha1",
      kind: "Page",
      metadata: { name: "empty", title: "空" },
      spec: {}
    };
    expect(validatePage(view, "empty.yaml").diagnostics).toEqual([]);
    expect(knownRichTextBlocks(view as Page, "empty.yaml").blocks).toEqual([]);
  });

  it("no longer carries documentType on the repository entry", () => {
    const result = extract(`apiVersion: vellym.tasclub.com/v1alpha1
kind: Page
metadata: { name: p, title: P }
spec:
  documentType: guide
  blocks:
    - { id: body, type: rich-text, content: "本文" }
`);
    if (result.kind !== "entry") throw new Error("fixture failed");
    expect(result.entry).not.toHaveProperty("documentType");
    expect(result.entry.kind).toBe("Page");
  });
});
