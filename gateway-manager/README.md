# Common MCP Gateway Manager

A web-based configuration management interface for the Common MCP Gateway. Manage all your downstream MCP servers through an intuitive web interface.

## ⚠️ Important: Restart Required

After making configuration changes through this UI, **you MUST restart Windsurf IDE** for changes to take effect. The Gateway needs to reload the updated configuration file.

## Features

- **View all downstream MCP servers** from Common MCP configuration
- **Inline editing** - Edit forms appear below selected server (better UX)
- **Enable/Disable toggle** for each MCP server
- **Add new MCP servers** with full configuration support
- **Advanced settings**: Timeout, retry, circuit breaker, fallback servers
- **Live configuration reload** via WebSocket (no restart needed)
- **Real-time updates** when config file changes externally
- **Dark mode UI** with Tailwind CSS
- **PM2 auto-start support** for production deployment

## Architecture

```
gateway-manager/
├── backend/           # Express + Socket.io server
│   ├── src/
│   │   └── server.ts  # API endpoints + config management
│   ├── package.json
│   └── tsconfig.json
└── frontend/          # React + Vite application
    ├── src/
    │   ├── App.tsx    # Main UI component
    │   ├── main.tsx   # Entry point
    │   └── index.css  # Tailwind styles
    ├── package.json
    └── vite.config.ts
```

## Prerequisites

- Node.js 18+ (LTS)
- npm or yarn
- Common MCP Gateway installed and configured
- Configuration file at: `C:\Users\[username]\.common-mcp\config.json`

## Installation

### Backend Setup

```bash
cd marketplace/backend
npm install
npm run build
```

### Frontend Setup

```bash
cd marketplace/frontend
npm install
```

## Usage

### Start Backend (Port 1525)

```bash
cd marketplace/backend
npm run dev
```

The backend API will be available at `http://127.0.0.1:1525`

### Start Frontend (Port 5173)

In a separate terminal:

```bash
cd marketplace/frontend
npm run dev
```

The UI will be available at `http://localhost:5173`

### PM2 Auto-Start (Recommended for Production)

```bash
# Install PM2 globally (if not installed)
npm install -g pm2

# From Common MCP root directory
pm2 start ecosystem.config.js

# View status
pm2 status

# View logs
pm2 logs mcp-marketplace-backend
pm2 logs mcp-marketplace-frontend

# Enable startup on system boot
pm2 startup
pm2 save
```

### Access the UI

1. Open `http://localhost:5173` in your browser
2. The UI will automatically load your Common MCP configuration
3. Changes made in the UI are saved to: `C:\Users\[username]\.common-mcp\config.json`
4. **Important**: The UI edits the Common MCP config, NOT Windsurf's `mcp_config.json`

## API Endpoints

### GET /api/config
Get the current Common MCP configuration.

**Response:**
```json
{
  "common-mcp": {
    "version": "1.0.0",
    "globalDefaults": {
      "timeout": 30000,
      "retryAttempts": 3,
      "retryDelay": 1000,
      "circuitBreaker": {
        "enabled": true,
        "failureThreshold": 5,
        "resetTimeout": 60000
      }
    },
    "downstreamServers": {
      "server-name": {
        "command": "npx",
        "args": ["-y", "package-name"],
        "env": {},
        "disabled": false,
        "timeout": 30000,
        "retries": 3
      }
    }
  }
}
```

### POST /api/config
Save the entire Common MCP configuration.

**Request Body:**
```json
{
  "common-mcp": {
    "downstreamServers": { ... }
  }
}
```

### PUT /api/config/server/:serverId
Create or update a specific MCP server.

**Request Body:**
```json
{
  "command": "npx",
  "args": ["-y", "package-name"],
  "env": {"API_KEY": "value"},
  "disabled": false
}
```

### PATCH /api/config/server/:serverId/toggle
Toggle the enabled/disabled state of a server.

**Response:**
```json
{
  "success": true,
  "disabled": true
}
```

### DELETE /api/config/server/:serverId
Remove a server from the configuration.

## WebSocket Events

### Connection
```javascript
const socket = io('http://localhost:1525');
```

### Event: `configUpdate`
Emitted when the configuration changes (either from UI or external file edit).

