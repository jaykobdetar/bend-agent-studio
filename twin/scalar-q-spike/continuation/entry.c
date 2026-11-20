/* Appended to the existing generated scalar witness. No archive I/O. */
/* CONTINUATION DATA */

_Static_assert(!DYNA_Q && !DOUBLE_Q && !UNIFORM && !EXPECTED_SARSA && REPLICATES == 1,
               "continuation checks one Q-learning replicate");
_Static_assert(sizeof resume_rows / sizeof resume_rows[0] <= PAIR_CAP,
               "restored model exceeds the selected kernel's capacity");

int main(void) {
  require_fp_environment();
  Learner learner = {0};
  Table *t = learner.values;
  t->size = sizeof resume_rows / sizeof resume_rows[0];
  for (uint32_t i = 0; i < t->size; ++i) {
    const uint32_t *r = resume_rows[i];
    t->cells[i] = (Cell){r[0], r[1], r[2], r[4], r[5], from_bits(r[3])};
  }
  puts(CONTINUATION_HASH);
  fputc('[', stdout);
  print_tree(stdout, t);
  fputc(',', stdout);
  print_reports(stdout, &learner, CONTINUATION_FIRST_SEED, CONTINUATION_TRAIN_COUNT, 1);
  fputc(',', stdout);
  print_reports(stdout, &learner, CONTINUATION_VALIDATION_SEED, VAL_COUNT, 0);
  fputc(',', stdout);
  print_tree(stdout, t);
  puts("]");
  return fflush(stdout) || ferror(stdout) ? 1 : 0;
}
