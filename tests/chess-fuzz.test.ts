/**
 * Chess Engine Fuzz Test
 * Plays 100 random games, comparing our engine's valid moves
 * against chess.js (industry-standard reference implementation).
 *
 * If our engine generates moves chess.js considers illegal, or
 * misses moves chess.js considers legal, this test catches it.
 */

import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";

// ===== Our engine (copied from page.tsx) =====
const isW = (p: number) => p > 0 && p % 2 === 0;
const same = (a: number, b: number) => a > 0 && b > 0 && a % 2 === b % 2;
const pt = (p: number) => p & 0xfe;

function initBoard() {
  const b = Array(64).fill(0);
  b[0] = 4; b[1] = 6; b[2] = 8; b[3] = 10; b[4] = 12; b[5] = 8; b[6] = 6; b[7] = 4;
  for (let i = 8; i < 16; i++) b[i] = 2;
  for (let i = 48; i < 56; i++) b[i] = 3;
  b[56] = 5; b[57] = 7; b[58] = 9; b[59] = 11; b[60] = 13; b[61] = 9; b[62] = 7; b[63] = 5;
  return b;
}
function pathClear(f: number, t: number, b: number[]) {
  const fr = f >> 3, fc = f & 7, tr = t >> 3, tc = t & 7;
  const rs = Math.sign(tr - fr), cs = Math.sign(tc - fc);
  let r = fr + rs, c = fc + cs;
  while (r !== tr || c !== tc) { if (b[r * 8 + c]) return false; r += rs; c += cs; }
  return true;
}
function isAttacked(b: number[], sq: number, byW: boolean): boolean {
  for (let i = 0; i < 64; i++) {
    const p = b[i]; if (!p || byW !== isW(p)) continue;
    const t = pt(p), dr = Math.abs((sq >> 3) - (i >> 3)), dc = Math.abs((sq & 7) - (i & 7));
    if (t === 6 && ((dr === 2 && dc === 1) || (dr === 1 && dc === 2))) return true;
    if (t === 2) { const dir = byW ? 1 : -1; if ((sq >> 3) - (i >> 3) === dir && dc === 1) return true; }
    if (t === 12 && dr <= 1 && dc <= 1 && (dr + dc) > 0) return true;
    if ((t === 4 && (dr === 0 || dc === 0)) || (t === 8 && dr === dc && dr > 0) || (t === 10 && ((dr === 0 || dc === 0) || (dr === dc)) && (dr + dc) > 0)) {
      if (pathClear(i, sq, b)) return true;
    }
  }
  return false;
}
function getValid(b: number[], from: number, ep: number, castle: number): number[] {
  const p = b[from]; if (!p) return [];
  const w = isW(p), t = pt(p), r = from >> 3, c = from & 7, m: number[] = [];
  const add = (r: number, c: number) => {
    if (r < 0 || r > 7 || c < 0 || c > 7) return false;
    const i = r * 8 + c;
    if (same(p, b[i])) return false;
    if (!b[i]) { m.push(i); return true; }
    m.push(i); return false;
  };
  const line = (dr: number, dc: number) => {
    for (let i = 1; i < 8; i++) {
      if (!add(r + dr * i, c + dc * i) || b[(r + dr * i) * 8 + (c + dc * i)]) break;
    }
  };
  switch (t) {
    case 2: {
      const d = w ? 1 : -1, s = w ? 1 : 6, nr = r + d;
      if (nr >= 0 && nr <= 7 && !b[nr * 8 + c]) {
        m.push(nr * 8 + c);
        if (r === s && !b[(r + d * 2) * 8 + c]) m.push((r + d * 2) * 8 + c);
      }
      [-1, 1].forEach(dc => {
        const nc = c + dc;
        if (nr < 0 || nr > 7 || nc < 0 || nc > 7) return;
        const i = nr * 8 + nc;
        if (b[i] > 0 && !same(p, b[i])) m.push(i);
        if (i === ep) m.push(i);
      });
      break;
    }
    case 4: line(1, 0); line(-1, 0); line(0, 1); line(0, -1); break;
    case 6: [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]].forEach(([a, b]) => add(r + a, c + b)); break;
    case 8: line(1, 1); line(1, -1); line(-1, 1); line(-1, -1); break;
    case 10: line(1, 0); line(-1, 0); line(0, 1); line(0, -1); line(1, 1); line(1, -1); line(-1, 1); line(-1, -1); break;
    case 12: {
      [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]].forEach(([a, b]) => add(r + a, c + b));
      if (w) {
        if (castle & 1 && !b[5] && !b[6] && !isAttacked(b, 4, false) && !isAttacked(b, 5, false) && !isAttacked(b, 6, false)) m.push(6);
        if (castle & 2 && !b[1] && !b[2] && !b[3] && !isAttacked(b, 4, false) && !isAttacked(b, 3, false) && !isAttacked(b, 2, false)) m.push(2);
      } else {
        if (castle & 4 && !b[61] && !b[62] && !isAttacked(b, 60, true) && !isAttacked(b, 61, true) && !isAttacked(b, 62, true)) m.push(62);
        if (castle & 8 && !b[57] && !b[58] && !b[59] && !isAttacked(b, 60, true) && !isAttacked(b, 59, true) && !isAttacked(b, 58, true)) m.push(58);
      }
      break;
    }
  }
  const k = w ? 12 : 13;
  return m.filter(to => {
    const t2 = [...b];
    t2[to] = p; t2[from] = 0;
    if (pt(p) === 2 && to === ep) t2[(to & 7) + r * 8] = 0;
    if (pt(p) === 12 && Math.abs((to & 7) - c) === 2) {
      if ((to & 7) === 6) { t2[r * 8 + 5] = t2[r * 8 + 7]; t2[r * 8 + 7] = 0; }
      if ((to & 7) === 2) { t2[r * 8 + 3] = t2[r * 8 + 0]; t2[r * 8 + 0] = 0; }
    }
    if (pt(p) === 2 && ((to >> 3) === (w ? 7 : 0))) t2[to] = w ? 10 : 11;
    const ks = t2.indexOf(k);
    return ks >= 0 && !isAttacked(t2, ks, !w);
  });
}
function updCastle(c: number, f: number, t: number) {
  let n = c;
  if (f === 4 || t === 4) n &= 0b1100;
  if (f === 60 || t === 60) n &= 0b0011;
  if (f === 0 || t === 0) n &= 0b1101;
  if (f === 7 || t === 7) n &= 0b1110;
  if (f === 56 || t === 56) n &= 0b0111;
  if (f === 63 || t === 63) n &= 0b1011;
  return n;
}

