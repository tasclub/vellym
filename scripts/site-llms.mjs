// Apply a transformation only outside CommonMark fenced code blocks.
function outsideFences(markdown, transform) {
  let fence = null;
  return markdown.split("\n").map((line) => {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (match && match[1][0] === fence[0] && match[1].length >= fence.length && !match[2].trim()) fence = null;
      return line;
    }
    if (match && !(match[1][0] === "`" && match[2].includes("`"))) {
      fence = match[1];
      return line;
    }
    return transform(line);
  }).join("\n");
}

export function demoteHeadings(markdown) {
  return outsideFences(markdown, (line) => line.replace(/^(#{1,5})(?= )/, "#$1"));
}

export function pageOrder(repository) {
  const { pages, folders } = repository.data;
  const result = [];
  function visit(folderPath) {
    const folder = folders.find((item) => item.path === folderPath);
    if (!folder) return;
    const prefix = folderPath ? `${folderPath}/` : "";
    const children = [
      ...pages.filter((page) => page.relativePath.startsWith(prefix) && !page.relativePath.slice(prefix.length).includes("/"))
        .map((page) => ({ key: page.relativePath.slice(prefix.length), page })),
      ...folders.filter((child) => child.path.startsWith(prefix) && child.path !== folderPath && !child.path.slice(prefix.length).includes("/"))
        .map((child) => ({ key: child.path.slice(prefix.length), folder: child }))
    ];
    const order = folder.order ?? [];
    children.sort((a, b) => {
      const ai = order.indexOf(a.key), bi = order.indexOf(b.key);
      return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) || a.key.localeCompare(b.key);
    });
    for (const child of children) {
      if (child.page) result.push(child.page);
      else visit(child.folder.path);
    }
  }
  visit("");
  return result;
}

export function llmsIndex({ pagesByLocale, schemas }) {
  const links = (pages) => pages.map(({ title, url }) => `- [${title}](${url})`);
  return [
    "# Vellym",
    "> Vellym turns Git-managed YAML documents into a browsable static site and structured data.",
    "VellymはGitで管理するYAML文書をブラウザで閲覧できる静的サイトと構造化データにするツールです。",
    "", "## 日本語の利用ガイド", "", ...links(pagesByLocale.ja),
    "", "## English user guide", "", ...links(pagesByLocale.en),
    "", "## Full text", "",
    "- [日本語の全文](https://vellym.tasclub.com/llms-full.txt)",
    "- [English full text](https://vellym.tasclub.com/en/llms-full.txt)",
    "", "## Schemas", "", ...links(schemas), ""
  ].join("\n");
}

export function llmsFull({ locale, pages, publishedPages = pages }) {
  const urls = new Map(publishedPages.map((page) => [page.name, page.url]));
  const expand = (content) => outsideFences(content, (line) =>
    line.replace(/(`+)(.*?)(\1)|\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g, (source, ticks, _code, _end, target, label) => {
      if (ticks) return source;
      const name = target.trim();
      const url = urls.get(name);
      return url ? `[${(label ?? name).trim()}](${url})` : source;
    }));
  return [
    locale === "ja" ? "# Vellym 利用ガイド（全文）" : "# Vellym User Guide (full text)",
    "", "## Contents", "",
    ...pages.map(({ title, url }, index) => `${index + 1}. [${title}](${url})`),
    ...pages.flatMap(({ title, url, content }) => ["", `## ${title}`, `Source: ${url}`, "", demoteHeadings(expand(content))]),
    ""
  ].join("\n");
}
