# Contributing

## Development

Hot reload mode (server):

```bash
pnpm dev
```

The script loads [`.env.example`](.env.example) automatically.

Set the MCP server URL in your agent config, or use the CLI client for quick dev testing:

```bash
pnpm cli -- fetch <url>
pnpm cli -- search <query>
```
