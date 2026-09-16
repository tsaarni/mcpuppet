# Contributing

## Development

Hot reload mode (server):

```bash
pnpm dev
```

The script loads [`.env.example`](.env.example) automatically.

Set the MCP server URL in your agent config, or use the CLI client for quick dev testing:

```bash
pnpm cli fetch <url>
pnpm cli search <query>
```

To debug pipeline steps, set variable `MCPUPPET_SESSION_DEBUG_DIR=./.session-debug`.
This creates a directory containing JSON files for each tool invocation, helping you identify and investigate cases where pipeline steps accidentally remove important content.

## Tests

```bash
pnpm test
```

Tests use Node's built-in test runner. The devtools-mcp tests launch a real Chrome instance.

## Updating dependencies

Use `pnpm audit` to check for vulnerabilities, `pnpm outdated` to list stale packages, and `pnpm update --latest` to update.
