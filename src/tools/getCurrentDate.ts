import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../db';
import { convertAuroraDateTime } from '../utils/dateUtils';

export const registerGetCurrentDateTool = (server: McpServer) => {
  server.tool(
    'getCurrentDate',
    'Get the current in-game date for a specific game. Returns three formats: raw GameTime (seconds since epoch — use this value as lastGameTime input for getEventLog), calculated date components (year, month, day, hours, minutes, seconds), and a formatted human-readable date string. This is typically the first tool called in any session to establish current game state. GameID must be resolved dynamically — the database contains multiple campaigns.',
    { gameId: z.number() },
    async ({ gameId }) => {
      const db = getDb();
      try {
        const result = db
          .prepare('SELECT GameTime, StartYear FROM FCT_Game WHERE GameID = ?')
          .get(gameId) as { GameTime: number; StartYear: number } | undefined;

        if (!result) {
          return {
            content: [
              {
                type: 'text',
                text: `Error: No game data found for GameID ${gameId}`,
              },
            ],
            isError: true,
          };
        }

        const { GameTime, StartYear } = result;
        const dateTime = convertAuroraDateTime(GameTime, StartYear);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(dateTime, null, 2),
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

