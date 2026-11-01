/* ACME study: small statistics library for data.html (no network, no libraries).
   Pure functions on arrays of numbers. Distribution functions follow the standard series and
   continued fraction forms (Numerical Recipes); they are checked against SciPy in the project notes.
   Tests: Welch t, Mann-Whitney U, one-way ANOVA (classic and Welch), Kruskal-Wallis, Brown-Forsythe,
   chi-square test of independence, Holm correction. Effect sizes: Hedges g, eta squared, omega squared,
   epsilon squared, rank-biserial r, Cramer's V.
   For the correlational study: Pearson and Spearman correlation (Fisher CI), skewness and kurtosis, Cronbach's alpha,
   McDonald's omega (one factor, principal axis), ordinary least squares, VIF, Benjamini-Hochberg, power for correlations. */
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

  /* ---------- correlation-study tools ---------- */

  function normCdf(z) { return z >= 0 ? 1 - 0.5 * pZ2(z) : 0.5 * pZ2(z); }

  // inverse of the normal cdf: Acklam's rational approximation plus one Halley step
  function normInv(p) {
    if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
    var a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    var b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    var c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    var d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    var x, q, r;
    if (p < 0.02425) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    else if (p > 1 - 0.02425) { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    else { q = p - 0.5; r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
    var e = normCdf(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }

  // Benjamini-Hochberg false discovery rate (adjusted p-values)
  function bh(ps) {
    var m = ps.length, idx = ps.map(function (p, i) { return i; }).sort(function (a, b) { return ps[b] - ps[a]; });
    var out = new Array(m), run = 1;
    idx.forEach(function (i, k) { var rank = m - k; run = Math.min(run, ps[i] * m / rank); out[i] = Math.min(1, run); });
    return out;
  }

  function skew(a) {   // sample skewness G1 (as SPSS and scipy bias=False)
    var n = a.length;
    if (n < 3) return NaN;
    var m = mean(a), s = sd(a), t = 0;
    if (!(s > 0)) return NaN;
    for (var i = 0; i < n; i++) t += Math.pow((a[i] - m) / s, 3);
    return n / ((n - 1) * (n - 2)) * t;
  }

  function kurtosis(a) {   // sample excess kurtosis G2
    var n = a.length;
    if (n < 4) return NaN;
    var m = mean(a), s = sd(a), t = 0;
    if (!(s > 0)) return NaN;
    for (var i = 0; i < n; i++) t += Math.pow((a[i] - m) / s, 4);
    return n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * t - 3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3));
  }

  // Pearson r with t test and Fisher 95% CI. x and y: equal-length arrays, no missing values.
  function pearson(x, y) {
    var n = x.length;
    if (n < 3) return { r: NaN, n: n, p: NaN, ciLo: NaN, ciHi: NaN, df: n - 2 };
    var mx = mean(x), my = mean(y), sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) { var dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    var tx = 1e-18 * (mx * mx + 1e-12), ty = 1e-18 * (my * my + 1e-12);   // a value that varies only by rounding noise has no spread
    if (!(sxx / n > tx && syy / n > ty)) return { r: NaN, n: n, p: NaN, ciLo: NaN, ciHi: NaN, df: n - 2, degenerate: true };
    var r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))), df = n - 2;
    var p = Math.abs(r) >= 1 ? 0 : pT2(r * Math.sqrt(df / (1 - r * r)), df);
    var lo = NaN, hi = NaN;
    if (n > 3 && Math.abs(r) < 1) { var z = Math.atanh(r), h = 1.959964 / Math.sqrt(n - 3); lo = Math.tanh(z - h); hi = Math.tanh(z + h); }
    return { r: r, n: n, p: p, ciLo: lo, ciHi: hi, df: df };
  }

  function spearman(x, y) {
    if (x.length < 3) return { r: NaN, n: x.length, p: NaN, ciLo: NaN, ciHi: NaN, df: x.length - 2 };
    return pearson(ranks(x).r, ranks(y).r);
  }

  // slope, intercept and r of a simple regression line (for scatter plots)
  function line(x, y) {
    var mx = mean(x), my = mean(y), sxy = 0, sxx = 0;
    for (var i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); }
    var b = sxx > 0 ? sxy / sxx : NaN;
    return { b: b, a: my - b * mx };
  }

  function corrMatrix(cols) {   // cols: array of arrays (complete cases), returns k x k Pearson matrix
    var k = cols.length, R = [];
    for (var i = 0; i < k; i++) { R.push([]); for (var j = 0; j < k; j++) R[i].push(i === j ? 1 : NaN); }
    for (i = 0; i < k; i++) for (j = i + 1; j < k; j++) { R[i][j] = R[j][i] = pearson(cols[i], cols[j]).r; }
    return R;
  }

  // Cronbach's alpha. rows: array of participants, each an array of k item scores (complete cases only).
  function cronbach(rows) {
    var n = rows.length, k = n ? rows[0].length : 0;
    if (n < 3 || k < 2) return { alpha: NaN, n: n, k: k, items: [] };
    var cols = [], i, j;
    for (j = 0; j < k; j++) cols.push(rows.map(function (r) { return r[j]; }));
    var tot = rows.map(function (r) { return sum(r); });
    function alphaOf(c) {
      var kk = c.length, vs = 0, t = [];
      for (var q = 0; q < n; q++) { var s = 0; for (var w = 0; w < kk; w++) s += c[w][q]; t.push(s); }
      for (var w2 = 0; w2 < kk; w2++) vs += variance(c[w2]);
      var vt = variance(t);
      return vt > 0 ? kk / (kk - 1) * (1 - vs / vt) : NaN;
    }
    var R = corrMatrix(cols), rs = 0, cnt = 0;
    for (i = 0; i < k; i++) for (j = i + 1; j < k; j++) if (isFinite(R[i][j])) { rs += R[i][j]; cnt++; }
    var rbar = cnt ? rs / cnt : NaN;
    var items = cols.map(function (c, idx) {
      var others = rows.map(function (r, q) { return tot[q] - r[idx]; });
      var rest = cols.filter(function (cc, w) { return w !== idx; });
      return { mean: mean(c), sd: sd(c), rDrop: pearson(c, others).r, alphaDrop: k > 2 ? alphaOf(rest) : NaN };
    });
    return { alpha: alphaOf(cols), alphaStd: isFinite(rbar) ? k * rbar / (1 + (k - 1) * rbar) : NaN, rbar: rbar, n: n, k: k, items: items };
  }

  // McDonald's omega (total) from a one-factor solution (iterated principal axis). rows as in cronbach().
  function omega(rows) {
    var n = rows.length, k = n ? rows[0].length : 0;
    if (n < 5 || k < 3) return NaN;
    var cols = [], i, j;
    for (j = 0; j < k; j++) cols.push(rows.map(function (r) { return r[j]; }));
    var R = corrMatrix(cols);
    for (i = 0; i < k; i++) for (j = 0; j < k; j++) if (!isFinite(R[i][j])) return NaN;
    var h = R.map(function (row, a) { var m = 0; row.forEach(function (v, b) { if (a !== b) m = Math.max(m, Math.abs(v)); }); return m; });
    var lam = new Array(k).fill(0), it, v;
    for (it = 0; it < 500; it++) {
      var M = R.map(function (row, a) { return row.map(function (x, b) { return a === b ? h[a] : x; }); });
      v = new Array(k).fill(1 / Math.sqrt(k));
      var ev = 0;
      for (var p = 0; p < 300; p++) {      // power iteration on M + shift, so the largest eigenvalue is the dominant one
        var w = new Array(k).fill(0);
        for (i = 0; i < k; i++) { for (j = 0; j < k; j++) w[i] += M[i][j] * v[j]; w[i] += k * v[i]; }
        var nm = Math.sqrt(sum(w.map(function (z) { return z * z; })));
        if (!(nm > 0)) return NaN;
        var nv = w.map(function (z) { return z / nm; }), dd = 0;
        for (i = 0; i < k; i++) dd = Math.max(dd, Math.abs(nv[i] - v[i]));
        v = nv; ev = nm - k;
        if (dd < 1e-13) break;
      }
      if (!(ev > 0)) return NaN;
      var sgn = sum(v) < 0 ? -1 : 1, change = 0;
      for (i = 0; i < k; i++) { lam[i] = sgn * v[i] * Math.sqrt(ev); var nh = Math.min(0.9999, lam[i] * lam[i]); change = Math.max(change, Math.abs(nh - h[i])); h[i] = nh; }
      if (change < 1e-10) break;
    }
    var sl = sum(lam), uniq = 0;
    for (i = 0; i < k; i++) uniq += 1 - lam[i] * lam[i];
    return sl * sl / (sl * sl + uniq);
  }

  /* ---------- linear algebra and ordinary least squares ---------- */

  function invert(A) {   // Gauss-Jordan with partial pivoting; null when singular
    var n = A.length, M = A.map(function (r, i) { var row = r.slice(); for (var j = 0; j < n; j++) row.push(i === j ? 1 : 0); return row; });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-11) return null;
      var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      var d = M[c][c];
      for (var j2 = 0; j2 < 2 * n; j2++) M[c][j2] /= d;
      for (r = 0; r < n; r++) if (r !== c) { var f = M[r][c]; if (f) for (j2 = 0; j2 < 2 * n; j2++) M[r][j2] -= f * M[c][j2]; }
    }
    return M.map(function (row) { return row.slice(n); });
  }

  // X: n rows of predictor values WITHOUT the intercept column; y: n values. The intercept is always fitted.
  function ols(X, y) {
    var n = y.length, p = (X[0] ? X[0].length : 0) + 1, i, j, k;
    if (n <= p) return { error: 'Not enough complete cases for this model (' + n + ' cases, ' + p + ' coefficients).' };
    var D = X.map(function (r) { return [1].concat(r); });
    var XtX = [], Xty = [];
    for (i = 0; i < p; i++) { XtX.push(new Array(p).fill(0)); Xty.push(0); }
    for (k = 0; k < n; k++) for (i = 0; i < p; i++) { Xty[i] += D[k][i] * y[k]; for (j = i; j < p; j++) XtX[i][j] += D[k][i] * D[k][j]; }
    for (i = 0; i < p; i++) for (j = 0; j < i; j++) XtX[i][j] = XtX[j][i];
    var inv = invert(XtX);
    if (!inv) return { error: 'The predictors are perfectly collinear (or one has no spread), so the model cannot be fitted.' };
    var b = inv.map(function (row) { var s = 0; for (var q = 0; q < p; q++) s += row[q] * Xty[q]; return s; });
    var sse = 0, my = mean(y), sst = 0;
    for (k = 0; k < n; k++) { var f = 0; for (i = 0; i < p; i++) f += D[k][i] * b[i]; sse += (y[k] - f) * (y[k] - f); sst += (y[k] - my) * (y[k] - my); }
    var df = n - p, s2 = sse / df, tc = tCrit(df, 0.95);
    var cov = inv.map(function (row) { return row.map(function (v) { return v * s2; }); });
    var coef = b.map(function (bi, q) {
      var se = Math.sqrt(cov[q][q]), t = bi / se;
      return { b: bi, se: se, t: t, p: se > 0 ? pT2(t, df) : NaN, ciLo: bi - tc * se, ciHi: bi + tc * se };
    });
    var r2 = sst > 0 ? 1 - sse / sst : NaN, dfm = p - 1;
    var F = dfm > 0 && sse > 0 ? ((sst - sse) / dfm) / (sse / df) : NaN;
    return { n: n, p: p, df: df, coef: coef, cov: cov, r2: r2, adjR2: 1 - (1 - r2) * (n - 1) / df, F: F, dfm: dfm, pF: isFinite(F) ? pF(F, dfm, df) : NaN, sigma: Math.sqrt(s2) };
  }

  // variance inflation factors of the columns of X (no intercept): diagonal of the inverse correlation matrix
  function vif(X) {
    var k = X[0] ? X[0].length : 0, cols = [];
    if (k < 2) return k ? [1] : [];
    for (var j = 0; j < k; j++) cols.push(X.map(function (r) { return r[j]; }));
    var inv = invert(corrMatrix(cols));
    return inv ? inv.map(function (row, i) { return row[i]; }) : cols.map(function () { return Infinity; });
  }

  /* ---------- power and sensitivity for correlations ---------- */

  function minR(n, power, alpha) {   // smallest |r| detectable with the given power, two-sided (Fisher z)
    if (n <= 3) return NaN;
    var za = normInv(1 - (alpha == null ? 0.05 : alpha) / 2), zb = normInv(power == null ? 0.8 : power);
    return Math.tanh((za + zb) / Math.sqrt(n - 3));
  }

  function nForR(r, power, alpha) {
    var za = normInv(1 - (alpha == null ? 0.05 : alpha) / 2), zb = normInv(power == null ? 0.8 : power);
    return Math.ceil(Math.pow((za + zb) / Math.atanh(Math.abs(r)), 2) + 3);
  }

  var api = {
    ibeta: ibeta, gammaQ: gammaQ, pT2: pT2, pF: pF, pChi2: pChi2, pZ2: pZ2, tCrit: tCrit,
    mean: mean, sd: sd, variance: variance, median: median, describe: describe, ranks: ranks,
    welchT: welchT, mannWhitney: mannWhitney, anova: anova, welchAnova: welchAnova, kruskal: kruskal,
    levene: levene, holm: holm, chiSquareRates: chiSquareRates, compare: compare,
    effectWord: effectWord, nPerGroup: nPerGroup,
    normCdf: normCdf, normInv: normInv, bh: bh, skew: skew, kurtosis: kurtosis, pearson: pearson, spearman: spearman, line: line,
    corrMatrix: corrMatrix, cronbach: cronbach, omega: omega, invert: invert, ols: ols, vif: vif, minR: minR, nForR: nForR
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ACMEStats = api;
})(typeof window !== 'undefined' ? window : this);
