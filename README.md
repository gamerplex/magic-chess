# Magic Chess — Fully On-Chain Chess on MagicBlock ER

> **Every single move is a real Solana transaction on MagicBlock's Ephemeral Rollup.**
> No server adjudication, no "eventually consistent" state — the chain validates every rule.

**Live demo:** https://gamerplex.com/play/chess
**Submission for:** Solana Blitz v3 (MagicBlock Hackathon, April 2026)
**Built by:** Johnny Buidl ([@zerorouter](https://x.com/zerorouter)) — solo builder

---

## ⚡ Quick Pitch

Magic Chess proves MagicBlock's Ephemeral Rollup can power real-time fully on-chain games with zero wallet friction. It's the flagship game of the **Gamerplex** protocol.

- 🎯 **580 lines of Rust** — full chess rules engine on-chain
- 🧪 **1.2M positions fuzz-tested** against chess.js — **zero** mismatches
- ⚡ **ER Pool** — players start games in <1 second, no wallet connect required
- 🤖 **6 Stockfish-calibrated agents** play each other 24/7 on real devnet
- 🏆 **SOAR leaderboard** — wallet-owned ELO, permanent, portable
- 🎨 **3D Three.js board** with cinematic rotating camera

---

## 🎥 Demo

1. Visit https://gamerplex.com
2. Watch up to 5 Gamerplex Agents (SF1200 → SF3000) playing live chess on MagicBlock ER
3. Click "Play Magic Chess" → game starts instantly (ER pool assigns a slot)
4. Every move creates a real on-chain TX — click TX links to see on Solana Explorer
5. Game over → optionally connect wallet to save ELO on SOAR

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────┐
│  FRONTEND (Next.js + Three.js)                            │
│  ui/ChessPage.tsx, ui/Chess3DBoard.tsx                    │
│  Browser signs white moves directly with session key      │
└──────────────────────────────────────────────────────────┘
                           ↓ signs + sends
┌──────────────────────────────────────────────────────────┐
│  MAGICBLOCK EPHEMERAL ROLLUP                              │
│  devnet.magicblock.app                                    │
│  GameState PDA (delegated from L1) validates make_move    │
└──────────────────────────────────────────────────────────┘
                           ↑ creates/delegates/commits
┌──────────────────────────────────────────────────────────┐
│  SOLANA L1 (devnet)                                       │
│  Chess Program: 3LVg8uUsHtq6fusjrSfyGUCLQ83TFegDKmY3bCNz3QYr │
│  580 lines of Rust — full chess rules                     │
└──────────────────────────────────────────────────────────┘
                           ↑ manages
┌──────────────────────────────────────────────────────────┐
│  ER POOL (Cloud Run resolver)                             │
│  server/er-pool.ts, server/game-pool.routes.ts            │
│  Pre-creates 10 GameState PDAs, delegates all to ER.      │
│  Assigns instantly to arriving players.                   │
└──────────────────────────────────────────────────────────┘
```

---

## 📁 Repo Structure

```
magic-chess/
├── program/              # Anchor workspace (Rust)
│   └── programs/chess/
│       └── src/lib.rs    # 580 lines, full chess rules
├── ui/                   # React components for web3 chess app
│   ├── ChessPage.tsx     # Main game page (2D + 3D toggle)
│   ├── Chess3DBoard.tsx  # Three.js 3D board with auto-rotate
│   ├── chain.ts          # ER pool client + move signing
│   ├── magic.css         # Magic-themed styling
│   └── chess-idl.json    # Program IDL
├── server/               # Backend (Node/Express, deployed to Cloud Run)
│   ├── er-pool.ts        # ER pool management (pre-create + delegate)
│   └── game-pool.routes.ts  # REST API endpoints
├── agents/               # AI agents (Node)
│   ├── chess-agent.ts    # Stockfish-calibrated minimax AI
│   ├── chess-daemon.ts   # Runs 5 parallel games continuously
│   ├── setup-agents.ts   # Creates 6 agent wallets + funds them
│   └── tip-balancer.ts   # Redistributes SOL between agents
└── tests/                # E2E tests (Vitest, real devnet, zero mocks)
    ├── er-pool.test.ts          # Delegation + ER moves (6 tests)
    ├── chess-onchain.test.ts    # L1 program tests (6 tests)
    ├── chess-rules.test.ts      # Rules engine (25 tests)
    ├── chess-fuzz.test.ts       # 1.2M positions vs chess.js
    └── chess-famous-games.test.ts  # Replays historical games (12 tests)
```

---

## 🧪 Test Results

```
Chess engine verified: 1,232,746 positions checked across 100 games
Mismatches: 0 (zero illegal moves, zero missed legal moves)

46 chess-specific tests:
  ✓ Chess Rules Engine (25)   — pawn, bishop, knight, rook, queen, king, castling, pins, check
  ✓ Famous Games (12)         — Immortal Game, Kasparov vs Topalov, etc
  ✓ ER Pool (6)               — delegation + commit lifecycle
  ✓ Fuzz test (3)             — chess.js parity

6 ER pool tests (real devnet + MagicBlock ER):
  ✓ Create game on L1 (session=white, authority=black)   2.3s
  ✓ Delegate game to MagicBlock ER                       1.2s
  ✓ ER picks up account                                  instant
  ✓ White e2-e4 on ER (session key signs)                0.8s
  ✓ Black e7-e5 on ER (authority/AI signs)               0.4s
  ✓ White Nf3 on ER                                      0.4s
```

Run tests:
```bash
cd tests && npm install && npm test
```

---

## 🚀 Run Locally

### Prerequisites
- Node 20+
- Solana CLI
- Anchor 0.32+
- Rust
- ~0.5 SOL on devnet

### 1. Deploy the chess program
```bash
cd program
anchor build
anchor deploy --provider.cluster devnet
```

### 2. Run tests
```bash
cd tests
npm install
npm test          # full suite (requires devnet SOL)
```

### 3. Run agents locally
```bash
cd agents
npm install
npx tsx setup-agents.ts                    # create 6 agent wallets
NUM_GAMES=5 npx tsx chess-daemon.ts        # start 5 bots playing
```

### 4. Embed the UI in your app
```tsx
import Chess3DBoard from "./ui/Chess3DBoard";
import ChessPage from "./ui/ChessPage";
```

---

## 🔑 Deployed Addresses (Solana devnet)

| Program | Address |
|---------|---------|
| Chess | [`3LVg8uUsHtq6fusjrSfyGUCLQ83TFegDKmY3bCNz3QYr`](https://explorer.solana.com/address/3LVg8uUsHtq6fusjrSfyGUCLQ83TFegDKmY3bCNz3QYr?cluster=devnet) |
| SOAR | [`SoarNNzwQHMwcfdkdLc6kvbkoMSxcHy89gTHrjhJYkk`](https://explorer.solana.com/address/SoarNNzwQHMwcfdkdLc6kvbkoMSxcHy89gTHrjhJYkk?cluster=devnet) |

**MagicBlock ER endpoint:** `https://devnet.magicblock.app`

---

## 🎨 What Makes This Submission Different

### Creativity
- **ER Pool pattern** — novel way to give players instant on-chain games with zero wallet friction. Pre-create + delegate + recycle.
- **Live agents on the landing page** — visitors see real on-chain activity in real-time, with a cinematic rotating 3D board.
- **Gamerplex Rankings Protocol** — portable wallet-owned ELO as a public good (combines ELO + Glicko-2 + OpenSkill + SOAR).

### Technical Quality
- **1.2 million chess positions fuzz-tested** against chess.js — engine correctness proven mathematically
- **Full chess rules in 580 lines of Rust** — castling, en passant, promotion, check, pin, threefold repetition
- **Real E2E tests on devnet** — zero mocks, every test hits real Solana + real MagicBlock ER

### Meaningful MagicBlock Integration
- Not just "uses ER" — builds the **ER Pool pattern** that makes free on-chain play economically viable
- Full delegation + commit/undelegate lifecycle implemented via `#[delegate]` and `#[commit]` macros
- SOAR integration for permanent leaderboards
- 6 AI agents demonstrating continuous on-chain gameplay at scale

---

## 🔗 Links

- **Live app:** https://gamerplex.com
- **Play:** https://gamerplex.com/play/chess
- **Activity feed:** https://gamerplex.com/activity
- **Docs:** https://gamerplex.com/docs
- **X/Twitter:** [@zerorouter](https://x.com/zerorouter)

---

## 📜 License

MIT — fork it, build on it, host your own.

---

## 🙏 Credits

- **MagicBlock** — Ephemeral Rollup + SOAR infrastructure
- **Solana Foundation** — the chain we build on
- **chess.js** — reference chess engine (used in fuzz tests)
- **Three.js** — 3D rendering

Built for **Solana Blitz v3** hackathon (April 2026).
