# Contributing to Vellym

## Before opening a change

- Use an issue form for reproducible bugs, user problems, or template proposals.
- Do not attach private project documents. Reduce YAML to a synthetic fixture.
- Discuss breaking YAML, CLI, config, or JSON-output changes before implementation.

## Development

Vellym requires Node.js 22 or 24 and npm.

```bash
npm ci
npm run typecheck
npm test
```

Run `npm run pack:smoke` for packaging changes and `npm run verify:core` for browser, accessibility, and 100-page verification. Pull requests must describe YAML read/write and compatibility impact.

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

## Releasing

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

- YAML under the configured content root is the source of truth.
- Preserve comments, unknown keys, and unknown blocks when changing known fields.
- Do not write outside the configured project root or silently overwrite external changes.
- Vellym does not automatically run Git add, commit, or push.
- Embedded AI chat, generation, and review are outside the product boundary.
