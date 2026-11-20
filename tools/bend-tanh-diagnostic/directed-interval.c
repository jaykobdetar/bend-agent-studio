/* MPFR independent enclosure, RNE, IEEE binary32 input words. */
#include <fenv.h>
#include <float.h>
#include <inttypes.h>
#include <mpfr.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

_Static_assert(sizeof(float) == sizeof(uint32_t) && FLT_RADIX == 2 &&
               FLT_MANT_DIG == 24 && FLT_MAX_EXP == 128, "requires binary32");

static uint32_t bits(float f) {
  uint32_t u;
  memcpy(&u, &f, sizeof u);
  return u;
}

int main(void) {
  if (fesetround(FE_TONEAREST)) return 1;
  mpfr_t x, lo, hi;
  mpfr_init2(x, 24);
  mpfr_inits2(128, lo, hi, (mpfr_ptr)0);
  fprintf(stderr, "MPFR %s\n", mpfr_get_version());
  uint32_t u;
  int read;
  while ((read = scanf("%8" SCNx32, &u)) == 1) {
    if ((u & UINT32_C(0x7fffffff)) > UINT32_C(0x7f800000)) {
      printf("%08" PRIx32 " nan\n", u);
      continue;
    }
    float f;
    memcpy(&f, &u, sizeof f);
    mpfr_set_flt(x, f, MPFR_RNDN);
    int resolved = 0;
    for (mpfr_prec_t p = 128; p <= 4096; p *= 2) {
      mpfr_set_prec(lo, p);
      mpfr_set_prec(hi, p);
      mpfr_tanh(lo, x, MPFR_RNDD);
      mpfr_tanh(hi, x, MPFR_RNDU);
      const uint32_t a = bits(mpfr_get_flt(lo, MPFR_RNDN));
      const uint32_t b = bits(mpfr_get_flt(hi, MPFR_RNDN));
      if (a == b) {
        printf("%08" PRIx32 " %08" PRIx32 "\n", u, a);
        resolved = 1;
        break;
      }
    }
    if (!resolved) {
      fprintf(stderr, "MPFR interval unresolved for %08" PRIx32 "\n", u);
      return 2;
    }
  }
  mpfr_clears(x, lo, hi, (mpfr_ptr)0);
  return read == EOF && !ferror(stdin) ? 0 : 1;
}
