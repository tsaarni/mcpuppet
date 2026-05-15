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
