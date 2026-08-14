// 規模計測用のfixtureを生成する。
//
// 実データに近づけるため、次を意図的にばらつかせる。
//   - 文書とチケットの比率（実プロジェクトの資料量の逆算に合わせる）
//   - 本文長（対数正規に近い分布。短いチケットと長い設計文書が混在する）
//   - blockの数、見出し・箇条書き・表・コードblockの出現
//   - 階層の深さ、フォルダあたりの件数
//   - labelsの種類と付与数
//   - 一部ページの多言語translations
//
// 全ページを同一内容にすると、文字列の共有などで実態より良い数値が出るため、
// 本文は必ずページごとに異なる語を含める。seedを固定すれば再現する。
//
//   node scripts/bench-fixture.mjs --out <dir> --pages 30000 [--seed 1]

import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const outDir = path.resolve(option(args, "--out") ?? "bench-fixture");
const totalPages = Number(option(args, "--pages") ?? "30000");
const seed = Number(option(args, "--seed") ?? "1");

if (!Number.isInteger(totalPages) || totalPages < 1) {
  throw new Error(`--pages must be a positive integer: ${totalPages}`);
}

// mulberry32。seedが同じなら同じfixtureを生成する。
function makeRng(value) {
  let state = value >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(seed);

const pick = (list) => list[Math.floor(rng() * list.length)];
const between = (min, max) => min + Math.floor(rng() * (max - min + 1));

// 対数正規に近い分布。medianを中心に、右へ長い裾を持つ。
function lognormalBytes(median, sigma, cap) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const normal = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.min(cap, Math.max(120, Math.round(median * Math.exp(sigma * normal))));
}

const NOUNS = [
  "認証基盤", "権限設計", "検索索引", "配信経路", "移行手順", "監査ログ", "通知基盤",
  "画面遷移", "入力検証", "保存処理", "競合解決", "履歴管理", "多言語対応", "静的生成",
  "依存関係", "外部連携", "計測基盤", "障害対応", "復旧手順", "性能要件", "受入条件",
  "運用体制", "教育計画", "移行判定", "リリース判定", "契約範囲", "見積根拠", "工数配分",
  "リスク評価", "代替案", "制約条件", "前提条件", "利害関係者", "承認経路", "変更管理"
];

const VERBS = [
  "整理する", "定義する", "見直す", "確定する", "検証する", "移管する", "分割する",
  "統合する", "計測する", "削減する", "自動化する", "文書化する", "合意する", "棚上げする"
];

const ADJECTIVES = [
  "現行の", "暫定の", "恒久的な", "最小の", "段階的な", "限定的な", "全社的な",
  "部分的な", "再利用可能な", "後戻りできる", "検証済みの", "未確定の"
];

const CONNECTORS = [
  "このため", "一方", "したがって", "ただし", "なお", "その結果", "これに対し",
  "前提として", "補足すると", "結論として"
];

const COMPONENTS = [
  "ui", "api", "core", "storage", "search", "auth", "build", "cli", "docs", "i18n",
  "editor", "navigation", "validation", "migration", "security", "telemetry",
  "packaging", "runtime", "schema", "plugin"
];

const AREAS = ["frontend", "backend", "infra", "qa", "design", "pm", "ops", "research"];
const PRIORITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["backlog", "in-progress", "review", "blocked", "done"];

const DOC_TYPES = [
  "project-charter", "requirement", "architecture-decision", "design",
  "screen-specification", "meeting-notes", "risk-register", "roadmap",
  "report", "consideration", "research"
];

function sentence() {
  const shape = rng();
  if (shape < 0.25) {
    return `${pick(CONNECTORS)}、${pick(ADJECTIVES)}${pick(NOUNS)}を${pick(VERBS)}。`;
  }
  if (shape < 0.55) {
    return `${pick(ADJECTIVES)}${pick(NOUNS)}と${pick(NOUNS)}の関係を${pick(VERBS)}。`;
  }
  if (shape < 0.8) {
    return `${pick(NOUNS)}は${pick(ADJECTIVES)}${pick(NOUNS)}に依存するため、先に${pick(VERBS)}。`;
  }
  return `${pick(NOUNS)}について、${between(2, 9)}件の${pick(NOUNS)}を${pick(VERBS)}。`;
}

