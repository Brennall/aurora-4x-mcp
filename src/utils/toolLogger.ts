import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Create dedicated tool call log directory
const logsDir = path.join('C:\\Aurora-4X-MCP', 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Dedicated logger for tool calls — separate from the main application logger
const toolCallLogger = winston.createLogger({
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
      maxsize: 10485760, // 10MB
      maxFiles: 10,
    }),
  ],
});

/**
 * Wraps the server.tool() method to log every tool call with parameters,
 * execution time, and success/error status.
 *
 * Call this BEFORE registerTools(server) in app.ts.
 * No changes needed to individual tool files.
 */
export function enableToolCallLogging(server: McpServer): void {
  const originalTool = server.tool.bind(server);

  // Override server.tool to wrap each handler with logging
  server.tool = function (
    name: string,
    description: string,
    schema: any,
    handler: (...args: any[]) => Promise<any>
  ) {
    const wrappedHandler = async (...args: any[]) => {
      const startTime = Date.now();
      const params = args[0] || {};

      // Log the call with parameters (truncate SQL to keep logs readable)
      const paramSummary = summariseParams(name, params);
      toolCallLogger.info(`CALL | ${name} | ${paramSummary}`);

      try {
        const result = await handler(...args);
        const duration = Date.now() - startTime;
        const isError = result?.isError === true;
        const status = isError ? 'ERROR' : 'OK';

        // Estimate response size from content
        const responseSize = estimateResponseSize(result);

        toolCallLogger.info(
          `RESULT | ${name} | ${status} | ${duration}ms | ${responseSize}`
        );

        return result;
      } catch (err: unknown) {
        const duration = Date.now() - startTime;
        const error = err as Error;
        toolCallLogger.info(
          `RESULT | ${name} | EXCEPTION | ${duration}ms | ${error.message}`
        );
        throw err;
      }
    };

    // Call the original server.tool with the wrapped handler
    return originalTool(name, description, schema, wrappedHandler);
  } as typeof server.tool;
}

/**
 * Summarise parameters for logging. Truncates SQL queries and large values.
 */
function summariseParams(toolName: string, params: Record<string, any>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (key === 'sql' && typeof value === 'string') {
      // Truncate SQL to first 200 chars for readability
      const truncated =
        value.length > 200 ? value.substring(0, 200) + '...' : value;
      // Collapse whitespace for single-line logging
      parts.push(`sql="${truncated.replace(/\s+/g, ' ').trim()}"`);
    } else if (typeof value === 'string' && value.length > 100) {
      parts.push(`${key}="${value.substring(0, 100)}..."`);
    } else {
      parts.push(`${key}=${JSON.stringify(value)}`);
    }
  }

  return parts.join(' | ') || '(no params)';
}

/**
 * Estimate response size for logging without serialising the full response.
 */
function estimateResponseSize(result: any): string {
  try {
    if (!result?.content) return 'no content';
    const textContent = result.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text || '')
      .join('');
    const bytes = Buffer.byteLength(textContent, 'utf8');
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1048576).toFixed(1)}MB`;
  } catch {
    return 'unknown size';
  }
}
