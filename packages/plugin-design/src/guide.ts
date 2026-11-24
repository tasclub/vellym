/**
 * Localized section appended to VELLYM.md when the design plugin is enabled.
 * Keep this practical: use the schema command for the complete, versioned shape.
 */
export const designGuide = {
  id: "design",
  ja: {
    title: "デザインキャンバス",
    body: `デザインキャンバスを使うときは、次の保存形式と検証方法に従ってください。

### ファイルの置き方

キャンバスは1つのフォルダに置きます。ボード・部品は1件ずつ別ファイルにし、\`metadata.name\`をファイル名と参照に使います。

\`\`\`text
<contentRoot>/<キャンバス名>/
├── <キャンバス名>.yaml              # DesignCanvas
├── <キャンバス名>-styles.yaml       # DesignStyles（任意）
├── <キャンバス名>.tokens.json       # DTCG tokens（任意）
├── <キャンバス名>.resolver.json     # DTCG Resolver（任意）
├── +boards/<ボード名>.yaml           # DesignBoard
└── +components/<部品名>.yaml         # DesignComponent
\`\`\`

### スキーマと書き方

- 詳しい項目は \`npx vellym schema --kind DesignBoard\` などで確認します。
- CSS・SVG・DTCGにある概念はその名前と値を使います（例: \`display: flex\`、\`gridTemplateColumns\`、SVGのパス \`d\`）。CSSにない概念はFigmaの語を使います（例: \`sizing: hug/fill/fixed\`、\`constraints\`、部品のバリアント）。
- 長さはpxの数値、角度は度で書きます。ノードの \`id\` はファイル内で一意にし、作成後は変えないでください。リソース間の参照はファイルパスでなく \`metadata.name\` を使います。
- デザイントークンはDTCG 2025.10のJSONをそのまま \`.tokens.json\` に保存し、YAMLへ変換しません。値から参照するときは \`"{color.primary}"\` の形を使います。
- \`DesignBoard.spec.implementedBy\` には実装ファイルのパスをGitルートからの相対パス（スラッシュ区切り）で書きます。

### 書いた後の確認

変更したデザインを検証し、診断を解消します。

\`\`\`sh
npx vellym validate --strict --config vellym.config.yaml
\`\`\``,
  },
  en: {
    title: "Design canvas",
    body: `When working with design canvases, follow this storage format and validation workflow.

### File layout

Keep each canvas in its own folder. Store each board and component in a separate file; use \`metadata.name\` for filenames and references.

\`\`\`text
<contentRoot>/<canvas-name>/
├── <canvas-name>.yaml              # DesignCanvas
├── <canvas-name>-styles.yaml       # DesignStyles (optional)
├── <canvas-name>.tokens.json       # DTCG tokens (optional)
├── <canvas-name>.resolver.json     # DTCG Resolver (optional)
├── +boards/<board-name>.yaml       # DesignBoard
└── +components/<component-name>.yaml # DesignComponent
\`\`\`

### Schema and conventions

- Inspect the complete schema with commands such as \`npx vellym schema --kind DesignBoard\`.
- Use CSS, SVG, and DTCG names and values when those standards define the concept (for example, \`display: flex\`, \`gridTemplateColumns\`, and SVG path \`d\`). Use Figma terminology for concepts without a CSS equivalent, such as \`sizing: hug/fill/fixed\`, \`constraints\`, and component variants.
- Lengths are numeric px values and angles are in degrees. Keep each node \`id\` unique within its file and stable after creation. Resolve resources by \`metadata.name\`, not by file path.
- Store design tokens unchanged as DTCG 2025.10 JSON in \`.tokens.json\`; do not convert them to YAML. Reference a token in a value as \`"{color.primary}"\`.
- Write paths in \`DesignBoard.spec.implementedBy\` relative to the Git root, using forward slashes.

### Validate after writing

Validate the changed design and resolve all diagnostics:

\`\`\`sh
npx vellym validate --strict --config vellym.config.yaml
\`\`\``,
  },
} as const;
