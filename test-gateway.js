// Quick test for Common MCP Gateway tools listing
const { spawn } = require('child_process');

console.log('Starting Common MCP Gateway test...');

const gateway = spawn('node', ['dist/index.js'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe']
});

let stdoutBuffer = '';
let stderrBuffer = '';

gateway.stdout.on('data', (data) => {
  const chunk = data.toString();
  console.log('[GATEWAY STDOUT]', chunk);
  stdoutBuffer += chunk;
});

gateway.stderr.on('data', (data) => {
  const chunk = data.toString();
  console.log('[GATEWAY STDERR]', chunk);
  stderrBuffer += chunk;
});

gateway.on('exit', (code) => {
  console.log('[GATEWAY EXIT]', code);
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

  console.log('[SEND INITIALIZE]', JSON.stringify(initRequest, null, 2));
  gateway.stdin.write(JSON.stringify(initRequest) + '\n');

  // Send initialized notification
  setTimeout(() => {
    const initialized = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    };
    console.log('[SEND INITIALIZED]');
    gateway.stdin.write(JSON.stringify(initialized) + '\n');

    // Send tools/list request
    setTimeout(() => {
      const listRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      };

      console.log('[SEND TOOLS/LIST]', JSON.stringify(listRequest, null, 2));
      gateway.stdin.write(JSON.stringify(listRequest) + '\n');
    }, 1000);
  }, 1000);
}, 2000);

// Exit after 15s
setTimeout(() => {
  console.log('Test timeout - killing gateway');
  gateway.kill();
}, 15000);
