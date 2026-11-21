const pieces = ['', '♙', '♘', '♗', '♖', '♕', '♔', '', '', '♟', '♞', '♝', '♜', '♛', '♚'];
const promotions = {2: 'n', 3: 'b', 4: 'r', 5: 'q'};
const backRank = [4, 2, 3, 5, 6, 3, 2, 4];
const file = (s) => s & 7;
const rank = (s) => s >> 4;
const squareName = (s) => 'abcdefgh'[file(s)] + (rank(s) + 1);
const validSquare = (s) => (s & 0x88) === 0;

function decode(action) {
  if (!Number.isInteger(action) || action < 0 || action >= 6 * 16384) return null;
  const from = action & 127,
    to = (action >> 7) & 127,
    promotion = action >> 14;
  if (
    !validSquare(from) ||
    !validSquare(to) ||
    from === to ||
    (promotion && !promotions[promotion])
  )
    return null;
  return {from, to, promotion};
}

export function chessAction(action) {
  const move = decode(action);
  return move
    ? squareName(move.from) + squareName(move.to) + (promotions[move.promotion] ?? '')
    : String(action);
}

function initialBoard() {
  const squares = Array(128).fill(0);
  for (const [f, p] of backRank.entries()) {
    squares[f] = p;
    squares[16 + f] = 1;
    squares[96 + f] = 9;
    squares[112 + f] = p + 8;
  }
  return {squares, from: null, to: null};
}

// The first position is fixed. Accepted sealed actions are sufficient to
// reconstruct the display; the renderer doesn't generate or approve any moves.
export function chessBoards(trace) {
  const out = [initialBoard()];
  for (const frame of trace.frames) {
    const before = out.at(-1),
      move = frame.accepted ? decode(frame.action) : null;
    const p = move ? before.squares[move.from] : 0;
    if (!move || !p) {
      out.push(before);
      continue;
    }
    const {from, to, promotion} = move,
      squares = before.squares.slice();
    const side = p & 8,
      piece = p & 7;
    if (piece === 1 && !squares[to] && file(from) !== file(to)) squares[to + (side ? 16 : -16)] = 0;
    if (piece === 6 && rank(from) === rank(to) && Math.abs(to - from) === 2) {
      const toward = Math.sign(to - from),
        rook = (from & 112) + (toward === 1 ? 7 : 0);
      squares[from + toward] = squares[rook];
      squares[rook] = 0;
    }
    squares[to] = promotion ? side + promotion : p;
    squares[from] = 0;
    out.push({squares, from, to});
  }
  return out;
}

export function drawChess(c, state = initialBoard()) {
  const dim = 24,
    x0 = 160,
    y0 = 12;
  c.fillStyle = '#212033';
  c.fillRect(0, 0, 512, 220);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (let r = 7; r >= 0; r--) {
    for (let f = 0; f < 8; f++) {
      const pos = r * 16 + f,
        x = x0 + f * dim,
        y = y0 + (7 - r) * dim;
      const light = (r + f) % 2;
      const marked = state.from === pos || state.to === pos;
      c.fillStyle = marked ? (light ? '#f2c06a' : '#c88b50') : light ? '#e9d9bc' : '#8b7893';
      c.fillRect(x, y, dim, dim);
      const p = state.squares[pos];
      if (!p) continue;
      c.font = '24px "DejaVu Sans", "Segoe UI Symbol", serif';
      c.strokeStyle = p & 8 ? '#f0e5d0' : '#23202b';
      c.lineWidth = 0.8;
      c.strokeText(pieces[p], x + dim / 2, y + dim / 2 + 1);
      c.fillStyle = p & 8 ? '#252232' : '#fff9e9';
      c.fillText(pieces[p], x + dim / 2, y + dim / 2 + 1);
    }
    c.fillStyle = '#f5e6ce';
    c.font = '10px sans-serif';
    c.fillText(r + 1, x0 - 9, y0 + (7 - r) * dim + dim / 2);
  }
  for (let f = 0; f < 8; f++) c.fillText('abcdefgh'[f], x0 + f * dim + dim / 2, y0 + 8 * dim + 8);
  c.font = '14px sans-serif';
  c.fillText(
    state.from === null ? 'Start position' : squareName(state.from) + ' → ' + squareName(state.to),
    425,
    110,
  );
}
