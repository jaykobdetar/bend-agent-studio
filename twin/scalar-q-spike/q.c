/* Scalar replicate kernels in a fixed pthread pool; data from parity.mjs.
 * It writes a comparison stream, never isolated or sealed checkpoints. */
#define _POSIX_C_SOURCE 200809L
#include <fenv.h>
#include <float.h>
#include <inttypes.h>
#include <math.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

_Static_assert(sizeof(float) == 4 && FLT_RADIX == 2 && FLT_MANT_DIG == 24 && FLT_EVAL_METHOD == 0,
               "requires native binary32 without extended intermediates");
typedef struct { uint32_t upper, row, reward_bits; } Outcome;
typedef struct { uint32_t action, base, count; } Action;
typedef struct { uint32_t observation, base, count; } State;

/* GENERATED */

#define EMPTY UINT32_MAX
typedef struct { uint32_t s, a, visits, lo, hi; float value; } Cell;
typedef struct { uint32_t size; Cell cells[PAIR_CAP]; } Table;
#if DYNA_Q
typedef struct { uint32_t row, count, prev, next; float reward; } Sample;
typedef struct { uint32_t s, a, total, first, last; } Pair;
#endif
typedef struct {
  Table values[1 + DOUBLE_Q];
  uint32_t side_seed;
#if DYNA_Q
  uint32_t pairs, samples, planning_seed;
  Pair experience[PAIR_CAP];
  Sample outcomes[SAMPLE_CAP];
#endif
} Learner;
typedef struct { float score; uint32_t steps, terminal; } Report;
typedef struct { uint32_t action_row; float value; } Maximum;

#define OUTPUT_CAP (16u * 1024u * 1024u)
#define STACK_CAP (1024u * 1024u)
#define MAX_WORKERS 4u
#define REPLICATE_CAP ((OUTPUT_CAP - sizeof(PLAN_HASH)) / REPLICATES)
_Static_assert(sizeof(Learner) <= STACK_CAP / 2, "learner leaves insufficient fixed stack headroom");
_Static_assert(REPLICATES >= 1 && REPLICATES <= 8 && REPLICATE_CAP > 1, "invalid replicate/output bounds");
typedef struct { size_t size; char data[REPLICATE_CAP]; } Result;
typedef struct { uint32_t first, stride; } Work;
static Result results[REPLICATES]; /* exactly one thread owns each mutable slot */

static void fail(const char *s) {
  fprintf(stderr, "%s\n", s);
  fflush(stderr);
  /* No shared stream cleanup/flush from a failed worker. */
  _Exit(1);
}
static float from_bits(uint32_t bits) { float x; memcpy(&x, &bits, sizeof x); return x; }
static uint32_t bits_of(float x) { uint32_t bits; memcpy(&bits, &x, sizeof bits); return bits; }
static uint32_t lcg(uint32_t x) { return x * UINT32_C(1664525) + UINT32_C(1013904223); }
static uint32_t mix(uint32_t x) {
  x = (x ^ (x >> 16)) * UINT32_C(2246822507);
  x = (x ^ (x >> 13)) * UINT32_C(3266489909);
  return x ^ (x >> 16);
}
static float add(float a, float b) { return a + b; }
static float sub(float a, float b) { return a - b; }
static float mul(float a, float b) { return a * b; }
#if EXPECTED_SARSA || DYNA_Q
/* The stock ES backend divides in binary64, then rounds to binary32. */
static float div_count(float n, uint32_t d) { return (float)((double)n / (double)(float)d); }
#endif

/* Preserve Bend's digital-tree shape by inserting on the first real visit.
 * On a miss, use alternating low bits of the query s and a, not the stored key. */
static uint32_t find(const Table *t, uint32_t s, uint32_t a) {
  uint32_t i = t->size ? 0 : EMPTY, bits = s, other = a;
  while (i != EMPTY) {
    const Cell *c = &t->cells[i];
    if (c->s == s && c->a == a) return i;
    i = bits & 1 ? c->hi : c->lo;
    uint32_t next_other = bits >> 1; bits = other; other = next_other;
  }
  return EMPTY;
}
static float value(const Table *t, uint32_t s, uint32_t a) {
  uint32_t i = find(t, s, a);
  return i == EMPTY ? 0.0f : t->cells[i].value;
}
static float policy_value(const Table *left, const Table *right, uint32_t s, uint32_t a) {
  float v = value(left, s, a);
  return right ? add(v, value(right, s, a)) : v;
}
static void adjust(Table *t, uint32_t s, uint32_t a, float alpha, float target) {
  uint32_t root = t->size ? 0 : EMPTY, *slot = &root, bits = s, other = a;
  while (*slot != EMPTY) {
    Cell *c = &t->cells[*slot];
    if (c->s == s && c->a == a) {
      c->value = add(c->value, mul(alpha, sub(target, c->value)));
      ++c->visits;
      if (!isfinite(c->value)) fail("nonfinite table update; no parity output can be adopted");
      return;
    }
    slot = bits & 1 ? &c->hi : &c->lo;
    uint32_t next_other = bits >> 1; bits = other; other = next_other;
  }
  if (t->size >= PAIR_CAP) fail("generated pair bound exceeded");
  *slot = t->size++;
  float v = add(0.0f, mul(alpha, sub(target, 0.0f)));
  if (!isfinite(v)) fail("nonfinite table insertion");
  t->cells[*slot] = (Cell){s, a, 1, EMPTY, EMPTY, v};
}

