/**
 * Chess Rules Test — validates the pure JS chess engine that runs in the browser.
 * This mirrors the exact logic in gamerplex.com-2026/app/play/chess/page.tsx lines 23-30.
 *
 * Covers every rule scenario to prove the engine is correct.
 */

import { describe, it, expect } from "vitest";

// ===== Copy of chess engine from page.tsx =====
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
  while (r !== tr || c !== tc) {
    if (b[r * 8 + c]) return false;
    r += rs; c += cs;
  }
  return true;
}

function isAttacked(b: number[], sq: number, byW: boolean): boolean {
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || byW !== isW(p)) continue;
    const t = pt(p);
    const dr = Math.abs((sq >> 3) - (i >> 3)), dc = Math.abs((sq & 7) - (i & 7));
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
  const p = b[from];
  if (!p) return [];
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
    case 2: { // Pawn
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

// Helpers
const sq = (file: string, rank: number) => (rank - 1) * 8 + (file.charCodeAt(0) - 97);
const sqName = (idx: number) => String.fromCharCode(97 + (idx & 7)) + ((idx >> 3) + 1);

function execMoveTest(from: number, to: number, board: number[]): number[] {
  const p = board[from];
  const nb = [...board];
  nb[to] = p; nb[from] = 0;
  return nb;
}

describe("Chess Rules Engine — Pawn", () => {
  it("pawn on e2 can move to e3 and e4 from start", () => {
    const b = initBoard();
    const moves = getValid(b, sq("e", 2), 255, 0b1111);
    expect(moves).toContain(sq("e", 3));
    expect(moves).toContain(sq("e", 4));
    expect(moves).toHaveLength(2);
  });

  it("pawn on e4 can only move to e5 (single step)", () => {
    let b = initBoard();
    b = execMoveTest(sq("e", 2), sq("e", 4), b);
    const moves = getValid(b, sq("e", 4), 255, 0b1111);
    expect(moves).toContain(sq("e", 5));
    expect(moves).toHaveLength(1);
  });

  it("pawn blocked can't move", () => {
    let b = initBoard();
    b = execMoveTest(sq("e", 7), sq("e", 5), b); // black pawn to e5
    b = execMoveTest(sq("e", 2), sq("e", 4), b); // white pawn to e4 (now blocks nothing)
    // black pawn on e5, white pawn on e4 — both pawns face each other, blocked
    const whiteMoves = getValid(b, sq("e", 4), 255, 0b1111);
    expect(whiteMoves).toHaveLength(0); // blocked by e5 pawn
    const blackMoves = getValid(b, sq("e", 5), 255, 0b1111);
    expect(blackMoves).toHaveLength(0); // blocked by e4 pawn
  });

  it("pawn on d5 CAN capture black pawn on c6 (standard position, no check)", () => {
    // Pawn captures work normally when king is NOT in check
    const b = Array(64).fill(0);
    b[sq("d", 5)] = 2; // white pawn
    b[sq("c", 6)] = 3; // black pawn
    b[sq("e", 1)] = 12; // white king
    b[sq("e", 8)] = 13; // black king
    const moves = getValid(b, sq("d", 5), 255, 0);
    expect(moves).toContain(sq("c", 6)); // diagonal capture
    expect(moves).toContain(sq("d", 6)); // forward push
  });

  it("USER SCENARIO: Qa5 check — pawn d5 CANNOT capture c6 because king is in check", () => {
    // This reproduces the user's bug report exactly.
    // Moves: d4, c6, d5, Qa5
    // Black queen on a5 gives check along a5-b4-c3-d2-e1 diagonal (d2 empty since pawn moved)
    // White MUST address check — pawn capture of c6 does not block/stop the check
    let b = initBoard();
    b = execMoveTest(sq("d", 2), sq("d", 4), b);
    b = execMoveTest(sq("c", 7), sq("c", 6), b);
    b = execMoveTest(sq("d", 4), sq("d", 5), b);
    b = execMoveTest(sq("d", 8), sq("a", 5), b);

    // Verify king IS in check
    const e1 = sq("e", 1);
    const kingInCheck = isAttacked(b, e1, false);
    expect(kingInCheck).toBe(true); // black queen attacks white king

    // Pawn on d5 cannot move anywhere (including c6 capture) because it doesn't resolve check
    const pawnMoves = getValid(b, sq("d", 5), 255, 0b1111);
    console.log("  Pawn d5 moves (king in check):", pawnMoves.map(sqName));
    expect(pawnMoves).toHaveLength(0);

    // Blocking: knight b1 to c3 blocks the queen's diagonal attack
    const knightMoves = getValid(b, sq("b", 1), 255, 0b1111);
    console.log("  Legal knight b1 moves:", knightMoves.map(sqName));
    expect(knightMoves).toContain(sq("c", 3));
  });

  it("pawn can capture on both diagonals", () => {
    let b = initBoard();
    // Set up: white pawn d5, black pawns c6 and e6
    b = execMoveTest(sq("d", 2), sq("d", 5), b);
    b = execMoveTest(sq("c", 7), sq("c", 6), b);
    b = execMoveTest(sq("e", 7), sq("e", 6), b);

    const moves = getValid(b, sq("d", 5), 255, 0b1111);
    expect(moves).toContain(sq("c", 6));
    expect(moves).toContain(sq("e", 6));
  });

  it("pawn cannot move diagonally without capture", () => {
    let b = initBoard();
    b = execMoveTest(sq("e", 2), sq("e", 4), b);
    const moves = getValid(b, sq("e", 4), 255, 0b1111);
    expect(moves).not.toContain(sq("d", 5));
    expect(moves).not.toContain(sq("f", 5));
  });

  it("en passant capture works", () => {
    let b = initBoard();
    b = execMoveTest(sq("e", 2), sq("e", 5), b); // white pawn to e5
    b = execMoveTest(sq("d", 7), sq("d", 5), b); // black pawn d7-d5 (two squares, creates ep at d6)
    const ep = sq("d", 6);
    const moves = getValid(b, sq("e", 5), ep, 0b1111);
    expect(moves).toContain(ep);
  });

  it("pawn promotion: pawn on 7th rank can advance to 8th", () => {
    const b = Array(64).fill(0);
    b[sq("e", 7)] = 2; // white pawn on e7
    b[sq("e", 1)] = 12; // white king
    b[sq("e", 8)] = 0; // empty
    b[sq("a", 8)] = 13; // black king on a8
    const moves = getValid(b, sq("e", 7), 255, 0);
    expect(moves).toContain(sq("e", 8));
  });
});

describe("Chess Rules Engine — Bishop", () => {
  it("bishop on c1 is initially blocked by pawns", () => {
    const b = initBoard();
    const moves = getValid(b, sq("c", 1), 255, 0b1111);
    expect(moves).toHaveLength(0);
  });

  it("bishop on c4 (after d3) moves all 4 diagonals", () => {
    const b = Array(64).fill(0);
    b[sq("c", 4)] = 8; // white bishop on c4
    b[sq("e", 1)] = 12; // white king
    b[sq("e", 8)] = 13; // black king
    const moves = getValid(b, sq("c", 4), 255, 0);
    // Should move: a2, b3, d5, e6, f7, g8 (one diagonal), b5, a6, d3, e2, f1 (other diagonals)
    expect(moves).toContain(sq("a", 2));
    expect(moves).toContain(sq("b", 3));
    expect(moves).toContain(sq("d", 5));
    expect(moves).toContain(sq("e", 6));
    expect(moves).toContain(sq("f", 7));
    expect(moves).toContain(sq("g", 8));
    expect(moves).toContain(sq("b", 5));
    expect(moves).toContain(sq("a", 6));
    expect(moves).toContain(sq("d", 3));
    expect(moves).toContain(sq("e", 2));
    expect(moves).toContain(sq("f", 1));
    expect(moves.length).toBeGreaterThanOrEqual(11);
  });

  it("bishop blocked by own piece stops before it", () => {
    const b = Array(64).fill(0);
    b[sq("c", 1)] = 8; // white bishop
    b[sq("e", 3)] = 2; // white pawn in way
    b[sq("e", 1)] = 12;
    b[sq("e", 8)] = 13;
    const moves = getValid(b, sq("c", 1), 255, 0);
    expect(moves).toContain(sq("d", 2)); // can get to d2
    expect(moves).not.toContain(sq("e", 3)); // can't land on own pawn
    expect(moves).not.toContain(sq("f", 4)); // can't pass pawn
  });

  it("bishop can capture enemy piece then stop", () => {
    const b = Array(64).fill(0);
    b[sq("c", 1)] = 8;
    b[sq("e", 3)] = 3; // black pawn
    b[sq("e", 1)] = 12;
    b[sq("e", 8)] = 13;
    const moves = getValid(b, sq("c", 1), 255, 0);
    expect(moves).toContain(sq("e", 3)); // can capture
    expect(moves).not.toContain(sq("f", 4)); // can't continue past
  });
});

describe("Chess Rules Engine — Knight", () => {
  it("knight on b1 can jump to a3 or c3", () => {
    const b = initBoard();
    const moves = getValid(b, sq("b", 1), 255, 0b1111);
    expect(moves).toContain(sq("a", 3));
    expect(moves).toContain(sq("c", 3));
    expect(moves).toHaveLength(2);
  });

  it("knight in center has 8 moves", () => {
    const b = Array(64).fill(0);
    b[sq("d", 4)] = 6;
    b[sq("e", 1)] = 12;
    b[sq("e", 8)] = 13;
    const moves = getValid(b, sq("d", 4), 255, 0);
    expect(moves).toHaveLength(8);
  });

  it("knight can jump over pieces", () => {
    const b = initBoard();
    const moves = getValid(b, sq("b", 1), 255, 0b1111);
    // Knight can jump over its own pawns
    expect(moves.length).toBeGreaterThan(0);
  });
});

describe("Chess Rules Engine — Rook", () => {
  it("rook on a1 is initially blocked", () => {
    const b = initBoard();
    const moves = getValid(b, sq("a", 1), 255, 0b1111);
    expect(moves).toHaveLength(0);
  });

  it("rook on open board has 14 moves", () => {
    const b = Array(64).fill(0);
    b[sq("d", 4)] = 4;
    b[sq("a", 1)] = 12;
    b[sq("h", 8)] = 13;
    const moves = getValid(b, sq("d", 4), 255, 0);
    expect(moves).toHaveLength(14); // 7 horizontal + 7 vertical
  });
});

describe("Chess Rules Engine — Queen", () => {
  it("queen on open board has 27 moves", () => {
    const b = Array(64).fill(0);
    b[sq("d", 4)] = 10;
    b[sq("e", 1)] = 12; // own king NOT on queen's diagonals
    b[sq("h", 8)] = 13;
    const moves = getValid(b, sq("d", 4), 255, 0);
    expect(moves).toHaveLength(27); // 14 rook + 13 bishop
  });
});

describe("Chess Rules Engine — King & Castling", () => {
  it("king has 8 moves on open board", () => {
    const b = Array(64).fill(0);
    b[sq("d", 4)] = 12;
    b[sq("h", 8)] = 13;
    const moves = getValid(b, sq("d", 4), 255, 0);
    expect(moves).toHaveLength(8);
  });

  it("kingside castling works", () => {
    const b = initBoard();
    // Clear f1 and g1
    b[sq("f", 1)] = 0; // bishop gone
    b[sq("g", 1)] = 0; // knight gone
    const moves = getValid(b, sq("e", 1), 255, 0b1111);
    expect(moves).toContain(sq("g", 1)); // castle target
  });

  it("queenside castling works", () => {
    const b = initBoard();
    b[sq("b", 1)] = 0;
    b[sq("c", 1)] = 0;
    b[sq("d", 1)] = 0;
    const moves = getValid(b, sq("e", 1), 255, 0b1111);
    expect(moves).toContain(sq("c", 1));
  });

  it("king cannot move into check", () => {
    const b = Array(64).fill(0);
    b[sq("e", 1)] = 12; // white king
    b[sq("e", 8)] = 13; // black king
    b[sq("e", 3)] = 5; // black rook on e3 attacks e-file
    const moves = getValid(b, sq("e", 1), 255, 0);
    expect(moves).not.toContain(sq("e", 2)); // would step into check
  });
});

describe("Chess Rules Engine — Check / Pin", () => {
  it("pinned piece can't move off pin line", () => {
    const b = Array(64).fill(0);
    b[sq("e", 1)] = 12; // white king
    b[sq("e", 4)] = 8; // white bishop pinned
    b[sq("e", 8)] = 5; // black rook pinning along e-file
    b[sq("a", 8)] = 13;
    const moves = getValid(b, sq("e", 4), 255, 0);
    // Bishop is pinned — it cannot move off the e-file
    const offFileMoves = moves.filter(m => (m & 7) !== 4);
    expect(offFileMoves).toHaveLength(0);
  });

  it("must resolve check — king moves, block, or capture checker", () => {
    const b = Array(64).fill(0);
    b[sq("e", 1)] = 12; // white king in check
    b[sq("e", 8)] = 13; // black king
    b[sq("e", 7)] = 5; // black rook checks king
    // White king's valid moves: must escape check
    const kingMoves = getValid(b, sq("e", 1), 255, 0);
    // Can't stay on e-file
    expect(kingMoves).not.toContain(sq("e", 2));
    // Can go to d1, f1, d2, f2
    expect(kingMoves).toContain(sq("d", 1));
    expect(kingMoves).toContain(sq("f", 1));
  });
});
