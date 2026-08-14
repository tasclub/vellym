// 「抽出済みテキストを保持し、走査で検索する」場合の実測。
//
// 現行はクエリのたびに、メモリ上のMarkdownからASTを組み直し、正規化をかけ直している。
// 抽出時に一度だけ正規化済みプレーンテキストを作って保持した場合に、
//   - 検索が実用域（数百ms以内）に収まるか
//   - 保持するエントリが実際どれだけのメモリを占めるか
// を測る。この2点が、索引を持つべきかどうかとエントリの形を決める。
//
//   node --expose-gc scripts/bench-scan.mjs --content <fixture>/content

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseAllDocuments } from "yaml";

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const args = process.argv.slice(2);
const contentRoot = path.resolve(option(args, "--content") ?? "bench-fixture/content");

async function collect(dir, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "_archive") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(full, out);
    else if (/\.ya?ml$/.test(entry.name) && entry.name !== "_index.yaml") out.push(full);
  }
  return out;
}

const normalize = (value) => value.normalize("NFKC").toLocaleLowerCase();

// Markdownの構文記号を落として本文テキストだけにする。
// 抽出時に一度だけ行う想定なので、ここでの正確さより「保持する量」を見るのが目的。
function plainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^\s*\|.*\|\s*$/gm, (row) => row.replace(/[|\-:]/g, " "))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>~]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

const files = await collect(contentRoot, []);

const gc = () => {
  if (global.gc) {
    global.gc();
    global.gc();
  }
};

gc();
const baseline = process.memoryUsage();

const extractStarted = performance.now();
const records = [];
let rawBytes = 0;
let textChars = 0;

for (const file of files) {
  const source = await readFile(file, "utf8");
  rawBytes += Buffer.byteLength(source, "utf8");
  const documents = parseAllDocuments(source);
  const value = documents[0]?.toJS({ maxAliasCount: 100 });
  if (!value || value.kind !== "Page") continue;
  const blocks = Array.isArray(value.spec?.blocks) ? value.spec.blocks : [];
  const text = normalize(
    blocks
      .filter((block) => block?.type === "rich-text" && typeof block.content === "string")
      .map((block) => plainText(block.content))
      .join("\n")
  );
  textChars += text.length;
  records.push({
    name: value.metadata?.name,
    title: value.metadata?.title ?? "",
    normalizedTitle: normalize(value.metadata?.title ?? ""),
    relativePath: path.relative(contentRoot, file),
    documentType: value.spec?.documentType,
    locale: value.spec?.locale,
    labels: value.metadata?.labels,
    text
  });
}
const extractMs = Math.round(performance.now() - extractStarted);

gc();
const afterExtract = process.memoryUsage();

const queries = [
  "認証基盤",
  "移行手順",
  "識別子 ticket-000010-b1",
  "存在しない語彙xyzzy",
  "段階的な代替案"
];

const scan = [];
for (const query of queries) {
  const needle = normalize(query);
  // 温めてから測る。
  for (let warm = 0; warm < 2; warm += 1) {
    for (const record of records) record.text.includes(needle);
  }
  const started = performance.now();
  let hits = 0;
  for (const record of records) {
    if (record.normalizedTitle.includes(needle) || record.text.includes(needle)) hits += 1;
  }
  scan.push({ query, ms: Math.round((performance.now() - started) * 100) / 100, hits });
}

const mb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

process.stdout.write(
  `${JSON.stringify(
    {
      files: files.length,
      records: records.length,
      source: {
        rawMegabytes: mb(rawBytes),
        plainTextChars: textChars,
        plainTextMegabytesUtf16: mb(textChars * 2)
      },
      extraction: { ms: extractMs, msPerPage: Math.round((extractMs / records.length) * 100) / 100 },
      memory: {
        heapUsedBeforeMb: mb(baseline.heapUsed),
        heapUsedAfterMb: mb(afterExtract.heapUsed),
        retainedMb: mb(afterExtract.heapUsed - baseline.heapUsed),
        retainedKbPerPage:
          Math.round(((afterExtract.heapUsed - baseline.heapUsed) / records.length / 1024) * 10) / 10,
        rssMb: mb(afterExtract.rss)
      },
      scan
    },
    null,
    2
  )}\n`
);
