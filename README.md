# Common MCP Gateway

One MCP (Model Context Protocol) endpoint for all your MCP servers. Add your servers once, use them from every AI client (Claude Desktop, Devin, Cursor, Windsurf, VS Code, ...) and every project, with per-project tool filtering, timeouts, retries and circuit breakers.

## Features

- **Aggregates many MCP servers** under a single endpoint, tools are exposed as `serverId__toolName`
- **Shared background daemon**: every downstream server runs once, however many clients are open (see below)
- **Lazy start and tool cache**: servers start on the first tool call, the tool list comes from a disk cache
- **Per-project policy (gate)**: enable or disable servers and single tools per project
- **Timeout watchdog, exponential backoff retry with jitter, circuit breaker** (Closed / Open / Half-Open), optional fallback servers
- **Live config reload** when `config.json` or a project policy changes
- **Gateway Manager**: web UI to edit servers, tools and policies
- **Structured JSON logging** (Winston, daily rotation)
- Windows friendly: no empty console windows, whole process trees are cleaned up on exit

## Installation

Requires Node.js 18 or newer.

```bash
cd Common_MCP
npm install
npm run build
```

Optionally install the `common-mcp` command globally:

```bash
npm install -g .
```

### Configuration file

The gateway reads `~/.common-mcp/config.json` (Windows: `C:\Users\<you>\.common-mcp\config.json`), or the file named in `COMMON_MCP_CONFIG`. Start from `config/default.json`:

```bash
mkdir ~/.common-mcp
cp config/default.json ~/.common-mcp/config.json
```

```json
{
  "common-mcp": {
    "version": "1.0.0",
    "globalDefaults": {
      "timeout": 30000,
      "retryAttempts": 3,
      "retryDelay": 1000,
      "circuitBreaker": { "enabled": true, "failureThreshold": 5, "resetTimeout": 60000 }
    },
    "downstreamServers": {
      "memory": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"] }
    },
    "logging": { "level": "INFO", "format": "json", "file": "logs/common-mcp.log", "maxSize": "10MB", "maxFiles": 5 }
  }
}
```

Never put real API keys into files that are committed to git. Keep local snapshots (for example `Valid_Config.json`) out of version control, this repository ignores that file name.

## Connect your AI client

In every client, register only the gateway and disable the individual servers there, the gateway manages them.

Use the built entry point (path to your clone), or the `common-mcp` command if installed globally:

```json
{
  "mcpServers": {
    "common-mcp-gateway": {
      "command": "node",
      "args": ["/path/to/Common_MCP/dist/index.js"]
    }
  }
}
```

Where the client keeps this file:

- **Windsurf**: `~/.codeium/windsurf/mcp_config.json`
- **Cursor**: `%APPDATA%\Cursor\User\mcp.json` (Windows), `~/.config/Cursor/User/mcp.json` (Linux), `~/Library/Application Support/Cursor/User/mcp.json` (macOS)
- **Claude Desktop**: `claude_desktop_config.json`, normally in `%APPDATA%\Claude\` (Windows). The Microsoft Store build reads its own copy under `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude\`, edit that one if you installed it from the Store. Quit Claude Desktop completely before editing, it rewrites the file on exit.
- **Devin**: `%APPDATA%\devin\mcp_config.json` on Windows. Paths on other systems are not verified here, check the Devin documentation.

### Tool names

Tools are named `serverId__toolName` (double underscore), for example `time__get_current_time` or `filesystem__read_file`. Clients such as Windsurf require names matching `^[a-zA-Z0-9_-]{1,64}$`, so `/` cannot be used as a separator.

## Shared daemon mode (default)

Every client still starts the gateway with `node dist/index.js`, but that process is only a thin stdio bridge. The first bridge starts a shared background daemon on `127.0.0.1:47831`, protected by a token in `~/.common-mcp/daemon.token`, and all bridges connect to it. Each client gets its own session (own project context and policy), while every downstream server runs **once**, no matter how many clients are open. This also makes servers that accept only one connection (some Unity MCP servers, for example) usable from several clients at once.

- Downstream servers start lazily on the first tool call. The tool list comes from a cache in `~/.common-mcp/tools-cache`: 24 hours for pinned or local commands, 4 hours for unpinned launchers (`npx pkg`, `uvx pkg`, `mcp-remote` to a URL, whose tools can change without the command changing), and it is invalidated when the server command changes. Every time a server is actually started it reports its current tools, which refreshes the cache. `COMMON_MCP_TOOLS_TTL_MS` changes the default lifetime. A server that failed to start is not retried for 10 minutes.
- Idle downstream servers stop after 10 minutes (`COMMON_MCP_IDLE_MS`). The daemon exits after 15 minutes without sessions (`COMMON_MCP_DAEMON_IDLE_MS`).
- **Updates:** the daemon reports its version. A newer bridge asks an older daemon to exit and starts a fresh one, but only while no client is connected, otherwise it keeps using the running daemon (the protocol is unchanged) and prints a notice on stderr. The update is then applied when the clients are restarted. `COMMON_MCP_FORCE_DAEMON_RESTART=1` replaces a busy daemon immediately and drops its sessions.
- **Downgrades:** an older bridge never replaces a newer daemon.
- **Daemon restarts are invisible to clients:** when the daemon was restarted, updated or crashed, the bridge starts a daemon if none runs, repeats the client's `initialize` handshake on a fresh session, replays the request that found the session gone, answers requests that were in flight with a retryable error and sends `tools/list_changed`. The client keeps its connection and no manual reconnect is needed. Bridges from before this behavior (older installs) exit instead, so restart the clients once after updating.
- **Dead clients:** a session whose bridge was killed without a goodbye is closed after 3 minutes without any open connection (`COMMON_MCP_SESSION_TTL_MS`), so it cannot keep the daemon and its servers alive.
- `COMMON_MCP_PORT` changes the port. `COMMON_MCP_MODE=standalone` runs the previous in-process gateway without a daemon, which is also the automatic fallback if the daemon cannot start.
- `http://127.0.0.1:47831/health` answers `{ "ok": true }` to anyone on the machine. With the token from `~/.common-mcp/daemon.token` as `Authorization: Bearer <token>` it also shows the version, the number of sessions and the downstream connections.

