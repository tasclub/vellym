/** Crockford base32。`I`・`L`・`O`・`U`を含まない */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/**
 * `metadata.name`に使う小文字ULIDを作る。
 *
 * 時刻順に単調増加するため、ファイル名がおおよそ作成順に並び、Gitの差分と
 * ディレクトリ一覧が読みやすい。連番は採らない。分散した作業やブランチ間で
 * 衝突するためである。
 *
 * `metadata.name`のパターン（小文字英数と`-`）に収めるため、標準ULIDの
 * 大文字表記ではなく小文字にする。
 */
export function ulid(now = Date.now()): string {
  let time = "";
  let remaining = now;
  for (let index = 0; index < 10; index += 1) {
    time = `${ALPHABET[remaining % 32]}${time}`;
    remaining = Math.floor(remaining / 32);
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let random = "";
  for (const byte of bytes) {
    random += ALPHABET[byte % 32];
  }
  return `${time}${random}`;
}

/** チケットの`metadata.name`。ファイル名もこれと同じにする */
export function ticketName(now = Date.now()): string {
  return `ticket-${ulid(now)}`;
}

/**
 * `TicketTracker`の`metadata.name`。人が指すものなのでULIDにしない。
 *
 * 名前から作り、規則に合わない文字は落とす。空になる場合と衝突しうる場合に
 * 備えて短い接尾辞を付ける。
 */
export function trackerName(title: string, now = Date.now()): string {
  const base = title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const suffix = ulid(now).slice(-6);
  return base ? `${base}-${suffix}` : `ticket-tracker-${suffix}`;
}
