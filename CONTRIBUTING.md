# Contributing to Vellym

## Before opening a change

- Use an issue form for usage questions, reproducible bugs, feature requests, or template proposals. Japanese or English is fine.
- Do not attach private project documents. Reduce YAML to a synthetic fixture.
- Discuss breaking YAML, CLI, config, or JSON-output changes before implementation.

## Development

Vellym requires Node.js 22.12 or later and npm. CI verifies the current 22 and 24
release lines. Versions below 22.12 cannot load JSON modules reliably and are not
supported.

```bash
npm ci
npm run typecheck
npm test
```

Run `npm run pack:smoke` for packaging changes, `npm run verify:core` for browser, accessibility, and 100-page verification, `npm run verify:browser` for all `tests/*.browser.mjs` checks (including Git commit/push and image upload), and `npm run verify:ui-locale` to check that an English-only project shows no Japanese UI text on the main screens. The browser checks require Playwright Chromium; see *Seeing the screen* below. Pull requests must describe YAML read/write and compatibility impact.

## Changing the UI

Run `npm run verify:acceptance` for the automated manual-acceptance scenarios in
`scripts/acceptance/`. It builds the CLI, uses disposable projects and headless
Chromium, and prints PASS / FAIL / BLOCKED / NOT RUN counts. Evidence (commit,
execution time, per-check details and durations) is in `dist/acceptance/result.json`.
Any FAIL exits with code 1; BLOCKED and NOT RUN are reported, not counted as passes.
Modules export `steps = [{ id, title, run(ctx) }]`; `ctx` provides temporary roots,
CLI/Git commands, filesystem access, dev servers on available ports, browser pages,
`check(title, fn)` (aggregated assertions), `note(text)`, and `blocked(reason)`.
Real macOS IME candidate selection is not emulated; unautomated parts are recorded
in each scenario's detail. Scenario expectations must not be weakened to fit the UI.

A green `npm run typecheck` and `npm test` do not mean a screen is finished.
Open the affected screen in a browser before proposing the change — see
*Seeing the screen* at the end of this section for how — and check the list
below. Each item has caused a real regression.

**Global CSS wins by default.** `packages/ui-react/src/styles.css` contains
ancestor-plus-element selectors such as `.setup-shell button`. Their specificity
(0,1,1) beats a component's single class (0,1,0), so a new bare icon button
silently inherits a border and `min-height`. When a component needs to opt out,
raise its specificity and say why in a comment.

**A selected row must not split in two.** If a full-width background marks
selection, anything that belongs to that row — name fields, conflict actions —
has to sit inside the same visual block, not below it on the page background.

**Indent through nesting, not per-row padding.** Put the step on
`ul[role="group"]`; a row should never compute its own depth for layout. Keep
`aria-level` for semantics.

**Watch the per-item line count.** Stacking title, description, reference, and
reason vertically is unreadable at 100+ rows. Collapse secondary text onto one
line and drop anything with no information in it. Give long lists an
expand-all/collapse-all control.

**Grid the label/input pairs.** Inline labels and inputs collide, and Japanese
labels get truncated. Use a fixed label column and a flexible input column.

**Clearing a checkbox must not remove the row.** If the list is derived from the
selection, an unselected item disappears with no way to restore it. Hold the
visible set separately from the selected set and let it grow only, marking
cleared rows instead of hiding them.

Accessibility is not optional here: `role="tree"`/`treeitem`/`group`,
`aria-level`, `aria-expanded`, `aria-checked` (`mixed` for partial), roving
tabindex, and arrow/Home/End/Space/Enter handling are all verified by
`tests/setup-tree.test.ts` and `npm run verify:core`.

### Seeing the screen

The dev container publishes no ports, so a browser on the host cannot reach
`npm run dev` inside it. Drive Chromium **inside the container** instead. The
dev container already has it: the `development` image installs Chromium's
system libraries, and `postCreateCommand` downloads the browser. Outside the
dev container, install them once:

```bash
npx playwright install chromium
sudo npx playwright install-deps chromium
```

`install-deps` also pulls `fonts-ipafont-gothic` and `fonts-wqy-zenhei`. Without
them Japanese renders as boxes, which hides the wrapping and truncation problems
you are looking for — do not skip it and judge the layout from a Latin-only
screenshot. When you bump `@playwright/test`, bump `PLAYWRIGHT_VERSION` in the
`Dockerfile` with it.

Then write a throwaway script that spawns the built CLI and screenshots it. Put
it at the repository root — importing `@playwright/test` from `/tmp` fails with
`ERR_MODULE_NOT_FOUND`, because the only `node_modules` is the workspace's. Do
not add it to `scripts/`; delete it when you are done.

```js
const server = spawn(process.execPath, [
  "packages/vellym/dist/cli.mjs", "dev",
  "--config", configPath, "--port", String(port)
]);
// poll GET /api/v1/repository until it answers, then:
const context = await browser.newContext({
  locale: "ja-JP", viewport: { width: 1440, height: 900 }
});
```

Run `npm run build` first — the script runs `packages/vellym/dist/cli.mjs`, not
the sources.

**Pick the config that exposes the problem.** `how-to-use/vellym.config.yaml`
loads the tickets, kanban, and WBS plugins, and is the only way to reach a
screen that is not a Page. It is a small tree, so density and overflow do not
show up there — generate a large one with
`node scripts/bench-fixture.mjs --out /tmp/big --pages 200` and point `--config`
at the `vellym.config.yaml` it writes. A few dozen pages is enough; the real
sidebar and outline problems appear well before the 3000-page scale fixture.

