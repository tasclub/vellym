# Architecture

This document explains how Vellym is put together and where to make a change. The
package boundaries described here are enforced by `tests/architecture.test.ts`, so a
change that crosses them fails CI rather than being caught in review.

## The one rule

**YAML under the configured content root is the source of truth. Everything else is
derived.** HTML, the static site, the search index, and the in-memory repository
snapshot are all generated from it and can be rebuilt at any time. No feature may
introduce a second place where document content lives.

## Packages

The repository is an npm workspaces monorepo. Only `vellym` is published; the other
three are internal and get bundled into it at build time.

| Package | Published | Responsibility |
| --- | --- | --- |
| `@vellym-internal/core` | no | Types, JSON Schema validation, navigation, search projection, editing rules |
| `@vellym-internal/runtime-node` | no | Filesystem access, repository loading, saving, structure changes, the local HTTP server |
| `@vellym-internal/ui-react` | no | The browser UI, used by both the dev server and the static build |
| `vellym` | **yes** | The CLI (`init` / `dev` / `validate` / `build` / `migrate`) and the static site builder |

### Dependency direction

```
vellym  ──▶  runtime-node  ──▶  core
   │                             ▲
   └──────▶  ui-react  ──────────┘
```

Enforced constraints:

- **`core` depends on nothing of ours, and not on Node.js or React.** It must run in
  both the browser and Node. No `node:` imports, no `react` imports.
- **`runtime-node` never imports `ui-react`.** The server serves the built UI as
  static files; it does not know about components.
- **`ui-react` never imports `runtime-node`.** It talks to the server over HTTP, and
  in static mode reads baked JSON instead. This is why the same UI works for both.

## Where things live

| If you are changing… | Start here |
| --- | --- |
| The Page/Folder schema | `packages/core/schemas/`, `packages/core/src/validation.ts` |
| What counts as an editable block | `packages/core/src/editing.ts` |
| Search behaviour | `packages/core/src/search.ts` |
| Tree, breadcrumbs, previous/next | `packages/core/src/navigation.ts` |
| Reading YAML from disk | `packages/runtime-node/src/repository.ts` |
| Saving a page | `packages/runtime-node/src/page-store.ts` |
| Create / move / reorder / archive | `packages/runtime-node/src/structure.ts` |
| HTTP endpoints | `packages/runtime-node/src/server.ts` |
| First-run setup and templates | `packages/runtime-node/src/setup.ts` |
| Screens and interactions | `packages/ui-react/src/` |
| CLI commands and messages | `packages/vellym/src/cli.ts`, `cli-messages.ts` |
| Static site output | `packages/vellym/src/static-builder.ts` |

## Reading path

`loadRepository()` walks the content root, parses each YAML file, validates it, and
produces a `RepositorySnapshot`. A file that fails to parse or validate becomes a
diagnostic attached to that file; **it never stops the rest of the repository from
loading.** This isolation is deliberate: one broken document must not take down the
whole project.

The snapshot is the only thing the HTTP layer and the static builder read from.

## Writing path

Saving is deliberately conservative, because the file on disk is the source of truth
and may contain things Vellym does not understand yet.

1. Resolve the real path and confirm it is inside the content root
2. Confirm the file is a regular file, not a symlink
3. Compare a hash of the current file against the hash the client started from —
   a mismatch is a conflict, never an overwrite
4. Edit the parsed YAML document **in place**, touching only known nodes, so
   comments, unknown keys, and unknown blocks survive
5. Re-validate the serialised result before writing
6. Write to a temporary file, validate that file, then rename over the original

Two consequences worth knowing before you change this code:

- **The write path edits the original document tree, not a serialised model.** This is
  what makes non-destructive round-tripping possible. Do not replace it with
  "deserialise, mutate, re-serialise".
- **Structure changes never delete.** Removing something moves it under `_archive/`.
  Real deletion is out of scope for the normal UI.

## The two runtime modes

The same React application serves both modes, with a flag deciding which:

- **`vellym dev`** — the UI calls the local HTTP API. Editing, structure changes, and
  search are available. File changes on disk are pushed to the browser over SSE.
- **`vellym build`** — the UI is shipped with the data baked in as JSON. It is
  read-only: no editing, no structure changes, no server. It can be hosted on any
  static file server.

Keeping one UI for both modes is a constraint, not an accident. A feature that cannot
degrade to read-only needs to be behind a capability flag rather than forked into a
second UI.

## Local server model

The server binds to loopback by default and has **no authentication**. Its safety
comes from being local:

- While bound to loopback, the `Host` header is restricted, which blocks DNS
  rebinding from an external site
- State-changing requests check `Origin`
- All responses carry `nosniff`, `DENY`, and `no-referrer`
- Writes are confined to the content root by real-path checks

If you add an endpoint, it inherits the header and origin handling from the shared
helpers — but the path boundary check is per-operation and must be written explicitly.

## Errors

`RuntimeError` carries a message, an HTTP status, and a **stable `code`**. The code is
the contract; the message is a fallback. The browser UI looks up `error.<CODE>` in its
locale files so the same failure reads correctly in Japanese and English. When you add
an error, add the code to both `packages/ui-react/src/locales/*.json`.

Unexpected exceptions are never returned verbatim: they are logged to the terminal
that started the server, and the response is a fixed `INTERNAL` message. Filesystem
errors can contain absolute paths outside the project.

## Testing

| Command | Covers |
| --- | --- |
| `npm test` | Unit and integration tests, including package boundaries |
| `npm run coverage` | Same, with coverage reporting |
| `npm run verify:core` | Real browser: accessibility, keyboard, Japanese IME, CommonMark round-trip, search response time at 100 pages |
| `npm run pack:smoke` | The published tarball, in an empty environment |
| `npm run site:verify` | The generated static site, in a real browser |

`verify:core` runs in CI on every pull request. It is the only check that exercises
the actual UI, so a UI change that passes `npm test` is not yet verified.
