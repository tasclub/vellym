#!/bin/sh
set -eu

VELLYM_SMOKE_ROOT="$(mktemp -d)"
PACK_JSON="$(npm pack --workspace vellym --pack-destination "$VELLYM_SMOKE_ROOT" --json)"
PACK_FILE="$(node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(value[0].filename)' <<EOF
$PACK_JSON
EOF
)"
mkdir -p "$VELLYM_SMOKE_ROOT/consumer"
cd "$VELLYM_SMOKE_ROOT/consumer"
npm init -y >/dev/null
npm install "$VELLYM_SMOKE_ROOT/$PACK_FILE" >/dev/null
./node_modules/.bin/vellym init "$VELLYM_SMOKE_ROOT/example" \
  --yes --language ja --content-root content --profile software-basic
./node_modules/.bin/vellym validate --config "$VELLYM_SMOKE_ROOT/example/vellym.config.yaml"
./node_modules/.bin/vellym build --config "$VELLYM_SMOKE_ROOT/example/vellym.config.yaml"
# buildの出力ディレクトリは日時付きのため、生成物の存在だけを確認する。
test -n "$(find "$VELLYM_SMOKE_ROOT/example/dist" -name index.html -print -quit)"
printf 'tarball smoke test passed: %s\n' "$VELLYM_SMOKE_ROOT"
