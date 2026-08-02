import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { validatePage, type Page, type PageView } from "@vellym-internal/core";
import { RuntimeError } from "./errors.js";
import { contentHash, isInside } from "./path-utils.js";
import { loadRepository } from "./repository.js";
import type { LoadedPage, PagePatch } from "./types.js";

export function parsePagePatch(value: unknown): PagePatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RuntimeError("PATCH本文はobjectで指定してください", 400, "INVALID_PATCH");
  }
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.baseHash !== "string" || !/^[a-f0-9]{64}$/.test(candidate.baseHash)) {
    throw new RuntimeError("baseHashが不正です", 400, "INVALID_PATCH");
  }
  if (candidate.title !== undefined && (typeof candidate.title !== "string" || candidate.title.length === 0)) {
    throw new RuntimeError("titleは空でない文字列で指定してください", 400, "INVALID_PATCH");
  }
  if (
    candidate.slug !== undefined &&
    (typeof candidate.slug !== "string" ||
      candidate.slug.length > 120 ||
      !/^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u.test(candidate.slug))
  ) {
    throw new RuntimeError("URL名が不正です", 400, "INVALID_PATCH");
  }
  let richTextBlocks: PagePatch["richTextBlocks"];
  if (candidate.richTextBlocks !== undefined) {
    if (!Array.isArray(candidate.richTextBlocks)) {
      throw new RuntimeError("richTextBlocksは配列で指定してください", 400, "INVALID_PATCH");
    }
    richTextBlocks = candidate.richTextBlocks.map((item) => {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof (item as Record<string, unknown>).id !== "string" ||
        typeof (item as Record<string, unknown>).content !== "string"
      ) {
        throw new RuntimeError("richTextBlocksの要素が不正です", 400, "INVALID_PATCH");
      }
      return {
        id: (item as Record<string, unknown>).id as string,
        content: (item as Record<string, unknown>).content as string
      };
    });
    if (new Set(richTextBlocks.map((item) => item.id)).size !== richTextBlocks.length) {
      throw new RuntimeError("同じblock IDを複数回変更できません", 400, "INVALID_PATCH");
    }
  }
  return {
    baseHash: candidate.baseHash,
    ...(candidate.title === undefined ? {} : { title: candidate.title as string }),
    ...(candidate.slug === undefined ? {} : { slug: (candidate.slug as string).normalize("NFC") }),
    ...(richTextBlocks === undefined ? {} : { richTextBlocks })
  };
}

export async function savePage(
  contentRoot: string,
  loaded: LoadedPage,
  patch: PagePatch
): Promise<PageView> {
  if (loaded.view.readOnly) {
    throw new RuntimeError(
      loaded.view.readOnlyReasons.join("、") || "読み取り専用です",
      422,
      "READ_ONLY"
    );
  }
  const rootReal = await realpath(contentRoot);
  const sourceReal = await realpath(loaded.sourcePath);
  if (!isInside(rootReal, sourceReal)) {
    throw new RuntimeError("contentRoot外への保存は許可されていません", 422, "PATH_BOUNDARY");
  }
  const info = await lstat(sourceReal);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new RuntimeError("通常ファイル以外は保存できません", 422, "UNSAFE_FILE");
  }
  const source = await readFile(sourceReal, "utf8");
  if (contentHash(source) !== patch.baseHash) {
    throw new RuntimeError(
      "外部変更を検出しました。YAMLから再読み込みしてください",
      409,
      "HASH_CONFLICT"
    );
  }
  const document = parseDocument(source, { keepSourceTokens: true });
  if (document.errors.length) {
    throw new RuntimeError(document.errors[0]!.message, 422, "YAML_PARSE");
  }
  const value = document.toJS({ maxAliasCount: 100 }) as Page;
  if (patch.title !== undefined) document.setIn(["metadata", "title"], patch.title);
  if (patch.slug !== undefined) {
    const snapshot = await loadRepository(contentRoot);
    const duplicate = snapshot.bySlug.get(
      patch.slug.normalize("NFC").toLocaleLowerCase()
    );
    if (
      duplicate &&
      duplicate.view.page.metadata.name !== loaded.view.page.metadata.name
    ) {
      throw new RuntimeError("同じURL名のPageがあります", 409, "DUPLICATE_PAGE_SLUG");
    }
    document.setIn(["metadata", "slug"], patch.slug);
  }
  for (const change of patch.richTextBlocks ?? []) {
    const indexes = value.spec.blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.type === "rich-text" && block.id === change.id);
    if (indexes.length !== 1) {
      throw new RuntimeError(
        `rich-text block ${change.id} を一意に特定できません`,
        400,
        "BLOCK_NOT_FOUND"
      );
    }
    const target = indexes[0]!;
    if (target.block.format !== "commonmark") {
      throw new RuntimeError("編集可能なrich-textではありません", 400, "INVALID_BLOCK");
    }
    document.setIn(["spec", "blocks", target.index, "content"], change.content);
  }
  const output = document.toString({ lineWidth: 0 });
  const checkedDocument = parseDocument(output);
  const checked = validatePage(checkedDocument.toJS(), loaded.view.relativePath);
  if (!checked.page || checkedDocument.errors.length) {
    throw new RuntimeError("保存後のPage検証に失敗しました", 422, "SAVE_VALIDATION");
  }
  const temporary = path.join(
    path.dirname(sourceReal),
    `.${path.basename(sourceReal)}.vellym-${process.pid}-${randomBytes(6).toString("hex")}.tmp`
  );
  try {
    await writeFile(temporary, output, { encoding: "utf8", mode: info.mode });
    await chmod(temporary, info.mode);
    const rereadDocument = parseDocument(await readFile(temporary, "utf8"));
    if (
      rereadDocument.errors.length ||
      !validatePage(rereadDocument.toJS(), loaded.view.relativePath).page
    ) {
      throw new RuntimeError("一時ファイルの再検証に失敗しました", 422, "TEMP_VALIDATION");
    }
    await rename(temporary, sourceReal);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  const refreshed = await loadRepository(contentRoot);
  const page = refreshed.byName.get(loaded.view.page.metadata.name);
  if (!page) throw new RuntimeError("保存後のPageを再読込できません", 500, "RELOAD_FAILED");
  return page.view;
}