```javascript
socket.on('configUpdate', (newConfig) => {
  console.log('Configuration updated:', newConfig);
});
```

## Configuration Validation

The backend uses Zod schemas to validate all configuration changes:

```typescript
const MCPServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  disabled: z.boolean().optional(),
  disabledTools: z.array(z.string()).optional(),
  timeout: z.number().min(1000).max(300000).optional(),
  retries: z.number().min(0).max(10).optional(),
  circuitBreakerThreshold: z.number().min(1).max(100).optional(),
  fallbackServers: z.array(z.string()).optional()
});
```

Invalid configurations are rejected with a 400 error.

## Security

- **Localhost only**: Backend binds to `127.0.0.1` to prevent external access
- **CORS**: Restricted to frontend origin (`http://localhost:5173`)
- **Helmet**: Security headers with CSP
- **Input validation**: Zod schemas on all endpoints
- **No authentication needed**: Safe for local-only use

## Port Information

- **Backend**: `1525` (localhost only)
- **Frontend**: `5173` (Vite dev server)

Port 1525 is in the dynamic/private range and generally unused by common services.

## Development

### Backend Development Mode

```bash
cd marketplace/backend
npm run dev  # Watches for changes and reloads
```

### Frontend Development Mode

```bash
cd marketplace/frontend
npm run dev  # Hot module replacement enabled
```

### Build for Production

**Backend:**
```bash
cd marketplace/backend
npm run build
npm start
```

**Frontend:**
```bash
cd marketplace/frontend
npm run build
# Serve the dist/ folder with any static file server
```

## Troubleshooting

### Backend won't start

- Check if port 1525 is available: `netstat -ano | findstr :1525`
- Verify Common MCP config path exists: `C:\Users\[username]\.common-mcp\config.json`
- Backend auto-creates default config if missing
- Check backend logs for errors

### Frontend can't connect to backend

- Ensure backend is running on port 1525
- Check CORS settings in `backend/src/server.ts`
- Verify Vite proxy configuration in `frontend/vite.config.ts`

### Configuration not saving

- Check file permissions for `C:\Users\[username]\.common-mcp\config.json`
- Verify JSON syntax matches Common MCP format
- Check backend console for Zod validation errors
- Ensure `downstreamServers` structure is correct

### Live reload not working

- Ensure WebSocket connection is established
- Check browser console for Socket.io errors
- Verify chokidar is watching the correct file path

## Technology Stack

### Backend
- **Express**: Web framework
- **Socket.io**: Real-time WebSocket communication
- **Chokidar**: File system watching
- **Zod**: Schema validation
- **Helmet**: Security middleware
- **CORS**: Cross-origin resource sharing

### Frontend
- **React 18**: UI framework
- **Vite**: Build tool and dev server
- **TanStack Query**: Data fetching and caching
- **Socket.io-client**: WebSocket client
- **Tailwind CSS**: Utility-first styling
- **TypeScript**: Type safety

## Advanced Configuration

The Marketplace UI supports advanced MCP server settings:

### Timeout Configuration
- **Default:** 30000 ms (30 seconds)
- **Range:** 1000-300000 ms
- **Purpose:** Maximum time to wait for MCP server response

### Retry Configuration
- **Default:** 3 retries
- **Range:** 0-10 retries
- **Purpose:** Number of retry attempts on failure with exponential backoff

### Circuit Breaker
- **Default:** 5 failures
- **Range:** 1-100 failures
- **Purpose:** Open circuit after N consecutive failures to prevent cascade failures

### Fallback Servers
- **Format:** Comma-separated server IDs
- **Example:** `backup-server-1, backup-server-2`
- **Purpose:** Alternative servers to use when primary fails

### Configuration Example

```json
{
  "common-mcp": {
    "downstreamServers": {
      "my-server": {
        "command": "npx",
        "args": ["-y", "my-package"],
        "timeout": 60000,
        "retries": 5,
        "circuitBreakerThreshold": 10,
        "fallbackServers": ["backup-server"],
        "disabled": false
      }
    }
  }
}
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

Apache License 2.0

## Links

- [Common MCP Gateway](../README.md)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Windsurf IDE](https://codeium.com/windsurf)
- [Cursor AI IDE](https://cursor.sh/)
