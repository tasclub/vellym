import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { RuntimeError } from "./errors.js";
import { savePage } from "./page-store.js";
import { loadRepository } from "./repository.js";

export interface SlugMigrationPlan {
  pages: Array<{ pageId: string; title: string; slug: string }>;
  planHash: string;
}

function slugFromTitle(value: string): string {
  return value
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "page";
}

export async function planSlugMigration(
  contentRoot: string
): Promise<SlugMigrationPlan> {
  const repository = await loadRepository(contentRoot);
  const used = new Set(
    repository.pages
      .map((page) => page.view.page.metadata.slug)
      .filter((slug): slug is string => Boolean(slug))
      .map((slug) => slug.toLocaleLowerCase())
  );
  const pages = repository.pages
    .filter((page) => !page.view.page.metadata.slug)
    .map((page) => {
      const base = slugFromTitle(page.view.page.metadata.title);
      let slug = base;
      let suffix = 2;
      while (used.has(slug.toLocaleLowerCase())) {
        slug = `${base.slice(0, Math.max(1, 120 - String(suffix).length - 1))}-${suffix++}`;
      }
      used.add(slug.toLocaleLowerCase());
      return {
        pageId: page.view.page.metadata.name,
        title: page.view.page.metadata.title,
        slug
      };
    });
  return {
    pages,
    planHash: createHash("sha256")
      .update(JSON.stringify({
        pages,
        hashes: repository.pages.map((page) => [
          page.view.page.metadata.name,
          page.view.hash
        ])
      }))
      .digest("hex")
  };
}

export async function applySlugMigration(
  contentRoot: string,
  expected: SlugMigrationPlan
): Promise<{ migrated: number }> {
  const current = await planSlugMigration(contentRoot);
  if (current.planHash !== expected.planHash) {
    throw new RuntimeError(
      "確認後にPageが変更されました。もう一度確認してください",
      409,
      "SLUG_MIGRATION_CONFLICT"
    );
  }
  const repository = await loadRepository(contentRoot);
  const originals = new Map<string, string>();
  try {
    for (const item of current.pages) {
      const page = repository.byName.get(item.pageId);
      if (!page) throw new RuntimeError("Pageが見つかりません", 404, "NOT_FOUND");
      originals.set(page.sourcePath, await readFile(page.sourcePath, "utf8"));
      await savePage(contentRoot, page, {
        baseHash: page.view.hash,
        slug: item.slug
      });
    }
  } catch (error) {
    for (const [sourcePath, source] of originals) {
      await writeFile(sourcePath, source, "utf8");
    }
    throw error;
  }
  return { migrated: current.pages.length };
}
