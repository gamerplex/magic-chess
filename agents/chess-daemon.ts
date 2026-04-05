/**
 * GAMERPLEX CHESS DAEMON — Runs N chess bot games continuously.
 *
 * Creates N parallel Stockfish-vs-Stockfish matches on MagicBlock ER.
 * Each match finishes (checkmate, draw, or move limit), the slot recycles,
 * and a new match starts. Provides constant activity for the homepage viewer.
 *
 * Usage:
 *   NUM_GAMES=5 npx tsx chess-daemon.ts
 */

import { spawn } from "child_process";
import * as path from "path";

const NUM_GAMES = parseInt(process.env.NUM_GAMES || "5");
const MOVE_DELAY_MS = process.env.MOVE_DELAY_MS || "3000"; // 3s per move for spectators
const MAX_MOVES = process.env.MAX_MOVES || "60";

const AGENT_NAMES = ["sf1200", "sf1500", "sf1800", "sf2100", "sf2400", "sf3000"];

function randomAgent(): string {
  return AGENT_NAMES[Math.floor(Math.random() * AGENT_NAMES.length)];
}

function startGameLoop(slotId: number): void {
  const run = () => {
    const white = randomAgent();
    const black = randomAgent();
    console.log(`[slot ${slotId}] Starting: ${white} vs ${black}`);

    const proc = spawn("npx", ["tsx", path.join(__dirname, "chess-agent.ts")], {
      env: {
        ...process.env,
        WHITE: white,
        BLACK: black,
        MOVE_DELAY_MS,
        MAX_MOVES,
        CONTINUOUS: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    proc.stdout?.on("data", (data) => {
      const lines = data.toString().split("\n").filter(Boolean);
      lines.forEach((l: string) => console.log(`[slot ${slotId}] ${l}`));
    });
    proc.stderr?.on("data", (data) => {
      console.error(`[slot ${slotId}] ERR: ${data.toString().trim()}`);
    });

    proc.on("close", (code) => {
      console.log(`[slot ${slotId}] Match ended (${code}). Restarting in 5s...`);
      setTimeout(run, 5000);
    });
  };
  run();
}

console.log(`🎮 Chess daemon starting ${NUM_GAMES} parallel games`);
console.log(`   Move delay: ${MOVE_DELAY_MS}ms | Max moves: ${MAX_MOVES}`);

for (let i = 0; i < NUM_GAMES; i++) {
  setTimeout(() => startGameLoop(i), i * 3000); // stagger starts
}
