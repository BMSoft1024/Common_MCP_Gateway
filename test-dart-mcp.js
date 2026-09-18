// Test script for dart MCP server tools
const { spawn } = require('child_process');

console.log('Testing Dart MCP Server...');

const dartServer = spawn('G:/M_Programming/X_ENV_X/FLUTTER_SDK/flutter/bin/dart.bat', ['mcp-server'], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    DART_SDK: 'G:\\M_Programming\\X_ENV_X\\FLUTTER_SDK\\flutter\\bin\\cache\\dart-sdk'
  }
});

let stdoutBuffer = '';
let stderrBuffer = '';

dartServer.stdout.on('data', (data) => {
  const chunk = data.toString();
  console.log('[DART STDOUT]', chunk);
  stdoutBuffer += chunk;
});

dartServer.stderr.on('data', (data) => {
  const chunk = data.toString();
  console.log('[DART STDERR]', chunk);
  stderrBuffer += chunk;
});

dartServer.on('exit', (code) => {
  console.log('[DART EXIT]', code);
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

  console.log('[SEND INITIALIZE]');
  dartServer.stdin.write(JSON.stringify(initRequest) + '\n');

  // Send initialized notification
  setTimeout(() => {
    const initialized = {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {}
    };
    console.log('[SEND INITIALIZED]');
    dartServer.stdin.write(JSON.stringify(initialized) + '\n');

    // Send tools/list request
    setTimeout(() => {
      const listRequest = {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      };

      console.log('[SEND TOOLS/LIST]');
      dartServer.stdin.write(JSON.stringify(listRequest) + '\n');
    }, 1000);
  }, 1000);
}, 2000);

// Exit after 10s
setTimeout(() => {
  console.log('Test timeout - killing dart server');
  dartServer.kill();
}, 10000);
