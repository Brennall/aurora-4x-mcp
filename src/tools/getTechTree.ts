import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../db';

export const registerGetTechTreeTool = (server: McpServer) => {
  server.tool(
    'getTechTree',
    'Query the technology tree for a specific game and race. Three modes:\n' +
      '- "unlocks": Given a tech name, returns unresearched techs it enables (what completing this tech opens up). ' +
      'Each unlocked tech includes: name, RP cost, research field, description, and critically whether it is ' +
      'availableNow (true if all prerequisites are met) or blocked by another unresearched prerequisite. ' +
      'When blocked, the otherPrerequisite field shows the blocking tech name and its researched status. ' +
      'This is essential for research planning — a tech may appear unlocked but still be unavailable.\n' +
      '- "prerequisites": Given a tech name, returns its prerequisite techs and whether each is already researched. ' +
      'Also reports whether the tech itself is already researched and whether allPrerequisitesMet. ' +
      'Use for planning: "how far away is tech X?"\n' +
      '- "available": Returns all techs that can be researched now (all prerequisites met, not yet researched). ' +
      'Optionally filter by research field name (partial match, case-insensitive). ' +
      'Excludes RuinOnly techs. Results sorted by field then RP cost ascending. ' +
      'Use when assigning idle scientists: "what can I research next in Power and Propulsion?"\n\n' +
      'Only returns techs visible to the specified race (universal techs + race-specific). ' +
      'Excludes alien-specific technologies for spoiler safety. ' +
      'GameID must be resolved dynamically — the database contains multiple campaigns.',
    {
      gameId: z.number(),
      raceId: z.number(),
      mode: z
        .enum(['unlocks', 'prerequisites', 'available'])
        .describe(
          'Query mode: "unlocks" = what does this tech enable, ' +
            '"prerequisites" = what does this tech require, ' +
            '"available" = what can be researched now'
        ),
      techName: z
        .string()
        .optional()
        .describe(
          'Technology name to query. Required for "unlocks" and "prerequisites" modes. ' +
            'Ignored for "available" mode.'
        ),
      field: z
        .string()
        .optional()
        .describe(
          'Optional research field filter for "available" mode (e.g. "Power and Propulsion"). ' +
            'Ignored for other modes.'
        ),
    },
    async ({ gameId, raceId, mode, techName, field }) => {
      const db = getDb();

      try {
        if (mode === 'unlocks') {
          if (!techName) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: techName is required for "unlocks" mode.',
                },
              ],
              isError: true,
            };
          }

          // Find the TechSystemID for the named tech
          const sourceTech = db
            .prepare(
              `SELECT TechSystemID, Name, DevelopCost
               FROM FCT_TechSystem
               WHERE Name = ? AND (RaceID = 0 OR RaceID = ?) AND (GameID = 0 OR GameID = ?)`
            )
            .get(techName, raceId, gameId) as
            | { TechSystemID: number; Name: string; DevelopCost: number }
            | undefined;

          if (!sourceTech) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: Technology "${techName}" not found for this race.`,
                },
              ],
              isError: true,
            };
          }

          // Find all techs that have this as a prerequisite and aren't yet researched
          const unlocked = db
            .prepare(
              `SELECT ts.Name, ts.DevelopCost, ts.TechDescription, rf.FieldName,
                      ts.Prerequisite1, ts.Prerequisite2
               FROM FCT_TechSystem ts
               JOIN DIM_TechType dt ON ts.TechTypeID = dt.TechTypeID
               JOIN DIM_ResearchField rf ON dt.FieldID = rf.ResearchFieldID
               WHERE (ts.Prerequisite1 = ? OR ts.Prerequisite2 = ?)
                 AND (ts.RaceID = 0 OR ts.RaceID = ?)
                 AND (ts.GameID = 0 OR ts.GameID = ?)
                 AND ts.TechSystemID NOT IN (
                   SELECT TechID FROM FCT_RaceTech WHERE RaceID = ? AND GameID = ?
                 )
               ORDER BY ts.DevelopCost ASC`
            )
            .all(
              sourceTech.TechSystemID,
              sourceTech.TechSystemID,
              raceId,
              gameId,
              raceId,
              gameId
            ) as any[];

          // For each unlocked tech, check if the OTHER prerequisite is met
          const enriched = unlocked.map((tech: any) => {
            let otherPrereqMet = true;
            let otherPrereqName: string | null = null;

            const otherPrereq =
              tech.Prerequisite1 === sourceTech.TechSystemID
                ? tech.Prerequisite2
                : tech.Prerequisite1;

            if (otherPrereq && otherPrereq !== 0) {
              // Check if the other prerequisite is researched
              const isResearched = db
                .prepare(
                  `SELECT 1 FROM FCT_RaceTech WHERE TechID = ? AND RaceID = ? AND GameID = ?`
                )
                .get(otherPrereq, raceId, gameId);

              otherPrereqMet = !!isResearched;

              // Get the name of the other prerequisite
              const otherTech = db
                .prepare(`SELECT Name FROM FCT_TechSystem WHERE TechSystemID = ?`)
                .get(otherPrereq) as { Name: string } | undefined;

              otherPrereqName = otherTech?.Name || `Unknown (ID: ${otherPrereq})`;
            }

            return {
              name: tech.Name,
              rpCost: tech.DevelopCost,
              field: tech.FieldName,
              description: tech.TechDescription || null,
              availableNow: otherPrereqMet,
              otherPrerequisite: otherPrereqName
                ? { name: otherPrereqName, researched: otherPrereqMet }
                : null,
            };
          });

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    sourceTech: techName,
                    unlockedTechs: enriched,
                    count: enriched.length,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else if (mode === 'prerequisites') {
          if (!techName) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: 'Error: techName is required for "prerequisites" mode.',
                },
              ],
              isError: true,
            };
          }

          const tech = db
            .prepare(
              `SELECT ts.TechSystemID, ts.Name, ts.DevelopCost, ts.TechDescription,
                      ts.Prerequisite1, ts.Prerequisite2, rf.FieldName
               FROM FCT_TechSystem ts
               JOIN DIM_TechType dt ON ts.TechTypeID = dt.TechTypeID
               JOIN DIM_ResearchField rf ON dt.FieldID = rf.ResearchFieldID
               WHERE ts.Name = ? AND (ts.RaceID = 0 OR ts.RaceID = ?) AND (ts.GameID = 0 OR ts.GameID = ?)`
            )
            .get(techName, raceId, gameId) as any | undefined;

          if (!tech) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Error: Technology "${techName}" not found for this race.`,
                },
              ],
              isError: true,
            };
          }

          // Check if already researched
          const alreadyResearched = db
            .prepare(
              `SELECT 1 FROM FCT_RaceTech WHERE TechID = ? AND RaceID = ? AND GameID = ?`
            )
            .get(tech.TechSystemID, raceId, gameId);

          // Look up each prerequisite
          const prereqs: any[] = [];
          for (const prereqId of [tech.Prerequisite1, tech.Prerequisite2]) {
            if (prereqId && prereqId !== 0) {
              const prereqTech = db
                .prepare(
                  `SELECT ts.Name, ts.DevelopCost, rf.FieldName
                   FROM FCT_TechSystem ts
                   JOIN DIM_TechType dt ON ts.TechTypeID = dt.TechTypeID
                   JOIN DIM_ResearchField rf ON dt.FieldID = rf.ResearchFieldID
                   WHERE ts.TechSystemID = ?`
                )
                .get(prereqId) as any | undefined;

              const isResearched = db
                .prepare(
                  `SELECT 1 FROM FCT_RaceTech WHERE TechID = ? AND RaceID = ? AND GameID = ?`
                )
                .get(prereqId, raceId, gameId);

              prereqs.push({
                name: prereqTech?.Name || `Unknown (ID: ${prereqId})`,
                rpCost: prereqTech?.DevelopCost || null,
                field: prereqTech?.FieldName || null,
                researched: !!isResearched,
              });
            }
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    tech: tech.Name,
                    rpCost: tech.DevelopCost,
                    field: tech.FieldName,
                    description: tech.TechDescription || null,
                    alreadyResearched: !!alreadyResearched,
                    prerequisites: prereqs,
                    allPrerequisitesMet: prereqs.every((p) => p.researched),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else if (mode === 'available') {
          // Find all techs where:
          // 1. Not yet researched by this race
          // 2. All prerequisites (1 and 2) are either 0 or already researched
          // 3. Visible to this race (RaceID = 0 or RaceID = race)
          const availableTechs = db
            .prepare(
              `SELECT ts.Name, ts.DevelopCost, ts.TechDescription, rf.FieldName
               FROM FCT_TechSystem ts
               JOIN DIM_TechType dt ON ts.TechTypeID = dt.TechTypeID
               JOIN DIM_ResearchField rf ON dt.FieldID = rf.ResearchFieldID
               WHERE (ts.RaceID = 0 OR ts.RaceID = ?)
                 AND (ts.GameID = 0 OR ts.GameID = ?)
                 AND ts.TechSystemID NOT IN (
                   SELECT TechID FROM FCT_RaceTech WHERE RaceID = ? AND GameID = ?
                 )
                 AND (ts.Prerequisite1 = 0 OR ts.Prerequisite1 IN (
                   SELECT TechID FROM FCT_RaceTech WHERE RaceID = ? AND GameID = ?
                 ))
                 AND (ts.Prerequisite2 = 0 OR ts.Prerequisite2 IN (
                   SELECT TechID FROM FCT_RaceTech WHERE RaceID = ? AND GameID = ?
                 ))
                 AND ts.RuinOnly = 0
               ORDER BY rf.FieldName, ts.DevelopCost ASC`
            )
            .all(raceId, gameId, raceId, gameId, raceId, gameId, raceId, gameId) as any[];

          // Apply optional field filter
          let filtered = availableTechs;
          if (field) {
            const fieldLower = field.toLowerCase();
            filtered = availableTechs.filter(
              (t: any) => t.FieldName.toLowerCase().includes(fieldLower)
            );
          }

          const results = filtered.map((t: any) => ({
            name: t.Name,
            rpCost: t.DevelopCost,
            field: t.FieldName,
            description: t.TechDescription || null,
          }));

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    availableTechs: results,
                    count: results.length,
                    fieldFilter: field || null,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: Unknown mode "${mode}".`,
            },
          ],
          isError: true,
        };
      } catch (err: unknown) {
        const error = err as Error;
        return {
          content: [
            {
              type: 'text' as const,
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
