# Common MCP Gateway Manager

Web admin UI for the Common MCP Gateway configuration (`~/.common-mcp/config.json`). It runs standalone and only needs the config file.

## Features

- Servers tab: add, edit, enable/disable, delete downstream MCP servers (command, one argument per line, environment JSON, timeout, retry attempts, circuit breaker threshold, fallback servers). Fields are validated before saving.
- Tool catalog tab: every tool the gateway discovered per server, with the ON/OFF state from the active project policy and a filter box. Read from `~/.common-mcp/tool-catalog.json`, which the gateway writes.
- Gate tab: registered projects and the unknown project defaults (read-only, the policy files are edited by hand or by other tools).
- Settings tab: global defaults and logging (read-only).
- Status bar: live WebSocket connection, config path, tool catalog age, config file problems.
- Live updates: external changes to the config or the catalog (gateway, other tools, manual edit) appear without reload.

## Safe saving

The API and the live socket only answer requests from localhost with a localhost `Host` and the bundled UI `Origin`, so a web page the browser has open cannot read or change the configuration. `GATEWAY_MANAGER_ALLOW_REMOTE=true` is refused unless `GATEWAY_MANAGER_SECRET` is set.

Saving always re-reads the file from disk and changes only the edited server, so the `gate` section, logging, health checks and any other fields written by other tools are preserved. The file is replaced atomically and the previous content is kept as `config.json.bak`. The legacy `retries` field is stored as `retryAttempts`; the gateway accepts both when loading.

## Start

Windows:

```bat
start-gateway-manager.cmd
```

Linux, macOS, Git Bash:

```bash
./start-gateway-manager.sh            # add --no-open to skip opening the browser
```

Both scripts install missing dependencies, start the backend (`http://127.0.0.1:1525`) and the frontend (`http://localhost:5173`). The bash script stops both on Ctrl+C. If the script is not executable: `chmod +x start-gateway-manager.sh`.

Manual start:

```bash
cd gateway-manager/backend && npm install && npm run dev
cd gateway-manager/frontend && npm install && npm run dev
```

PM2: `pm2 start ecosystem.config.js` (processes `gateway-manager-backend`, `gateway-manager-frontend`).

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `COMMON_MCP_CONFIG` | `~/.common-mcp/config.json` | Config file to edit |
| `COMMON_MCP_TOOL_CATALOG` | `~/.common-mcp/tool-catalog.json` | Catalog file to display |
| `PORT` | `1525` | Backend port (the Vite proxy in `frontend/vite.config.ts` expects 1525) |
| `GATEWAY_MANAGER_ALLOW_REMOTE` | `false` | Allow non-localhost clients |
| `GATEWAY_MANAGER_SECRET` | none | Bearer token required by `/api`; the bundled frontend does not send it, so leave it unset for local use |

## API

`GET /api/status`, `GET /api/config`, `POST /api/config`, `PUT /api/config/server/:id`, `DELETE /api/config/server/:id`, `PATCH /api/config/server/:id/toggle`, `GET /api/config/validate`, `GET /api/tool-catalog`. Errors return `{ "error": "..." }` with a readable message.

## When changes take effect

The gateway watches the config file and reloads it: enabling, disabling, adding or removing servers and the tool list update while it runs. Changing the command or arguments of a server whose connection is already open takes effect after that connection is closed (disable and enable it) or after the gateway restarts. Some IDE clients cache the tool list until they refresh it.

## Tests

```bash
cd gateway-manager/backend && npm test
```

The tests start the backend on port 15251 against a temporary config and delete it afterwards.
