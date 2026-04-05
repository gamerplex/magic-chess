/**
 * Chess on-chain client — uses Gamerplex ER Pool for real MagicBlock gameplay.
 * Every move is a real Solana transaction on the Ephemeral Rollup.
 *
 * Flow:
 * 1. GET /game-pool/assign → get pre-delegated game + session key
 * 2. White moves: browser signs with session key → sends to ER RPC
 * 3. Black moves: POST /game-pool/ai-move → server signs → sends to ER
 * 4. Game over: POST /game-pool/finish → recycle game, optional SOAR save
 */

import { Buffer } from "buffer";
import {
  Connection,
  PublicKey,
  Transaction,
  Keypair,
  sendAndConfirmTransaction,
  TransactionInstruction,
} from "@solana/web3.js";

const RESOLVER = process.env.NEXT_PUBLIC_RESOLVER_URL ||
  "https://resolver.gamerplex.com";

const CHESS_PROGRAM_ID = new PublicKey("3LVg8uUsHtq6fusjrSfyGUCLQ83TFegDKmY3bCNz3QYr");

/** Precomputed Anchor discriminator for make_move */
const MAKE_MOVE_DISC = Buffer.from([78, 77, 152, 203, 222, 211, 208, 233]);

export class ChessOnChain {
  erConnection: Connection | null = null;
  sessionKey: Keypair | null = null;
  gamePda: PublicKey | null = null;
  gameId: number = 0;
  aiPublicKey: PublicKey | null = null;
  ready: boolean = false;
  erRpc: string = "";

  /**
   * Request a free ER game from the pool.
   * Returns true if assigned, false if pool is empty.
   */
  async requestGame(): Promise<boolean> {
    try {
      const res = await fetch(`${RESOLVER}/game-pool/assign`);
      if (!res.ok) {
        // Endpoint not deployed yet — silent fallback to local play
        return false;
      }
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch {
        // Resolver returned HTML (not deployed yet) — silent fallback
        return false;
      }

      if (!data.ok || !data.game) {
        console.warn("No free ER games available:", data.error);
        return false;
      }

      const { gameId, gamePda, sessionKeySecret, sessionKeyPublic, erRpc, aiPublicKey } = data.game;

      this.gameId = gameId;
      this.gamePda = new PublicKey(gamePda);
      this.sessionKey = Keypair.fromSecretKey(new Uint8Array(sessionKeySecret));
      this.erConnection = new Connection(erRpc, "confirmed");
      this.erRpc = erRpc;
      this.aiPublicKey = new PublicKey(aiPublicKey);
      this.ready = true;

      console.log(`[ER] Game assigned: ${gamePda.slice(0, 12)}... on ${erRpc}`);
      return true;
    } catch (e: any) {
      console.error("[ER] Failed to request game:", e.message);
      return false;
    }
  }

  get isReady(): boolean {
    return this.ready && this.erConnection !== null && this.sessionKey !== null;
  }

  /**
   * Send a WHITE move (player) directly to ER.
   * Signed by session key in the browser — no server round trip.
   */
  async sendPlayerMove(from: number, to: number, moveAlg: string, promotionPiece: number = 0): Promise<string | null> {
    if (!this.isReady) return null;

    try {
      const data = Buffer.alloc(11);
      MAKE_MOVE_DISC.copy(data, 0);
      data.writeUInt8(from, 8);
      data.writeUInt8(to, 9);
      data.writeUInt8(promotionPiece, 10);

      const ix = new TransactionInstruction({
        programId: CHESS_PROGRAM_ID,
        keys: [
          { pubkey: this.gamePda!, isSigner: false, isWritable: true },
          { pubkey: this.sessionKey!.publicKey, isSigner: true, isWritable: false },
        ],
        data,
      });

      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(
        this.erConnection!,
        tx,
        [this.sessionKey!],
        { skipPreflight: true }
      );

      console.log(`[ER] White: ${moveAlg} | TX: ${sig.slice(0, 20)}...`);
      return sig;
    } catch (e: any) {
      console.error(`[ER] Player move failed:`, e.message?.slice(0, 150));
      return null;
    }
  }

  /**
   * Send a BLACK move (AI) via the resolver.
   * Server signs with authority key and sends to ER.
   */
  async sendAiMove(from: number, to: number, promotionPiece: number = 0): Promise<string | null> {
    if (!this.gamePda) return null;

    try {
      const res = await fetch(`${RESOLVER}/game-pool/ai-move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gamePda: this.gamePda.toBase58(),
          from,
          to,
          promotion: promotionPiece,
        }),
      });

      const data = await res.json();
      if (data.ok && data.sig) {
        console.log(`[ER] Black: ${from}→${to} | TX: ${data.sig.slice(0, 20)}...`);
        return data.sig;
      }
      console.warn("[ER] AI move failed:", data.error);
      return null;
    } catch (e: any) {
      console.error("[ER] AI move error:", e.message);
      return null;
    }
  }

  /**
   * Finish the game — return to pool, optionally save to SOAR.
   */
  async finish(playerWallet?: string, result?: { winner: "white" | "black" | "draw"; moves: number }): Promise<boolean> {
    if (!this.gamePda) return false;

    try {
      const res = await fetch(`${RESOLVER}/game-pool/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gamePda: this.gamePda.toBase58(),
          playerWallet,
          result,
        }),
      });

      const data = await res.json();
      console.log(`[ER] Game finished: recycled=${data.recycled}, soar=${data.soarSubmitted}`);
      return data.ok;
    } catch (e: any) {
      console.error("[ER] Finish failed:", e.message);
      return false;
    }
  }

  /** Explorer URL for ER transaction */
  static explorerUrl(sig: string, erRpc: string = "https://devnet.magicblock.app"): string {
    return `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(erRpc)}`;
  }
}
