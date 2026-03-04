import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../db';

interface ShipyardRow {
    name: string;
    type: string;
    capacity: number;
    slipways: number;
    taskType: number;
    task: string;
    requiredBP: number;
    completedBP: number;
    percentComplete: number | null;
    remainingBP: number;
}

interface BuildTaskRow {
    shipyard: string;
    unitName: string;
    className: string;
    totalBP: number;
    completedBP: number;
    percentComplete: number | null;
    remainingBP: number;
    paused: number;
}

export const registerGetShipyardStatusTool = (server: McpServer) => {
    server.tool(
        'getShipyardStatus',
        'Get shipyard status including expansions and ships under construction. Note: expansion progress is held in memory — force a game save before querying for accurate expansion data. Returns two sections: shipyards (name, type, capacity, slipways, and expansion task if active) and buildTasks (ship name, class, BP progress, percentage complete, and pause status). Covers both new construction and refits.',
        {
            gameId: z.number(),
            raceId: z.number(),
        },
        async ({ gameId, raceId }) => {
            const db = getDb();
            try {
                // Shipyard status with expansion tasks
                const shipyards = db
                    .prepare(
                        `SELECT 
                            ShipyardName as name,
                            CASE SYType 
                                WHEN 1 THEN 'Naval' 
                                WHEN 2 THEN 'Commercial' 
                                ELSE 'Unknown' 
                            END as type,
                            Capacity as capacity,
                            Slipways as slipways,
                            TaskType as taskType,
                            CASE TaskType
                                WHEN 0 THEN 'No Activity'
                                WHEN 1 THEN 'Add Slipway'
                                WHEN 2 THEN 'Add 500t Capacity'
                                WHEN 3 THEN 'Add 1,000t Capacity'
                                WHEN 4 THEN 'Add 2,000t Capacity'
                                WHEN 5 THEN 'Add 5,000t Capacity'
                                WHEN 6 THEN 'Add 10,000t Capacity'
                                WHEN 7 THEN 'Continual Capacity Upgrade'
                                WHEN 8 THEN 'Retool'
                                ELSE 'Unknown (' || TaskType || ')'
                            END as task,
                            RequiredBP as requiredBP,
                            CompletedBP as completedBP,
                            ROUND((CompletedBP / NULLIF(RequiredBP, 0)) * 100, 1) as percentComplete,
                            ROUND(RequiredBP - CompletedBP, 1) as remainingBP
                        FROM FCT_Shipyard
                        WHERE RaceID = ?
                        ORDER BY SYType, ShipyardName`
                    )
                    .all(raceId) as ShipyardRow[];

                // Ships under construction / refit
                const buildTasks = db
                    .prepare(
                        `SELECT 
                            sy.ShipyardName as shipyard,
                            syt.UnitName as unitName,
                            sc.ClassName as className,
                            syt.TotalBP as totalBP,
                            syt.CompletedBP as completedBP,
                            ROUND((syt.CompletedBP / NULLIF(syt.TotalBP, 0)) * 100, 1) as percentComplete,
                            ROUND(syt.TotalBP - syt.CompletedBP, 0) as remainingBP,
                            syt.Paused as paused
                        FROM FCT_ShipyardTask syt
                        JOIN FCT_Shipyard sy ON syt.ShipyardID = sy.ShipyardID
                        LEFT JOIN FCT_ShipClass sc ON syt.ClassID = sc.ShipClassID
                        WHERE syt.RaceID = ?
                        ORDER BY sy.ShipyardName, percentComplete DESC`
                    )
                    .all(raceId) as BuildTaskRow[];

                // Format shipyards with expansion info
                const formattedShipyards = shipyards.map((sy) => {
                    const result: Record<string, unknown> = {
                        name: sy.name,
                        type: sy.type,
                        capacity: sy.capacity,
                        slipways: sy.slipways,
                    };

                    if (sy.taskType !== 0) {
                        result.expansion = {
                            task: sy.task,
                            requiredBP: sy.requiredBP,
                            completedBP: sy.completedBP,
                            percentComplete: sy.percentComplete,
                            remainingBP: sy.remainingBP,
                        };
                    }

                    return result;
                });

                // Format build tasks
                const formattedBuildTasks = buildTasks.map((bt) => ({
                    shipyard: bt.shipyard,
                    unitName: bt.unitName,
                    className: bt.className,
                    totalBP: bt.totalBP,
                    completedBP: bt.completedBP,
                    percentComplete: bt.percentComplete,
                    remainingBP: bt.remainingBP,
                    paused: bt.paused === 1,
                }));

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    shipyards: formattedShipyards,
                                    buildTasks: formattedBuildTasks,
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
