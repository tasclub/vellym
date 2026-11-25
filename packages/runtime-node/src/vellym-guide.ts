import { open } from "node:fs/promises";
import { loadCatalog } from "./catalog/load.js";
import type { FolderDef } from "./catalog/types.js";

export type GuidePlugin = { id: string; name: string; guideUrl?: { ja?: string; en?: string } };

/** Append without creating a missing guide or rewriting any existing bytes. */
export async function appendGuideSection(path: string, section: { id: string; title: string; body: string }): Promise<void> {
  let file;
  try {
    file = await open(path, "r+");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  try {
    const source = await file.readFile();
    const marker = `<!-- vellym:guide:${section.id} -->`;
    if (source.includes(Buffer.from(marker))) return;
    const suffix = Buffer.from(`\n\n${marker}\n## ${section.title}\n\n${section.body}\n`);
    await file.writeFile(suffix);
  } finally {
    await file.close();
  }
}

export function vellymGuide({ language, structure, numbered, folderNames, contentRoot = ".", plugins, sections = [], version }: {
  language: "ja" | "en"; structure: string; numbered: boolean; folderNames: Record<string, string>;
  contentRoot?: string; plugins: GuidePlugin[]; sections?: Array<{ id: string; title: string; body: string }>; version: string;
}): string {
  const ja = language === "ja";
  const root = contentRoot.replace(/\/+$/, "");
  const definition = loadCatalog().structures.find(item => item.id === structure);
  if (!definition) throw new Error(`Unknown guide structure: ${structure}`);
  const map: string[] = [];
  const visit = (folders: FolderDef[], parent = ""): void => {
    folders.forEach((folder, index) => {
      const name = folderNames[folder.id] ?? `${numbered ? `${String(index).padStart(2, "0")}_` : ""}${folder.name[language]}`;
      const path = `${parent}${name}/`;
      map.push(`- \`${path}\`: ${folder.description[language]}`);
      if (folder.children) visit(folder.children, path);
    });
  };
  visit(definition.folders);
  const details = sections.map(section => `<!-- vellym:guide:${section.id} -->\n### ${section.title}\n\n${section.body}`).join("\n\n");
  const urls = [...new Set(plugins.map((p) => p.guideUrl?.[language] ?? p.guideUrl?.en ?? p.guideUrl?.ja).filter(Boolean))];
  const validate = "npx vellym validate --strict --config vellym.config.yaml";
  return `# ${ja ? "このプロジェクトのVellym" : "Vellym in this project"}

${ja ? `人とAIエージェントのための案内です。vellym init（vellym ${version}）が作成しました。自由に編集でき、削除してもVellymの動作には影響しません。` : `A guide for people and AI agents, created by vellym init (vellym ${version}). Edit freely; deleting it does not affect Vellym.`}

## ${ja ? "1. 文書の地図" : "1. Document map"}

${ja ? `設定は` : `Configuration:`} \`vellym.config.yaml\`  
${ja ? `文書の正本は` : `Source YAML documents:`} \`${root}/\`  
${ja ? "作成時に有効にしたプラグイン" : "Plugins enabled at creation"}: ${plugins.map((p) => `\`${p.name}\``).join(", ") || (ja ? "なし" : "none")}

${map.join("\n")}

## ${ja ? "2. 作業の流れ" : "2. Workflow"}

${ja ? `1. 導入: \`vellym init\`か画面で構成を作り、AGENTS.mdにこの案内を読む行を足す。
2. 立ち上げ: 目的・成功指標・関係者・範囲を決め、必要なテンプレートやセットだけ足す。判断の理由は決定記録に残す。
3. 管理: 必要なら作業の管理を作り、状態と項目を決める。
4. 要求・設計: 機能ごとに要求と受入条件を書き、画面・API・データを設計する。関連する文書を参照で結ぶ。
5. 実装: 作業を1件選んで作業中にし、関連文書を読んで実装・検証する。仕様を変えたら文書も直し、コミットに作業の名前を残して完了にする。
6. リリース: 版の範囲・見送り・判断・振り返りを記録し、Gitのタグと\`npx vellym build\`による共有用サイトを用意する。
7. 次の版: 要件・設計を更新し、ロードマップと現在地を直す。完了した作業は消さず、一覧を状態で絞る。

反復型ではスプリントごと、予測型では工程ごとにフォルダとセットを足せる。置き場所は上の地図で確認する。` : `1. Set up with \`vellym init\` or the UI, then add a line to AGENTS.md pointing here.
2. Start with purpose, success measures, stakeholders and scope. Add only needed templates or sets; record reasons for decisions.
3. If needed, create work management and define its statuses and fields.
4. Write requirements and acceptance criteria per feature, design screens, APIs and data, and link related documents.
5. Take one work item, mark it in progress, read related documents, implement and verify. Update documents when specifications change, name the work item in the commit, then complete it.
6. Record release scope, deferred work, decisions and a retrospective. Prepare a Git tag and a shared site with \`npx vellym build\`.
7. Update requirements, designs, roadmap and current position for the next version. Keep completed work and filter lists by status.

For iterative work, add a folder and set per sprint; for predictive work, per phase. Use the map above to find destinations.`}

