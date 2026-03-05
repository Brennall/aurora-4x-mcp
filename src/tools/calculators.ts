import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export const registerCalculatorTools = (server: McpServer) => {
  server.tool(
    'calculateResearchTime',
    'Calculate research completion time for a scientist/technology combination. Pure calculator — no database access, returns instantly. ' +
      'Use this for HYPOTHETICAL scenarios: "what if I assign Skinner to Fusion Reactor?" The getResearchStatus tool already provides ' +
      'annualRP, daysRemaining, and estimatedCompletion for currently active research — do not use this calculator to re-derive those values. ' +
      'All inputs must be provided by the caller (typically from getResearchStatus unassigned scientist data, or from getSessionStatus). ' +
      'Returns: multiplier (effective research multiplier), annualRP (RP generated per year), rpPerTick (RP per 5-day increment), ' +
      'daysRemaining (calendar days to completion), and estimatedCompletion (date string, if currentGameDate provided). ' +
      'Uses the confirmed formula: Annual RP = baseRate × labs × multiplier, where ' +
      'in-field multiplier = 4 × bonusValue − 3 (e.g. 1.5 bonus → 3.0×), out-of-field multiplier = bonusValue (e.g. 1.5 bonus → 1.5×). ' +
      'A bonusValue of 1.0 (0% bonus) gives 1.0× in either case. ' +
      'The baseRate is gameResearch × gameResearchSpeed / 100 (e.g. 240 × 50 / 100 = 120 for The Horizon Line at current settings). ' +
      'Caller must provide baseRate from the database or session data — do not hardcode it.',
    {
      rpRemaining: z.number().describe('RP remaining on the research project'),
      bonusValue: z.number().describe('Scientist research bonus value (e.g. 1.5 for 50% bonus)'),
      labs: z.number().describe('Number of labs assigned to the project'),
      inField: z.boolean().describe('Whether the scientist is researching in their specialisation field'),
      baseRate: z.number().describe('Base RP rate per lab per year: gameResearch × gameResearchSpeed / 100. For The Horizon Line: 120'),
      currentGameDate: z.string().optional().describe('Current game date in YYYY-MM-DD format for completion date calculation. If omitted, only days remaining is returned.'),
    },
    async ({ rpRemaining, bonusValue, labs, inField, baseRate, currentGameDate }) => {
      const multiplier = inField ? (4 * bonusValue - 3) : bonusValue;
      const annualRP = baseRate * labs * multiplier;
      const rpPerTick = annualRP / 73; // 73 five-day ticks per year
      const daysRemaining = (rpRemaining / annualRP) * 365;

      let estimatedCompletion: string | null = null;
      if (currentGameDate) {
        try {
          const gameDate = new Date(currentGameDate);
          gameDate.setDate(gameDate.getDate() + Math.ceil(daysRemaining));
          estimatedCompletion = gameDate.toISOString().split('T')[0];
        } catch {
          estimatedCompletion = 'Invalid date provided';
        }
      }

      const result: any = {
        rpRemaining,
        multiplier: Math.round(multiplier * 100) / 100,
        annualRP: Math.round(annualRP),
        rpPerTick: Math.round(rpPerTick * 100) / 100,
        daysRemaining: Math.round(daysRemaining),
      };

      if (estimatedCompletion) {
        result.estimatedCompletion = estimatedCompletion;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  server.tool(
    'calculateMineralDepletion',
    'Calculate when a mineral will deplete at current consumption rate. Pure calculator — no database access, returns instantly. ' +
      'All inputs must be provided by the caller (typically from getSessionStatus minerals output or getEmpireMinerals). ' +
      'Only meaningful when delta is negative — returns a "not depleting" message if delta is zero or positive. ' +
      'Returns: mineral (name), stock (current tonnes), delta (per-increment change), depleting (boolean), ' +
      'incrementsRemaining (number of 5-day increments until zero), daysRemaining (calendar days), ' +
      'and estimatedDepletion (date string, if currentGameDate provided). ' +
      'IMPORTANT: Assumes constant consumption rate. If construction completes or queue allocation changes, ' +
      'the actual depletion timeline will shift. Recalculate after any production change. ' +
      'One increment = 5 game days. The delta value from getSessionStatus/getEmpireMinerals is already per-increment.',
    {
      mineralName: z.string().describe('Mineral name (for labelling output only)'),
      stock: z.number().describe('Current mineral stock in tonnes'),
      delta: z.number().describe('Per-increment delta (should be negative for depletion calculation)'),
      currentGameDate: z.string().optional().describe('Current game date in YYYY-MM-DD format for depletion date calculation'),
    },
    async ({ mineralName, stock, delta, currentGameDate }) => {
      if (delta >= 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                mineral: mineralName,
                stock: Math.round(stock),
                delta: Math.round(delta),
                depleting: false,
                message: 'Delta is positive or zero — mineral is not depleting.',
              }, null, 2),
            },
          ],
        };
      }

      const incrementsRemaining = Math.floor(stock / Math.abs(delta));
      const daysRemaining = incrementsRemaining * 5; // 5 days per increment

      let estimatedDepletion: string | null = null;
      if (currentGameDate) {
        try {
          const gameDate = new Date(currentGameDate);
          gameDate.setDate(gameDate.getDate() + daysRemaining);
          estimatedDepletion = gameDate.toISOString().split('T')[0];
        } catch {
          estimatedDepletion = 'Invalid date provided';
        }
      }

      const result: any = {
        mineral: mineralName,
        stock: Math.round(stock),
        delta: Math.round(delta),
        depleting: true,
        incrementsRemaining,
        daysRemaining,
      };

      if (estimatedDepletion) {
        result.estimatedDepletion = estimatedDepletion;
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
};
