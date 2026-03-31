# vue-harvest

Extract reusable component libraries and design tokens from Vue applications.

Point it at a Vue project. It parses every `.vue` file, maps the dependency graph, classifies components by reusability, and auto-extracts the safe ones into standalone bundles. It also pulls out your design tokens (colors, typography, spacing) and generates a CSS token library.

## Quick start

```bash
npx vue-harvest analyze ./my-vue-app
```

This creates a `.vue-harvest/` directory with:
- `registry.json` : machine-readable component registry
- `catalog.html` : browsable catalog with tier filters
- `analysis.json` : full analysis for the MCP server
- `SUMMARY.md` : human-readable report
- `components/` : extracted component bundles

## Commands

```bash
vue-harvest analyze [path]       # full analysis + auto-extraction
vue-harvest list [path]          # list components by confidence
vue-harvest inspect <name>       # deep-inspect a single component
vue-harvest extract <name>       # extract a component into a bundle
vue-harvest tokens [path]        # extract design system tokens
vue-harvest init                 # create harvest.config.json
```

### Flags

| Flag | Commands | Description |
|------|----------|-------------|
| `--threshold <n>` | analyze | Confidence threshold 0-100 (default: 70) |
| `--output <dir>` | analyze, extract, tokens | Output directory |
| `--json` | analyze, list, inspect, tokens | JSON output to stdout |
| `--tier <tier>` | list | Filter by tier |
| `--force` | extract | Extract below threshold |

## Component tiers

| Tier | Confidence | Meaning |
|------|-----------|---------|
| Primitive | 85-100% | Pure UI, no business logic |
| Composite | 70-85% | Built from primitives |
| Feature | 50-70% | Has business logic, potentially reusable |
| Page-bound | 30-50% | Coupled to a specific route |
| App-specific | 0-30% | Deeply coupled |

## Programmatic usage

```typescript
import { analyze, writeOutput, analyzeTokens } from 'vue-harvest'

const report = await analyze('./my-vue-app')
console.log(report.summary)
await writeOutput(report)

const tokens = await analyzeTokens('./my-vue-app')
console.log(tokens.palette)
```

## Configuration

`harvest.config.json` (optional):

```json
{
  "include": ["**/*.vue"],
  "exclude": ["node_modules/**", "dist/**"],
  "extractionThreshold": 70,
  "outDir": ".vue-harvest"
}
```

Path aliases are auto-detected from `tsconfig.json`.

## MCP server

For AI-assisted extraction of harder components, see [vue-harvest-mcp](https://www.npmjs.com/package/vue-harvest-mcp).

## Full documentation

See the [project README](https://github.com/virgilvox/vue-harvest) for complete docs on architecture, coupling issues, MCP tools, and internal workings.

## License

MIT
