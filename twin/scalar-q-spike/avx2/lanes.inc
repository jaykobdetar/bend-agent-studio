#if !UNIFORM
#error "The vector witness is restricted to Uniform"
#endif
typedef uint32_t U8 __attribute__((vector_size(32)));
static inline U8 lane_lcg(U8 x) {
  return x * UINT32_C(1664525) + UINT32_C(1013904223);
}
static inline U8 lane_mix(U8 x) {
  x = (x ^ (x >> 16)) * UINT32_C(2246822507);
  x = (x ^ (x >> 13)) * UINT32_C(3266489909);
  return x ^ (x >> 16);
}
/* Named boundary to inspect, not a claim that scalar gathers/divide vectorize. */
__attribute__((noinline))
static void uniform8(uint32_t seed, uint32_t valid, Report report[8]) {
  U8 seeds = {0,1,2,3,4,5,6,7};
  seeds += seed;
  U8 resets = lane_mix(seeds ^ UINT32_C(3266489917));
  U8 raw = lane_lcg(seeds);
  U8 active = {0};
  State current[8];
  for (uint32_t i = 0; i < valid; ++i) {
    current[i] = states[sample(INITIAL_BASE, INITIAL_COUNT, resets[i]).row];
    active[i] = current[i].count == 0 ? 0u : UINT32_MAX;
    report[i] = (Report){0.0f, 0, current[i].count == 0};
  }
  for (uint32_t round = 0; round < STEP_LIMIT; ++round) {
    int live = 0;
    for (uint32_t i = 0; i < valid; ++i) live |= active[i] != 0;
    if (!live) break;
    U8 policy = lane_mix(raw ^ UINT32_C(1515870810));
    U8 world_raw = lane_lcg(raw);
    U8 world = lane_mix(world_raw ^ UINT32_C(2779096485));
    raw = (lane_lcg(world_raw) & active) | (raw & ~active);
    for (uint32_t i = 0; i < valid; ++i) {
      if (!active[i]) continue;
      State s = current[i];
      uint32_t a = s.base + policy[i] % s.count;
      Outcome next = sample(actions[a].base, actions[a].count, world[i]);
      report[i].score = add(report[i].score, from_bits(next.reward_bits));
      if (!isfinite(report[i].score)) fail("nonfinite score");
      ++report[i].steps;
      current[i] = states[next.row];
      if (current[i].count == 0) {
        report[i].terminal = 1; /* Terminal wins over simultaneous horizon. */
        active[i] = 0;
      }
    }
  }
}
static void print_reports(FILE *out, Learner *learner, uint32_t seed, uint32_t count, int train) {
  fputc('[', out);
  for (uint32_t base = 0; base < count; base += 8) {
    Report reports[8];
    uint32_t valid = count - base < 8 ? count - base : 8;
    uniform8(seed + base, valid, reports);
    for (uint32_t i = 0; i < valid; ++i) {
      Report r = reports[i];
      Report scalar = episode(learner, seed + base + i, train);
      if (bits_of(r.score) != bits_of(scalar.score) || r.steps != scalar.steps ||
          r.terminal != scalar.terminal) fail("vector/scalar raw report mismatch");
      fprintf(out, "%s[%" PRIu32 ",%" PRIu32 ",%" PRIu32 "]",
              base + i ? "," : "", bits_of(r.score), r.steps, r.terminal);
    }
  }
  fputc(']', out);
}
