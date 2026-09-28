/* Cálculos dos padrões de crescimento da OMS (0–5 anos) — sem DOM, sem dados embutidos.
 * Os dados (L, M, S) vêm de who-growth-data.js (gerado a partir das tabelas oficiais).
 *
 * Método: LMS, tal como no pacote oficial da OMS "anthro" (R, github.com/WorldHealthOrganization/anthro):
 *   z = ((y/M)^L − 1) / (S·L)
 *   Indicadores de peso (peso/idade, peso/comprimento, peso/altura) usam o z "ajustado" da OMS para |z| > 3:
 *     SDk = M·(1 + L·S·k)^(1/L)
 *     z > 3  → 3 + (y − SD3) / (SD3 − SD2)
 *     z < −3 → −3 + (y − SD−3) / (SD−2 − SD−3)
 *   Comprimento/altura e perímetro cefálico usam o z sem ajuste.
 *   Idade = dias completos entre a data de nascimento e a data da medição; só < 60 meses (dias / 30,4375).
 *   Peso/comprimento: < 731 dias → tabela de comprimento (45–110 cm); ≥ 731 dias → tabela de altura (65–120 cm);
 *     L, M, S interpolados linearmente entre os dois pontos de 0,1 cm (como no anthro).
 *   z arredondado a 2 casas (como no anthro); percentil = Φ(z)·100.
 *   Sinalização (valores a confirmar), limiares do anthro: peso/idade z < −6 ou > 5; comprimento |z| > 6;
 *     perímetro cefálico |z| > 5; peso/comprimento |z| > 5.
 * Referência técnica: WHO Child Growth Standards — Methods and development (2006), cap. 7. */