function paragraph() {
  const count = between(2, 5);
  let text = "";
  for (let index = 0; index < count; index += 1) text += sentence();
  return text;
}

function bulletList() {
  const count = between(2, 6);
  const lines = [];
  for (let index = 0; index < count; index += 1) {
    lines.push(`- ${pick(ADJECTIVES)}${pick(NOUNS)}を${pick(VERBS)}`);
  }
  return lines.join("\n");
}

function table() {
  const rows = between(2, 5);
  const lines = ["| 項目 | 内容 | 判定 |", "| --- | --- | --- |"];
  for (let index = 0; index < rows; index += 1) {
    lines.push(`| ${pick(NOUNS)} | ${pick(ADJECTIVES)}${pick(NOUNS)} | ${pick(["整合", "要再検証", "衝突"])} |`);
  }
  return lines.join("\n");
}

function codeBlock() {
  return [
    "```yaml",
    `${pick(COMPONENTS)}:`,
    `  enabled: ${rng() < 0.5}`,
    `  retries: ${between(0, 5)}`,
    "```"
  ].join("\n");
}

// ページ固有の語を必ず混ぜ、全ページが同一文字列にならないようにする。
function body(targetBytes, uniqueToken) {
  const parts = [`## ${pick(NOUNS)}の${pick(["方針", "整理", "記録", "判断", "調査"])}`];
  parts.push(`識別子 ${uniqueToken} の記録である。${paragraph()}`);
  let size = Buffer.byteLength(parts.join("\n\n"), "utf8");
  while (size < targetBytes) {
    const shape = rng();
    let next;
    if (shape < 0.5) next = paragraph();
    else if (shape < 0.7) next = bulletList();
    else if (shape < 0.82) next = `### ${pick(NOUNS)}\n\n${paragraph()}`;
    else if (shape < 0.92) next = table();
    else next = codeBlock();
    parts.push(next);
    size += Buffer.byteLength(next, "utf8") + 2;
  }
  return parts.join("\n\n");
}

function quote(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function indent(text, spaces) {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.length ? pad + line : ""))
    .join("\n");
}

function labelsFor(kind) {
  const entries = [];
  entries.push(["component", pick(COMPONENTS)]);
  if (kind === "ticket") {
    entries.push(["priority", pick(PRIORITIES)]);
    entries.push(["status", pick(STATUSES)]);
    if (rng() < 0.6) entries.push(["area", pick(AREAS)]);
  } else if (rng() < 0.5) {
    entries.push(["area", pick(AREAS)]);
  }
  return entries;
}

function renderPage({ name, title, documentType, blocks, labels, translation }) {
  const lines = [
    "apiVersion: vellym.tasclub.com/v1alpha1",
    "kind: Page",
    "metadata:",
    `  name: ${name}`,
    `  title: ${quote(title)}`
  ];
  if (labels.length) {
    lines.push("  labels:");
    for (const [key, value] of labels) lines.push(`    ${key}: ${value}`);
  }
  lines.push("spec:");
  lines.push(`  documentType: ${documentType}`);
  lines.push("  locale: ja");
  lines.push("  blocks:");
  blocks.forEach((content, index) => {
    lines.push(`    - id: block-${index + 1}`);
    lines.push("      type: rich-text");
    lines.push("      format: commonmark");
    lines.push("      content: |");
    lines.push(indent(content, 8));
  });
  if (translation) {
    lines.push("  translations:");
    lines.push("    en:");
    lines.push(`      visibility: ${translation.visibility}`);
    lines.push(`      title: ${quote(translation.title)}`);
    lines.push("      blocks:");
    translation.blocks.forEach((content, index) => {
      lines.push(`        - id: block-${index + 1}`);
      lines.push("          type: rich-text");
      lines.push("          format: commonmark");
      lines.push("          content: |");
      lines.push(indent(content, 12));
    });
  }
  return `${lines.join("\n")}\n`;
}

