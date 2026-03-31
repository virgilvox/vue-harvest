# Contributing

## Setup

```bash
git clone https://github.com/virgilvox/vue-harvest.git
cd vue-harvest
pnpm install
pnpm build
pnpm test
```

Requires Node.js 20+ and pnpm 10+.

## Project structure

This is a pnpm monorepo with two packages:

- `packages/cli` publishes as `vue-harvest` on npm. Contains the analysis engine, extractors, generators, and CLI.
- `packages/mcp` publishes as `vue-harvest-mcp` on npm. Contains the MCP server that wraps the CLI's analysis engine.

The MCP package depends on the CLI package via `workspace:*`.

## Development workflow

Watch mode for the CLI:

```bash
pnpm --filter vue-harvest dev
```

Run all tests:

```bash
pnpm test
```

Run a specific test file:

```bash
npx vitest run packages/cli/tests/unit/sfc-analyzer.test.ts
```

Typecheck:

```bash
pnpm typecheck
```

## Testing

Tests live in `packages/cli/tests/`. The `fixtures/` directory contains a real mini Vue project used as test input. This includes components of different tiers (primitives, coupled components, page views) so the analyzer can be tested against realistic code.

When adding a new analyzer feature, add a fixture component that exercises it, then write tests against the fixture.

## Code organization within the CLI

```
src/
  types.ts          All types. Shared across the project.
  index.ts          Pipeline orchestrator. Ties analyzers, extractors, generators together.
  cli.ts            CLI entry point.
  analyzers/        Read-only analysis. Takes source code, returns structured data.
  extractors/       Takes analyzed data, produces output files.
  generators/       Takes analyzed data, produces registry/catalog.
  commands/         CLI command definitions. Thin wrappers around the pipeline.
  utils/            Config resolution, path alias detection.
```

Analyzers are pure functions of their inputs (file content, config). They do not write to disk. Extractors and generators handle output.

## Adding a new CLI command

1. Create `src/commands/yourcommand.ts` using `defineCommand` from citty.
2. Register it in `src/cli.ts` under `subCommands`.
3. The command should be a thin wrapper that calls into `src/index.ts`.

## Adding a new MCP tool

1. Add the tool definition to the `ListToolsRequestSchema` handler in `packages/mcp/src/index.ts`.
2. Add the handler in the `CallToolRequestSchema` switch statement.
3. Keep tool responses as structured data (JSON) that the LLM can reason about.

## Commits

Write clear commit messages. One logical change per commit.

## Pull requests

Keep PRs focused. If you are fixing a bug and also want to refactor something nearby, make those separate PRs.