(function(root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.WhoGrowth = factory(root.WHO_GROWTH_DATA);
})(typeof self !== 'undefined' ? self : this, function(DATA){
  'use strict';
  if (!DATA) return null;

  const DAYS_PER_MONTH = 365.25 / 12;          // 30,4375 — o mesmo do anthro
  const MAX_DAY = 1856;
  const HEIGHT_FROM_DAY = DATA.lhfaHeightFromDay; // 731: a partir daqui a OMS usa altura (em pé)

  // "AAAA-MM-DD" → dia civil (sem horas nem fuso). Datas locais, aritmética em UTC para evitar a mudança de hora.
  function civilDay(iso){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = Date.UTC(y, mo - 1, d);
    const back = new Date(t);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
    return t / 86400000;
  }
  function ageInDays(dobISO, dateISO){
    const a = civilDay(dobISO), b = civilDay(dateISO);
    return (a == null || b == null) ? null : b - a;
  }

  // Φ(z) — Marsaglia (2004), série de Taylor; erro < 1e-14 para |z| ≤ 8.
  function normCdf(z){
    if (z < -8) return 0; if (z > 8) return 1;
    let s = z, t = 0, b = z, q = z * z, i = 1;
    while (s !== t) s = (t = s) + (b *= q / (i += 2));
    return 0.5 + s * Math.exp(-0.5 * q - 0.91893853320467274178);
  }
  // Φ⁻¹(p) por bisseção sobre normCdf (só usado para desenhar as curvas P3…P97).
  function normQuantile(p){
    let lo = -8, hi = 8;
    for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (normCdf(mid) < p) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  }

  function lmsZ(y, L, M, S){ return L === 0 ? Math.log(y / M) / S : (Math.pow(y / M, L) - 1) / (S * L); }
  function lmsValue(z, L, M, S){ return L === 0 ? M * Math.exp(S * z) : M * Math.pow(1 + L * S * z, 1 / L); }
  function lmsZAdjusted(y, L, M, S){
    const z = lmsZ(y, L, M, S);
    const sd = k => lmsValue(k, L, M, S);
    if (z > 3) { const sd3 = sd(3); return 3 + (y - sd3) / (sd3 - sd(2)); }
    if (z < -3) { const sd3n = sd(-3); return -3 + (y - sd3n) / (sd(-2) - sd3n); }
    return z;
  }
  const round2 = z => Math.round(z * 100) / 100;

  function table(ind, sex){
    const t = DATA[ind]; if (!t) return null;
    const s = t[sex === 'M' ? 'M' : sex === 'F' ? 'F' : null];
    return s ? { t, s } : null;
  }
  function lmsAtDay(ind, sex, day){
    const tb = table(ind, sex); if (!tb || day < 0 || day > MAX_DAY || day !== Math.floor(day)) return null;
    return { L: tb.s.L[day], M: tb.s.M[day], S: tb.s.S[day] };
  }
  // Por comprimento/altura: interpolação linear entre os pontos de 0,1 cm (anthro: trunc(x·10)/10).
  function lmsAtLength(ind, sex, cm){
    const tb = table(ind, sex); if (!tb) return null;
    const { start, n } = tb.t;
    const tenth = Math.floor(cm * 10 + 1e-9);          // 1e-9 evita 85,3·10 = 852,99999…
    const i = tenth - Math.round(start * 10);
    if (i < 0 || i > n - 1) return null;
    const diff = (cm * 10 - tenth);                     // fração dentro do intervalo de 0,1 cm
    const f = diff < 1e-9 ? 0 : diff;
    if (f === 0) return { L: tb.s.L[i], M: tb.s.M[i], S: tb.s.S[i] };
    if (i + 1 > n - 1) return null;
    const mix = k => tb.s[k][i] + f * (tb.s[k][i + 1] - tb.s[k][i]);
    return { L: mix('L'), M: mix('M'), S: mix('S') };
  }

  const FLAGS = { wfa: [-6, 5], lhfa: [-6, 6], hcfa: [-5, 5], wfl: [-5, 5], wfh: [-5, 5] };
  const ADJUSTED = { wfa: true, wfl: true, wfh: true, lhfa: false, hcfa: false };

  function result(ind, lms, y, extra){
    const zRaw = ADJUSTED[ind] ? lmsZAdjusted(y, lms.L, lms.M, lms.S) : lmsZ(y, lms.L, lms.M, lms.S);
    if (!isFinite(zRaw)) return { ok: false, reason: 'invalid' };
    const z = round2(zRaw);
    const pct = normCdf(z) * 100;
    const [lo, hi] = FLAGS[ind];
    return Object.assign({ ok: true, indicator: ind, z, zRaw, percentile: pct, flagged: z < lo || z > hi, L: lms.L, M: lms.M, S: lms.S }, extra);
  }
  function checkAge(days){
    if (days == null) return 'no-dates';
    if (days < 0) return 'before-birth';
    if (days > MAX_DAY || days / DAYS_PER_MONTH >= 60) return 'over-5y';
    return null;
  }
  function byAge(ind, sex, days, y){
    if (sex !== 'F' && sex !== 'M') return { ok: false, reason: 'no-sex' };
    const bad = checkAge(days); if (bad) return { ok: false, reason: bad };
    if (!(y > 0)) return { ok: false, reason: 'invalid' };
    const lms = lmsAtDay(ind, sex, days); if (!lms) return { ok: false, reason: 'out-of-range' };
    const extra = { days };
    if (ind === 'lhfa') extra.measure = days < HEIGHT_FROM_DAY ? 'length' : 'height';
    return result(ind, lms, y, extra);
  }

  // Peso/comprimento (< 731 dias) ou peso/altura (≥ 731 dias).
  function weightForLengthHeight(sex, days, cm, kg){
    if (sex !== 'F' && sex !== 'M') return { ok: false, reason: 'no-sex' };
    const bad = checkAge(days); if (bad) return { ok: false, reason: bad };
    if (!(kg > 0) || !(cm > 0)) return { ok: false, reason: 'invalid' };
    const ind = days < HEIGHT_FROM_DAY ? 'wfl' : 'wfh';
    const [lo, hi] = ind === 'wfl' ? [45, 110] : [65, 120];
    if (cm < lo || cm > hi) return { ok: false, reason: 'length-out-of-range', indicator: ind, range: [lo, hi] };
    const lms = lmsAtLength(ind, sex, cm); if (!lms) return { ok: false, reason: 'length-out-of-range', indicator: ind, range: [lo, hi] };
    return result(ind, lms, kg, { days, cm, measure: ind === 'wfl' ? 'length' : 'height' });
  }

  // Pontos de uma curva de percentil (valor da medida para o percentil p), para desenhar.
  function curveByAge(ind, sex, p, fromDay, toDay, stepDays){
    const z = normQuantile(p / 100), pts = [];
    const a = Math.max(0, Math.floor(fromDay)), b = Math.min(MAX_DAY, Math.ceil(toDay));
    const push = d => { const l = lmsAtDay(ind, sex, d); if (l) pts.push({ day: d, v: lmsValue(z, l.L, l.M, l.S) }); };
    for (let d = a; d <= b; d += stepDays) push(d);
    if (!pts.length || pts[pts.length - 1].day !== b) push(b);
    return pts;
  }
  function curveByLength(ind, sex, p, fromCm, toCm, stepCm){
    const z = normQuantile(p / 100), pts = [];
    for (let c = fromCm; c <= toCm + 1e-9; c = Math.round((c + stepCm) * 10) / 10) {
      const l = lmsAtLength(ind, sex, c); if (l) pts.push({ cm: c, v: lmsValue(z, l.L, l.M, l.S) });
    }
    return pts;
  }

  return {
    DAYS_PER_MONTH, MAX_DAY, HEIGHT_FROM_DAY,
    ageInDays, normCdf, normQuantile, lmsZ, lmsZAdjusted, lmsValue, lmsAtDay, lmsAtLength,
    weightForAge: (sex, days, kg) => byAge('wfa', sex, days, kg),
    lengthForAge: (sex, days, cm) => byAge('lhfa', sex, days, cm),
    headForAge: (sex, days, cm) => byAge('hcfa', sex, days, cm),
    weightForLengthHeight,
    curveByAge, curveByLength,
  };
});
