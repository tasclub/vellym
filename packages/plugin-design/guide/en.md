When working with design canvases, follow this storage format and validation workflow.

### File layout

Keep each canvas in its own folder. Store each board and component in a separate file; use `metadata.name` for filenames and references.

```text
<contentRoot>/<canvas-name>/
├── <canvas-name>.yaml              # DesignCanvas
├── <canvas-name>-styles.yaml       # DesignStyles (optional)
├── <canvas-name>.tokens.json       # DTCG tokens (optional)
├── <canvas-name>.resolver.json     # DTCG Resolver (optional)
├── +boards/<board-name>.yaml       # DesignBoard
└── +components/<component-name>.yaml # DesignComponent
```

### Schema and conventions

- Inspect the complete schema with commands such as `npx vellym schema --kind DesignBoard`.
- Use CSS, SVG, and DTCG names and values when those standards define the concept (for example, `display: flex`, `gridTemplateColumns`, and SVG path `d`). Use Figma terminology for concepts without a CSS equivalent, such as `sizing: hug/fill/fixed`, `constraints`, and component variants.
- Lengths are numeric px values and angles are in degrees. Keep each node `id` unique within its file and stable after creation. Resolve resources by `metadata.name`, not by file path.
- Store design tokens unchanged as DTCG 2025.10 JSON in `.tokens.json`; do not convert them to YAML. Reference a token in a value as `"{color.primary}"`.
- Write paths in `DesignBoard.spec.implementedBy` relative to the Git root, using forward slashes.

### Validate after writing

Validate the changed design and resolve all diagnostics:

```sh
npx vellym validate --strict --config vellym.config.yaml
```
