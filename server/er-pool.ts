/**
 * ER Game Pool — Production-grade MagicBlock Ephemeral Rollup game management.
 * Pre-creates and delegates chess GameState PDAs for instant free play.
 * Every move is a real Solana transaction on MagicBlock ER.
 *
 * Proven pattern: delegation tested on devnet (TX: 3ZAShhSbs...)
 * Account order verified against IDL: buffer, record, metadata, game, payer, owner, delegation, system
 *
 * Cost model (mainnet): ~$0.09 net per game (rent is refunded on recycle)
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationRecordPdaFromDelegatedAccount,
  delegationMetadataPdaFromDelegatedAccount,
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import * as crypto from "crypto";

// Programs
const CHESS_PROGRAM_ID = new PublicKey("3LVg8uUsHtq6fusjrSfyGUCLQ83TFegDKmY3bCNz3QYr");
const GAME_SEED = Buffer.from("chess_game");

// Precomputed discriminators (sha256("global:<name>")[:8])
const DISC = {
  create_game: Buffer.from([124, 69, 75, 66, 184, 220, 72, 206]),
  join_game: Buffer.from([107, 112, 18, 38, 56, 173, 60, 128]),
  make_move: Buffer.from([78, 77, 152, 203, 222, 211, 208, 233]),
  delegate_game: crypto.createHash("sha256").update("global:delegate_game").digest().slice(0, 8),
  finish_game: crypto.createHash("sha256").update("global:finish_game").digest().slice(0, 8),
};

// Config
const DEVNET_RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const ER_RPC = process.env.ER_RPC || "https://devnet.magicblock.app";
const SESSION_FUND_LAMPORTS = Math.floor(0.02 * LAMPORTS_PER_SOL); // covers ~4000 tx fees
const GAME_TIMEOUT_MS = 4 * 60 * 1000; // 4 min (2x move timer) — auto-recycle stale games

interface PooledGame {
  gameId: number;
  gamePda: PublicKey;
  sessionKey: Keypair;
  status: "creating" | "available" | "in_use" | "finishing" | "failed";
  assignedAt: number | null;
  playerWallet: string | null;
  moveCount: number;
  createdAt: number;
}

// State
const pool: PooledGame[] = [];
let authority: Keypair | null = null;
let baseConnection: Connection;
let erConnection: Connection;
let poolInitialized = false;
// Persistent shared session keypair — reused across all games to avoid burning SOL
// on orphaned keypairs. Lives in memory per resolver instance, funded once on startup.
let sharedSessionKey: Keypair | null = null;

/**
 * Initialize the ER pool. Called once on server startup.
 */
export async function initERPool(
  resolverKeypair: Keypair,
  poolSize: number = 2
): Promise<void> {
  authority = resolverKeypair;
  baseConnection = new Connection(DEVNET_RPC, "confirmed");
  erConnection = new Connection(ER_RPC, "confirmed");

  const balance = await baseConnection.getBalance(authority.publicKey);
  const balanceSol = balance / LAMPORTS_PER_SOL;
  console.log(`[ER-POOL] Authority: ${authority.publicKey.toBase58()}`);
  console.log(`[ER-POOL] Balance: ${balanceSol.toFixed(4)} SOL`);

  // Need ~0.01 SOL per game (rent only — session key is reused globally)
  const requiredSol = poolSize * 0.01 + 0.1; // +0.1 for session key
  if (balanceSol < requiredSol) {
    console.warn(`[ER-POOL] Insufficient SOL: need ${requiredSol}, have ${balanceSol.toFixed(4)}. Pool disabled.`);
    return;
  }

  // Create persistent shared session key (funded once, reused across all games)
  sharedSessionKey = Keypair.generate();
  const fundAmount = Math.floor(0.1 * LAMPORTS_PER_SOL); // ~20k move transactions
  await sendAndConfirmTransaction(
    baseConnection,
    new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: authority.publicKey,
        toPubkey: sharedSessionKey.publicKey,
        lamports: fundAmount,
      })
    ),
    [authority]
  );
  console.log(`[ER-POOL] Shared session key: ${sharedSessionKey.publicKey.toBase58()} (${fundAmount/LAMPORTS_PER_SOL} SOL)`);

  console.log(`[ER-POOL] Creating ${poolSize} games (sequential with retry)...`);

  // Create games SEQUENTIALLY to avoid nonce/blockhash conflicts
  let succeeded = 0;
  for (let i = 0; i < poolSize; i++) {
    let created = false;
    for (let attempt = 0; attempt < 3 && !created; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`[ER-POOL] Game ${i} retry ${attempt}/2...`);
          await new Promise(r => setTimeout(r, 2000)); // wait before retry
        }
        await createPooledGame(i);
        created = true;
        succeeded++;
      } catch (err: any) {
        console.warn(`[ER-POOL] Game ${i} attempt ${attempt} failed:`, err.message?.slice(0, 120));
      }
    }
  }

  poolInitialized = succeeded > 0;
  console.log(`[ER-POOL] Ready: ${succeeded}/${poolSize} available`);

  // Start cleanup timer — recycle stale games every 5 min
  setInterval(recycleStaleGames, 5 * 60 * 1000);
}

