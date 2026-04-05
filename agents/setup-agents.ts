/**
 * Setup Gamerplex Agent Wallets
 *
 * 1. Generate 6 agent keypairs (one per skill tier)
 * 2. Fund each from deployer wallet
 * 3. Save keypairs to keys/ directory
 *
 * Run once: npx tsx setup-agents.ts
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const DEVNET_RPC = "https://api.devnet.solana.com";
const FUND_PER_AGENT = 0.05 * LAMPORTS_PER_SOL; // ~10k txs per agent
const AGENTS = ["pawn", "knight", "bishop", "rook", "queen", "king"];

async function main() {
  const connection = new Connection(DEVNET_RPC, "confirmed");

  // Load deployer wallet (default solana keypair)
  const deployerPath = `${process.env.HOME}/.config/solana/id.json`;
  const deployer = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(deployerPath, "utf-8")))
  );
  console.log(`Deployer: ${deployer.publicKey.toBase58()}`);

  const deployerBalance = await connection.getBalance(deployer.publicKey);
  console.log(`Deployer balance: ${(deployerBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  const required = AGENTS.length * FUND_PER_AGENT;
  if (deployerBalance < required) {
    console.error(`Insufficient SOL. Need ${required / LAMPORTS_PER_SOL}, have ${deployerBalance / LAMPORTS_PER_SOL}`);
    process.exit(1);
  }

  const keysDir = path.join(__dirname, "keys");
  if (!fs.existsSync(keysDir)) fs.mkdirSync(keysDir);

  console.log(`\nCreating ${AGENTS.length} agent wallets:`);
  for (const agentName of AGENTS) {
    const keyPath = path.join(keysDir, `${agentName}.json`);
    let kp: Keypair;

    if (fs.existsSync(keyPath)) {
      kp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(keyPath, "utf-8"))));
      console.log(`  ${agentName}: ${kp.publicKey.toBase58()} (existing)`);
    } else {
      kp = Keypair.generate();
      fs.writeFileSync(keyPath, JSON.stringify(Array.from(kp.secretKey)));
      console.log(`  ${agentName}: ${kp.publicKey.toBase58()} (NEW)`);
    }

    const currentBalance = await connection.getBalance(kp.publicKey);
    if (currentBalance < FUND_PER_AGENT / 2) {
      const needed = FUND_PER_AGENT - currentBalance;
      console.log(`    funding ${(needed / LAMPORTS_PER_SOL).toFixed(4)} SOL...`);
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: deployer.publicKey,
          toPubkey: kp.publicKey,
          lamports: needed,
        })
      );
      const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
      console.log(`    ✓ funded: ${sig.slice(0, 20)}...`);
    } else {
      console.log(`    balance: ${(currentBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL (OK)`);
    }
  }

  console.log(`\n✅ Agent wallets ready in ${keysDir}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
