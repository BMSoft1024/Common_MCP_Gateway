# Common MCP Gateway Manager - User Guide

## Overview

The Common MCP Gateway includes a web-based admin interface for managing downstream MCP servers. This Gateway Manager allows you to easily add, modify, and delete MCP servers.

## ⚠️ IMPORTANT: Restart Required

**After ANY configuration change (enable/disable, add, edit, delete), you MUST restart Windsurf IDE** for the changes to take effect. The Gateway loads configuration on startup and does not hot-reload.

## Features

### Core Features
- **View all servers**: Complete list of downstream servers
- **Inline editing**: Edit forms appear below the selected server (better UX)
- **Enable/Disable**: Toggle servers on/off with a single click
- **Add servers**: Quick addition of new MCP servers
- **Delete servers**: Remove servers with confirmation

### Advanced Features
- **Timeout configuration**: 1000-300000 ms range (default: 30000)
- **Retry attempts**: 0-10 retries (default: 3)
- **Circuit breaker**: 1-100 failure threshold (default: 5)
- **Fallback servers**: Specify alternative servers on failure
- **Live updates**: WebSocket-based real-time synchronization
- **Auto-save**: Changes are saved immediately
- **No restart required**: Config changes apply instantly

## Installation and Startup

### Prerequisites
- Node.js 18+ (LTS version)
- npm or yarn
- Common MCP Gateway installed and configured

### Manual Start (Development)

**Terminal 1 - Backend:**
```bash
cd gateway-manager/backend
npm install
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd gateway-manager/frontend
npm install
npm run dev
```

**Access:** http://localhost:5173

### PM2 Auto-Start (Recommended)

Use PM2 process manager for production environments:

```bash
# Install PM2 (if not installed)
npm install -g pm2

# From Common MCP root directory
pm2 start ecosystem.config.js

# Check status
pm2 status

# View logs
pm2 logs gateway-manager-backend
pm2 logs gateway-manager-frontend

# Stop all
pm2 stop all

# Enable auto-start on system boot
pm2 startup
pm2 save
```

## Configuration Location

**IMPORTANT:** The Gateway Manager edits this file:

**Windows:**
```
C:\Users\[username]\.common-mcp\config.json
```

**Linux/macOS:**
```
~/.common-mcp/config.json
```

**NOT** the Windsurf config file:
- Windows: `C:\Users\[username]\.codeium\windsurf\mcp_config.json`
- Linux/macOS: `~/.codeium/windsurf/mcp_config.json`

Changes are saved immediately and broadcast to all clients via WebSocket.

## Usage

### 1. Adding a New MCP Server

1. Click the **"+ Add New MCP"** button in the top right
2. Enter the server name (unique identifier)
3. Enter the command (e.g., `npx`)
4. Enter arguments separated by commas
5. Optionally set environment variables
6. Configure advanced settings (timeout, retry, etc.)
7. Click **"Save"**

### 2. Editing an Existing Server

1. Find the server you want to edit in the list
2. Click the **"Edit"** button
3. The edit form appears **directly below that server**
4. Modify the settings
5. Click **"Save"** or **"Cancel"** to discard changes

**New feature:** Edit form now appears inline below the item, not at the top of the page!

### 3. Enabling/Disabling a Server

1. Click the **"Enable"** or **"Disable"** button next to the server
2. The change takes effect immediately
3. Server status shows green (ENABLED) or red (DISABLED)

### 4. Deleting a Server

1. Click the **"Delete"** button
2. Confirm deletion in the popup dialog
3. The server is immediately removed from configuration

## Advanced Settings

### Timeout Configuration
- **Minimum:** 1000 ms (1 second)
- **Maximum:** 300000 ms (5 minutes)
- **Default:** 30000 ms (30 seconds)
- **Purpose:** Maximum wait time for MCP server response

### Retry Configuration
- **Minimum:** 0 (no retries)
- **Maximum:** 10 retries
- **Default:** 3
- **Purpose:** Number of retry attempts on failure with exponential backoff

