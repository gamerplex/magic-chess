/**
 * Shared test helpers — real devnet connections, real keypairs, real transactions.
 * NO MOCKS. Every helper hits Solana devnet.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";

export const DEVNET_RPC = "https://api.devnet.solana.com";
export const ER_RPC = "https://devnet.magicblock.app";

// Program IDs — deployed on devnet
export const PROGRAMS = {
  chess: new PublicKey("3LVg8uUsHtq6fusjrSfyGUCLQ83TFegDKmY3bCNz3QYr"),
  soar: new PublicKey("SoarNNzwQHMwcfdkdLc6kvbkoMSxcHy89gTHrjhJYkk"),
};

export const RESOLVER_URL =
  process.env.RESOLVER_URL ||
  "https://resolver.gamerplex.com";

/**
 * Load the default Solana keypair (~/.config/solana/id.json).
 */
export function loadKeypair(
  path?: string
): Keypair {
  const keyPath =
    path || `${process.env.HOME}/.config/solana/id.json`;
  const raw = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(raw));
}

/**
 * Get a devnet connection.
 */
export function getConnection(): Connection {
  return new Connection(DEVNET_RPC, "confirmed");
}

/**
 * Create and fund a temp keypair on devnet via transfer from authority.
 * NOT airdrop (rate limited). Transfer from the main wallet.
 */
export async function createFundedKeypair(
  connection: Connection,
  funder: Keypair,
  lamports: number = 0.05 * LAMPORTS_PER_SOL
): Promise<Keypair> {
  const kp = Keypair.generate();
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: kp.publicKey,
      lamports,
    })
  );
  await sendAndConfirmTransaction(connection, tx, [funder]);
  return kp;
}

/**
 * Assert a transaction signature exists on-chain.
 * This is the core assertion — if the sig doesn't exist, the test fails.
 */
export async function assertTxExists(
  connection: Connection,
  sig: string,
  label: string = "transaction"
): Promise<void> {
  const status = await connection.getSignatureStatus(sig);
  if (!status?.value) {
    throw new Error(
      `${label}: Transaction ${sig} not found on-chain`
    );
  }
  if (status.value.err) {
    throw new Error(
      `${label}: Transaction ${sig} failed on-chain: ${JSON.stringify(status.value.err)}`
    );
  }
}

/**
 * Assert an account exists on-chain.
 */
export async function assertAccountExists(
  connection: Connection,
  address: PublicKey,
  label: string = "account"
): Promise<void> {
  const info = await connection.getAccountInfo(address);
  if (!info) {
    throw new Error(`${label}: Account ${address.toBase58()} not found on-chain`);
  }
}

/**
 * Assert a program is deployed on devnet.
 */
export async function assertProgramDeployed(
  connection: Connection,
  programId: PublicKey
): Promise<void> {
  const info = await connection.getAccountInfo(programId);
  if (!info) {
    throw new Error(`Program ${programId.toBase58()} not deployed on devnet`);
  }
  if (!info.executable) {
    throw new Error(`Account ${programId.toBase58()} exists but is not executable`);
  }
}

/**
 * Fetch JSON from resolver API.
 */
export async function resolverFetch(
  path: string,
  options?: RequestInit
): Promise<any> {
  const res = await fetch(`${RESOLVER_URL}${path}`, options);
  if (!res.ok) {
    throw new Error(`Resolver ${path} returned ${res.status}: ${await res.text()}`);
  }
  return res.json();
}
