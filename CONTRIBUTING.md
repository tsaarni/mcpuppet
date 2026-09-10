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

## Checking and updating vulnerable packages

Check for known vulnerabilities:

```bash
pnpm audit
```

List outdated packages:

```bash
pnpm outdated
```

Update packages to latest allowed by version ranges in `package.json`:

```bash
pnpm update
```

Update a specific package to latest, including major version bumps:

```bash
pnpm update <package> --latest
```

Update all packages to latest, including major version bumps:

```bash
pnpm update --latest
```

After updating, run tests and type checks to catch breakage:

```bash
pnpm typecheck
pnpm test
```

