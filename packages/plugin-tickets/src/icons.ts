import type { PluginKindIcon } from "@vellym/plugin-api";

/**
 * このプラグインが持つアイコン。**Coreは持たない。**
 *
 * 16×16のviewBoxへ描くpathの`d`だけを渡す。Core側は`currentColor`の線画として
 * 描くだけで、種別名から絵を推測しない。プラグインが増えるたびにCoreが
 * アイコン集合を抱える形にしないための境界である。
 */

/** チケット1件。角を落とした札に、状態を示す線を1本引く */
export const TICKET_ICON: PluginKindIcon = {
  paths: [
    "M2.75 4.75h10.5v6.5H2.75z",
    "M6 4.75v6.5",
    "M8.25 7.25h3.25",
    "M8.25 9h2"
  ]
};

/** チケット管理。札を重ねて、束であることを示す */
export const TICKET_TRACKER_ICON: PluginKindIcon = {
  paths: [
    "M2.75 6.25h8.5v7H2.75z",
    "M5 6.25V3.75h8.5v7h-2.25",
    "M5.25 8.75h3.5",
    "M5.25 10.75h2.5"
  ]
};
