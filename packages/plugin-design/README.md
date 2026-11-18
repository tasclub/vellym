# @vellym/design

[English](#english) | [日本語](#日本語)

## English

A Vellym plugin that adds design canvases: an artboard canvas you lay out and edit in the browser. This package is stage 1a. It contributes the `DesignCanvas` and `DesignBoard` kinds, their schemas, and the creation commands. The canvas screen itself is a placeholder list for now and arrives in the next release step.

```yaml
plugins:
  - "@vellym/design"
```

A canvas is one resource; every artboard is its own resource so dragging one frame rewrites only that file. Boards live in a `+boards/` folder next to their canvas and are not shown in the document tree.

```yaml
# DesignCanvas (e.g. 30-設計/ux-canvas.yaml)
apiVersion: vellym.tasclub.com/v1
kind: DesignCanvas
metadata:
  name: ux-canvas
  title: UX canvas
spec:
  pages:
    - { id: mobile, title: Mobile }
```

```yaml
# DesignBoard (e.g. 30-設計/+boards/home-mobile.yaml)
apiVersion: vellym.tasclub.com/v1
kind: DesignBoard
metadata:
  name: ux-canvas-board-1
  title: Home mobile
spec:
  canvas: ux-canvas     # DesignCanvas metadata.name
  page: mobile          # optional
  x: 0
  y: 0
  w: 390
  h: 844
  title: Home mobile
  html: "<div>…</div>"  # self-contained HTML
```

Create both from commands: "New design canvas" in the document tree, "New artboard" in an open canvas. Commands only produce unsaved drafts; nothing is written until you save.

## 日本語

Vellymのデザインキャンバス插件です。アートボードを並べて設定する画面の土台で、`DesignCanvas`・`DesignBoard`の種別とスキーマ、作成コマンドを入れます。段階1aのため、キャンバス画面はまだ仮の一覧です。画面の描画は次の段階で入ります。

```yaml
plugins:
  - "@vellym/design"
```

キャンバスは1リソース、アートボードは1枚ずつ別リソースです。枠を動かすとそのアートボード1ファイルだけ書き換わります。アートボードはキャンバスと同じフォルダの`+boards/`に置き、文書ツリーには出しません。

```yaml
# DesignCanvas（例: 30-設計/ux-canvas.yaml）
apiVersion: vellym.tasclub.com/v1
kind: DesignCanvas
metadata:
  name: ux-canvas
  title: UXキャンバス
spec:
  pages:
    - { id: mobile, title: スマホ }
```

```yaml
# DesignBoard（例: 30-設計/+boards/home-mobile.yaml）
apiVersion: vellym.tasclub.com/v1
kind: DesignBoard
metadata:
  name: ux-canvas-board-1
  title: M1 ホーム
spec:
  canvas: ux-canvas     # DesignCanvasのmetadata.name
  page: mobile          # 任意
  x: 0
  y: 0
  w: 390
  h: 844
  title: M1 ホーム
  html: "<div>…</div>"  # 自己完結したHTML
```

作成はコマンドからです。文書ツリーから「デザインキャンバスを作成」、開いているキャンバスから「アートボードを追加」。コマンドは未保存のドラフトを作るだけで、保存するまでファイルは書かれません。