## ${ja ? "3. 決まり" : "3. Rules"}

${ja ? `- 正本はYAMLとGit。画面や出力はその表示であり、変更履歴はGitに残す。競合は通常のブランチ・プルリクエストの運用で解決する。
- 必要な文書だけ作る。要件・設計は版ごとに複製せず上書きして育てる。完了した作業や文書も消さずに残す。
- 完了とは、受入条件と検証を満たし、仕様を変えたなら要件・設計も同じ作業で直し、実行結果と直した文書を記録した状態。
- 判断は決定記録に、理由・代替案とともに残す。版を締めたときや大きな判断の後に現在地を更新する。
- 参照はファイル名でなく\`metadata.name\`を使った\`[[名前]]\`で書く。` : `- YAML and Git are the source of truth; screens and exports are views. Keep history in Git and resolve conflicts through normal branches and pull requests.
- Create only needed documents. Evolve requirements and designs in place rather than copying them per version. Do not delete completed work or documents.
- Done means acceptance criteria and verification pass, changed specifications are reflected in requirements and designs in the same work, and results and updated documents are recorded.
- Keep decisions with their reasons and alternatives in decision records. Update current position at release closure and after major decisions.
- Link using \`[[name]]\` with \`metadata.name\`, not a file name.`}

## ${ja ? "4. AIの手順" : "4. AI procedure"}

${ja ? "まずこの案内と対象の作業を読む。参照から必要な要件・設計だけを調べ、履歴や全フォルダを一括で読まない。今の状態と形は次のコマンドで調べる。着手前に状態を作業中へ更新し、検証後に結果と変更した文書を記録して完了にする。進められない場合は理由と次の担当を記録し、実際の管理に定義された状態に更新する。" : "Read this guide and the target work first. Follow links to only the required requirements and designs; do not read all history or folders. Inspect current state and schemas with these commands. Mark work in progress before starting; after verification record results and updated documents, then complete it. If blocked, record the reason and next owner and use a status defined in the actual management configuration."}

\`\`\`yaml
apiVersion: vellym.tasclub.com/v1
kind: Page
metadata:
  name: example
spec:
  blocks:
    - id: body
      type: rich-text
      format: commonmark
      content: Hello
\`\`\`

### ${ja ? "今の状態を調べる" : "Inspect the current state"}

${ja ? "管理情報や設定の現在の中身は、このファイルではなくコマンドで調べます。" : "Inspect current management and configuration contents using commands rather than this file."}

\`\`\`sh
npx vellym schema --list --config vellym.config.yaml
npx vellym schema --kind <kind> --config vellym.config.yaml
npx vellym list --kind <kind> --json --config vellym.config.yaml
npx vellym validate --strict --json --config vellym.config.yaml
\`\`\`

### ${ja ? "書いた後に必ず実行する" : "Always validate after writing"}

${ja ? "次を実行し、診断0件にします。" : "Run this and ensure there are zero diagnostics:"}
\`\`\`sh
${validate}
\`\`\`
${plugins.length ? `\n## ${ja ? "5. プラグイン" : "5. Plugins"}\n\n${details}\n` : ""}
## ${ja ? "詳しい使い方" : "More information"}

- ${ja ? "利用ガイド" : "User guide"}: https://vellym.tasclub.com/${ja ? "" : "en/"}
- llms.txt: https://vellym.tasclub.com/llms.txt
- ${ja ? "全文" : "Full guide"}: https://vellym.tasclub.com/${ja ? "" : "en/"}llms-full.txt
- ${ja ? "スキーマ" : "Schemas"}: https://vellym.tasclub.com/schemas/v1/
${urls.map((url) => `- ${url}`).join("\n")}

## ${ja ? "AGENTS.md（またはCLAUDE.md）に足す行の例" : "Lines to add to AGENTS.md (or CLAUDE.md)"}

\`\`\`text
${ja ? `文書と作業の正本は${root}/（Vellym）。書き方は${root}/VELLYM.mdを読む。` : `The source of truth for documents and work is ${root}/ (Vellym). Read ${root}/VELLYM.md for instructions.`}
${ja ? `文書・作業を変えたら ${validate} を実行し、診断0件にする。` : `After changing documents or work, run ${validate} and ensure zero diagnostics.`}
${ja ? "形は npx vellym schema --kind <kind> --config vellym.config.yaml で調べる。" : "Inspect schemas with npx vellym schema --kind <kind> --config vellym.config.yaml."}
\`\`\`
`;
}
