// Quick test client for Common MCP Gateway
const { spawn } = require('child_process');

const client = spawn('C:\\Users\\mikuc\\AppData\\Roaming\\npm\\common-mcp.cmd', [], {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true
});

let buffer = '';

client.stdout.on('data', (data) => {
  buffer += data.toString();
  console.log('[STDOUT]', data.toString());
  
  // Try to parse JSON-RPC messages
  try {
    const lines = buffer.split('\n');
    for (const line of lines) {
      if (line.trim() && line.includes('{')) {
        const msg = JSON.parse(line);
        console.log('[PARSED]', JSON.stringify(msg, null, 2));
      }
    }
  } catch (e) {
    // Not yet complete JSON
  }
});

client.stderr.on('data', (data) => {
  console.log('[STDERR]', data.toString());
});

client.on('exit', (code) => {
  console.log('[EXIT]', code);
  process.exit(code);
});

// Send initialize request
setTimeout(() => {
  const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'test-client',
        version: '1.0.0'
      }
    }
  };
  
  console.log('[SEND]', JSON.stringify(initRequest));
  client.stdin.write(JSON.stringify(initRequest) + '\n');
}, 1000);

// Send tools/list after 3s
setTimeout(() => {
  const listRequest = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {}
  };
  
  console.log('[SEND]', JSON.stringify(listRequest));
  client.stdin.write(JSON.stringify(listRequest) + '\n');
}, 3000);

// Exit after 30s to allow all 11 MCPs to load
setTimeout(() => {
  console.log('[TIMEOUT] Test completed');
  client.kill();
  process.exit(0);
}, 30000);