function renderFolder(title, description, order) {
  const lines = [
    "apiVersion: vellym.tasclub.com/v1alpha1",
    "kind: Folder",
    "metadata:",
    `  title: ${quote(title)}`,
    "spec:",
    `  description: ${quote(description)}`
  ];
  if (order && order.length) {
    lines.push("  order:");
    for (const entry of order) lines.push(`    - ${quote(entry)}`);
  }
  return `${lines.join("\n")}\n`;
}

// 文書フォルダ。実プロジェクトの構成に寄せ、深さを2〜3段に散らす。
const DOC_FOLDERS = [
  { dir: "00-構想", title: "構想", weight: 2 },
  { dir: "10-要件", title: "要件", weight: 14 },
  { dir: "20-設計", title: "設計", weight: 10 },
  { dir: "20-設計/decisions", title: "決定記録", weight: 16 },
  { dir: "20-設計/screens", title: "画面仕様", weight: 8 },
  { dir: "30-実装", title: "実装", weight: 8 },
  { dir: "40-品質", title: "品質", weight: 8 },
  { dir: "50-運営", title: "運営", weight: 10 },
  { dir: "50-運営/会議録", title: "会議録", weight: 12 },
  { dir: "60-検討", title: "検討", weight: 8 },
  { dir: "70-調査履歴", title: "調査履歴", weight: 4 }
];

// 文書とチケットの比率は、想定資料量（文書1,000〜2,000／チケット10,000〜20,000）に合わせる。
const DOC_RATIO = 0.08;
const documentCount = Math.max(1, Math.round(totalPages * DOC_RATIO));
const ticketCount = totalPages - documentCount;

// チケットは月次フォルダへ分散する。1フォルダへ数万件を積まない。
const TICKET_MONTHS = 36;

await rm(outDir, { recursive: true, force: true });
const contentRoot = path.join(outDir, "content");
await mkdir(contentRoot, { recursive: true });

await writeFile(
  path.join(outDir, "vellym.config.yaml"),
  'schemaVersion: "1.0"\ncontentRoot: content\noutputDir: dist/site\nui:\n  language: ja\nplugins: []\n',
  "utf8"
);

const filesByFolder = new Map();
const pending = [];
let bytesWritten = 0;

function queue(filePath, contents) {
  bytesWritten += Buffer.byteLength(contents, "utf8");
  pending.push([filePath, contents]);
}

const docWeightTotal = DOC_FOLDERS.reduce((sum, folder) => sum + folder.weight, 0);
let documentIndex = 0;

DOC_FOLDERS.forEach((folder, folderIndex) => {
  // 端数で総数がずれないよう、最後のフォルダで差分を吸収する。
  const share =
    folderIndex === DOC_FOLDERS.length - 1
      ? documentCount - documentIndex
      : Math.round((documentCount * folder.weight) / docWeightTotal);
  const names = [];
  for (let index = 0; index < share; index += 1) {
    documentIndex += 1;
    const id = String(documentIndex).padStart(6, "0");
    const name = `doc-${id}`;
    const documentType = pick(DOC_TYPES);
    const noun = pick(NOUNS);
    const title = `${noun}の${pick(["方針", "整理", "記録", "検討", "定義"])} ${id}`;
    const fileName = `${noun}-${id}.yaml`;
    const blockCount = between(1, 6);
    const blocks = [];
    for (let block = 0; block < blockCount; block += 1) {
      // 実docs/contentの分布（中央値約4.7KB、平均約7.2KB、p90約16.8KB、最大約36KB）に合わせる。
      blocks.push(body(lognormalBytes(4500, 0.95, 60000) / blockCount, `${name}-b${block + 1}`));
    }
    // 一部の文書だけ翻訳を持たせる。全件に持たせると実態から離れる。
    const translation =
      rng() < 0.03
        ? {
            visibility: rng() < 0.7 ? "published" : "draft",
            title: `Document ${id}`,
            blocks: [body(lognormalBytes(900, 0.7, 12000), `${name}-en`)]
          }
        : undefined;
    names.push(fileName);
    queue(
      path.join(contentRoot, folder.dir, fileName),
      renderPage({ name, title, documentType, blocks, labels: labelsFor("document"), translation })
    );
  }
  filesByFolder.set(folder.dir, { title: folder.title, names, ordered: true });
});