### Circuit Breaker Threshold
- **Minimum:** 1 failure
- **Maximum:** 100 failures
- **Default:** 5
- **Purpose:** Open circuit after N consecutive failures to prevent cascade failures

### Fallback Servers
- **Format:** Comma-separated server IDs
- **Example:** `backup-server-1, backup-server-2`
- **Purpose:** Alternative servers to use when primary is unavailable

### Example Configuration

```json
{
  "common-mcp": {
    "downstreamServers": {
      "primary-server": {
        "command": "npx",
        "args": ["-y", "my-mcp-package"],
        "timeout": 60000,
        "retries": 5,
        "circuitBreakerThreshold": 10,
        "fallbackServers": ["backup-server"],
        "disabled": false
      },
      "backup-server": {
        "command": "npx",
        "args": ["-y", "my-mcp-package-backup"],
        "timeout": 45000,
        "retries": 3,
        "disabled": false
      }
    }
  }
}
```

## WebSocket Live Updates

The Marketplace UI uses WebSocket connection to the backend:
- **Port:** 1525
- **Event:** `configUpdate`
- **Behavior:** Broadcasts to all clients after every config change

**Benefits:**
- No manual refresh needed
- Multiple clients can be used simultaneously
- External file modifications appear instantly

## Troubleshooting

### Backend won't start
- Check if port 1525 is available: `netstat -ano | findstr :1525`
- Verify config file path: `C:\Users\[name]\.common-mcp\config.json`
- Backend auto-creates default config if missing
- Check backend logs

### Frontend can't connect to backend
- Ensure backend is running on port 1525
- Check CORS settings in `backend/src/server.ts`
- Verify Vite proxy configuration in `frontend/vite.config.ts`

### Configuration not saving
- Check file permissions: `C:\Users\[name]\.common-mcp\config.json`
- Verify JSON syntax is correct
- Check backend console for Zod validation errors
- Ensure `downstreamServers` structure is correct

### Live updates not working
- Verify WebSocket connection is established
- Check browser console for Socket.io errors
- Verify chokidar is watching the correct file path

### PM2 Specific Issues

**PM2 won't install:**
```bash
npm install -g pm2 --force
```

**PM2 app won't start:**
```bash
pm2 delete all
pm2 start ecosystem.config.js
pm2 logs
```

**PM2 startup error on Windows:**
```bash
# Run as administrator
pm2 startup
# Copy and run the displayed command
pm2 save
```

## Ports

- **Backend API:** 1525 (localhost only)
- **Frontend Dev Server:** 5173 (Vite)
- **WebSocket:** 1525 (same as backend)

## Security

- **Localhost only:** Backend binds to 127.0.0.1 only
- **CORS:** Restricted to frontend origin
- **Helmet:** Security headers with CSP
- **Input validation:** Zod schemas on all endpoints
- **No authentication:** Safe for local-only use

## Technology Stack

### Backend
- Express 4.x
- Socket.io 4.x
- Chokidar 3.x
- Zod 3.x
- TypeScript 5.x

### Frontend
- React 18
- Vite 5.x
- TanStack Query (React Query) 5.x
- Socket.io-client 4.x
- Tailwind CSS 3.x
- TypeScript 5.x

## Support

If you have issues with the Marketplace UI:
1. Check this documentation
2. View logs: `pm2 logs` or backend/frontend console
3. Verify config file syntax
4. Open an issue on the GitHub repository

## Release Notes

### v1.0.0 (2026-01-04)
- ✅ Config path fixed: Uses Common MCP `config.json`
- ✅ Inline edit form: Appears below item (not at top)
- ✅ PM2 auto-start support: `ecosystem.config.js`
- ✅ Full advanced settings: timeout, retry, circuit breaker, fallback
- ✅ WebSocket live updates for all changes
- ✅ Dark mode UI with Tailwind CSS
- ✅ Full API validation with Zod schemas

## Planned Features

- [ ] Server health monitoring (health check)
- [ ] Configuration import/export
- [ ] Batch operations (multiple servers at once)
- [ ] Server templates
- [ ] Metrics and statistics dashboard
- [ ] Server log viewer in UI
