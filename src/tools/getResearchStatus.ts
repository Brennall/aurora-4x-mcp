import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../db';

interface ActiveResearchRow {
    scientist: string;
    field: string;
    technology: string;
    labs: number;
    rpRemaining: number;
    researchBonus: number;
    inField: string;
    multiplier: number;
    annualRP: number;
    daysRemaining: number;
    estimatedCompletion: string;
    healthRisk: number;
}

interface UnassignedScientistRow {
    name: string;
    field: string;
    researchBonus: number;
    maxLabs: number;
    healthRisk: number;
}

interface GameDateRow {
    gameDate: string;
}

export const registerGetResearchStatusTool = (server: McpServer) => {
    server.tool(
        'getResearchStatus',
        'Get current research projects with completion forecasts and unassigned scientists. Results sorted by estimated completion date. Active research includes: scientist name, specialisation field, technology name, lab count, RP remaining, research bonus, in-field status, effective multiplier, annual RP rate, days remaining, estimated completion date, and health risk level. Unassigned scientists include: name, field, research bonus, max labs capacity, and health risk. A researchBonus of 0 with high maxLabs indicates a Research Admin, not a researcher.',
        {
            gameId: z.number(),
            raceId: z.number(),
        },
        async ({ gameId, raceId }) => {
            const db = getDb();
            try {
                // Get game date
                const dateRow = db
                    .prepare(
                        `SELECT date('2050-01-01', CAST(ROUND(GameTime/86400) AS INTEGER) || ' days') as gameDate
                        FROM FCT_Game
                        WHERE GameID = ?`
                    )
                    .get(gameId) as GameDateRow | undefined;

                // Active research with completion forecasts
                // Uses confirmed formula from Research Completion Mechanics
                // Sorted by EstCompletion ASC — this is structural, not advisory
                const activeResearch = db
                    .prepare(
                        `SELECT 
                            c.Name as scientist,
                            rf.FieldName as field,
                            ts.Name as technology,
                            rp.Facilities as labs,
                            ROUND(rp.ResearchPointsRequired, 0) as rpRemaining,
                            COALESCE(MAX(CASE WHEN dbt.Description = 'Research' THEN cb.BonusValue END), 1.0) as researchBonus,
                            CASE WHEN c.ResSpecID = dt.FieldID THEN 'YES' ELSE 'NO' END as inField,
                            CASE WHEN c.ResSpecID = dt.FieldID 
                                THEN ROUND(4 * COALESCE(MAX(CASE WHEN dbt.Description = 'Research' THEN cb.BonusValue END), 1.0) - 3, 2)
                                ELSE ROUND(COALESCE(MAX(CASE WHEN dbt.Description = 'Research' THEN cb.BonusValue END), 1.0), 2)
                            END as multiplier,
                            ROUND(
                                (SELECT r.Research * g.ResearchSpeed / 100.0 
                                 FROM FCT_Race r JOIN FCT_Game g ON r.GameID = g.GameID 
                                 WHERE r.RaceID = ? AND r.GameID = ?)
                                * rp.Facilities 
                                * CASE WHEN c.ResSpecID = dt.FieldID 
                                    THEN 4 * COALESCE(MAX(CASE WHEN dbt.Description = 'Research' THEN cb.BonusValue END), 1.0) - 3
                                    ELSE COALESCE(MAX(CASE WHEN dbt.Description = 'Research' THEN cb.BonusValue END), 1.0)
                                  END
                            , 0) as annualRP,
                            ROUND(
                                rp.ResearchPointsRequired / (
                                    (SELECT r.Research * g.ResearchSpeed / 100.0 
                                     FROM FCT_Race r JOIN FCT_Game g ON r.GameID = g.GameID 
                                     WHERE r.RaceID = ? AND r.GameID = ?)
                                    * rp.Facilities 
                                    * CASE WHEN c.ResSpecID = dt.FieldID 
                                        THEN 4 * COALESCE(MAX(CASE WHEN dbt.Description = 'Research' THEN cb.BonusValue END), 1.0) - 3
                                        ELSE COALESCE(MAX(CASE WHEN dbt.Description = 'Research' THEN cb.BonusValue END), 1.0)
                                      END
                                ) * 365
                            , 0) as daysRemaining,
                            date('2050-01-01', 
                                CAST(ROUND(
                                    (SELECT GameTime FROM FCT_Game WHERE GameID = ?) / 86400
                                ) AS INTEGER) || ' days',
                                CAST(ROUND(
                                    rp.ResearchPointsRequired / (
                                        (SELECT r.Research * g.ResearchSpeed / 100.0 
                                         FROM FCT_Race r JOIN FCT_Game g ON r.GameID = g.GameID 
                                         WHERE r.RaceID = ? AND r.GameID = ?)
                                        * rp.Facilities 
                                        * CASE WHEN c.ResSpecID = dt.FieldID 
                                            THEN 4 * COALESCE(MAX(CASE WHEN dbt.Description = 'Research' THEN cb.BonusValue END), 1.0) - 3
                                            ELSE COALESCE(MAX(CASE WHEN dbt.Description = 'Research' THEN cb.BonusValue END), 1.0)
                                          END
                                    ) * 365
                                ) AS INTEGER) || ' days'
                            ) as estimatedCompletion,
                            c.HealthRisk as healthRisk
                        FROM FCT_Commander c
                        JOIN FCT_ResearchProject rp ON rp.ProjectID = c.CommandID
                        JOIN FCT_TechSystem ts ON rp.TechID = ts.TechSystemID
                        JOIN DIM_TechType dt ON ts.TechTypeID = dt.TechTypeID
                        JOIN DIM_ResearchField rf ON c.ResSpecID = rf.ResearchFieldID
                        LEFT JOIN FCT_CommanderBonuses cb ON c.CommanderID = cb.CommanderID
                        LEFT JOIN DIM_CommanderBonusType dbt ON cb.BonusID = dbt.BonusID
                        WHERE c.RaceID = ?
                        AND c.CommanderType = 3
                        AND c.CommandType = 7
                        GROUP BY c.CommanderID, c.Name, c.ResSpecID, ts.Name, dt.FieldID, 
                                 rp.Facilities, rp.ResearchPointsRequired
                        ORDER BY estimatedCompletion ASC`
                    )
                    .all(
                        raceId, gameId,  // first subquery
                        raceId, gameId,  // second subquery
                        gameId,          // GameTime subquery
                        raceId, gameId,  // third subquery
                        raceId           // WHERE clause
                    ) as ActiveResearchRow[];

                // Unassigned scientists
                const unassigned = db
                    .prepare(
                        `SELECT 
                            c.Name as name,
                            rf.FieldName as field,
                            COALESCE(MAX(CASE WHEN dbt.Description = 'Research' THEN cb.BonusValue END), 0) as researchBonus,
                            COALESCE(MAX(CASE WHEN dbt.Description = 'Research Admin' THEN cb.BonusValue END), 0) as maxLabs,
                            c.HealthRisk as healthRisk
                        FROM FCT_Commander c
                        JOIN DIM_ResearchField rf ON c.ResSpecID = rf.ResearchFieldID
                        LEFT JOIN FCT_CommanderBonuses cb ON c.CommanderID = cb.CommanderID
                        LEFT JOIN DIM_CommanderBonusType dbt ON cb.BonusID = dbt.BonusID
                        WHERE c.RaceID = ?
                        AND c.Deceased = 0
                        AND c.CommanderType = 3
                        AND c.CommandType = 0
                        GROUP BY c.CommanderID, c.Name, rf.FieldName
                        ORDER BY researchBonus DESC`
                    )
                    .all(raceId) as UnassignedScientistRow[];

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(
                                {
                                    gameDate: dateRow?.gameDate || 'unknown',
                                    activeResearch,
                                    unassignedScientists: unassigned,
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