// 中間ディレクトリにも_index.yamlが要る。
for (const folder of DOC_FOLDERS) {
  const parent = path.dirname(folder.dir);
  if (parent !== "." && !filesByFolder.has(parent)) {
    filesByFolder.set(parent, { title: path.basename(parent), names: [], ordered: false });
  }
}

let ticketIndex = 0;
for (let month = 0; month < TICKET_MONTHS; month += 1) {
  const year = 2024 + Math.floor(month / 12);
  const monthLabel = String((month % 12) + 1).padStart(2, "0");
  const dir = `80-課題/${year}-${monthLabel}`;
  // 端数で総数がずれないよう、累積の差分で各月の件数を決める。
  const share =
    Math.round((ticketCount * (month + 1)) / TICKET_MONTHS) -
    Math.round((ticketCount * month) / TICKET_MONTHS);
  for (let index = 0; index < share; index += 1) {
    ticketIndex += 1;
    const id = String(ticketIndex).padStart(6, "0");
    const name = `ticket-${id}`;
    const title = `${pick(ADJECTIVES)}${pick(NOUNS)}を${pick(VERBS)} ${id}`;
    const blockCount = rng() < 0.75 ? 1 : 2;
    const blocks = [];
    for (let block = 0; block < blockCount; block += 1) {
      // チケットは説明本文のみで、文書より一桁短い。
      blocks.push(body(lognormalBytes(900, 1.0, 20000) / blockCount, `${name}-b${block + 1}`));
    }
    queue(
      path.join(contentRoot, dir, `課題-${id}.yaml`),
      renderPage({ name, title, documentType: "ticket", blocks, labels: labelsFor("ticket") })
    );
  }
  // チケットフォルダにspec.orderは付けない。実運用で数百件を手で並べることはないため、
  // ここへorderを置くと現実には起きない負荷を測ることになる。
  filesByFolder.set(dir, { title: `${year}年${monthLabel}月の課題`, names: [], ordered: false });
}
filesByFolder.set("80-課題", { title: "課題", names: [], ordered: false });

for (const [dir, folder] of filesByFolder) {
  queue(
    path.join(contentRoot, dir, "_index.yaml"),
    renderFolder(
      folder.title,
      `${folder.title}の文書を格納する。`,
      folder.ordered ? folder.names : undefined
    )
  );
}
queue(
  path.join(contentRoot, "_index.yaml"),
  renderFolder("プロジェクト文書", "規模計測用のfixture。", undefined)
);

// ディレクトリを先に作り、書き込みは同時実行数を抑える（EMFILE回避）。
const directories = new Set(pending.map(([filePath]) => path.dirname(filePath)));
for (const dir of directories) await mkdir(dir, { recursive: true });

const BATCH = 256;
for (let index = 0; index < pending.length; index += BATCH) {
  await Promise.all(
    pending
      .slice(index, index + BATCH)
      .map(([filePath, contents]) => writeFile(filePath, contents, "utf8"))
  );
}

process.stdout.write(
  `${JSON.stringify(
    {
      outDir,
      seed,
      files: pending.length,
      pages: documentIndex + ticketIndex,
      documents: documentIndex,
      tickets: ticketIndex,
      folders: filesByFolder.size + 1,
      bytes: bytesWritten,
      averagePageBytes: Math.round(bytesWritten / (documentIndex + ticketIndex))
    },
    null,
    2
  )}\n`
);