// ===== Helpers to convert between our format and chess.js =====
const idxToAlg = (idx: number) => String.fromCharCode(97 + (idx & 7)) + ((idx >> 3) + 1);
const algToIdx = (a: string) => (parseInt(a[1]) - 1) * 8 + (a.charCodeAt(0) - 97);

function ourSquaresOfPiece(b: number[], pieceType: number, isWhite: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (p === 0) continue;
    if (pt(p) !== pieceType) continue;
    if (isW(p) !== isWhite) continue;
    out.push(i);
  }
  return out;
}

// Get all legal moves from our engine in {from, to} pairs
function ourAllMoves(b: number[], whiteTurn: boolean, ep: number, castle: number): Array<{from: number, to: number}> {
  const moves: Array<{from: number, to: number}> = [];
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (p === 0) continue;
    if (isW(p) !== whiteTurn) continue;
    const targets = getValid(b, i, ep, castle);
    targets.forEach(to => moves.push({ from: i, to }));
  }
  return moves;
}

// Parse FEN to our board format (source of truth = chess.js)
function fenToBoard(fen: string): { board: number[]; whiteTurn: boolean; ep: number; castle: number } {
  const parts = fen.split(" ");
  const boardPart = parts[0];
  const turn = parts[1] === "w";
  const castleStr = parts[2];
  const epStr = parts[3];

  const b = Array(64).fill(0);
  const pieceMap: Record<string, number> = {
    P: 2, p: 3, R: 4, r: 5, N: 6, n: 7, B: 8, b: 9, Q: 10, q: 11, K: 12, k: 13,
  };

  const rows = boardPart.split("/");
  // FEN rank 8 is first, rank 1 is last. Our index 0 = a1, 63 = h8.
  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    const row = rows[rankIdx];
    const rank = 7 - rankIdx; // FEN rank 8 → our rank 7 (index 56-63)
    let file = 0;
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") {
        file += parseInt(ch);
      } else {
        b[rank * 8 + file] = pieceMap[ch] || 0;
        file++;
      }
    }
  }

  let castle = 0;
  if (castleStr.includes("K")) castle |= 0b0001; // white kingside
  if (castleStr.includes("Q")) castle |= 0b0010; // white queenside
  if (castleStr.includes("k")) castle |= 0b0100; // black kingside
  if (castleStr.includes("q")) castle |= 0b1000; // black queenside

  let ep = 255;
  if (epStr !== "-") {
    const file = epStr.charCodeAt(0) - 97;
    const rank = parseInt(epStr[1]) - 1;
    ep = rank * 8 + file;
  }

  return { board: b, whiteTurn: turn, ep, castle };
}

