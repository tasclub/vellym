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

## Design boundaries

- YAML under the configured content root is the source of truth.
- Preserve comments, unknown keys, and unknown blocks when changing known fields.
- Do not write outside the configured project root or silently overwrite external changes.
- Vellym does not automatically run Git add, commit, or push.
- Embedded AI chat, generation, and review are outside the product boundary.
