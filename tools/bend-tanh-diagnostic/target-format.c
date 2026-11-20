/* MPFR target-format binary32 oracle, separate from the interval + float cast. */
#include <assert.h>
#include <inttypes.h>
#include <mpfr.h>
#include <stdint.h>
#include <stdio.h>

#define SGN UINT32_C(0x80000000)
#define FRAC UINT32_C(0x007fffff)
#define INF UINT32_C(0x7f800000)

static void import_word(mpfr_t x, uint32_t u) {
  const int sign = (u & SGN) ? -1 : 1;
  const unsigned exp = (u >> 23) & 0xff;
  const uint32_t frac = u & FRAC;
  if (exp == 0xff) {
    assert(frac == 0);
    mpfr_set_inf(x, sign);
  } else if (exp == 0 && frac == 0) {
    mpfr_set_zero(x, sign);
  } else {
    const uint32_t sig = exp == 0 ? frac : UINT32_C(0x00800000) | frac;
    const mpfr_exp_t shift = exp == 0 ? -149 : (mpfr_exp_t)exp - 150;
    assert(mpfr_set_ui_2exp(x, sig, shift, MPFR_RNDN) == 0);
    if (sign < 0) assert(mpfr_neg(x, x, MPFR_RNDN) == 0);
  }
}

static uint32_t export_word(const mpfr_t x, mpz_t scratch) {
  const uint32_t sign = mpfr_signbit(x) ? SGN : 0;
  assert(!mpfr_nan_p(x));
  if (mpfr_zero_p(x)) return sign;
  if (mpfr_inf_p(x)) return sign | INF;
  const mpfr_exp_t scaled = mpfr_get_z_2exp(scratch, x);
  const mpfr_exp_t exponent = mpfr_get_exp(x);
  assert(exponent >= -148 && exponent <= 128);
  assert(mpz_sizeinbase(scratch, 2) == 24 && scaled == exponent - 24);
  const uint32_t sig = (uint32_t)mpz_get_ui(scratch); /* Abs value. */
  if (exponent >= -125) {
    const uint32_t biased = (uint32_t)(exponent + 126);
    return sign | (biased << 23) | (sig & FRAC);
  }
  const unsigned drop = (unsigned)(-149 - scaled);
  assert(drop >= 1 && drop <= 23);
  assert((sig & ((UINT32_C(1) << drop) - 1)) == 0);
  assert((sig >> drop) != 0 && (sig >> drop) <= FRAC);
  return sign | (sig >> drop);
}

static void ternary_control(mpz_t scratch) {
  mpfr_t exact, with_ternary, without_ternary;
  mpfr_init2(exact, 48);
  mpfr_inits2(24, with_ternary, without_ternary, (mpfr_ptr)0);
  /* (1.5 - 2^-25) times the least subnormal. The first RNE rounds up
   * to exactly 1.5 ulps; honoring the ternary resolves the false tie. */
  assert(mpfr_set_ui_2exp(exact, 50331647, -174, MPFR_RNDN) == 0);
  const int ternary = mpfr_set(with_ternary, exact, MPFR_RNDN);
  assert(ternary > 0);
  assert(mpfr_set(without_ternary, with_ternary, MPFR_RNDN) == 0);
  mpfr_subnormalize(with_ternary, ternary, MPFR_RNDN);
  mpfr_subnormalize(without_ternary, 0, MPFR_RNDN); /* Deliberately wrong. */
  const uint32_t correct = export_word(with_ternary, scratch);
  const uint32_t double_rounded = export_word(without_ternary, scratch);
  assert(correct == 1 && double_rounded == 2);
  fprintf(stderr, "halfway control: propagated %08" PRIx32
                  ", dropped %08" PRIx32 "\n", correct, double_rounded);
  mpfr_clears(exact, with_ternary, without_ternary, (mpfr_ptr)0);
}

int main(void) {
  if (mpfr_set_emin(-148) || mpfr_set_emax(128)) return 1;
  mpfr_t x, y;
  mpz_t scratch;
  mpfr_inits2(24, x, y, (mpfr_ptr)0);
  mpz_init(scratch);
  fprintf(stderr, "MPFR %s, precision %ld, emin %ld, emax %ld\n",
          mpfr_get_version(), (long)mpfr_get_prec(y),
          (long)mpfr_get_emin(), (long)mpfr_get_emax());
  ternary_control(scratch);
  uint32_t u;
  int read;
  while ((read = scanf("%8" SCNx32, &u)) == 1) {
    if ((u & ~SGN) > INF) {
      printf("%08" PRIx32 " nan\n", u); /* No MPFR payload guarantee. */
      continue;
    }
    import_word(x, u);
    assert(export_word(x, scratch) == u);
    const int ternary = mpfr_tanh(y, x, MPFR_RNDN);
    mpfr_subnormalize(y, ternary, MPFR_RNDN);
    printf("%08" PRIx32 " %08" PRIx32 "\n", u, export_word(y, scratch));
  }
  mpz_clear(scratch);
  mpfr_clears(x, y, (mpfr_ptr)0);
  return read == EOF && !ferror(stdin) ? 0 : 1;
}
