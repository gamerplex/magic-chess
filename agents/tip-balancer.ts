/**
 * GAMERPLEX AGENT TIP BALANCER
 *
 * Self-balancing treasury: checks all 6 agent wallet balances,
 * redistributes SOL from rich agents to poor agents when imbalanced.
 *
 * Keeps the agent economy stable without external top-ups.
 * Every tip is a real on-chain transfer (Solana devnet).
 *
 * Usage:
 *   npx tsx tip-balancer.ts          # one-shot balance check
 *   WATCH=true npx tsx tip-balancer.ts  # continuous (every 5 min)
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
const MIN_BALANCE = 0.01 * LAMPORTS_PER_SOL;      // tip recipient threshold
const TARGET_BALANCE = 0.03 * LAMPORTS_PER_SOL;   // tip until this level
const WATCH = process.env.WATCH === "true";
const AGENTS = ["sf1200", "sf1500", "sf1800", "sf2100", "sf2400", "sf3000"];

function loadAgent(name: string): Keypair {
  const p = path.join(__dirname, "keys", `${name}.json`);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(fs.readFileSync(p, "utf-8"))));
}

async function balance(conn: Connection): Promise<void> {
  const keypairs = AGENTS.map(loadAgent);
  const balances = await Promise.all(
    keypairs.map(async (kp, i) => ({
      name: AGENTS[i].toUpperCase(),
      kp,
      balance: await conn.getBalance(kp.publicKey),
    }))
  );

  console.log(`\n🏦 Agent Wallet Balances (${new Date().toLocaleTimeString()})`);
  console.log("━".repeat(60));
  balances.forEach(b => {
    const sol = (b.balance / LAMPORTS_PER_SOL).toFixed(4);
    const status = b.balance < MIN_BALANCE ? " ⚠️  LOW" : "";
    console.log(`  ${b.name.padEnd(8)} ${sol} SOL${status}`);
  });

  const totalSol = balances.reduce((s, b) => s + b.balance, 0) / LAMPORTS_PER_SOL;
  const avgSol = totalSol / balances.length;
  console.log("━".repeat(60));
  console.log(`  Total: ${totalSol.toFixed(4)} SOL · Avg: ${avgSol.toFixed(4)} SOL\n`);

  // Find imbalanced agents
  const poor = balances.filter(b => b.balance < MIN_BALANCE).sort((a, b) => a.balance - b.balance);
  const rich = balances.filter(b => b.balance > TARGET_BALANCE * 2).sort((a, b) => b.balance - a.balance);

  if (poor.length === 0) {
    console.log("✅ All agents above threshold. No tips needed.");
    return;
  }

  if (rich.length === 0) {
    console.log("⚠️  Some agents low but no rich donors available. Need external top-up.");
    return;
  }

  // Tip flow: richest agent tips poorest
  for (const poorAgent of poor) {
    const donor = rich[0];
    if (!donor || donor.balance < TARGET_BALANCE * 2) break;

    const tipAmount = TARGET_BALANCE - poorAgent.balance;
    console.log(`💸 Tipping ${(tipAmount / LAMPORTS_PER_SOL).toFixed(4)} SOL: ${donor.name} → ${poorAgent.name}`);

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: donor.kp.publicKey,
        toPubkey: poorAgent.kp.publicKey,
        lamports: tipAmount,
      })
    );

    try {
      const sig = await sendAndConfirmTransaction(conn, tx, [donor.kp]);
      console.log(`  ✓ tx: ${sig.slice(0, 20)}... (https://explorer.solana.com/tx/${sig}?cluster=devnet)`);
      donor.balance -= tipAmount + 5000; // tx fee
      poorAgent.balance += tipAmount;
    } catch (err: any) {
      console.error(`  ✗ failed: ${err.message?.slice(0, 100)}`);
    }
  }
}

async function main() {
  const conn = new Connection(DEVNET_RPC, "confirmed");
  await balance(conn);

  if (WATCH) {
    console.log("\n👁️  Watching every 5 min...");
    setInterval(() => balance(conn).catch(console.error), 5 * 60 * 1000);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
