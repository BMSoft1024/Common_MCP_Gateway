const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

async function main() {
  console.log('🔍 Starting tool availability check...');

  const transport = new StdioClientTransport({
    command: 'node',
    args: ['g:/M_Programming/AI_Project/BMSoft1024_Common_MCP/main/Common_MCP/dist/index.js'],
    env: process.env
  });

  const client = new Client(
    {
      name: 'tool-checker',
      version: '1.0.0'
    },
    {
      capabilities: {}
    }
  );

  try {
    await client.connect(transport);
    console.log('✅ Connected to gateway');

    const toolsResult = await client.listTools();
    const toolNames = toolsResult.tools.map((t) => t.name).sort();
    console.log(`📋 Tools available (${toolNames.length}):`);
    console.log(toolNames.join(', '));

    const requiredTools = [
      'fetch__fetch',
      'open-websearch__search',
      'open-websearch__fetchLinuxDoArticle',
      'open-websearch__fetchCsdnArticle',
      'open-websearch__fetchGithubReadme',
      'open-websearch__fetchJuejinArticle'
    ];

    for (const tool of requiredTools) {
      if (!toolNames.includes(tool)) {
        throw new Error(`Missing required tool: ${tool}`);
      }
    }
    console.log('✅ All required tools are present');

    console.log('🌐 Calling fetch__fetch...');
    const fetchResult = await client.callTool({
      name: 'fetch__fetch',
      arguments: {
        url: 'https://example.com',
        max_length: 200
      }
    });
    console.log('fetch__fetch result snippet:', JSON.stringify(fetchResult, null, 2).slice(0, 400));

    console.log('🔎 Calling open-websearch__search...');
    const searchResult = await client.callTool({
      name: 'open-websearch__search',
      arguments: {
        query: 'Model Context Protocol news',
        engines: ['duckduckgo'],
        limit: 3
      }
    });
    console.log('open-websearch__search result snippet:', JSON.stringify(searchResult, null, 2).slice(0, 400));

    console.log('✅ Tool check completed successfully');
  } catch (error) {
    console.error('❌ Tool check failed:', error);
    process.exitCode = 1;
  } finally {
    await client.close();
  }
}

main();
