/* ACME study: small statistics library for data.html (no network, no libraries).
   Pure functions on arrays of numbers. Distribution functions follow the standard series and
   continued fraction forms (Numerical Recipes); they are checked against SciPy in the project notes.
   Tests: Welch t, Mann-Whitney U, one-way ANOVA (classic and Welch), Kruskal-Wallis, Brown-Forsythe,
   chi-square test of independence, Holm correction. Effect sizes: Hedges g, eta squared, omega squared,
   epsilon squared, rank-biserial r, Cramer's V. */
(function (root) {
  'use strict';

  /* ---------- special functions ---------- */

  function lgamma(x) {
    var c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    var y = x, t = x + 5.5, s = 1.000000000190015;
    t -= (x + 0.5) * Math.log(t);
    for (var j = 0; j < 6; j++) s += c[j] / ++y;
    return -t + Math.log(2.5066282746310005 * s / x);
  }

  function betacf(x, a, b) {
    var MAXIT = 300, EPS = 3e-16, FPMIN = 1e-300;
    var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= MAXIT; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }

  // regularized incomplete beta I_x(a, b)
  function ibeta(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(x, a, b) / a;
    return 1 - bt * betacf(1 - x, b, a) / b;
  }

  // regularized upper incomplete gamma Q(a, x)
  function gammaQ(a, x) {
    if (x <= 0) return 1;
    var gln = lgamma(a), EPS = 3e-16, FPMIN = 1e-300;
    if (x < a + 1) {
      var ap = a, sum = 1 / a, del = sum;
      for (var n = 0; n < 500; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * EPS) break; }
      return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
    }
    var b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (var i = 1; i < 500; i++) {
      var an = -i * (i - a);
      b += 2;
      d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      var dl = d * c;
      h *= dl;
      if (Math.abs(dl - 1) < EPS) break;
    }
    return Math.exp(-x + a * Math.log(x) - gln) * h;
  }

  function pT2(t, df) { return ibeta(df / (df + t * t), df / 2, 0.5); }                 // two-sided
  function pF(F, d1, d2) { return F <= 0 ? 1 : ibeta(d2 / (d2 + d1 * F), d2 / 2, d1 / 2); }  // upper tail
  function pChi2(x, k) { return x <= 0 ? 1 : gammaQ(k / 2, x / 2); }                    // upper tail
  function pZ2(z) { return gammaQ(0.5, z * z / 2); }                                    // two-sided

  function tCrit(df, conf) {   // two-sided critical t, by bisection
    var target = 1 - conf, lo = 0, hi = 200;
    for (var i = 0; i < 100; i++) { var mid = (lo + hi) / 2; if (pT2(mid, df) > target) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  /* ---------- descriptives ---------- */

  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function mean(a) { return a.length ? sum(a) / a.length : NaN; }
  function variance(a) {
    if (a.length < 2) return NaN;
    var m = mean(a), s = 0;
    for (var i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m);
    return s / (a.length - 1);
  }
  function sd(a) { return Math.sqrt(variance(a)); }
  function median(a) {
    if (!a.length) return NaN;
    var b = a.slice().sort(function (x, y) { return x - y; }), n = b.length;
    return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2;
  }

  function describe(a) {
    var n = a.length, m = mean(a), s = sd(a), se = s / Math.sqrt(n), h = n > 1 ? tCrit(n - 1, 0.95) * se : NaN;
    return {
      n: n, mean: m, sd: s, se: se, median: median(a),
      min: Math.min.apply(null, a), max: Math.max.apply(null, a), ciLo: m - h, ciHi: m + h
    };
  }

  /* ---------- ranks ---------- */

  // average ranks of the pooled values; also the tie term sum(t^3 - t)
  function ranks(values) {
    var idx = values.map(function (v, i) { return i; }).sort(function (i, j) { return values[i] - values[j]; });
    var r = new Array(values.length), ties = 0, i = 0;
    while (i < idx.length) {
      var j = i;
      while (j + 1 < idx.length && values[idx[j + 1]] === values[idx[i]]) j++;
      var avg = (i + j) / 2 + 1, t = j - i + 1;
      for (var k = i; k <= j; k++) r[idx[k]] = avg;
      ties += t * t * t - t;
      i = j + 1;
    }
    return { r: r, ties: ties };
  }

  /* ---------- two groups ---------- */

  function welchT(a, b) {
    var n1 = a.length, n2 = b.length, m1 = mean(a), m2 = mean(b), v1 = variance(a), v2 = variance(b);
    var se2 = v1 / n1 + v2 / n2, se = Math.sqrt(se2), diff = m1 - m2;
    if (!(se > 0)) return { t: NaN, df: NaN, p: NaN, diff: diff, ciLo: NaN, ciHi: NaN, g: NaN, degenerate: true };
    var t = diff / se;
    var df = se2 * se2 / ((v1 / n1) * (v1 / n1) / (n1 - 1) + (v2 / n2) * (v2 / n2) / (n2 - 1));
    var p = pT2(t, df), h = tCrit(df, 0.95) * se;
    var sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
    var d = sp > 0 ? diff / sp : NaN;
    var g = d * (1 - 3 / (4 * (n1 + n2) - 9));      // Hedges correction
    return { t: t, df: df, p: p, diff: diff, ciLo: diff - h, ciHi: diff + h, g: g };
  }

  function mannWhitney(a, b) {
    var n1 = a.length, n2 = b.length, n = n1 + n2, rk = ranks(a.concat(b));
    var r1 = 0;
    for (var i = 0; i < n1; i++) r1 += rk.r[i];
    var u1 = r1 - n1 * (n1 + 1) / 2, u2 = n1 * n2 - u1, u = Math.max(u1, u2);
    var mu = n1 * n2 / 2, sigma2 = n1 * n2 / 12 * ((n + 1) - rk.ties / (n * (n - 1)));
    var p = 1;
    if (sigma2 > 0) p = pZ2(Math.max(0, u - mu - 0.5) / Math.sqrt(sigma2));
    return { u: Math.min(u1, u2), u1: u1, p: Math.min(1, p), r: 2 * u1 / (n1 * n2) - 1 };
  }

  /* ---------- k groups ---------- */

  function anova(groups) {
    var k = groups.length, N = 0, tot = 0, i;
    groups.forEach(function (g) { N += g.length; tot += sum(g); });
    var gm = tot / N, ssb = 0, ssw = 0;
    groups.forEach(function (g) {
      var m = mean(g);
      ssb += g.length * (m - gm) * (m - gm);
      for (i = 0; i < g.length; i++) ssw += (g[i] - m) * (g[i] - m);
    });
    var df1 = k - 1, df2 = N - k, msb = ssb / df1, msw = ssw / df2;
    var F = msw > 0 ? msb / msw : Infinity;
    return {
      F: F, df1: df1, df2: df2, p: msw > 0 ? pF(F, df1, df2) : 0,
      eta2: ssb / (ssb + ssw), omega2: Math.max(0, (ssb - df1 * msw) / (ssb + ssw + msw))
    };
  }

  function welchAnova(groups) {
    var k = groups.length, w = [], m = [], W = 0, mw = 0, i;
    for (i = 0; i < k; i++) {
      var v = variance(groups[i]);
      if (!(v > 0)) return null;
      w.push(groups[i].length / v); m.push(mean(groups[i]));
      W += w[i];
    }
    for (i = 0; i < k; i++) mw += w[i] * m[i] / W;
    var A = 0, lam = 0;
    for (i = 0; i < k; i++) {
      A += w[i] * (m[i] - mw) * (m[i] - mw) / (k - 1);
      lam += (1 - w[i] / W) * (1 - w[i] / W) / (groups[i].length - 1);
    }
    var B = 1 + 2 * (k - 2) / (k * k - 1) * lam;
    var F = A / B, df1 = k - 1, df2 = (k * k - 1) / (3 * lam);
    return { F: F, df1: df1, df2: df2, p: pF(F, df1, df2) };
  }

  function kruskal(groups) {
    var all = [], N = 0;
    groups.forEach(function (g) { all = all.concat(g); });
    N = all.length;
    var rk = ranks(all), pos = 0, H = 0;
    groups.forEach(function (g) {
      var r = 0;
      for (var i = 0; i < g.length; i++) r += rk.r[pos + i];
      pos += g.length;
      H += r * r / g.length;
    });
    H = 12 / (N * (N + 1)) * H - 3 * (N + 1);
    var corr = 1 - rk.ties / (N * N * N - N);
    if (corr > 0) H /= corr;
    var df = groups.length - 1;
    return { H: H, df: df, p: pChi2(H, df), eps2: H / (N - 1) };
  }

  // Brown-Forsythe (Levene with the median): do the groups have the same spread?
  function levene(groups) {
    var z = groups.map(function (g) { var md = median(g); return g.map(function (x) { return Math.abs(x - md); }); });
    var r = anova(z);
    return { F: r.F, df1: r.df1, df2: r.df2, p: r.p };
  }

  function holm(ps) {
    var idx = ps.map(function (p, i) { return i; }).sort(function (a, b) { return ps[a] - ps[b]; });
    var out = new Array(ps.length), run = 0, m = ps.length;
    idx.forEach(function (i, rank) {
      run = Math.max(run, Math.min(1, (m - rank) * ps[i]));
      out[i] = run;
    });
    return out;
  }

  /* ---------- chi-square test of independence (groups x yes/no) ---------- */

  function chiSquareRates(groups) {   // groups: [{yes, n}]
    var k = groups.length, Y = 0, N = 0, chi = 0, lowExpected = false;
    groups.forEach(function (g) { Y += g.yes; N += g.n; });
    if (k < 2 || Y === 0 || Y === N) return null;
    groups.forEach(function (g) {
      var ey = g.n * Y / N, en = g.n * (N - Y) / N;
      if (ey < 5 || en < 5) lowExpected = true;
      chi += (g.yes - ey) * (g.yes - ey) / ey + ((g.n - g.yes) - en) * ((g.n - g.yes) - en) / en;
    });
    return { chi2: chi, df: k - 1, p: pChi2(chi, k - 1), v: Math.sqrt(chi / (N * 1)), lowExpected: lowExpected };
  }

  /* ---------- the comparison used by the page ---------- */

  function effectWord(x, kind) {
    var a = Math.abs(x);
    var cut = kind === 'g' ? [0.2, 0.5, 0.8] : kind === 'eta' ? [0.01, 0.06, 0.14] : [0.1, 0.3, 0.5];
    return a < cut[0] ? 'negligible' : a < cut[1] ? 'small' : a < cut[2] ? 'medium' : 'large';
  }

  // groups: [{ key, label, values: [numbers] }]. Groups with fewer than 2 values are left out.
  function compare(groups) {
    var use = groups.filter(function (g) { return g.values.length >= 2; });
    var res = { groups: use, dropped: groups.length - use.length };
    if (use.length < 2) { res.error = 'Need at least two groups with two or more values.'; return res; }
    var vals = use.map(function (g) { return g.values; });
    res.desc = use.map(function (g) { return describe(g.values); });
    res.levene = use.reduce(function (s, g) { return s + g.values.length; }, 0) > use.length ? levene(vals) : null;
    if (use.length === 2) {
      res.kind = 'two';
      res.welch = welchT(vals[0], vals[1]);
      res.mw = mannWhitney(vals[0], vals[1]);
    } else {
      res.kind = 'many';
      res.anova = anova(vals);
      res.welchAnova = welchAnova(vals);
      res.kruskal = kruskal(vals);
    }
    if (res.kind === 'two' ? res.welch.degenerate : !isFinite(res.anova.F)) {
      res.error = 'The values have no spread inside the groups, so the tests are not defined.';
      return res;
    }
    res.pairs = [];
    if (use.length > 2) {
      for (var i = 0; i < use.length; i++) for (var j = i + 1; j < use.length; j++) {
        res.pairs.push({ i: i, j: j, welch: welchT(vals[i], vals[j]), mw: mannWhitney(vals[i], vals[j]) });
      }
      var pa = holm(res.pairs.map(function (q) { return isNaN(q.welch.p) ? 1 : q.welch.p; }));
      var pb = holm(res.pairs.map(function (q) { return q.mw.p; }));
      res.pairs.forEach(function (q, x) { q.welchHolm = pa[x]; q.mwHolm = pb[x]; });
    }
    return res;
  }

  // n per group for a two-sided two-sample t test, alpha .05, power .80 (normal approximation)
  function nPerGroup(d) { return Math.ceil(2 * Math.pow(1.959964 + 0.841621, 2) / (d * d) + 0.96); }

  var api = {
    ibeta: ibeta, gammaQ: gammaQ, pT2: pT2, pF: pF, pChi2: pChi2, pZ2: pZ2, tCrit: tCrit,
    mean: mean, sd: sd, median: median, describe: describe, ranks: ranks,
    welchT: welchT, mannWhitney: mannWhitney, anova: anova, welchAnova: welchAnova, kruskal: kruskal,
    levene: levene, holm: holm, chiSquareRates: chiSquareRates, compare: compare,
    effectWord: effectWord, nPerGroup: nPerGroup
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACMEStats = api;
})(typeof window !== 'undefined' ? window : this);
