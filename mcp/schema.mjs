export const str = {type: 'string', minLength: 1, maxLength: 2048};
export const uint = {type: 'integer', minimum: 0, maximum: 4294967295};
export const horizon = {type: 'integer', minimum: 1, maximum: 4096};
export const choice = (...values) => ({type: 'string', enum: values});
export const schema = (properties, required) => ({
  type: 'object',
  properties,
  additionalProperties: false,
  required,
});
export const tool = (description, properties, required, readOnly, run) => ({
  description,
  inputSchema: schema(properties, required),
  readOnly,
  run,
});

// The scientific validators remain authoritative (IDs, probability sums, seed
// overlap, legal methods, etc.). These schemas expose the two supported authoring
// modes to clients without introducing a generic file-writing tool.
const num = {type: 'number'},
  version = {type: 'integer', const: 1};
const arr = (items) => ({type: 'array', items});
const initial = schema({to: uint, weight: {type: 'integer', minimum: 1, maximum: 4294967296}}, [
  'to',
  'weight',
]);
const outcome = schema({...initial.properties, reward: num}, ['to', 'weight', 'reward']);
const state = schema(
  {
    id: uint,
    observation: uint,
    actions: arr(schema({id: uint, outcomes: arr(outcome)}, ['id', 'outcomes'])),
  },
  ['id', 'actions'],
);
const finite = schema({schema: version, initial: arr(initial), states: arr(state)}, [
  'schema',
  'initial',
  'states',
]);
const grid = schema(
  {
    schema: version,
    grid: arr({type: 'string'}),
    stepReward: num,
    goalReward: num,
    pitReward: num,
    slip: {type: 'number', minimum: 0, maximum: 1},
  },
  ['schema', 'grid'],
);
export const worldInput = {
  description: 'Workspace JSON path or an inline finite/grid world.',
  oneOf: [str, finite, grid],
};
const game = schema({id: str, limit: uint, definition: {oneOf: [finite, grid]}}, ['id', 'limit']);
const arm = schema(
  {
    id: str,
    method: str,
    epsilon: num,
    alpha: num,
    gamma: num,
    observation: str,
    planningSteps: uint,
    criticRate: num,
  },
  ['id', 'method'],
);
const plan = schema(
  {
    schema: version,
    name: str,
    games: arr(game),
    evaluationGames: arr(game),
    arms: arr(arm),
    replicates: uint,
    checkpoints: arr(uint),
    budgetUnit: choice('episodes', 'steps'),
    maxTrainEpisodes: uint,
    validationEpisodes: uint,
    testEpisodes: uint,
    seeds: schema({train: uint, validation: uint, test: uint, stride: uint}, [
      'train',
      'validation',
      'test',
      'stride',
    ]),
  },
  [
    'schema',
    'name',
    'games',
    'arms',
    'replicates',
    'checkpoints',
    'validationEpisodes',
    'testEpisodes',
    'seeds',
  ],
);
export const planInput = {
  description:
    'Workspace plan path or self-contained plan data. Embed finite/grid games under definition. External references and custom source bundles require a file-backed plan.',
  oneOf: [str, plan],
};
