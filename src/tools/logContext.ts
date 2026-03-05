import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import winston from 'winston';
import path from 'path';

// Use the same log file as the tool call middleware
const logsDir = path.join('C:\\Aurora-4X-MCP', 'logs');

const contextLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, message }) => {
      return `${timestamp} ${message}`;
    })
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(logsDir, 'tool-calls.log'),
      maxsize: 10485760,
      maxFiles: 10,
    }),
  ],
});

export const registerLogContextTool = (server: McpServer) => {
  server.tool(
    'logContext',
    'Annotate the tool call log with context about why the next query is being made. ' +
      'Call this before a query to record the purpose. The annotation appears in the ' +
      'tool-calls.log alongside the actual tool call entries. Takes a single context ' +
      'string. Returns confirmation. No game data is accessed.',
    {
      context: z
        .string()
        .describe(
          'Brief description of why the next query is being made, e.g. "checking what Gas-Core Engine unlocks"'
        ),
      session: z
        .string()
        .optional()
        .describe(
          'Optional session identifier, e.g. "2026-03-04-gameplay" for grouping log entries'
        ),
    },
    async ({ context, session }) => {
      const sessionTag = session ? ` [${session}]` : '';
      contextLogger.info(`CONTEXT${sessionTag} | ${context}`);

      return {
        content: [
          {
            type: 'text' as const,
            text: 'Context logged.',
          },
        ],
      };
    }
  );
};
