import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../../db';

interface MineralRow {
    Duranium: number;
    DurDelta: number;
    Neutronium: number;
    NeutDelta: number;
    Corbomite: number;
    CorbDelta: number;
    Tritanium: number;
    TritDelta: number;
    Boronide: number;
    BorDelta: number;
    Mercassium: number;
    MercDelta: number;
    Vendarite: number;
    VendDelta: number;
    Sorium: number;
    SorDelta: number;
    Uridium: number;
    UridDelta: number;
    Corundium: number;
    CorDelta: number;
    Gallicite: number;
    GallDelta: number;
}

interface GameDateRow {
    gameDate: string;
}

const MINERAL_NAMES = [
    'Duranium',
    'Neutronium',
    'Corbomite',
    'Tritanium',
    'Boronide',
    'Mercassium',
    'Vendarite',
    'Sorium',
    'Uridium',
    'Corundium',
    'Gallicite',
] as const;

const DELTA_KEYS = [
    'DurDelta',
    'NeutDelta',
    'CorbDelta',
    'TritDelta',
    'BorDelta',
    'MercDelta',
    'VendDelta',
    'SorDelta',
    'UridDelta',
    'CorDelta',
    'GallDelta',
] as const;

export const registerGetEmpireMineralsTool = (server: McpServer) => {
    server.tool(
        'getEmpireMinerals',
        'Get the current mineral status for a specific game and race',
        {
            gameId: z.number(),
            raceId: z.number(),
            colony: z.string().optional(),
        },
        async ({ gameId, raceId, colony }) => {
            const db = getDb();
            try {
                const colonyName = colony || 'Earth';

                // Get mineral stockpiles with deltas
                const row = db
                    .prepare(
                        `SELECT
                            p.Duranium,      p.Duranium - p.LastDuranium as DurDelta,
                            p.Neutronium,    p.Neutronium - p.LastNeutronium as NeutDelta,
                            p.Corbomite,     p.Corbomite - p.LastCorbomite as CorbDelta,
                            p.Tritanium,     p.Tritanium - p.LastTritanium as TritDelta,
                            p.Boronide,      p.Boronide - p.LastBoronide as BorDelta,
                            p.Mercassium,    p.Mercassium - p.LastMercassium as MercDelta,
                            p.Vendarite,     p.Vendarite - p.LastVendarite as VendDelta,
                            p.Sorium,        p.Sorium - p.LastSorium as SorDelta,
                            p.Uridium,       p.Uridium - p.LastUridium as UridDelta,
                            p.Corundium,     p.Corundium - p.LastCorundium as CorDelta,
                            p.Gallicite,     p.Gallicite - p.LastGallicite as GallDelta
                        FROM FCT_Population p
                        WHERE p.RaceID = ?
                        AND p.GameID = ?
                        AND p.PopName = ?`
                    )
                    .get(raceId, gameId, colonyName) as MineralRow | undefined;

                if (!row) {
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `Error: No mineral data found for colony '${colonyName}' (RaceID ${raceId}, GameID ${gameId})`,
                            },
                        ],
                        isError: true,
                    };
                }

                // Get game date for context
                const dateRow = db
                    .prepare(
                        `SELECT date('2050-01-01', CAST(ROUND(GameTime/86400) AS INTEGER) || ' days') as gameDate
                        FROM FCT_Game
                        WHERE GameID = ?`
                    )
                    .get(gameId) as GameDateRow | undefined;

                // Transform wide row into key-value array
                // This eliminates column adjacency confusion (e.g. Corbomite/Corundium swap)
                const minerals = MINERAL_NAMES.map((name, i) => ({
                    name,
                    stock: Math.round(row[name as keyof MineralRow] as number),
                    delta: Math.round(row[DELTA_KEYS[i] as keyof MineralRow] as number),
                }));

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    colony: colonyName,
                                    gameDate: dateRow?.gameDate || 'unknown',
                                    minerals,
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
