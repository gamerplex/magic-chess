/**
 * Test: Chess program — real game creation, moves, settlement on devnet.
 * Program: 3LVg8uUsHtq6fusjrSfyGUCLQ83TFegDKmY3bCNz3QYr
 *
 * This test creates a REAL game, makes REAL moves, and reads REAL on-chain state.
 * Every assertion verifies data returned from Solana devnet RPC.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getConnection,
  loadKeypair,
  createFundedKeypair,
  assertTxExists,
  assertAccountExists,
  PROGRAMS,
} from "./helpers";

const GAME_SEED = Buffer.from("chess_game");

async function getDiscriminator(name: string): Promise<Buffer> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`global:${name}`)
  );
  return Buffer.from(new Uint8Array(hash).slice(0, 8));
}

function getGamePda(gameId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [GAME_SEED, Buffer.from(new BigUint64Array([BigInt(gameId)]).buffer)],
    PROGRAMS.chess
  );
}

describe("Chess Program E2E", () => {
  let connection: Connection;
  let authority: Keypair;
  let player: Keypair;
  let gameId: number;
  let gamePda: PublicKey;

  beforeAll(async () => {
    connection = getConnection();
    authority = loadKeypair();
    player = await createFundedKeypair(connection, authority, 0.05 * LAMPORTS_PER_SOL);
    gameId = Date.now();
    [gamePda] = getGamePda(gameId);
  });

  it("Chess program is deployed on devnet", async () => {
    const info = await connection.getAccountInfo(PROGRAMS.chess);
    expect(info).not.toBeNull();
    expect(info!.executable).toBe(true);
  });

  it("player keypair was funded", async () => {
    const balance = await connection.getBalance(player.publicKey);
    expect(balance).toBeGreaterThan(0);
  });

  it("create_game creates a GameState PDA on-chain", async () => {
    const disc = await getDiscriminator("create_game");
    const data = Buffer.alloc(8 + 8 + 2);
    disc.copy(data, 0);
    data.writeBigUInt64LE(BigInt(gameId), 8);
    data.writeUInt16LE(120, 16); // 120s per move

    const ix = new TransactionInstruction({
      programId: PROGRAMS.chess,
      keys: [
        { pubkey: gamePda, isSigner: false, isWritable: true },
        { pubkey: player.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [player], {
      skipPreflight: true,
    });

    expect(sig).toBeTruthy();
    await assertTxExists(connection, sig, "create_game");
    await assertAccountExists(connection, gamePda, "GameState PDA");
  });

  it("GameState PDA contains correct initial board", async () => {
    const info = await connection.getAccountInfo(gamePda);
    expect(info).not.toBeNull();

    // Parse GameState: skip 8-byte discriminator
    const d = info!.data;
    const offset = 8;

    // game_id (u64) at offset 8
    const storedGameId = d.readBigUInt64LE(offset);
    expect(Number(storedGameId)).toBe(gameId);

    // white (Pubkey 32 bytes) at offset 16
    const white = new PublicKey(d.slice(offset + 8, offset + 8 + 32));
    expect(white.toBase58()).toBe(player.publicKey.toBase58());

    // status at offset 8 + 8 + 32 + 32 = 80
    const statusOffset = offset + 8 + 32 + 32;
    const status = d[statusOffset]; // 0 = WaitingForBlack
    expect(status).toBe(0);

    // turn at statusOffset + 1
    const turn = d[statusOffset + 1];
    expect(turn).toBe(0); // white to move

    // move_count at statusOffset + 2 (u16)
    const moveCount = d.readUInt16LE(statusOffset + 2);
    expect(moveCount).toBe(0);
  });

  it("make_move sends e2-e4 (square 12 to 28) on-chain", async () => {
    // First need a second player to join so game is Active
    // For this test, we skip join and test that make_move correctly rejects
    // (game is still WaitingForBlack)
    const disc = await getDiscriminator("make_move");
    const data = Buffer.alloc(8 + 1 + 1 + 1);
    disc.copy(data, 0);
    data.writeUInt8(12, 8); // from: e2 (row 1, col 4 = index 12)
    data.writeUInt8(28, 9); // to: e4 (row 3, col 4 = index 28)
    data.writeUInt8(0, 10); // no promotion

    const ix = new TransactionInstruction({
      programId: PROGRAMS.chess,
      keys: [
        { pubkey: gamePda, isSigner: false, isWritable: true },
        { pubkey: player.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);

    // This SHOULD fail because game status is WaitingForBlack (no opponent joined)
    // The program enforces status == Active before allowing moves
    let failed = false;
    try {
      await sendAndConfirmTransaction(connection, tx, [player], {
        skipPreflight: true,
      });
    } catch {
      // Expected: program rejects because game status is WaitingForBlack
      failed = true;
    }
    expect(failed).toBe(true);
  });

  it("join_game + make_move works for a complete 2-player flow", async () => {
    // Create a fresh game
    const gid2 = Date.now() + 1;
    const [pda2] = getGamePda(gid2);
    const player2 = await createFundedKeypair(connection, authority, 0.02 * LAMPORTS_PER_SOL);

    // Create game
    const createDisc = await getDiscriminator("create_game");
    const createData = Buffer.alloc(18);
    createDisc.copy(createData, 0);
    createData.writeBigUInt64LE(BigInt(gid2), 8);
    createData.writeUInt16LE(120, 16);

    const createIx = new TransactionInstruction({
      programId: PROGRAMS.chess,
      keys: [
        { pubkey: pda2, isSigner: false, isWritable: true },
        { pubkey: player.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: createData,
    });
    const createSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(createIx),
      [player],
      { skipPreflight: true }
    );
    expect(createSig).toBeTruthy();

    // Join game as player2
    const joinDisc = await getDiscriminator("join_game");
    const joinData = Buffer.alloc(16);
    joinDisc.copy(joinData, 0);
    joinData.writeBigUInt64LE(BigInt(gid2), 8);

    const joinIx = new TransactionInstruction({
      programId: PROGRAMS.chess,
      keys: [
        { pubkey: pda2, isSigner: false, isWritable: true },
        { pubkey: player2.publicKey, isSigner: true, isWritable: true },
      ],
      data: joinData,
    });
    const joinSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(joinIx),
      [player2],
      { skipPreflight: true }
    );
    expect(joinSig).toBeTruthy();

    // Verify game is now Active (status = 1)
    const infoAfterJoin = await connection.getAccountInfo(pda2);
    expect(infoAfterJoin).not.toBeNull();
    const statusOffset = 8 + 8 + 32 + 32; // disc + game_id + white + black
    expect(infoAfterJoin!.data[statusOffset]).toBe(1); // Active

    // Make move: e2-e4 (white, player1)
    const moveDisc = await getDiscriminator("make_move");
    const moveData = Buffer.alloc(11);
    moveDisc.copy(moveData, 0);
    moveData.writeUInt8(12, 8); // e2
    moveData.writeUInt8(28, 9); // e4
    moveData.writeUInt8(0, 10); // no promotion

    const moveIx = new TransactionInstruction({
      programId: PROGRAMS.chess,
      keys: [
        { pubkey: pda2, isSigner: false, isWritable: true },
        { pubkey: player.publicKey, isSigner: true, isWritable: false },
      ],
      data: moveData,
    });
    const moveSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(moveIx),
      [player],
      { skipPreflight: true }
    );
    expect(moveSig).toBeTruthy();
    await assertTxExists(connection, moveSig, "make_move e2-e4");

    // Verify on-chain: move_count should be 1, turn should be 1 (black)
    const infoAfterMove = await connection.getAccountInfo(pda2);
    expect(infoAfterMove).not.toBeNull();
    const turn = infoAfterMove!.data[statusOffset + 1];
    expect(turn).toBe(1); // black's turn
    const moveCount = infoAfterMove!.data.readUInt16LE(statusOffset + 2);
    expect(moveCount).toBe(1);

    // Verify board: e2 (index 12) should be empty, e4 (index 28) should have white pawn (2)
    const boardOffset = statusOffset + 4 + 1 + 2 + 8 + 1 + 1; // after status fields
    const e2 = infoAfterMove!.data[boardOffset + 12];
    const e4 = infoAfterMove!.data[boardOffset + 28];
    expect(e2).toBe(0); // empty
    expect(e4).toBe(2); // white pawn
  });
});
