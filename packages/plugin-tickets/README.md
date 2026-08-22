# @vellym/tickets

Official ticket management plugin for [Vellym](https://vellym.tasclub.com/).

Vellymの文書階層へチケット管理を追加する。開発、テスト、リリース準備など、
工程ごとに別のチケット管理を置き、それぞれ異なるステータスと項目を使える。

## インストール

Vellymプロジェクトのルートで実行する。

```sh
npm install @vellym/tickets
```

peer dependencyの`@vellym/plugin-api`はnpmによって自動的にインストールされる。

## 設定

`vellym.config.yaml`の`plugins`へパッケージ名を追加する。

```yaml
plugins:
  - "@vellym/tickets"
```

`vellym dev`を起動し、文書ツリーの追加メニューから「チケット管理」を選ぶ。

## チケット管理を置く場所

`TicketTracker`は、置いたフォルダとその子孫にあるチケットを管理する。たとえば
`30-実装/`へ置けば実装工程を、`40-品質/`へ置けば品質工程を別々に管理できる。

チケットの所属はYAMLの項目ではなく置き場所で決まる。上位に複数の
`TicketTracker`がある場合、最も近い祖先のTrackerがそのチケットを所有し、
ステータスと項目の定義を与える。チケットは、さらに上位にあるTrackerの一覧にも
表示される。

画面から作成した新しいチケットは、既定で
`<Trackerのフォルダ>/+tickets/`へ保存される。`+`で始まるフォルダは文書ツリーには
出ないが、チケット一覧、全文検索、内部リンクでは利用できる。

## ステータスと項目

Trackerを開き、「このチケット管理の設定」からステータスと項目を定義する。
工程ごとに必要な流れや、優先度、担当、期限などを設定できる。

定義を変更した結果、既存チケットのステータスや項目と食い違っても、Vellymは
すべて警告として扱う。チケットは読める状態、編集できる状態を保ち、値を勝手に
削除しない。

## プラグインを外す

`vellym.config.yaml`の`plugins`から`@vellym/tickets`を外すと、チケット一覧と
専用の設定画面は表示されなくなる。`Ticket`と`TicketTracker`のYAMLは変更も削除も
されず、本文は引き続き読み込まれ、全文検索と内部リンクから利用できる。Vellymが
その`kind`を解釈できないことはエラーにはならない。

## License

MIT
