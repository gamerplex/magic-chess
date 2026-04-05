/**
 * Game Pool API — assign free ER games, AI moves, finish games.
 * Every move is a real Solana transaction on MagicBlock Ephemeral Rollup.
 */

import { Router, Request, Response } from "express";
import { assignGame, sendAiMove, finishGame, getPoolStatus, reinitPool, getLiveGames, setGameLabel, getAgentLeaderboard } from "../er-pool";

export const gamePoolRouter = Router();

/**
 * GET /game-pool/assign
 * Assigns an available ER-delegated game. Returns session key for browser signing.
 */
gamePoolRouter.get("/assign", (_req: Request, res: Response) => {
  const game = assignGame();
  if (!game) {
    res.status(503).json({
      ok: false,
      error: "No free games available",
      pool: getPoolStatus(),
    });
    return;
  }
  res.json({ ok: true, game });
});

/**
 * POST /game-pool/ai-move
 * Body: { gamePda, from, to, promotion? }
 * Server signs AI (black) move and sends to ER.
 */
gamePoolRouter.post("/ai-move", async (req: Request, res: Response) => {
  try {
    const { gamePda, from, to, promotion } = req.body;
    if (!gamePda || from === undefined || to === undefined) {
      res.status(400).json({ error: "Missing: gamePda, from, to" });
      return;
    }

    const result = await sendAiMove(gamePda, from, to, promotion || 0);
    if (!result) {
      res.status(404).json({ error: "Game not found or not in use" });
      return;
    }

    res.json({ ok: true, ...result });
  } catch (err: any) {
    console.error("[GAME-POOL] AI move error:", err.message?.slice(0, 200));
    res.status(500).json({ error: err.message?.slice(0, 200) });
  }
});

/**
 * POST /game-pool/finish
 * Body: { gamePda, playerWallet?, result?: { winner, moves } }
 * Finishes game, submits SOAR score if wallet provided, recycles game slot.
 */
gamePoolRouter.post("/finish", async (req: Request, res: Response) => {
  try {
    const { gamePda, playerWallet, result, agentPair } = req.body;
    if (!gamePda) {
      res.status(400).json({ error: "Missing: gamePda" });
      return;
    }

    const outcome = await finishGame(gamePda, playerWallet, result, agentPair);
    res.json({ ok: true, ...outcome });
  } catch (err: any) {
    console.error("[GAME-POOL] Finish error:", err.message?.slice(0, 200));
    res.status(500).json({ error: err.message?.slice(0, 200) });
  }
});

/**
 * GET /game-pool/agents (DEPRECATED — use /rankings/agents)
 * GET /rankings/agents
 * Returns Gamerplex Agent rankings with ELO, wins, losses.
 */
gamePoolRouter.get("/agents", (_req: Request, res: Response) => {
  res.json({ ok: true, agents: getAgentLeaderboard() });
});

/**
 * GET /game-pool/status
 * Returns pool status for monitoring/debugging.
 */
gamePoolRouter.get("/status", (_req: Request, res: Response) => {
  res.json({ ok: true, pool: getPoolStatus() });
});

/**
 * GET /game-pool/live
 * Returns live board state for all in-use games.
 * Used by homepage to show ongoing bot vs bot matches.
 */
gamePoolRouter.get("/live", async (_req: Request, res: Response) => {
  try {
    const games = await getLiveGames();
    res.json({ ok: true, count: games.length, games });
  } catch (err: any) {
    res.status(500).json({ error: err.message?.slice(0, 200) });
  }
});

/**
 * POST /game-pool/label
 * Body: { gamePda, label }
 * Tag a game with a display label (e.g., "Queen Bot vs Knight Bot").
 */
gamePoolRouter.post("/label", (req: Request, res: Response) => {
  const { gamePda, label } = req.body;
  if (!gamePda || !label) {
    res.status(400).json({ error: "Missing: gamePda, label" });
    return;
  }
  setGameLabel(gamePda, label);
  res.json({ ok: true });
});

/**
 * POST /game-pool/init
 * Manually reinitialize pool (recovers from cold start failures).
 */
gamePoolRouter.post("/init", async (_req: Request, res: Response) => {
  try {
    const result = await reinitPool();
    res.json({ ok: true, ...result, pool: getPoolStatus() });
  } catch (err: any) {
    res.status(500).json({ error: err.message?.slice(0, 200) });
  }
});