static Outcome sample(uint32_t base, uint32_t count, uint32_t word) {
  for (uint32_t i = base; i < base + count; ++i)
    if (word <= outcomes[i].upper) return outcomes[i];
  fail("generated distribution does not cover the U32 word");
  return (Outcome){0};
}
/* The stock right fold uses >= to pick the first maximal action and its
 * exact F32 value. Earliest signed zero is significant for continuation. */
static Maximum first_max(const Table *left, const Table *right, State s) {
  uint32_t i = s.base + s.count - 1;
  Maximum result = {i, policy_value(left, right, s.observation, actions[i].action)};
  for (; i > s.base; ) {
    --i;
    float v = policy_value(left, right, s.observation, actions[i].action);
    if (v >= result.value) result = (Maximum){i, v};
  }
  return result;
}
static float continuation(const Table *t, const Table *other, State after) {
  if (!after.count) return 0.0f;
  /* Double Q picks the earliest maximum on the update side and
   * evaluates that action on the other side, never the sum policy. */
  if (other) return value(other, after.observation, actions[first_max(t, NULL, after).action_row].action);
#if EXPECTED_SARSA
  /* Match T.choices' right fold, including the original order of F32 adds.
   * Match the JS-compiled F32.div (binary64 division then fround). */
  uint32_t i = after.base + after.count - 1;
  float maximum = value(t, after.observation, actions[i].action);
  float sum = maximum;
  for (; i > after.base; ) {
    --i;
    float v = value(t, after.observation, actions[i].action);
    if (v >= maximum) maximum = v;
    sum = add(v, sum);
  }
  float epsilon = (float)((double)EXPLORATION / 65536.0);
  float mean = div_count(sum, after.count);
  return add(mul(sub(1.0f, epsilon), maximum), mul(epsilon, mean));
#else
  return first_max(t, NULL, after).value;
#endif
}

#if DYNA_Q
/* Structural public view equality, not equality of physical rows or of the
 * observation alone. Open/End and the original legal action order matter. */
static int same_view(uint32_t one, uint32_t two) {
  State a = states[one], b = states[two];
  if (a.observation != b.observation || a.count != b.count) return 0;
  for (uint32_t i = 0; i < a.count; ++i)
    if (actions[a.base + i].action != actions[b.base + i].action) return 0;
  return 1;
}
static void observe(Learner *learner, uint32_t s, uint32_t a, uint32_t row, float r) {
  uint32_t i = 0;
  while (i < learner->pairs &&
         (learner->experience[i].s != s || learner->experience[i].a != a)) ++i;
  if (i == learner->pairs) {
    if (i >= PAIR_CAP) fail("generated experience pair bound exceeded");
    learner->experience[i] = (Pair){s, a, 0, EMPTY, EMPTY};
    ++learner->pairs;
  }
  Pair *p = &learner->experience[i];
  ++p->total;
  for (i = p->first; i != EMPTY; i = learner->outcomes[i].next) {
    Sample *sample = &learner->outcomes[i];
    if (same_view(sample->row, row)) {
      ++sample->count;
      sample->reward = add(sample->reward, div_count(sub(r, sample->reward), sample->count));
      if (!isfinite(sample->reward)) fail("nonfinite experience reward mean");
      return;
    }
  }
  if (learner->samples >= SAMPLE_CAP) fail("generated experience sample bound exceeded");
  i = learner->samples++;
  learner->outcomes[i] = (Sample){row, 1, p->last, EMPTY, r};
  if (p->last == EMPTY) p->first = i;
  else learner->outcomes[p->last].next = i;
  p->last = i;
}
static void plan(Learner *learner, float alpha, float gamma) {
  /* Observe has committed at least one pair. Every plan draw selects a
   * pair (never an outcome), then backs up the whole empirical distribution. */
  for (uint32_t fuel = PLANNING_STEPS; fuel; --fuel) {
    Pair p = learner->experience[mix(learner->planning_seed) % learner->pairs];
    float target = 0.0f;
    for (uint32_t i = p.last; i != EMPTY; i = learner->outcomes[i].prev) {
      Sample x = learner->outcomes[i];
      float v = add(x.reward, mul(gamma, continuation(learner->values, NULL, states[x.row])));
      target = add(mul((float)x.count, v), target);
    }
    adjust(learner->values, p.s, p.a, alpha, div_count(target, p.total));
    learner->planning_seed = lcg(learner->planning_seed);
  }
}
#endif

