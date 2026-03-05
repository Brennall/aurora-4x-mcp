import 'reflect-metadata';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import { initDb } from './db';
import { registerTools } from './tools';
import { registerResources } from './resources';
import { registerPrompts } from './prompts';
import logger from './utils/logger';
import { enableToolCallLogging } from './utils/toolLogger';  // <-- NEW

dotenv.config();
logger.info('Environment variables loaded');

try {
  initDb();
  logger.info('Database initialized successfully');
} catch (error) {
  logger.error('Failed to initialize database', error);
  process.exit(1);
}

const server = new McpServer({
  name: 'aurora-4x-mcp',
  version: '1.0.0',
});

logger.info('MCP Server created');

// Enable tool call logging BEFORE registering tools
enableToolCallLogging(server);  // <-- NEW
logger.info('Tool call logging enabled');

try {
  registerResources(server);
  logger.info('Resources registered successfully');

  registerTools(server);
  logger.info('Tools registered successfully');

  registerPrompts(server);
  logger.info('Prompts registered successfully');
} catch (error) {
  logger.error('Failed to register server components', error);
  process.exit(1);
}

const transport = new StdioServerTransport();

try {
  server.connect(transport);
  logger.info('Server connected successfully');
} catch (error) {
  logger.error('Failed to connect server', error);
  process.exit(1);
}
