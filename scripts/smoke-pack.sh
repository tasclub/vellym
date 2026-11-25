#!/bin/sh
set -eu

VELLYM_SMOKE_ROOT="$(mktemp -d)"
PACK_JSON="$(npm pack --workspace vellym --pack-destination "$VELLYM_SMOKE_ROOT" --json)"
PACK_FILE="$(node -e 'const fs=require("node:fs"); const value=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(value[0].filename)' <<EOF
$PACK_JSON
EOF
)"
# The public plugins and their API, packed the same way, for an init --plugins project.
PLUGIN_FILES=""
for workspace in @vellym/plugin-api @vellym/tickets @vellym/kanban @vellym/wbs; do
  PLUGIN_JSON="$(npm pack --workspace "$workspace" --pack-destination "$VELLYM_SMOKE_ROOT" --json)"
  PLUGIN_FILE="$(printf '%s' "$PLUGIN_JSON" | node -e 'const fs=require("node:fs"); process.stdout.write(JSON.parse(fs.readFileSync(0,"utf8"))[0].filename)')"
  PLUGIN_FILES="$PLUGIN_FILES $VELLYM_SMOKE_ROOT/$PLUGIN_FILE"
done
mkdir -p "$VELLYM_SMOKE_ROOT/consumer"
cd "$VELLYM_SMOKE_ROOT/consumer"
npm init -y >/dev/null
npm install "$VELLYM_SMOKE_ROOT/$PACK_FILE" >/dev/null
./node_modules/.bin/vellym init "$VELLYM_SMOKE_ROOT/example" \
  --language ja --plugins tickets,kanban,wbs
# Install what init declared from the packed tarballs instead of the registry.
grep -q '"@vellym/wbs"' "$VELLYM_SMOKE_ROOT/example/package.json"
(cd "$VELLYM_SMOKE_ROOT/example" && npm install --no-save "$VELLYM_SMOKE_ROOT/$PACK_FILE" $PLUGIN_FILES >/dev/null)
./node_modules/.bin/vellym validate --config "$VELLYM_SMOKE_ROOT/example/docs/vellym.config.yaml"
./node_modules/.bin/vellym build --config "$VELLYM_SMOKE_ROOT/example/docs/vellym.config.yaml"
# buildの出力ディレクトリは日時付きのため、生成物の存在だけを確認する。
test -n "$(find "$VELLYM_SMOKE_ROOT/example/docs/dist" -name index.html -print -quit)"
printf 'tarball smoke test passed: %s\n' "$VELLYM_SMOKE_ROOT"
