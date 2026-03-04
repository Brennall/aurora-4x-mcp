import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../db';

interface EventLogEntry {
    date: string;
    eventType: string;
    eventTypeId: number;
    message: string;
    eventTime: number;
}

export const registerGetEventLogTool = (server: McpServer) => {
    server.tool(
        'getEventLog',
        'Get game events since a given time. Filters noise events and enforces race/game safety. If lastGameTime is omitted, returns the last 50 events. Output includes: date, eventType (human-readable), eventTypeId (for classification), message text, and eventTime (use newestEventTime as lastGameTime for next session). Noise events excluded: scientist experience, routine fleet movements, and other high-frequency low-value events.',
        {
            gameId: z.number(),
            raceId: z.number(),
            lastGameTime: z.number().optional(),
        },
        async ({ gameId, raceId, lastGameTime }) => {
            const db = getDb();
            try {
                // Noise event types to exclude:
                // 372, 292, 370 (Scientist Experience), 371, 280, 289, 253, 98, 291, 41
                const NOISE_EVENTS = [372, 292, 370, 371, 280, 289, 253, 98, 291, 41];
                const noisePlaceholders = NOISE_EVENTS.map(() => '?').join(',');

                let events: EventLogEntry[];

                if (lastGameTime !== undefined) {
                    // Standard mode: events since last session
                    events = db
                        .prepare(
                            `SELECT 
                                date('2050-01-01', CAST(ROUND(gl.Time/86400) AS INTEGER) || ' days') as date,
                                det.Description as eventType,
                                gl.EventType as eventTypeId,
                                gl.MessageText as message,
                                gl.Time as eventTime
                            FROM FCT_GameLog gl
                            JOIN DIM_EventType det ON gl.EventType = det.EventTypeID
                            WHERE gl.RaceID = ?
                            AND gl.GameID = ?
                            AND gl.EventType NOT IN (${noisePlaceholders})
                            AND gl.Time > ?
                            ORDER BY gl.Time ASC`
                        )
                        .all(
                            raceId,
                            gameId,
                            ...NOISE_EVENTS,
                            lastGameTime
                        ) as EventLogEntry[];
                } else {
                    // Fallback mode: last 50 events
                    events = db
                        .prepare(
                            `SELECT 
                                date('2050-01-01', CAST(ROUND(gl.Time/86400) AS INTEGER) || ' days') as date,
                                det.Description as eventType,
                                gl.EventType as eventTypeId,
                                gl.MessageText as message,
                                gl.Time as eventTime
                            FROM FCT_GameLog gl
                            JOIN DIM_EventType det ON gl.EventType = det.EventTypeID
                            WHERE gl.RaceID = ?
                            AND gl.GameID = ?
                            AND gl.EventType NOT IN (${noisePlaceholders})
                            ORDER BY gl.Time DESC
                            LIMIT 50`
                        )
                        .all(
                            raceId,
                            gameId,
                            ...NOISE_EVENTS
                        ) as EventLogEntry[];

                    // Reverse to chronological order
                    events.reverse();
                }

                const oldestTime = events.length > 0 ? events[0].eventTime : null;
                const newestTime = events.length > 0 ? events[events.length - 1].eventTime : null;

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    events,
                                    eventCount: events.length,
                                    oldestEventTime: oldestTime,
                                    newestEventTime: newestTime,
                                },
                                null,
                                2
                            ),
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
