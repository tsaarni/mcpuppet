# Contributing

## Development

Hot reload mode (server):

```bash
npm run dev
```

The script loads `.env.example` automatically via `--env-file=.env.example`.

Set the MCP server URL in your agent config, or use the CLI client for quick dev testing:

```bash
npx tsx src/cli.ts fetch <url>
npx tsx src/cli.ts search <query>
```