static uint32_t tie_rank(uint32_t count, uint32_t policy) {
  if (count == 1) return 0;
  uint32_t threshold = (uint32_t)(0 - count) % count;
  uint32_t raw = policy ^ UINT32_C(2246822519);
  for (uint32_t fuel = threshold + 1; fuel; --fuel, raw = lcg(raw)) {
    uint32_t draw = mix(raw);
    if (draw >= threshold) return draw % count;
  }
  return 0; /* Same specified fallback as Bend, not used for valid draws. */
}
static uint32_t select_action(const Learner *learner, State s, int train, uint32_t policy) {
  if (UNIFORM) return s.base + policy % s.count;
  if (train && (policy & UINT32_C(65535)) < EXPLORATION)
    return s.base + mix(policy ^ UINT32_C(2654435769)) % s.count;
  const Table *left = learner->values, *right = DOUBLE_Q ? left + 1 : NULL;
  Maximum maximum = first_max(left, right, s);
  if (!train) return maximum.action_row;
  uint32_t count = 0;
  for (uint32_t i = s.base; i < s.base + s.count; ++i)
    count += policy_value(left, right, s.observation, actions[i].action) == maximum.value;
  if (!count) fail("no finite greedy action");
  uint32_t rank = tie_rank(count, policy);
  for (uint32_t i = s.base; i < s.base + s.count; ++i) {
    if (policy_value(left, right, s.observation, actions[i].action) == maximum.value && rank-- == 0) return i;
  }
  fail("invalid greedy tie rank");
  return 0;
}
static Report episode(Learner *learner, uint32_t seed, int train) {
  State s = states[sample(INITIAL_BASE, INITIAL_COUNT, mix(seed ^ UINT32_C(3266489917))).row];
  uint32_t raw = lcg(seed), steps = 0;
  float score = 0.0f;
  while (s.count != 0 && steps < STEP_LIMIT) {
    uint32_t a = select_action(learner, s, train, mix(raw ^ UINT32_C(1515870810)));
    raw = lcg(raw);
    Outcome next = sample(actions[a].base, actions[a].count, mix(raw ^ UINT32_C(2779096485)));
    raw = lcg(raw);
    State after = states[next.row];
    float reward = from_bits(next.reward_bits);
    if (train && !UNIFORM) {
      Table *t = learner->values;
      const Table *other = NULL;
      if (DOUBLE_Q) {
        uint32_t side = mix(learner->side_seed) & 1;
        learner->side_seed = lcg(learner->side_seed);
        t += side;
        other = learner->values + (side ^ 1);
      }
      /* The last allowed move still bootstraps when the destination is open. */
      float boot = continuation(t, other, after);
      float alpha = from_bits(ALPHA_BITS), gamma = from_bits(GAMMA_BITS);
      float target = add(reward, mul(gamma, boot));
      adjust(t, s.observation, actions[a].action, alpha, target);
#if DYNA_Q
      observe(learner, s.observation, actions[a].action, next.row, reward);
      plan(learner, alpha, gamma);
#endif
    }
    score = add(score, reward);
    if (!isfinite(score)) fail("nonfinite score");
    s = after;
    ++steps;
  }
  return (Report){score, steps, s.count == 0};
}
static void print_reports(FILE *out, Learner *learner, uint32_t seed, uint32_t count, int train) {
  fputc('[', out);
  for (uint32_t i = 0; i < count; ++i) {
    Report r = episode(learner, seed + i, train);
    fprintf(out, "%s[%" PRIu32 ",%" PRIu32 ",%" PRIu32 "]", i ? "," : "", bits_of(r.score), r.steps, r.terminal);
  }
  fputc(']', out);
}
static void print_tree(FILE *out, const Table *t) {
  fputc('[', out);
  for (uint32_t i = 0; i < t->size; ++i) {
    const Cell *c = &t->cells[i];
    fprintf(out, "%s[%" PRIu32 ",%" PRIu32 ",%" PRIu32 ",%" PRIu32 ",%" PRIu32 ",%" PRIu32 "]",
           i ? "," : "", c->s, c->a, c->visits, bits_of(c->value), c->lo, c->hi);
  }
  fputc(']', out);
}
static void print_model(FILE *out, const Learner *learner) {
#if DYNA_Q
  fputc('[', out);
  print_tree(out, learner->values);
  fputs(",[", out);
  for (uint32_t i = 0; i < learner->pairs; ++i) {
    Pair p = learner->experience[i];
    fprintf(out, "%s[%" PRIu32 ",%" PRIu32 ",%" PRIu32 ",[", i ? "," : "", p.s, p.a, p.total);
    for (uint32_t j = p.first; j != EMPTY; j = learner->outcomes[j].next) {
      Sample x = learner->outcomes[j];
      fprintf(out, "%s[%" PRIu32 ",%" PRIu32 ",%" PRIu32 "]",
             j == p.first ? "" : ",", x.row, x.count, bits_of(x.reward));
    }
    fputs("]]", out);
  }
  fprintf(out, "],%" PRIu32 ",%" PRIu32 "]", learner->pairs, learner->planning_seed);
#else
  if (DOUBLE_Q) fputc('[', out);
  print_tree(out, learner->values);
  if (DOUBLE_Q) {
    fputc(',', out);
    print_tree(out, learner->values + 1);
    fprintf(out, ",%" PRIu32 "]", learner->side_seed);
  }
#endif
}
static uint32_t mxcsr(void) {
  uint32_t control;
  __asm__ volatile ("stmxcsr %0" : "=m"(control));
  return control;
}