/**
 * Manually reinitialize the pool (e.g. after cold start failure).
 */
export async function reinitPool(): Promise<{ succeeded: number; total: number }> {
  if (!authority) return { succeeded: 0, total: 0 };

  // Clear failed games
  const failed = pool.filter(g => g.status === "failed" || g.status === "creating");
  failed.forEach(g => {
    const idx = pool.indexOf(g);
    if (idx >= 0) pool.splice(idx, 1);
  });

  const available = pool.filter(g => g.status === "available").length;
  const target = 10;
  const toCreate = target - available;
  if (toCreate <= 0) return { succeeded: available, total: pool.length };

  let succeeded = 0;
  for (let i = 0; i < toCreate; i++) {
    try {
      await createPooledGame(pool.length + i);
      succeeded++;
    } catch (err: any) {
      console.warn(`[ER-POOL] Reinit game failed:`, err.message?.slice(0, 120));
    }
  }
  poolInitialized = pool.filter(g => g.status === "available").length > 0;
  return { succeeded: available + succeeded, total: pool.length };
}

/**
 * Create a single game, join as AI, delegate to ER.
 */
async function createPooledGame(index: number): Promise<void> {
  if (!authority) throw new Error("Pool not initialized");

  // Lazy-init shared session key if missing (e.g. after reinit)
  if (!sharedSessionKey) {
    sharedSessionKey = Keypair.generate();
    const fundAmount = Math.floor(0.1 * LAMPORTS_PER_SOL);
    await sendAndConfirmTransaction(
      baseConnection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: authority.publicKey,
          toPubkey: sharedSessionKey.publicKey,
          lamports: fundAmount,
        })
      ),
      [authority]
    );
    console.log(`[ER-POOL] Shared session key created: ${sharedSessionKey.publicKey.toBase58()}`);
  }

  const gameId = Date.now() + index * 100;
  const sessionKey = sharedSessionKey;

  const [gamePda] = PublicKey.findProgramAddressSync(
    [GAME_SEED, Buffer.from(new BigUint64Array([BigInt(gameId)]).buffer)],
    CHESS_PROGRAM_ID
  );

  const entry: PooledGame = {
    gameId,
    gamePda,
    sessionKey,
    status: "creating",
    assignedAt: null,
    playerWallet: null,
    moveCount: 0,
    createdAt: Date.now(),
  };
  pool.push(entry);

  try {
    // Session key is pre-funded once at startup (shared across all games).
    // Create game (sessionKey = white) + join (authority = black/AI)
    const createData = Buffer.alloc(18);
    DISC.create_game.copy(createData, 0);
    createData.writeBigUInt64LE(BigInt(gameId), 8);
    createData.writeUInt16LE(120, 16); // 2 min per move

    const joinData = Buffer.alloc(16);
    DISC.join_game.copy(joinData, 0);
    joinData.writeBigUInt64LE(BigInt(gameId), 8);

    await sendAndConfirmTransaction(
      baseConnection,
      new Transaction().add(
        new TransactionInstruction({
          programId: CHESS_PROGRAM_ID,
          keys: [
            { pubkey: gamePda, isSigner: false, isWritable: true },
            { pubkey: sessionKey.publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: createData,
        }),
        new TransactionInstruction({
          programId: CHESS_PROGRAM_ID,
          keys: [
            { pubkey: gamePda, isSigner: false, isWritable: true },
            { pubkey: authority.publicKey, isSigner: true, isWritable: true },
          ],
          data: joinData,
        })
      ),
      [sessionKey, authority],
      { skipPreflight: true }
    );

    // 3. Delegate to ER (proven account order from IDL)
    const buffer = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(gamePda, CHESS_PROGRAM_ID);
    const delegationRecord = delegationRecordPdaFromDelegatedAccount(gamePda);
    const delegationMetadata = delegationMetadataPdaFromDelegatedAccount(gamePda);

    await sendAndConfirmTransaction(
      baseConnection,
      new Transaction().add(
        new TransactionInstruction({
          programId: CHESS_PROGRAM_ID,
          keys: [
            // IDL order: buffer, delegation_record, delegation_metadata, game, payer, owner, delegation, system
            { pubkey: buffer, isSigner: false, isWritable: true },
            { pubkey: delegationRecord, isSigner: false, isWritable: true },
            { pubkey: delegationMetadata, isSigner: false, isWritable: true },
            { pubkey: gamePda, isSigner: false, isWritable: true },
            { pubkey: sessionKey.publicKey, isSigner: true, isWritable: true },
            { pubkey: CHESS_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: DISC.delegate_game,
        })
      ),
      [sessionKey],
      { skipPreflight: true }
    );

    entry.status = "available";
    console.log(`[ER-POOL] Game ${index} ready: ${gamePda.toBase58().slice(0, 12)}...`);
  } catch (err: any) {
    entry.status = "failed";
    console.error(`[ER-POOL] Game ${index} failed:`, err.message?.slice(0, 150));
    throw err;
  }
}

/**
 * Assign an available game to a player.
 * Returns game PDA + session key secret (browser uses this to sign moves on ER).
 */
export function assignGame(): {
  gameId: number;
  gamePda: string;
  sessionKeySecret: number[];
  sessionKeyPublic: string;
  erRpc: string;
  programId: string;
  aiPublicKey: string;
} | null {
  if (!authority) return null;

  const available = pool.find(g => g.status === "available");
  if (!available) {
    // Auto-reinit in background if pool is empty but we have authority
    if (pool.filter(g => g.status === "creating").length === 0) {
      console.log("[ER-POOL] Pool empty — auto-reinitializing...");
      reinitPool().catch(e => console.warn("[ER-POOL] Auto-reinit failed:", e.message?.slice(0, 100)));
    }
    return null;
  }

  available.status = "in_use";
  available.assignedAt = Date.now();
  available.moveCount = 0;

  console.log(`[ER-POOL] Assigned: ${available.gamePda.toBase58().slice(0, 12)}...`);

  return {
    gameId: available.gameId,
    gamePda: available.gamePda.toBase58(),
    sessionKeySecret: Array.from(available.sessionKey.secretKey),
    sessionKeyPublic: available.sessionKey.publicKey.toBase58(),
    erRpc: ER_RPC,
    programId: CHESS_PROGRAM_ID.toBase58(),
    aiPublicKey: authority.publicKey.toBase58(),
  };
}

/**
 * Sign and send an AI (black) move on ER.
 * Browser calculates the AI move, sends to server, server signs with authority key.
 */
export async function sendAiMove(
  gamePdaStr: string,
  from: number,
  to: number,
  promotion: number = 0
): Promise<{ sig: string; explorerUrl: string } | null> {
  if (!authority) return null;

  const gamePda = new PublicKey(gamePdaStr);
  const game = pool.find(g => g.gamePda.equals(gamePda) && g.status === "in_use");
  if (!game) return null;

  const moveData = Buffer.alloc(11);
  DISC.make_move.copy(moveData, 0);
  moveData.writeUInt8(from, 8);
  moveData.writeUInt8(to, 9);
  moveData.writeUInt8(promotion, 10);

  const ix = new TransactionInstruction({
    programId: CHESS_PROGRAM_ID,
    keys: [
      { pubkey: gamePda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data: moveData,
  });

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(erConnection, tx, [authority], {
    skipPreflight: true,
  });

  game.moveCount++;

  return {
    sig,
    explorerUrl: `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(ER_RPC)}`,
  };
}

/**
 * Finish a game — recycle the slot for the next player.
 * If playerWallet provided, submit score to SOAR.
 */
export async function finishGame(
  gamePdaStr: string,
  playerWallet?: string,
  result?: { winner: "white" | "black" | "draw"; moves: number },
  agentPair?: { white: string; black: string }
): Promise<{ recycled: boolean; soarSubmitted: boolean }> {
  const gamePda = new PublicKey(gamePdaStr);
  const game = pool.find(g => g.gamePda.equals(gamePda));
  if (!game) return { recycled: false, soarSubmitted: false };

  game.status = "finishing";
  game.playerWallet = playerWallet || null;

  // Record agent match stats (for Gamerplex Agents leaderboard)
  if (agentPair && result) {
    recordAgentMatch(agentPair.white, agentPair.black, result.winner);
  }

  let soarSubmitted = false;

  // Submit to SOAR if player connected wallet
  if (playerWallet && result) {
    try {
      const { submitScore, initPlayer, registerPlayerForLeaderboard } = await import("./soar");
      const playerKey = new PublicKey(playerWallet);
      await initPlayer(playerKey, playerWallet.slice(0, 4) + "..." + playerWallet.slice(-4));
      await registerPlayerForLeaderboard(playerKey, "chess");
      // ELO calculation: base 1200 + moves as bonus
      const elo = result.winner === "white" ? 1250 + result.moves : 1150;
      await submitScore(playerKey, "chess", elo);
      soarSubmitted = true;
      console.log(`[ER-POOL] SOAR score submitted for ${playerWallet.slice(0, 8)}...`);
    } catch (err: any) {
      console.warn(`[ER-POOL] SOAR submit failed:`, err.message?.slice(0, 100));
    }
  }

  // Recycle: remove old game, create new one
  const idx = pool.indexOf(game);
  pool.splice(idx, 1);

  // Create replacement in background (don't block response)
  if (authority) {
    createPooledGame(idx).catch(err => {
      console.warn(`[ER-POOL] Failed to recycle game:`, err.message?.slice(0, 100));
    });
  }

  return { recycled: true, soarSubmitted };
}

/**
 * Auto-recycle games that have been in_use for too long (player abandoned).
 */
function recycleStaleGames(): void {
  const now = Date.now();
  const stale = pool.filter(
    g => g.status === "in_use" && g.assignedAt && now - g.assignedAt > GAME_TIMEOUT_MS
  );

  for (const game of stale) {
    console.log(`[ER-POOL] Recycling stale game: ${game.gamePda.toBase58().slice(0, 12)}...`);
    finishGame(game.gamePda.toBase58()).catch(() => {});
  }
}

/**
 * Get pool status for monitoring.
 */
export function getPoolStatus(): {
  initialized: boolean;
  total: number;
  available: number;
  inUse: number;
  failed: number;
  erRpc: string;
  games: Array<{
    gamePda: string;
    status: string;
    gameId: number;
    moveCount: number;
    assignedAt: number | null;
  }>;
} {
  return {
    initialized: poolInitialized,
    total: pool.length,
    available: pool.filter(g => g.status === "available").length,
    inUse: pool.filter(g => g.status === "in_use").length,
    failed: pool.filter(g => g.status === "failed").length,
    erRpc: ER_RPC,
    games: pool.map(g => ({
      gamePda: g.gamePda.toBase58(),
      status: g.status,
      gameId: g.gameId,
      moveCount: g.moveCount,
      assignedAt: g.assignedAt,
    })),
  };
}

/**
 * Get live game state for all active (in_use) games.
 * Reads board state directly from MagicBlock ER.
 * Used by front-page live viewer to show ongoing bot vs bot matches.
 */
export async function getLiveGames(): Promise<Array<{
  gamePda: string;
  gameId: number;
  board: number[];
  moveCount: number;
  whiteTurn: boolean;
  label?: string; // e.g. "Queen Bot vs Knight Bot"
}>> {
  if (!erConnection) return [];

  const activeGames = pool.filter(g => g.status === "in_use");
  const results = await Promise.all(
    activeGames.map(async (game) => {
      try {
        const info = await erConnection.getAccountInfo(game.gamePda);
        if (!info) return null;

        // Parse GameState PDA:
        // 8 disc + 8 game_id + 32 white + 32 black + 1 status + 1 turn + 2 move_count
        // + 8 winner_bytes + 2 time_per_move + 8 last_move_at + 1 en_passant + 1 castling
        // + 64 board[u8]
        const d = info.data;
        const statusOffset = 8 + 8 + 32 + 32;
        const turn = d[statusOffset + 1];
        const moveCount = d.readUInt16LE(statusOffset + 2);
        const boardOffset = statusOffset + 4 + 1 + 2 + 8 + 1 + 1;
        const board = Array.from(d.slice(boardOffset, boardOffset + 64));

        return {
          gamePda: game.gamePda.toBase58(),
          gameId: game.gameId,
          board,
          moveCount,
          whiteTurn: turn === 0,
          label: (game as any).label,
        };
      } catch {
        return null;
      }
    })
  );

  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}

export function setGameLabel(gamePdaStr: string, label: string): void {
  const game = pool.find(g => g.gamePda.toBase58() === gamePdaStr);
  if (game) (game as any).label = label;
}

// Agent stats tracking (in-memory, for Gamerplex Agents leaderboard)
interface AgentStats {
  name: string;
  emoji: string;
  baseElo: number;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  wallet?: string;
}

// All agents start at ELO 1500 — true rankings EMERGE from real on-chain games.
// Naming convention: SF{stockfish_target_elo} — e.g. SF3000 = Stockfish calibrated to 3000 ELO strength.
const agentStats = new Map<string, AgentStats>([
  ["SF1200", { name: "SF1200", emoji: "♟️", baseElo: 1200, elo: 1500, wins: 0, losses: 0, draws: 0 }],
  ["SF1500", { name: "SF1500", emoji: "♞", baseElo: 1500, elo: 1500, wins: 0, losses: 0, draws: 0 }],
  ["SF1800", { name: "SF1800", emoji: "♝", baseElo: 1800, elo: 1500, wins: 0, losses: 0, draws: 0 }],
  ["SF2100", { name: "SF2100", emoji: "♜", baseElo: 2100, elo: 1500, wins: 0, losses: 0, draws: 0 }],
  ["SF2400", { name: "SF2400", emoji: "♛", baseElo: 2400, elo: 1500, wins: 0, losses: 0, draws: 0 }],
  ["SF3000", { name: "SF3000", emoji: "♚", baseElo: 3000, elo: 1500, wins: 0, losses: 0, draws: 0 }],
]);

/** Record an agent vs agent match result. Updates ELOs using standard formula. */
export function recordAgentMatch(whiteName: string, blackName: string, result: "white" | "black" | "draw"): void {
  const white = agentStats.get(whiteName);
  const black = agentStats.get(blackName);
  if (!white || !black) return;

  // Standard ELO update, K=32
  const K = 32;
  const expectedWhite = 1 / (1 + Math.pow(10, (black.elo - white.elo) / 400));
  const expectedBlack = 1 - expectedWhite;
  const scoreWhite = result === "white" ? 1 : result === "black" ? 0 : 0.5;
  const scoreBlack = 1 - scoreWhite;

  white.elo = Math.round(white.elo + K * (scoreWhite - expectedWhite));
  black.elo = Math.round(black.elo + K * (scoreBlack - expectedBlack));

  if (result === "white") { white.wins++; black.losses++; }
  else if (result === "black") { black.wins++; white.losses++; }
  else { white.draws++; black.draws++; }
}

export function setAgentWallet(name: string, wallet: string): void {
  const a = agentStats.get(name);
  if (a) a.wallet = wallet;
}

export function getAgentLeaderboard(): AgentStats[] {
  return Array.from(agentStats.values()).sort((a, b) => b.elo - a.elo);
}

export { CHESS_PROGRAM_ID, DISC, ER_RPC };
