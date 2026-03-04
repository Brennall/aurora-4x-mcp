import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../db';
import { convertAuroraDateTime } from '../utils/dateUtils';

export const registerGetSessionStatusTool = (server: McpServer) => {
  server.tool(
    'getSessionStatus',
    'Get a comprehensive session status report combining all startup queries into a single call. Returns gameDate, events since lastGameTime, research status with completion forecasts, industrial queue, wealth balance and trends, mineral stockpiles with deltas, shipyard status and build tasks, colony installations, health watch for at-risk officers (HealthRisk 6+), and fleet summary. This is the primary tool for session startup — call it once instead of making 10 separate queries. Requires lastGameTime from the previous session to filter events; if omitted, returns the last 50 events as fallback.',
    {
      gameId: z.number(),
      raceId: z.number(),
      lastGameTime: z.number().optional(),
    },
    async ({ gameId, raceId, lastGameTime }) => {
      const db = getDb();
      try {
        // ── 1. Game Date ──────────────────────────────────────────
        const gameDate = db
          .prepare(
            `SELECT GameName,
                    GameTime,
                    StartYear
             FROM FCT_Game
             WHERE GameID = ?`
          )
          .get(gameId) as { GameName: string; GameTime: number; StartYear: number } | undefined;

        if (!gameDate) {
          return {
            content: [{ type: 'text', text: `Error: No game found for GameID ${gameId}` }],
            isError: true,
          };
        }

        const formattedDate = convertAuroraDateTime(gameDate.GameTime, gameDate.StartYear);

        // ── 2. Event Log ──────────────────────────────────────────
        const NOISE_EVENTS = [372, 292, 370, 371, 280, 289, 253, 98, 291, 41];
        const noisePlaceholders = NOISE_EVENTS.map(() => '?').join(',');

        let events: any[];
        if (lastGameTime !== undefined) {
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
               WHERE gl.RaceID = ? AND gl.GameID = ?
                 AND gl.EventType NOT IN (${noisePlaceholders})
                 AND gl.Time > ?
               ORDER BY gl.Time ASC`
            )
            .all(raceId, gameId, ...NOISE_EVENTS, lastGameTime);
        } else {
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
               WHERE gl.RaceID = ? AND gl.GameID = ?
                 AND gl.EventType NOT IN (${noisePlaceholders})
               ORDER BY gl.Time DESC
               LIMIT 50`
            )
            .all(raceId, gameId, ...NOISE_EVENTS);
          events.reverse();
        }

        const newestEventTime =
          events.length > 0 ? events[events.length - 1].eventTime : null;

        // ── 3. Research Status ────────────────────────────────────
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
                 CAST(ROUND(? / 86400.0) AS INTEGER) || ' days',
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
             WHERE c.RaceID = ? AND c.CommanderType = 3 AND c.CommandType = 7
             GROUP BY c.CommanderID, c.Name, c.ResSpecID, ts.Name, dt.FieldID,
                      rp.Facilities, rp.ResearchPointsRequired
             ORDER BY estimatedCompletion ASC`
          )
          .all(
            raceId, gameId,     // first rate subquery
            raceId, gameId,     // second rate subquery
            gameDate.GameTime,  // date base
            raceId, gameId,     // third rate subquery
            raceId              // WHERE clause
          );

        const unassignedScientists = db
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
             WHERE c.RaceID = ? AND c.Deceased = 0
               AND c.CommanderType = 3 AND c.CommandType = 0
             GROUP BY c.CommanderID, c.Name, rf.FieldName
             ORDER BY researchBonus DESC`
          )
          .all(raceId);

        // ── 4. Industrial Queue ───────────────────────────────────
        const industrialQueue = db
          .prepare(
            `SELECT ProjectID, ProductionType, Description,
                    Amount, PartialCompletion, ProdPerUnit, Percentage, Pause, Queue
             FROM FCT_IndustrialProjects
             WHERE RaceID = ? AND GameID = ?
             ORDER BY Queue, ProductionType`
          )
          .all(raceId, gameId);

        // ── 5. Wealth ─────────────────────────────────────────────
        const wealthSummary = db
          .prepare(
            `SELECT WealthPoints as balance,
                    AnnualWealth as annualIncome
             FROM FCT_Race
             WHERE RaceID = ? AND GameID = ?`
          )
          .get(raceId, gameId);

        // Wealth history from increments
        const wealthHistory = db
          .prepare(
            `SELECT wh.IncrementTime, wh.WealthAmount,
                    LAG(wh.WealthAmount) OVER (ORDER BY wh.IncrementTime) as prevWealth
             FROM FCT_WealthHistory wh
             WHERE wh.GameID = ? AND wh.RaceID = ?
             ORDER BY wh.IncrementTime DESC
             LIMIT 20`
          )
          .all(gameId, raceId);

        // ── 6. Minerals ───────────────────────────────────────────
        const minerals = db
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
             WHERE p.RaceID = ? AND p.GameID = ?
               AND p.PopName = 'Earth'`
          )
          .get(raceId, gameId);

        // ── 7. Shipyard Status ────────────────────────────────────
        const shipyards = db
          .prepare(
            `SELECT ShipyardName,
                    CASE SYType WHEN 1 THEN 'Naval' WHEN 2 THEN 'Commercial' ELSE 'Unknown' END as type,
                    Capacity, Slipways,
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
                    RequiredBP, CompletedBP,
                    ROUND((CompletedBP / NULLIF(RequiredBP, 0)) * 100, 1) as pctComplete,
                    ROUND(RequiredBP - CompletedBP, 1) as remainingBP
             FROM FCT_Shipyard
             WHERE RaceID = ?
             ORDER BY SYType`
          )
          .all(raceId);

        const buildTasks = db
          .prepare(
            `SELECT sy.ShipyardName, syt.UnitName, sc.ClassName,
                    syt.TotalBP, syt.CompletedBP,
                    ROUND((syt.CompletedBP / NULLIF(syt.TotalBP, 0)) * 100, 1) as pctComplete,
                    ROUND(syt.TotalBP - syt.CompletedBP, 0) as remainingBP,
                    syt.Paused, syt.Freighter
             FROM FCT_ShipyardTask syt
             JOIN FCT_Shipyard sy ON syt.ShipyardID = sy.ShipyardID
             LEFT JOIN FCT_ShipClass sc ON syt.ClassID = sc.ShipClassID
             WHERE syt.RaceID = ?
             ORDER BY sy.ShipyardName, pctComplete DESC`
          )
          .all(raceId);

        // ── 8. Colony Installations ───────────────────────────────
        const installations = db
          .prepare(
            `SELECT
               p.PopName as colony,
               dpi.Name as installation,
               pi.Amount as amount
             FROM FCT_PopulationInstallations pi
             JOIN FCT_Population p ON pi.PopID = p.PopulationID
             JOIN DIM_PlanetaryInstallation dpi ON pi.PlanetaryInstallationID = dpi.PlanetaryInstallationID
             WHERE p.RaceID = ? AND p.GameID = ?
               AND pi.Amount > 0
             ORDER BY p.PopName, dpi.DisplayOrder`
          )
          .all(raceId, gameId);

        // ── 9. Health Watch ───────────────────────────────────────
        const healthWatch = db
          .prepare(
            `SELECT
               c.Name as name,
               CASE c.CommanderType
                 WHEN 0 THEN 'Naval'
                 WHEN 1 THEN 'Ground'
                 WHEN 2 THEN 'Admin'
                 WHEN 3 THEN 'Scientist'
               END as type,
               CASE c.CommandType
                 WHEN 0 THEN 'Unassigned'
                 WHEN 7 THEN 'In Lab'
                 WHEN 17 THEN 'Research Admin'
                 ELSE 'Assigned'
               END as status,
               date('2050-01-01', CAST(ROUND(c.CareerStart/86400) AS INTEGER) || ' days') as careerStart,
               ROUND((? - c.CareerStart) / 86400.0 / 365.25, 0) as yearsService,
               c.HealthRisk as healthRisk
             FROM FCT_Commander c
             WHERE c.RaceID = ?
               AND c.Deceased = 0
               AND c.HealthRisk >= 6
             ORDER BY c.HealthRisk DESC, c.CommanderType, c.CareerStart ASC`
          )
          .all(gameDate.GameTime, raceId);

        // ── 10. Fleet Summary ─────────────────────────────────────
        const fleetSummary = db
          .prepare(
            `SELECT
               sc.ClassName,
               h.Description as hullType,
               COUNT(s.ShipID) as shipCount,
               ROUND(SUM(sc.Size * 50), 0) as totalTonnage
             FROM FCT_Ship s
             JOIN FCT_ShipClass sc ON s.ShipClassID = sc.ShipClassID
             JOIN FCT_HullDescription h ON sc.HullDescriptionID = h.HullDescriptionID
             WHERE s.RaceID = ? AND s.GameID = ?
               AND s.Destroyed = 0
             GROUP BY sc.ShipClassID, sc.ClassName, h.Description
             ORDER BY totalTonnage DESC`
          )
          .all(raceId, gameId);

        const totalShips = fleetSummary.reduce(
          (sum: number, cls: any) => sum + cls.shipCount,
          0
        );

        // ── Assemble Result ───────────────────────────────────────
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  gameDate: {
                    gameName: gameDate.GameName,
                    currentDate: formattedDate.formatted,
                    gameTime: gameDate.GameTime,
                  },
                  events: {
                    entries: events,
                    count: events.length,
                    newestEventTime,
                    lastGameTimeUsed: lastGameTime ?? 'fallback-last-50',
                  },
                  research: {
                    activeResearch,
                    unassignedScientists,
                  },
                  industrialQueue,
                  wealth: {
                    summary: wealthSummary,
                    recentHistory: wealthHistory,
                  },
                  minerals,
                  shipyards: {
                    yards: shipyards,
                    buildTasks,
                  },
                  installations,
                  healthWatch,
                  fleet: {
                    totalShips,
                    classes: fleetSummary,
                  },
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
