import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getDb } from '../db';
import * as fs from 'fs';
import * as path from 'path';

interface ViewDefinition {
  name: string;
  description: string;
  dependencies: string[];
  sql: string;
}

interface ViewsFile {
  version: string;
  description: string;
  views: ViewDefinition[];
}

function loadViewDefinitions(): ViewsFile {
  const viewsPath = path.join(__dirname, '..', '..', 'data', 'views.json');
  const content = fs.readFileSync(viewsPath, 'utf-8');
  return JSON.parse(content) as ViewsFile;
}

/**
 * Topologically sort views based on dependencies.
 * Ensures dependent views are created after their dependencies.
 */
function sortByDependencies(views: ViewDefinition[]): ViewDefinition[] {
  const sorted: ViewDefinition[] = [];
  const visited = new Set<string>();
  const viewMap = new Map(views.map((v) => [v.name, v]));

  function visit(view: ViewDefinition) {
    if (visited.has(view.name)) return;
    visited.add(view.name);
    for (const dep of view.dependencies) {
      const depView = viewMap.get(dep);
      if (depView) visit(depView);
    }
    sorted.push(view);
  }

  views.forEach((v) => visit(v));
  return sorted;
}

export const registerViewTools = (server: McpServer) => {
  server.tool(
    'injectViews',
    'Inject or update SQL views in AuroraDB.db from the views.json data file. ' +
      'Views provide pre-built complex queries accessible via SELECT * FROM vw_name. ' +
      'Handles dependency ordering automatically — views that reference other views are created after their dependencies. ' +
      'Use mode "status" to check which views exist without making changes. ' +
      'Use mode "inject" to create or replace all views. ' +
      'Use mode "drop" to remove all managed views. ' +
      'The views.json file in the data/ directory is the single source of truth for view definitions. ' +
      'No game data is modified — views are read-only query definitions.',
    {
      mode: z
        .enum(['status', 'inject', 'drop'])
        .describe(
          'Operation mode: "status" = check current state, "inject" = create/replace views, "drop" = remove all managed views'
        ),
    },
    async ({ mode }) => {
      const db = getDb();

      try {
        let viewDefs: ViewsFile;
        try {
          viewDefs = loadViewDefinitions();
        } catch (err: unknown) {
          const error = err as Error;
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error loading views.json: ${error.message}`,
              },
            ],
            isError: true,
          };
        }

        if (mode === 'status') {
          // Check which views exist in the database
          const existingViews = db
            .prepare(
              `SELECT name FROM sqlite_master WHERE type = 'view' AND name LIKE 'vw_%'`
            )
            .all() as { name: string }[];

          const existingNames = new Set(existingViews.map((v) => v.name));
          const definedNames = new Set(viewDefs.views.map((v) => v.name));

          const status = viewDefs.views.map((v) => ({
            name: v.name,
            description: v.description,
            injected: existingNames.has(v.name),
            dependencies: v.dependencies,
          }));

          // Check for orphaned views (in DB but not in definitions)
          const orphaned = existingViews
            .filter((v) => !definedNames.has(v.name))
            .map((v) => v.name);

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    dataFileVersion: viewDefs.version,
                    totalDefined: viewDefs.views.length,
                    totalInjected: status.filter((s) => s.injected).length,
                    views: status,
                    orphanedViews: orphaned,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else if (mode === 'inject') {
          const sorted = sortByDependencies(viewDefs.views);
          const results: { name: string; status: string }[] = [];

          for (const view of sorted) {
            try {
              // Drop existing view first to handle definition changes
              db.prepare(`DROP VIEW IF EXISTS ${view.name}`).run();
              db.prepare(view.sql).run();
              results.push({ name: view.name, status: 'created' });
            } catch (err: unknown) {
              const error = err as Error;
              results.push({
                name: view.name,
                status: `ERROR: ${error.message}`,
              });
            }
          }

          const successCount = results.filter(
            (r) => r.status === 'created'
          ).length;
          const errorCount = results.filter((r) =>
            r.status.startsWith('ERROR')
          ).length;

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    dataFileVersion: viewDefs.version,
                    totalProcessed: results.length,
                    succeeded: successCount,
                    failed: errorCount,
                    results,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else if (mode === 'drop') {
          // Drop in reverse dependency order
          const sorted = sortByDependencies(viewDefs.views).reverse();
          const results: { name: string; status: string }[] = [];

          for (const view of sorted) {
            try {
              db.prepare(`DROP VIEW IF EXISTS ${view.name}`).run();
              results.push({ name: view.name, status: 'dropped' });
            } catch (err: unknown) {
              const error = err as Error;
              results.push({
                name: view.name,
                status: `ERROR: ${error.message}`,
              });
            }
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    totalProcessed: results.length,
                    results,
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