## Project policy (gate)

The optional `gate` section of `config.json` decides which servers and tools a project may see:

```json
{
  "common-mcp": {
    "gate": {
      "knownProjects": { "my-project": "/path/to/my-project" },
      "unknownProjectDefaults": { "defaultAllow": true, "alwaysVisibleTools": [] }
    }
  }
}
```

- The project is detected from the client's working directory, or from `COMMON_MCP_PROJECT_PATH`. Without a match, `unknownProjectDefaults` apply and every client lists all enabled servers and tools.
- Optional strict mode for Claude Desktop (no usable working directory): set `"requireContextDeclaration": true` in the `gate` section. Claude Desktop then sees only `gate__set_project_context` (plus `alwaysVisibleTools`) until it calls that meta tool with the project root path. The default is `false`, no client has to declare a project.
- A project's policy is read from `<project>/.ai/mcp_gate_policy.json` (`defaultAllow`, per server `enabled` and per tool switches). A missing file allows everything, but a file that exists and is damaged, unreadable or carries another project's `projectId` is never treated as "no policy": a new session gets no tools until the file is fixed, and a live session keeps its previous policy.
- A downstream server marked `"projectOnly": true` is off everywhere unless a policy enables it explicitly.
- The complete tool list of all servers, including policy-disabled ones, is written to `~/.common-mcp/tool-catalog.json` for UIs.

## Downstream server options

```json
{
  "downstreamServers": {
    "server-id": {
      "command": "npx",
      "args": ["-y", "package-name"],
      "timeout": 45000,
      "retryAttempts": 3,
      "circuitBreakerThreshold": 5,
      "fallbackServers": ["other-server-id"],
      "projectOnly": false,
      "disabled": false,
      "env": { "API_KEY": "your-key-here" }
    }
  }
}
```

Timeout, retry and circuit breaker values override `globalDefaults` per server.

### Downstream server on another machine (ssh stdio)

A downstream server can run on a remote machine when `command` is `ssh` and the remote command is the server itself. The ssh process is the stdio transport, so nothing else changes for the clients:

```json
{
  "downstreamServers": {
    "nektaria-shader-lab": {
      "command": "ssh",
      "args": ["-T", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=15", "my-server", "node", "/path/on/server/mcp/server.js"],
      "timeout": 120000,
      "projectOnly": true
    }
  }
}
```

