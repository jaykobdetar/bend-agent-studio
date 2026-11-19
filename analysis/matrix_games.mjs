// Exact vertex LP for small zero-sum games. Only the row payoff is needed;
// the column player receives its negation.
const maxActions = 6;
const zero = [0n, 1n];
const one = [1n, 1n];

function gcd(a, b) {
  a = a < 0n ? -a : a;
  for (; b; [a, b] = [b, a % b]);
  return a;
}
function frac(n, d = 1n) {
  if (d === 0n) throw Error('division by zero');
  if (d < 0n) return frac(-n, -d);
  const g = gcd(n, d);
  return [n / g, d / g];
}
const neg = ([n, d]) => [-n, d];
const add = ([a, b], [c, d]) => frac(a * d + c * b, b * d);
const mul = ([a, b], [c, d]) => frac(a * c, b * d);
const div = ([a, b], [c, d]) => frac(a * d, b * c);
const sub = (a, b) => add(a, neg(b));
const cmp = ([a, b], [c, d]) => a * d - c * b;
const format = ([n, d]) => (d === 1n ? String(n) : `${n}/${d}`);
const dot = (a, b) => a.reduce((sum, x, i) => add(sum, mul(x, b[i])), zero);

function validated(matrix) {
  if (
    !Array.isArray(matrix) ||
    !matrix.length ||
    matrix.length > maxActions ||
    !Array.isArray(matrix[0]) ||
    !matrix[0].length ||
    matrix[0].length > maxActions
  )
    throw Error(`payoff matrix needs 1 to ${maxActions} actions per seat`);
  const w = matrix[0].length;
  return Array.from(matrix, (row) => {
    if (!Array.isArray(row) || row.length !== w) throw Error('payoff matrix must be rectangular');
    return Array.from(row, (value) => {
      if (!Number.isSafeInteger(value)) throw Error('payoffs must be safe integers');
      return frac(BigInt(value));
    });
  });
}

function transpose(matrix) {
  return matrix[0].map((_, i) => matrix.map((row) => row[i]));
}

// Yield k-element selections from n constraint indices without replacement.
function* choose(n, k, start = 0, indices = []) {
  if (!k) {
    yield indices;
    return;
  }
  for (let i = start; i <= n - k; i++) yield* choose(n, k - 1, i + 1, [...indices, i]);
}

// The last entry of each equation row is its right-hand side. A singular
// active set is discarded, not approximated.
function gaussian(equations) {
  const work = equations.map((row) => row.slice());
  const n = work.length;
  for (let i = 0; i < n; i++) {
    const pivot = work.findIndex((row, j) => j >= i && row[i][0] !== 0n);
    if (pivot < 0) return null;
    [work[i], work[pivot]] = [work[pivot], work[i]];
    const scale = work[i][i];
    work[i] = work[i].map((x) => div(x, scale));
    for (let j = 0; j < n; j++) {
      const coefficient = work[j][i];
      if (j !== i && coefficient[0] !== 0n)
        work[j] = work[j].map((x, k) => sub(x, mul(coefficient, work[i][k])));
    }
  }
  return work.map((row) => row[n]);
}

// Maximize v with sum(p)=1, p>=0, and p^T A[:,j] >= v for each j.
// An optimum occurs at a vertex: an optimal equality slice has compact
// strategy coordinates and the polyhedron has no lines. Enumerate d active
// inequalities in addition to normalization for d strategy coordinates.
function maximizeSecurity(matrix) {
  const n = matrix.length;
  const constraints = [
    ...Array.from({length: n}, (_, i) =>
      Array.from({length: n + 1}, (_, j) => (i === j ? one : zero)),
    ),
    ...transpose(matrix).map((column) => [...column, neg(one)]),
  ];
  const simplex = [...Array(n).fill(one), zero, one];
  let best = null;
  for (const indices of choose(constraints.length, n)) {
    const candidate = gaussian([simplex, ...indices.map((i) => [...constraints[i], zero])]);
    if (!candidate || constraints.some((lhs) => dot(lhs, candidate)[0] < 0n)) continue;
    if (!best || cmp(candidate[n], best[n]) > 0n) best = candidate;
  }
  if (!best) throw Error('no feasible vertex found');
  return {probabilities: best.slice(0, n), value: best[n]};
}

export function solveMatrix(matrix) {
  const a = validated(matrix);
  const row = maximizeSecurity(a);
  const column = maximizeSecurity(transpose(a).map((r) => r.map(neg)));
  if (cmp(row.value, neg(column.value)) !== 0n) throw Error('primal and dual values disagree');
  return {
    value: format(row.value),
    rowStrategy: row.probabilities.map(format),
    columnStrategy: column.probabilities.map(format),
  };
}

function mix(counts, n) {
  if (!Array.isArray(counts) || counts.length !== n) throw Error('wrong number of action counts');
  const values = Array.from(counts, (count) => {
    if (!Number.isSafeInteger(count) || count < 0)
      throw Error('counts must be nonnegative safe integers');
    return BigInt(count);
  });
  const total = values.reduce((a, b) => a + b, 0n);
  if (!total) throw Error('at least one count must be positive per seat');
  return values.map((n) => frac(n, total));
}

export function exploitability(matrix, rowCounts, columnCounts) {
  const a = validated(matrix);
  const p = mix(rowCounts, a.length);
  const q = mix(columnCounts, a[0].length);
  const rowPayoffs = a.map((r) => dot(r, q));
  const columnPayoffs = transpose(a).map((c) => dot(c, p));
  const expectedPayoff = dot(p, rowPayoffs);
  const rowBestResponse = rowPayoffs.reduce((best, x) => (cmp(x, best) > 0n ? x : best));
  // The column best response is reported as row payoff (so lower is better).
  const columnBestResponse = columnPayoffs.reduce((best, x) => (cmp(x, best) < 0n ? x : best));
  const rowRegret = sub(rowBestResponse, expectedPayoff);
  const columnRegret = sub(expectedPayoff, columnBestResponse);
  const nashConv = add(rowRegret, columnRegret);
  const meanRegret = div(nashConv, frac(2n));
  return Object.fromEntries(
    Object.entries({
      expectedPayoff,
      rowBestResponse,
      columnBestResponse,
      rowRegret,
      columnRegret,
      nashConv,
      exploitability: meanRegret,
    }).map(([key, value]) => [key, format(value)]),
  );
}
