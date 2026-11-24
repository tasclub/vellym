/** Node contributions and diagnostics share the same Japanese/English dictionary. */
export const designText = {
  canvas: { ja: "キャンバス", en: "Canvas" },
  createCanvas: { ja: "デザインキャンバスを作成", en: "New design canvas" },
  createBoard: { ja: "ボードを追加", en: "New board" },
  createComponent: { ja: "部品を作成", en: "New component" },
  createStyles: { ja: "共有スタイルを作成", en: "New shared styles" },
  name: { ja: "名前", en: "Name" },
  nameRequired: { ja: "名前を入力してください", en: "Enter a name." },
  canvasRequired: { ja: "キャンバスを開いてください", en: "Open a canvas first." },
  canvasMissing: { ja: "参照先のキャンバスがありません", en: "Referenced canvas does not exist." },
  componentMissing: { ja: "参照先の部品がありません", en: "Referenced component does not exist." },
  stylesMissing: { ja: "参照先の共有スタイルがありません", en: "Referenced shared styles do not exist." },
  styleMissing: { ja: "参照先のスタイルがありません", en: "Referenced style does not exist." },
  boardMissing: { ja: "リンク先のボードがありません", en: "Destination board does not exist." },
  cycle: { ja: "部品の参照が循環しています", en: "Component references form a cycle." },
  duplicateId: { ja: "ファイルの中でノードIDが重複しています", en: "Node ID is duplicated within the file." },
  implementedBy: { ja: "実装ファイルはスラッシュ区切りの相対パスで指定してください", en: "Implementation files must use forward-slash relative paths." }
} as const;
