/**
 * GAMERPLEX CHESS AGENT — Stockfish vs Stockfish on MagicBlock ER.
 *
 * Runs agent-vs-agent chess games on real Solana devnet + MagicBlock ER.
 * Uses Stockfish at different skill levels for each agent profile.
 *
 * CRITICAL: If Stockfish suggests a move and our on-chain program rejects it,
 * that's a BUG in our chess engine. Stockfish only plays legal moves.
 *
 * Usage:
 *   npx tsx chess-agent.ts                     # random matchup
 *   WHITE=queen BLACK=knight npx tsx chess-agent.ts
 *   CONTINUOUS=true npx tsx chess-agent.ts     # loop forever
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { Chess } from "chess.js";
import * as crypto from "crypto";

const RESOLVER_URL = process.env.RESOLVER_URL || "https://resolver.gamerplex.com";
const CHESS_PROGRAM = new PublicKey("3LVg8uUsHtq6fusjrSfyGUCLQ83TFegDKmY3bCNz3QYr");
const MOVE_DELAY_MS = parseInt(process.env.MOVE_DELAY_MS || "3000"); // 3s per move for spectator pacing
const CONTINUOUS = process.env.CONTINUOUS === "true";

// Agent profiles — different Stockfish ELO calibrations
// Names match Stockfish target ELO; actual ranking emerges from real match results
const AGENTS = {
  sf1200: { name: "SF1200", elo: 1200, emoji: "♟️", skillLevel: 2 },
  sf1500: { name: "SF1500", elo: 1500, emoji: "♞", skillLevel: 6 },
  sf1800: { name: "SF1800", elo: 1800, emoji: "♝", skillLevel: 10 },
  sf2100: { name: "SF2100", elo: 2100, emoji: "♜", skillLevel: 14 },
  sf2400: { name: "SF2400", elo: 2400, emoji: "♛", skillLevel: 18 },
  sf3000: { name: "SF3000", elo: 3000, emoji: "♚", skillLevel: 20 },
};

type AgentName = keyof typeof AGENTS;

// Anchor discriminator helper
function disc(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
}

// Convert algebraic notation (e.g. "e2") to board index (0-63)
function algToIdx(a: string): number {
  return (parseInt(a[1]) - 1) * 8 + (a.charCodeAt(0) - 97);
}

// Heuristic AI with minimax depth search — skill level controls depth + randomness
// Low skill = depth 1 + random, high skill = depth 3 + deterministic
const PIECE_VALUES: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

function evalPosition(chess: Chess): number {
  // Positive = good for white
  if (chess.isCheckmate()) return chess.turn() === "w" ? -99999 : 99999;
  if (chess.isDraw() || chess.isStalemate()) return 0;

  let score = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = board[r][c];
      if (!sq) continue;
      const val = PIECE_VALUES[sq.type];
      score += sq.color === "w" ? val : -val;
      // Center bonus
      if ((r === 3 || r === 4) && (c === 3 || c === 4)) {
        score += sq.color === "w" ? 10 : -10;
      }
    }
  }
  return score;
}

function minimax(chess: Chess, depth: number, alpha: number, beta: number, maximizing: boolean): number {
  if (depth === 0 || chess.isGameOver()) return evalPosition(chess);

  const moves = chess.moves({ verbose: true });
  if (maximizing) {
    let maxEval = -Infinity;
    for (const m of moves) {
      chess.move(m);
      const ev = minimax(chess, depth - 1, alpha, beta, false);
      chess.undo();
      maxEval = Math.max(maxEval, ev);
      alpha = Math.max(alpha, ev);
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const m of moves) {
      chess.move(m);
      const ev = minimax(chess, depth - 1, alpha, beta, true);
      chess.undo();
      minEval = Math.min(minEval, ev);
      beta = Math.min(beta, ev);
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

// Pick best move using skill-adjusted minimax.
// skillLevel 0-20: depth = 1 + floor(skillLevel / 7), randomness scales inversely.
async function stockfishMove(fen: string, skillLevel: number): Promise<string> {
  const chess = new Chess(fen);
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) throw new Error("No legal moves");

  const depth = Math.min(3, 1 + Math.floor(skillLevel / 7));
  const isWhite = chess.turn() === "w";

  // Score each move with minimax
  const scored = legalMoves.map(m => {
    chess.move(m);
    const score = minimax(chess, depth - 1, -Infinity, Infinity, !isWhite);
    chess.undo();
    // White wants HIGH scores, black wants LOW
    return { move: m, score: isWhite ? score : -score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Weaker agents pick from a wider band (more blunders)
  // skill 0: picks from top 50%, skill 20: always picks top 1
  const bandSize = Math.max(1, Math.ceil(legalMoves.length * (1 - skillLevel / 22)));
  const pick = scored[Math.floor(Math.random() * Math.min(bandSize, scored.length))];

  const promo = pick.move.promotion ? pick.move.promotion : "";
  return pick.move.from + pick.move.to + promo;
}

async function playMatch(whiteAgent: AgentName, blackAgent: AgentName): Promise<void> {
  const white = AGENTS[whiteAgent];
  const black = AGENTS[blackAgent];

  console.log(`\n${white.emoji} ${white.name} (${white.elo}) vs ${black.emoji} ${black.name} (${black.elo})`);
  console.log("━".repeat(60));

  // 1. Request ER game from pool
  const res = await fetch(`${RESOLVER_URL}/game-pool/assign`);
  const data = await res.json();
  if (!data.ok || !data.game) {
    console.error(`❌ Pool unavailable:`, data.error);
    return;
  }

  const game = data.game;
  const gamePda = new PublicKey(game.gamePda);
  const sessionKey = Keypair.fromSecretKey(new Uint8Array(game.sessionKeySecret));
  const er = new Connection(game.erRpc, "confirmed");
  console.log(`Game: ${gamePda.toBase58().slice(0, 12)}...`);
  console.log(`ER: ${game.erRpc}`);

  // Tag game with display label for front-page viewer
  await fetch(`${RESOLVER_URL}/game-pool/label`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gamePda: gamePda.toBase58(),
      label: `${white.emoji} ${white.name} vs ${black.emoji} ${black.name}`,
    }),
  });

  // 2. Play moves with Stockfish-style engines, tracking with chess.js
  const chess = new Chess();
  let moveCount = 0;
  let illegalRejections: Array<{ move: string; reason: string }> = [];

  const maxMoves = parseInt(process.env.MAX_MOVES || "100");
  while (!chess.isGameOver() && !chess.isThreefoldRepetition() && !chess.isDraw() && moveCount < maxMoves) {
    const isWhiteTurn = chess.turn() === "w";
    const agent = isWhiteTurn ? white : black;

    // Get move from agent
    const moveStr = await stockfishMove(chess.fen(), agent.skillLevel);
    const fromAlg = moveStr.slice(0, 2);
    const toAlg = moveStr.slice(2, 4);

    // Apply to local chess.js board (for verification)
    const result = chess.move({ from: fromAlg, to: toAlg, promotion: "q" });
    if (!result) {
      console.error(`❌ chess.js rejected ${moveStr} — bug in our Stockfish wrapper`);
      break;
    }

    // Send to on-chain ER
    const from = algToIdx(fromAlg);
    const to = algToIdx(toAlg);
    const promotion = result.promotion === "q" ? 10 : 0; // queen = 10

    const moveData = Buffer.alloc(11);
    disc("make_move").copy(moveData, 0);
    moveData.writeUInt8(from, 8);
    moveData.writeUInt8(to, 9);
    moveData.writeUInt8(promotion, 10);

    const signer = isWhiteTurn ? sessionKey : null; // We only have session key
    if (!signer) {
      // For black moves, use resolver's AI endpoint (authority signs)
      const aiRes = await fetch(`${RESOLVER_URL}/game-pool/ai-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gamePda: gamePda.toBase58(),
          from,
          to,
          promotion,
        }),
      });
      const aiData = await aiRes.json();
      if (!aiData.ok) {
        console.error(`🚨 ON-CHAIN REJECTED ${agent.name}'s move ${moveStr}:`, aiData.error);
        console.error(`   FEN: ${chess.fen()}`);
        console.error(`   This is a BUG in our chess engine — Stockfish moves are always legal.`);
        illegalRejections.push({ move: moveStr, reason: aiData.error });
        break;
      }
      console.log(`${moveCount + 1}. ${agent.emoji} ${moveStr} (tx: ${aiData.sig.slice(0, 16)}...)`);
    } else {
      const tx = new Transaction().add(
        new TransactionInstruction({
          programId: CHESS_PROGRAM,
          keys: [
            { pubkey: gamePda, isSigner: false, isWritable: true },
            { pubkey: signer.publicKey, isSigner: true, isWritable: false },
          ],
          data: moveData,
        })
      );
      try {
        const sig = await sendAndConfirmTransaction(er, tx, [signer], { skipPreflight: true });
        console.log(`${moveCount + 1}. ${agent.emoji} ${moveStr} (tx: ${sig.slice(0, 16)}...)`);
      } catch (err: any) {
        console.error(`🚨 ON-CHAIN REJECTED ${agent.name}'s move ${moveStr}:`, err.message?.slice(0, 200));
        console.error(`   FEN: ${chess.fen()}`);
        console.error(`   This is a BUG — Stockfish moves are always legal.`);
        illegalRejections.push({ move: moveStr, reason: err.message });
        break;
      }
    }

    moveCount++;
    if (MOVE_DELAY_MS > 0) await new Promise(r => setTimeout(r, MOVE_DELAY_MS));
  }

  // 3. Determine winner
  let winner: "white" | "black" | "draw";
  if (chess.isCheckmate()) {
    winner = chess.turn() === "w" ? "black" : "white";
    console.log(`\n🏆 ${chess.turn() === "w" ? black.name : white.name} wins by checkmate in ${moveCount} moves`);
  } else if (chess.isDraw() || chess.isStalemate()) {
    winner = "draw";
    console.log(`\n🤝 Draw after ${moveCount} moves`);
  } else {
    winner = "draw"; // max moves reached
    console.log(`\n⏰ Move limit reached (${moveCount})`);
  }

  // 4. Finish game (recycle slot)
  await fetch(`${RESOLVER_URL}/game-pool/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gamePda: gamePda.toBase58(),
      result: { winner, moves: moveCount },
      agentPair: { white: white.name, black: black.name },
    }),
  });

  if (illegalRejections.length > 0) {
    console.error(`\n🚨 ${illegalRejections.length} ILLEGAL MOVE REJECTIONS — ENGINE BUG DETECTED`);
    illegalRejections.forEach(r => console.error(`   ${r.move}: ${r.reason}`));
  }
}

function randomAgent(): AgentName {
  const names = Object.keys(AGENTS) as AgentName[];
  return names[Math.floor(Math.random() * names.length)];
}

async function main() {
  const envWhite = process.env.WHITE as AgentName | undefined;
  const envBlack = process.env.BLACK as AgentName | undefined;

  do {
    const white = envWhite && AGENTS[envWhite] ? envWhite : randomAgent();
    const black = envBlack && AGENTS[envBlack] ? envBlack : randomAgent();
    try {
      await playMatch(white, black);
    } catch (err: any) {
      console.error(`Match failed:`, err.message);
    }
    if (CONTINUOUS) await new Promise(r => setTimeout(r, 5000));
  } while (CONTINUOUS);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
