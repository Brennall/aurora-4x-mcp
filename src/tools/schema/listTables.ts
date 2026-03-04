import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../../db';

export const registerListTablesTool = (server: McpServer) => {
  server.tool('listTables', 'List all table names in the Aurora 4X SQLite database. Takes no parameters. Returns a flat array of table names (both DIM_ dimension/lookup tables and FCT_ fact/data tables) plus a usage hint pointing to getTableDetails. Use this as a starting point when you need to discover which tables exist before writing a raw SQL query. Does not return column information — use getTableDetails for that, or searchColumns to find a column by name across all tables.', {}, async () => {
    const db = getDb();
    try {
      const tables = db
        .prepare(
          `SELECT name FROM sqlite_master 
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`
        )
        .all() as { name: string }[];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                tables: tables.map((t) => t.name),
                usage:
                  'Use the getTableDetails tool to get more information about a specific table',
              },
              null,
              2
            ),
          },
        ],
      };
    } finally {
      db.close();
    }
  });
};

