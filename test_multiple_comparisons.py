import contextlib
import csv
import io
import unittest
from itertools import combinations
from analyze import sign_test, holm, summarize


class Multiple(unittest.TestCase):
    def test_exact(self):
        self.assertEqual(sign_test([0]*8),(0,1))
        self.assertEqual(sign_test([1]*6+[0]*5),(6,1/32))
        self.assertEqual(sign_test([1]*5+[-1]),(6,14/64))
        self.assertEqual(sign_test([-99,1,3]),(3,1))
        self.assertGreater(sign_test([1]*2000)[1],0)

    def test_stepdown(self):
        self.assertEqual(holm(dict(a=.01,b=.011,c=.3)),dict(a=.03,b=.03,c=.3))
        self.assertEqual(holm(dict(a=.9,b=.9)),dict(a=1,b=1))

    def test_csv_scope(self):
        groups={(g,2,a):{i:score for i in range(6)}
                for g in ['g','h'] for a,score in [('ref',0),('a',1),('b',0)]}
        del groups['h',2,'b']
        file=io.StringIO()
        with contextlib.redirect_stdout(file):summarize(groups,'test','return','ref',200,'holm-sign')
        rows={(r['game'],r['arm']):r for r in csv.DictReader(io.StringIO(file.getvalue()))}
        self.assertEqual(float(rows['g','a']['holm_sign_p']),1/16)
        self.assertEqual(float(rows['h','a']['holm_sign_p']),1/32)
        self.assertEqual(int(rows['g','b']['non_ties']),0)
        with self.assertRaises(ValueError):summarize(groups,'test','return',None,200,'holm-sign')

    def test_two_correlated_null_contrasts(self):
        # Enumerate all equally likely sign patterns on 8 independent paired
        # replicate blocks. A second contrast can be perfectly anticorrelated.
        rejected=0
        for bits in range(256):
            x=[1 if bits&(1<<i) else -1 for i in range(8)]
            ps=holm({'a':sign_test(x)[1],'b':sign_test([-v for v in x])[1]})
            rejected+=min(ps.values())<=.05
        self.assertLessEqual(rejected/256,.05)

if __name__=='__main__':unittest.main()
