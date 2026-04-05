/**
 * Test: ER Pool — create chess game, delegate to MagicBlock ER, play moves on ER.
 * This tests the EXACT flow that the resolver does for free play:
 * 1. Create game on L1 (session key = white, authority = black/AI)
 * 2. Delegate game to MagicBlock Ephemeral Rollup
 * 3. Make moves on ER (real transactions, sub-50ms)
 * 4. Verify state on ER
 *
 * NO MOCKS. Real devnet. Real MagicBlock ER.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
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
import {
  getConnection,
  loadKeypair,
  createFundedKeypair,
  assertTxExists,
  PROGRAMS,
  ER_RPC,
} from "./helpers";

const GAME_SEED = Buffer.from("chess_game");
const CHESS = PROGRAMS.chess;

// Discriminators
function disc(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
}

function getGamePda(gameId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [GAME_SEED, Buffer.from(new BigUint64Array([BigInt(gameId)]).buffer)],
    CHESS
  );
}

describe("ER Pool — Free On-Chain Chess via MagicBlock", () => {
  let l1: Connection;
  let er: Connection;
  let authority: Keypair;   // server key (black / AI)
  let sessionKey: Keypair;  // browser key (white / player)
  let gameId: number;
  let gamePda: PublicKey;

  beforeAll(async () => {
    l1 = getConnection();
    er = new Connection(ER_RPC, "confirmed");
    authority = loadKeypair();

    // Generate session key (like browser would)
    sessionKey = await createFundedKeypair(l1, authority, 0.02 * LAMPORTS_PER_SOL);
    gameId = Date.now();
    [gamePda] = getGamePda(gameId);

    console.log(`Authority: ${authority.publicKey.toBase58()}`);
    console.log(`Session:   ${sessionKey.publicKey.toBase58()}`);
    console.log(`Game PDA:  ${gamePda.toBase58()}`);
    console.log(`Game ID:   ${gameId}`);
  }, 30000);

  it("Step 1: Create game on L1 (session=white, authority=black)", async () => {
    const createData = Buffer.alloc(18);
    disc("create_game").copy(createData, 0);
    createData.writeBigUInt64LE(BigInt(gameId), 8);
    createData.writeUInt16LE(120, 16);

    const joinData = Buffer.alloc(16);
    disc("join_game").copy(joinData, 0);
    joinData.writeBigUInt64LE(BigInt(gameId), 8);

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: CHESS,
        keys: [
          { pubkey: gamePda, isSigner: false, isWritable: true },
          { pubkey: sessionKey.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: createData,
      }),
      new TransactionInstruction({
        programId: CHESS,
        keys: [
          { pubkey: gamePda, isSigner: false, isWritable: true },
          { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        ],
        data: joinData,
      })
    );

    const sig = await sendAndConfirmTransaction(l1, tx, [sessionKey, authority], {
      skipPreflight: true,
    });
    expect(sig).toBeTruthy();
    await assertTxExists(l1, sig, "create+join on L1");

    // Verify game state
    const info = await l1.getAccountInfo(gamePda);
    expect(info).not.toBeNull();
    const d = info!.data;
    const statusOffset = 8 + 8 + 32 + 32; // disc + game_id + white + black
    expect(d[statusOffset]).toBe(1); // Active
    expect(d[statusOffset + 1]).toBe(0); // white to move

    console.log(`  Game created + joined on L1: ${sig.slice(0, 20)}...`);
  }, 30000);

  it("Step 2: Delegate game to MagicBlock ER", async () => {
    const buffer = delegateBufferPdaFromDelegatedAccountAndOwnerProgram(gamePda, CHESS);
    const delegationRecord = delegationRecordPdaFromDelegatedAccount(gamePda);
    const delegationMetadata = delegationMetadataPdaFromDelegatedAccount(gamePda);

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: CHESS,
        keys: [
          // Account order from IDL: buffer, record, metadata, game, payer, owner, delegation, system
          { pubkey: buffer, isSigner: false, isWritable: true },
          { pubkey: delegationRecord, isSigner: false, isWritable: true },
          { pubkey: delegationMetadata, isSigner: false, isWritable: true },
          { pubkey: gamePda, isSigner: false, isWritable: true },
          { pubkey: sessionKey.publicKey, isSigner: true, isWritable: true },
          { pubkey: CHESS, isSigner: false, isWritable: false },
          { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: disc("delegate_game"),
      })
    );

    const sig = await sendAndConfirmTransaction(l1, tx, [sessionKey], {
      skipPreflight: true,
    });
    expect(sig).toBeTruthy();
    console.log(`  Delegated to ER: ${sig.slice(0, 20)}...`);
  }, 30000);

  it("Step 3: Wait for ER to pick up the account", async () => {
    // ER needs a moment to sync the delegated account
    let found = false;
    for (let i = 0; i < 20; i++) {
      const info = await er.getAccountInfo(gamePda);
      if (info) {
        found = true;
        console.log(`  Account visible on ER after ${i + 1} attempts`);
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    expect(found).toBe(true);
  }, 30000);

  it("Step 4: Make white move (e2-e4) on ER — session key signs", async () => {
    const moveData = Buffer.alloc(11);
    disc("make_move").copy(moveData, 0);
    moveData.writeUInt8(12, 8);  // from: e2 (index 12)
    moveData.writeUInt8(28, 9);  // to: e4 (index 28)
    moveData.writeUInt8(0, 10);  // no promotion

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: CHESS,
        keys: [
          { pubkey: gamePda, isSigner: false, isWritable: true },
          { pubkey: sessionKey.publicKey, isSigner: true, isWritable: false },
        ],
        data: moveData,
      })
    );

    const sig = await sendAndConfirmTransaction(er, tx, [sessionKey], {
      skipPreflight: true,
    });
    expect(sig).toBeTruthy();
    console.log(`  White e2-e4 on ER: ${sig.slice(0, 20)}...`);

    // Verify state on ER
    const info = await er.getAccountInfo(gamePda);
    expect(info).not.toBeNull();
    const d = info!.data;
    const statusOffset = 8 + 8 + 32 + 32;
    expect(d[statusOffset + 1]).toBe(1); // black to move
    expect(d.readUInt16LE(statusOffset + 2)).toBe(1); // move_count = 1

    // Verify board: e2 empty, e4 has white pawn
    const boardOffset = statusOffset + 4 + 1 + 2 + 8 + 1 + 1;
    expect(d[boardOffset + 12]).toBe(0); // e2 empty
    expect(d[boardOffset + 28]).toBe(2); // e4 = white pawn
  }, 30000);

  it("Step 5: Make black move (e7-e5) on ER — authority signs (AI)", async () => {
    const moveData = Buffer.alloc(11);
    disc("make_move").copy(moveData, 0);
    moveData.writeUInt8(52, 8);  // from: e7 (index 52)
    moveData.writeUInt8(36, 9);  // to: e5 (index 36)
    moveData.writeUInt8(0, 10);

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: CHESS,
        keys: [
          { pubkey: gamePda, isSigner: false, isWritable: true },
          { pubkey: authority.publicKey, isSigner: true, isWritable: false },
        ],
        data: moveData,
      })
    );

    const sig = await sendAndConfirmTransaction(er, tx, [authority], {
      skipPreflight: true,
    });
    expect(sig).toBeTruthy();
    console.log(`  Black e7-e5 on ER: ${sig.slice(0, 20)}...`);

    // Verify
    const info = await er.getAccountInfo(gamePda);
    const d = info!.data;
    const statusOffset = 8 + 8 + 32 + 32;
    expect(d[statusOffset + 1]).toBe(0); // white to move
    expect(d.readUInt16LE(statusOffset + 2)).toBe(2); // move_count = 2
  }, 30000);

  it("Step 6: Make white move (Nf3) on ER", async () => {
    const moveData = Buffer.alloc(11);
    disc("make_move").copy(moveData, 0);
    moveData.writeUInt8(6, 8);   // from: g1 (index 6)
    moveData.writeUInt8(21, 9);  // to: f3 (index 21)
    moveData.writeUInt8(0, 10);

    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: CHESS,
        keys: [
          { pubkey: gamePda, isSigner: false, isWritable: true },
          { pubkey: sessionKey.publicKey, isSigner: true, isWritable: false },
        ],
        data: moveData,
      })
    );

    const sig = await sendAndConfirmTransaction(er, tx, [sessionKey], {
      skipPreflight: true,
    });
    expect(sig).toBeTruthy();
    console.log(`  White Nf3 on ER: ${sig.slice(0, 20)}...`);

    const info = await er.getAccountInfo(gamePda);
    const d = info!.data;
    const statusOffset = 8 + 8 + 32 + 32;
    expect(d.readUInt16LE(statusOffset + 2)).toBe(3); // 3 moves total

    console.log("\n  ===== ER POOL FLOW VERIFIED =====");
    console.log("  Game created on L1 ✓");
    console.log("  Delegated to MagicBlock ER ✓");
    console.log("  White move on ER (session key) ✓");
    console.log("  Black move on ER (authority/AI) ✓");
    console.log("  3 moves, all real Solana transactions ✓");
    console.log(`  Game PDA: ${gamePda.toBase58()}`);
  }, 30000);
});
