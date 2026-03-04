import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../db';

export const registerQueryTool = (server: McpServer) => {
  server.tool(
    'query',
    'Execute a raw SQL query against the Aurora 4X SQLite database. Takes a single sql string parameter. SELECT queries return an array of row objects; non-SELECT statements return the run result. Use this as a fallback when the structured tools (getEmpirePopulation, getResearchStatus, getShipyardStatus, etc.) do not cover the data needed — for example, querying installation counts, component stockpiles, or individual ship details. Important: CTEs (WITH ... AS) are not supported by this connection; use inline subqueries instead. Always filter by GameID to avoid returning data from other campaigns in the database.',
    { sql: z.string() },
    async ({ sql }) => {
      const db = getDb();
      try {
        const stmt = db.prepare(sql);
        let results;

        // Check if the statement is a SELECT query
        const isSelect = sql.trim().toLowerCase().startsWith('select');

        if (isSelect) {
          results = stmt.all();
        } else {
          results = stmt.run();
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (err: unknown) {
        const error = err as Error;
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      } finally {
        db.close();
      }
    }
  );
};