**Measure, do not eyeball.** `getBoundingClientRect()` and `getComputedStyle()`
on the real nodes, printed as JSON. A screenshot showed a cramped table of
contents; the measurement showed a 28px grid column reserved for a button that
no longer exists, and a `text-overflow: ellipsis` that could never fire because
`white-space` was `normal`. Neither is visible by looking.

**The document tree is a `treegrid`.** Its rows are `role="row"`, not
`role="treeitem"`. A locator written against `treeitem` matches nothing and
reports no error, so the check silently passes without having run.

**Reload and look again.** State that is held only in React — the tree's
expanded folders, for one — looks correct for the whole session and resets on
every reload. One reload at the end of the script catches it.

### README screenshots

The README shows four screenshots of the public guide's demo (`.github/readme/`). Retake them with one command:

```bash
npm run readme:screenshots
```

It builds the static guide and photographs the document view, ticket list, Kanban, and WBS at 1280×800 in Japanese; each file must stay at or below 300 KB. Retake them when a change alters how the document screen or the ticket screens look. Only the `how-to-use` demo is photographed, so no other documents appear. The images are not part of any npm package; the READMEs refer to them by absolute `raw.githubusercontent.com` URLs.

## Evolving the document format

Vellym ships **one** Page schema and one Folder schema, not one per `apiVersion`.
`packages/core/schemas/page.schema.json` accepts every supported version through the
`apiVersion` enum, which must stay in sync with `SUPPORTED_API_VERSIONS` (a test enforces
this). Version-specific schemas are produced only when publishing them to the site.

- **Adding is not a version bump.** New block types and new optional `metadata` or `spec`
  properties are valid under the existing version. Do not add a version for them.
- **Bump the version only for a breaking change**: a new required property, a changed
  meaning for an existing property, or a removal.
- **Write only the one-step conversion** from the immediately preceding version in
  `migration.ts`. Never write a direct multi-version conversion.
- **Support at most two versions at a time.** Remove the older one in the next major
  release rather than carrying it indefinitely.
- Plugin-provided blocks are namespaced (`vendor-name/block-type`) and are validated by
  the plugin that owns them. They never require a core schema change.

## Changing the plugin contract

`@vellym/plugin-api` is published, so anything exported from it is a public contract.
Keep it to types, constants, the manifest schema, and locale resolution. Runtime
behaviour belongs in `core`: if the contract package carries an implementation, a plugin
can bundle one version of it while the host runs another.

- A plugin receives extracted records, never a filesystem path or the content root, and
  writes only through host commands that go through the normal save path.
- A record projector must not retain the record it is given. Copy the values you need;
  keeping the reference retains every resource's `spec`.
- Anything a plugin gets wrong is a diagnostic. Nothing a plugin does may fail
  `validate`, `build`, the dev server, or the SPA.

Build the publishable output with `npm run build --workspace @vellym/plugin-api`. Day to
day you do not need to: the workspace resolves the package to its source.

## Releasing

Before publishing a feature or a plugin, check the documentation against each reader —
not whether a document exists, but whether that reader can *reach* it and get what they
need. A guide page describing only screen operations leaves an agent unable to write the
YAML, and a package nothing links to is never found.

- **Humans**: a `how-to-use/` page in both languages, listed in `_index.yaml`, linked
  from an existing page, and checked on the built site.
- **External AI agents**: the npm README is self-sufficient — never "see the site for
  details". A complete canonical YAML example, a table of every field type and required
  key, the `metadata.name` rule, a published JSON Schema under `/schemas/v1/`, and the
  page's body present in `dist/site/llms.txt`.
- **Contributors**: `CHANGELOG.md` updated, `CONTRIBUTING.md` still accurate, and the
  requirement or decision behind the change updated rather than the implementation
  landing alone.

Also re-walk the entry points: the two READMEs, the site page and its canonical URL,
`llms.txt`, and `/schemas/v1/`. The README "ステータス" section lists what is *not*
implemented, so releasing something means deleting a line there.

Publishing to npm uses trusted publishing (OIDC), so no npm token is stored in this
repository. The npm package must have a trusted publisher registered for this repository
with workflow filename `publish.yml` and no environment.

1. Bump the version with `npm version --workspace vellym <version>` so `package.json` and
   `package-lock.json` stay in sync, and date the release in `CHANGELOG.md`.
2. Point the install commands in both READMEs and the two getting-started guides at the
   dist-tag the version implies. `npm run release:check` fails the publish otherwise.
3. Create a GitHub Release for tag `v<version>`; mark prereleases as such. Publishing the
   release runs the workflow.
4. For a prerelease, update the `latest` dist-tag manually after publishing. OIDC
   credentials are scoped to publishing, so the workflow cannot change dist-tags:
   `npm dist-tag add vellym@<version> latest`. The workflow prints this in its summary.

If only the publish step fails, re-run the workflow with `workflow_dispatch` and the tag
name instead of recreating the tag and release.

## Design boundaries

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the packages fit together, which
boundaries `tests/architecture.test.ts` enforces, and where to make a given change.

The short version:

- YAML under the configured content root is the source of truth.
- Preserve comments, unknown keys, and unknown blocks when changing known fields.
- Do not write outside the configured project root or silently overwrite external changes.
- Vellym does not automatically run Git add, commit, or push.
- Embedded AI chat, generation, and review are outside the product boundary.
