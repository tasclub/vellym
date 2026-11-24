type GuidePlugin = { id: string; name: string; guideUrl?: { ja?: string; en?: string } };

export function vellymGuide({ language, contentRoot, plugins, version }: {
  language: "ja" | "en"; contentRoot: string; plugins: GuidePlugin[]; version: string;
}): string {
  const ja = language === "ja";
  const root = contentRoot.replace(/\/+$/, "");
  const pluginText: Record<string, [string, string]> = {
    tickets: ["任意のフォルダにTicketTrackerを1つ置き、その下の`+tickets/`にTicketを置く。状態は`spec.statuses`、項目は`spec.fields`で決める。", "Place one TicketTracker in any folder and its Tickets in `+tickets/` below it. Define statuses in `spec.statuses` and fields in `spec.fields`."],
    kanban: ["Trackerの`spec.kanban`に列を設定する。", "Configure columns in the Tracker's `spec.kanban`."],
    wbs: ["Trackerの`spec.wbs`に親・開始・終了・並び順の項目を設定する。", "Configure parent, start, end and ordering fields in the Tracker's `spec.wbs`."]
  };
  const details = plugins.map((p) => `- ${p.name}: ${pluginText[p.id]?.[ja ? 0 : 1] ?? ""}`).join("\n");
  const urls = [...new Set(plugins.map((p) => p.guideUrl?.[language] ?? p.guideUrl?.en ?? p.guideUrl?.ja).filter(Boolean))];
  const validate = "npx vellym validate --strict --config vellym.config.yaml";
  return `# ${ja ? "このプロジェクトのVellym" : "Vellym in this project"}

${ja ? `人とAIエージェントのための案内です。vellym init（vellym ${version}）が作成しました。自由に編集でき、削除してもVellymの動作には影響しません。` : `A guide for people and AI agents, created by vellym init (vellym ${version}). Edit freely; deleting it does not affect Vellym.`}

## ${ja ? "要点" : "Essentials"}

${ja ? `設定は` : `Configuration:`} \`vellym.config.yaml\`  
${ja ? `文書の正本は` : `Source YAML documents:`} \`${root}/\`  
${ja ? "作成時に有効にしたプラグイン" : "Plugins enabled at creation"}: ${plugins.map((p) => `\`${p.name}\``).join(", ") || (ja ? "なし" : "none")}

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

## ${ja ? "今の状態を調べる" : "Inspect the current state"}

${ja ? "Trackerや設定の現在の中身は、このファイルではなくコマンドで調べます。" : "Inspect current Tracker and configuration contents using commands rather than this file."}

\`\`\`sh
npx vellym schema --list --config vellym.config.yaml
npx vellym schema --kind <kind> --config vellym.config.yaml
npx vellym list --kind <kind> --json --config vellym.config.yaml
npx vellym validate --strict --json --config vellym.config.yaml
\`\`\`

## ${ja ? "書いた後に必ず実行する" : "Always validate after writing"}

${ja ? "次を実行し、診断0件にします。" : "Run this and ensure there are zero diagnostics:"}
\`\`\`sh
${validate}
\`\`\`
${plugins.length ? `\n## ${ja ? "プラグイン" : "Plugins"}\n\n${details}\n` : ""}
## ${ja ? "詳しい使い方" : "More information"}

- ${ja ? "利用ガイド" : "User guide"}: https://vellym.tasclub.com/${ja ? "" : "en/"}
- llms.txt: https://vellym.tasclub.com/llms.txt
- ${ja ? "全文" : "Full guide"}: https://vellym.tasclub.com/${ja ? "" : "en/"}llms-full.txt
- ${ja ? "スキーマ" : "Schemas"}: https://vellym.tasclub.com/schemas/v1/
${urls.map((url) => `- ${url}`).join("\n")}

## ${ja ? "AGENTS.md（またはCLAUDE.md）に足す行の例" : "Lines to add to AGENTS.md (or CLAUDE.md)"}

\`\`\`text
${ja ? `文書とTicketの正本は${root}/（Vellym）。書き方は${root}/VELLYM.mdを読む。` : `The source of truth for documents and Tickets is ${root}/ (Vellym). Read ${root}/VELLYM.md for instructions.`}
${ja ? `文書・Ticketを変えたら ${validate} を実行し、診断0件にする。` : `After changing documents or Tickets, run ${validate} and ensure zero diagnostics.`}
${ja ? "形は npx vellym schema --kind <kind> --config vellym.config.yaml で調べる。" : "Inspect schemas with npx vellym schema --kind <kind> --config vellym.config.yaml."}
\`\`\`
`;
}
