#!/usr/bin/env bash

set -euo pipefail

# npm publishはpackage directoryから実行する必要があるため、このスクリプトは
# 呼び出し元のpackage.jsonを読み、cwdを変えずにnpmを実行する。
metadata="$(
  node -e '
    const manifest = require("./package.json");
    const prerelease = manifest.version.includes("-")
      ? manifest.version.slice(manifest.version.indexOf("-") + 1).split(".")[0]
      : undefined;
    process.stdout.write(`${manifest.name}\t${manifest.version}\t${prerelease ?? "latest"}`);
  '
)"
IFS=$'\t' read -r package_name version dist_tag <<< "$metadata"

echo "package: ${package_name}@${version} (dist-tag: ${dist_tag})"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "name=$package_name" >> "$GITHUB_OUTPUT"
  echo "version=$version" >> "$GITHUB_OUTPUT"
  echo "tag=$dist_tag" >> "$GITHUB_OUTPUT"
fi

# publishせず、workflowと同じ版・dist-tagの解決だけを確認するための入口。
if [ "${1:-}" = "--show-metadata" ]; then
  exit 0
fi
if [ "$#" -ne 0 ]; then
  echo "usage: $0 [--show-metadata]" >&2
  exit 2
fi

view_output="$(mktemp)"
view_error="$(mktemp)"
trap 'rm -f "$view_output" "$view_error"' EXIT

# npmは同じ版を再公開できない。正確な版がregistryにあれば明示的に飛ばす。
# E404だけを未公開として扱い、認証・通信など別の失敗は握り潰さない。
if npm view "${package_name}@${version}" version --json > "$view_output" 2> "$view_error"; then
  cat "$view_error" >&2
  published_version="$(node -e '
    const output = require("node:fs").readFileSync(process.argv[1], "utf8");
    const value = JSON.parse(output);
    if (typeof value !== "string") process.exit(1);
    process.stdout.write(value);
  ' "$view_output")"
  if [ "$published_version" != "$version" ]; then
    echo "npm registryから予期しない版が返りました: ${published_version}" >&2
    exit 1
  fi
  echo "公開済みのためスキップ: ${package_name}@${version}"
  exit 0
else
  view_status=$?
fi

if ! grep -Eq '(^|[^[:alnum:]_])E404([^[:alnum:]_]|$)' "$view_output" \
  && ! grep -Eq '(^|[^[:alnum:]_])E404([^[:alnum:]_]|$)' "$view_error"; then
  cat "$view_output" >&2
  cat "$view_error" >&2
  exit "$view_status"
fi

echo "未公開のためpublish: ${package_name}@${version} (dist-tag: ${dist_tag})"
npm publish --provenance --access public --tag "$dist_tag"