- `-T` (no terminal) and `BatchMode=yes` (no password prompt) keep the stream clean JSON-RPC, `ServerAliveInterval` detects a dead connection. ssh diagnostics go to stderr, which is separate from the JSON-RPC stdout.
- When the ssh connection drops, the connection is marked disconnected and the next call spawns a new ssh process, so a restarted remote server reconnects without restarting the gateway.
- `projectOnly: true` hides the server everywhere except in projects whose `.ai/mcp_gate_policy.json` enables it, for example `{ "servers": { "nektaria-shader-lab": { "enabled": true, "tools": {} } } }` (tools without an explicit switch follow `defaultAllow`).
- Large results (such as base64 PNGs of `capture_render`) arrive as one JSON-RPC line, raise `timeout` if the remote render is slow.

## Gateway Manager (web UI)

A web admin UI for `config.json`: add, edit, enable, disable and delete servers, browse the tool catalog, view the project policy (gate) and shared settings, with live updates over WebSocket. It edits `~/.common-mcp/config.json`, not the client's own MCP config, and keeps sections it does not know (such as `gate`).

```bash
# Windows
start-gateway-manager.cmd

# Linux, macOS, Git Bash
./start-gateway-manager.sh
```

The scripts install missing dependencies, start backend (port 1525) and frontend (port 5173) and open the browser. Manual start: `npm run dev` in `gateway-manager/backend` and `gateway-manager/frontend`. For an auto-starting setup use PM2 with `ecosystem.config.js`. Details: [docs/EN/GATEWAY_MANAGER.md](./docs/EN/GATEWAY_MANAGER.md).

## Development

```bash
npm run build     # compile TypeScript to dist/
npm run dev       # watch mode
npm test          # unit tests
npm run test:e2e  # real bridge, daemon and downstream process in an isolated HOME and port
```

## Architecture

- **Bridge** (`src/daemon/bridge.ts`): stdio to daemon proxy started by every client
- **Daemon** (`src/daemon/daemon.ts`): shared gateway, one session per client, one shared connection pool
- **Gateway** (`src/gateway/server.ts`): one client session, project policy and context
- **Tool list** (`src/gateway/tool-list.ts`) and **tool executor** (`src/gateway/tool-executor.ts`): cache backed tool list, policy check, retry, timeout and fallback for every call
- **Connection pool** (`src/gateway/connection-pool.ts`): downstream lifecycle, idle stop, process tree cleanup
- **Middleware** (`src/middleware/`): timeout watchdog, retry engine, circuit breaker
- **Utils** (`src/utils/`): config loader, policy watcher, tool catalog, tools cache, logger

More: [docs/EN/ARCHITECTURE.md](./docs/EN/ARCHITECTURE.md), Hungarian versions in [docs/HU/](./docs/HU/).

## Troubleshooting

- **A server does not start**: run its `command` and `args` by hand (for example `npx -y package-name`). A failing server is skipped for 10 minutes, delete its file from `~/.common-mcp/tools-cache` (`<id>.fail.json`) to retry at once.
- **Timeout errors**: raise `timeout` globally or per server.
- **Circuit breaker open**: wait for `resetTimeout` (60 s by default) or restart the client.
- **Changed server command has no effect**: the running daemon keeps the old process until it is idle. Stop the daemon (end its `node` process) or wait for the idle timeout.
- **A new tool of a server does not show up**: delete `~/.common-mcp/tools-cache/<id>.json`, or wait for the cache lifetime. Starting the server (any tool call) refreshes it too.
- **Logs**: `~/.common-mcp/logs/common-mcp-*.log`

## Contributing

Contributions are welcome. Fork the repository, create a feature branch, test thoroughly and open a pull request.

## License

The project is **dual-licensed**:

| Use case | License | Cost |
|---|---|---|
| Personal and private use by individuals | [AGPL v3](LICENSE-AGPL) | Free |
| Open-source projects, education, research | [AGPL v3](LICENSE-AGPL) | Free |
| Commercial or closed-source products and services | [Commercial License](LICENSE-COMMERCIAL) | Paid |

Using the gateway privately, on your own machines and projects, does not oblige you to publish anything. If you distribute it or a modified version, or offer it to others as a network service, the AGPL v3 requires publishing the corresponding source code. For closed-source or commercial use without those obligations, a commercial license is required. Contact: [support@bmsoft1024.com](mailto:support@bmsoft1024.com). See [LICENSE](LICENSE) for the full text.

## Links

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- Issues: [github.com/BMSoft1024/Common_MCP_Gateway/issues](https://github.com/BMSoft1024/Common_MCP_Gateway/issues)

## Author

**BMSoft1024** ([github.com/BMSoft1024](https://github.com/BMSoft1024))
