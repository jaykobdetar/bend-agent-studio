import assert from 'node:assert/strict';
import {test} from 'node:test';
import {chessAction, chessBoards, drawChess} from './web/chess-scene.js';
import {actionName, boardStates} from './web/scene.js';

const square = (name) => 'abcdefgh'.indexOf(name[0]) + 16 * (Number(name[1]) - 1);
const move = (text, accepted = true) => ({
  action:
    square(text.slice(0, 2)) +
    128 * square(text.slice(2, 4)) +
    16384 * ({n: 2, b: 3, r: 4, q: 5}[text[4]] ?? 0),
  accepted,
});
const trace = (moves) => ({game: 'chess', frames: moves.map((m) => move(m))});
const at = (state, name) => state.squares[square(name)];

test('Studio reconstructs a castle without generating moves', () => {
  const t = trace(['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5', 'e1g1']);
  const boards = boardStates(t),
    state = boards.at(-1);
  assert.equal(boards.length, t.frames.length + 1);
  assert.equal(at(boards[0], 'e1'), 6);
  assert.equal(at(state, 'g1'), 6);
  assert.equal(at(state, 'f1'), 4);
  assert.equal(at(state, 'h1'), 0);
  assert.equal(actionName(t.game, t.frames.at(-1).action), 'e1g1');
});

test('Studio removes en passant captures and keeps rejected frames unchanged', () => {
  const t = trace(['e2e4', 'a7a6', 'e4e5', 'd7d5', 'e5d6']);
  t.frames.push(move('d6d7', false));
  const out = chessBoards(t),
    end = out.at(-1);
  assert.equal(at(end, 'd5'), 0);
  assert.equal(at(end, 'd6'), 1);
  assert.equal(end, out.at(-2));
});

test('Studio labels an underpromotion and paints the replay board', () => {
  const t = trace(['a2a4', 'h7h6', 'a4a5', 'h6h5', 'a5a6', 'h5h4', 'a6b7', 'h4h3', 'b7a8n']);
  const end = chessBoards(t).at(-1);
  assert.equal(at(end, 'a8'), 2);
  assert.equal(chessAction(t.frames.at(-1).action), 'b7a8n');
  const drawn = [];
  drawChess(
    {
      fillRect() {},
      strokeText() {},
      fillText(label) {
        drawn.push(label);
      },
    },
    end,
  );
  assert.ok(drawn.includes('♘'));
  assert.ok(drawn.includes('b7 → a8'));
});