describe("Chess Engine Fuzz Test — Validated Against chess.js", () => {
  it("compares our engine's legal moves vs chess.js for 100 random games", () => {
    let totalMovesChecked = 0;
    let mismatches: Array<{ fen: string; ours: string[]; theirs: string[] }> = [];

    for (let gameNum = 0; gameNum < 500; gameNum++) {
      const reference = new Chess();

      for (let moveNum = 0; moveNum < 80 && !reference.isGameOver(); moveNum++) {
        // Parse chess.js's current position as source of truth
        const { board: ourBoard, whiteTurn, ep, castle } = fenToBoard(reference.fen());
        const theirMoves = reference.moves({ verbose: true });
        const ourMoves = ourAllMoves(ourBoard, whiteTurn, ep, castle);

        // Convert to comparable sets (from+to, ignoring promotion details for now)
        const theirSet = new Set(theirMoves.map(m => m.from + m.to));
        const ourSet = new Set(ourMoves.map(m => idxToAlg(m.from) + idxToAlg(m.to)));

        if (theirSet.size !== ourSet.size || ![...theirSet].every(m => ourSet.has(m))) {
          const fen = reference.fen();
          const onlyTheirs = [...theirSet].filter(m => !ourSet.has(m));
          const onlyOurs = [...ourSet].filter(m => !theirSet.has(m));
          mismatches.push({
            fen,
            ours: onlyOurs,  // we have, chess.js says illegal
            theirs: onlyTheirs, // chess.js has, we miss
          });
          if (mismatches.length <= 9) {
            console.log(`\n  MISMATCH at game ${gameNum}, move ${moveNum}:`);
            console.log(`  FEN: ${fen}`);
            console.log(`  chess.js moves: ${theirMoves.length}, ours: ${ourMoves.length}`);
            console.log(`  Only in ours (potentially illegal): ${onlyOurs.join(", ") || "none"}`);
            console.log(`  Missing from ours: ${onlyTheirs.join(", ") || "none"}`);
          }
          break;
        }
        totalMovesChecked += theirMoves.length;

        // Pick a random legal move from chess.js and apply
        if (theirMoves.length === 0) break;
        const pick = theirMoves[Math.floor(Math.random() * theirMoves.length)];
        reference.move(pick);
      }
    }

    console.log(`\n  Checked ${totalMovesChecked} positions across 500 games`);
    console.log(`  Mismatches: ${mismatches.length}`);

    expect(mismatches).toHaveLength(0);
  }, 60000);
});
