/* Independently enclose the real result using directed MPFR evaluations.
 * The binary32 word is accepted only if RNE conversion of both endpoints
 * gives the same word. This detects uncertainty near rounding boundaries
 * rather than relying on fixed-precision double rounding. */
#include <errno.h>
#include <fenv.h>
#include <float.h>
#include <inttypes.h>
#include <mpfr.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

_Static_assert(sizeof(float) == sizeof(uint32_t) && FLT_RADIX == 2 &&
               FLT_MANT_DIG == 24 && FLT_MAX_EXP == 128, "requires binary32");

enum op { SIN, COS, TANH, LOG, EXP, SQRT, ADD, SUB, MUL, DIV, MUL_SUB_ONE };
struct result { uint32_t bits; int nan; };

static uint32_t bits(float f) {
  uint32_t u;
  memcpy(&u, &f, sizeof u);
  return u;
}
static float f32(uint32_t u) {
  float f;
  memcpy(&f, &u, sizeof f);
  return f;
}
static int calculate(enum op o, mpfr_t r, const mpfr_t x, const mpfr_t y, mpfr_rnd_t rd) {
  switch(o) {
    case SIN: return mpfr_sin(r,x,rd);
    case COS: return mpfr_cos(r,x,rd);
    case TANH: return mpfr_tanh(r,x,rd);
    case LOG: return mpfr_log(r,x,rd);
    case EXP: return mpfr_exp(r,x,rd);
    case SQRT: return mpfr_sqrt(r,x,rd);
    case ADD: return mpfr_add(r,x,y,rd);
    case SUB: return mpfr_sub(r,x,y,rd);
    case MUL: return mpfr_mul(r,x,y,rd);
    case DIV: return mpfr_div(r,x,y,rd);
    case MUL_SUB_ONE: return mpfr_sub_ui(r,x,1,rd);
  }
  abort();
}
static struct result rounded(enum op o, uint32_t ax, uint32_t by) {
  if (o == MUL_SUB_ONE) {
    const struct result mul = rounded(MUL, ax, by);
    if (mul.nan) return mul;
    ax = mul.bits;  /* Deliberately round before subtraction. */
  }
  mpfr_t x, y, lo, hi;
  mpfr_inits2(24, x, y, (mpfr_ptr)0);
  mpfr_inits2(128, lo, hi, (mpfr_ptr)0);
  mpfr_set_flt(x, f32(ax), MPFR_RNDN);
  mpfr_set_flt(y, f32(by), MPFR_RNDN);
  struct result result = {0, 0};
  int ok = 0;
  for (mpfr_prec_t p = 128; p <= 4096; p *= 2) {
    mpfr_set_prec(lo, p);
    mpfr_set_prec(hi, p);
    calculate(o, lo, x, y, MPFR_RNDD);
    calculate(o, hi, x, y, MPFR_RNDU);
    if (mpfr_nan_p(lo) && mpfr_nan_p(hi)) {
      result.nan = ok = 1;
      break;
    }
    const uint32_t a = bits(mpfr_get_flt(lo, MPFR_RNDN));
    const uint32_t b = bits(mpfr_get_flt(hi, MPFR_RNDN));
    if (a == b) {
      result.bits = a;
      ok = 1;
      break;
    }
    /* The directed answers to exact cancellation can differ only by sign.
     * For an exact zero, compute its IEEE RNE sign explicitly. */
    if (mpfr_zero_p(lo) && mpfr_zero_p(hi)) {
      calculate(o, lo, x, y, MPFR_RNDN);
      result.bits = bits(mpfr_get_flt(lo, MPFR_RNDN));
      ok = 1;
      break;
    }
  }
  mpfr_clears(x, y, lo, hi, (mpfr_ptr)0);
  if (!ok) {
    fprintf(stderr, "MPFR interval undecided: op %d x %08" PRIx32 " y %08" PRIx32 "\n",
            o, ax, by);
    exit(2);
  }
  return result;
}
static uint32_t word(const char *s) {
  char *end;
  errno = 0;
  unsigned long n = strtoul(s, &end, 10);
  if (!*s || *end || errno || n > UINT32_MAX) exit(2);
  return (uint32_t)n;
}
int main(int argc, char **argv) {
  if (argc < 3 || argc % 2 != 1 || fesetround(FE_TONEAREST)) return 2;
  fprintf(stderr, "MPFR %s\n", mpfr_get_version());
  for (int i = 1; i < argc; i += 2) {
    const uint32_t x = word(argv[i]), y = word(argv[i+1]);
    printf("R %08" PRIx32 " %08" PRIx32 " %08" PRIx32 " %08" PRIx32, x,y,x,y);
    for (enum op o = SIN; o <= MUL_SUB_ONE; o++) {
      const struct result r = rounded(o, x, y);
      if (r.nan) printf(" nan");
      else printf(" %08" PRIx32, r.bits);
    }
    putchar('\n');
  }
  return 0;
}