static void require_fp_environment(void) {
  if (fegetround() != FE_TONEAREST || (mxcsr() & (0x8000 | 0x40)))
    fail("requires nearest-even and IEEE subnormal inputs/outputs");
}
static void run_replicate(uint32_t rep) {
  Result *result = &results[rep];
  FILE *out = fmemopen(result->data, sizeof result->data, "w");
  if (!out) fail("cannot open bounded replicate buffer");
  uint32_t done = 0, offset = rep * STRIDE;
  Learner learner = {.side_seed = DOUBLE_Q ? mix((TRAIN_SEED + offset) ^ UINT32_C(374761393)) : 0};
#if DYNA_Q
  learner.planning_seed = mix((TRAIN_SEED + offset) ^ UINT32_C(1274126177));
#endif
  for (size_t i = 0; i < sizeof checkpoints / sizeof checkpoints[0]; ++i) {
    uint32_t point = checkpoints[i];
    fprintf(out, "[%" PRIu32 ",%" PRIu32 ",", rep, point);
    print_reports(out, &learner, TRAIN_SEED + offset + done, point - done, 1);
    fputc(',', out);
    print_reports(out, &learner, VAL_SEED + offset, VAL_COUNT, 0);
    fputc(',', out);
#if TEST_COUNT > 0
    if (i+1 == sizeof checkpoints / sizeof checkpoints[0])
      print_reports(out, &learner, TEST_SEED + offset, TEST_COUNT, 0);
    else
#endif
      fputs("null", out);
    fputc(',', out);
    print_model(out, &learner);
    fputs("]\n", out);
    done = point;
  }
  if (fflush(out) || ferror(out)) fail("replicate exhausted its output budget");
  long n = ftell(out);
  if (n <= 0 || (size_t)n >= sizeof result->data || fclose(out))
    fail("replicate output not complete within its budget");
  result->size = (size_t)n;
}
static void *work(void *arg) {
  const Work *job = arg;
  require_fp_environment();
  for (uint32_t rep = job->first; rep < REPLICATES; rep += job->stride)
    run_replicate(rep);
  return NULL;
}
int main(int argc, char **argv) {
  uint32_t workers = 1;
  if (argc == 2 && !strcmp(argv[1], "2")) workers = 2;
  else if (argc == 2 && !strcmp(argv[1], "4")) workers = 4;
  else if (argc != 1 && !(argc == 2 && !strcmp(argv[1], "1")))
    fail("usage: native [1|2|4]");
  require_fp_environment();
  pthread_t pool[MAX_WORKERS];
  Work jobs[MAX_WORKERS];
  pthread_attr_t attr;
  if (pthread_attr_init(&attr) || pthread_attr_setstacksize(&attr, STACK_CAP))
    fail("cannot configure fixed worker stacks");
  for (uint32_t i = 0; i < workers; ++i) {
    jobs[i] = (Work){i, workers};
    if (pthread_create(&pool[i], &attr, work, &jobs[i])) fail("cannot start native worker");
  }
  if (pthread_attr_destroy(&attr)) fail("cannot release worker attributes");
  for (uint32_t i = 0; i < workers; ++i)
    if (pthread_join(pool[i], NULL)) fail("cannot join native worker");

  /* Joining publishes each result. Nothing was emitted during training. */
  for (uint32_t rep = 0; rep < REPLICATES; ++rep)
    if (!results[rep].size) fail("missing native replicate output");
  if (puts(PLAN_HASH) == EOF) fail("cannot write plan hash");
  for (uint32_t rep = 0; rep < REPLICATES; ++rep) {
    const Result *result = &results[rep];
    if (fwrite(result->data, 1, result->size, stdout) != result->size)
      fail("cannot write ordered native output");
  }
  return fflush(stdout) || ferror(stdout) ? 1 : 0;
}
