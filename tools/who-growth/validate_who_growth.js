#!/usr/bin/env node
/* Valida who-growth-data.js + who-growth.js contra as tabelas oficiais da OMS.
 * Uso: node tools/who-growth/validate_who_growth.js <who-official.json>
 * O JSON tem as tabelas "zscore" e "percentiles" oficiais (todas as linhas), exportadas dos .xlsx com
 * read_xlsx() de build_who_growth.py: {ind: {F|M: {zh, ph, z:[[...]], p:[[...]]}}}. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..', '..');
const ctx = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'who-growth-data.js'), 'utf8'), ctx);
const DATA = ctx.window.WHO_GROWTH_DATA;
const G = require(path.join(root, 'who-growth.js'))(DATA);
const OFF = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; if (fails <= 40) console.log('FALHA:', msg); } };
const P_COLS = ['P1', 'P3', 'P5', 'P10', 'P15', 'P25', 'P50', 'P75', 'P85', 'P90', 'P95', 'P97', 'P99'];
const pctLabel = p => { const r = Math.round(p); return r < 1 ? '<P1' : r > 99 ? '>P99' : 'P' + r; };

for (const ind of ['wfa', 'lhfa', 'hcfa', 'wfl', 'wfh']) {
  for (const sex of ['F', 'M']) {
    const o = OFF[ind][sex], d = DATA[ind][sex];
    const pi = name => o.ph.indexOf(name), zi = name => o.zh.indexOf(name);
    let maxCurveErr = 0;
    o.p.forEach((row, r) => {
      // 1) L, M, S iguais aos oficiais
      ok(d.L[r] === row[pi('L')] && d.M[r] === row[pi('M')] && d.S[r] === row[pi('S')], `${ind} ${sex} linha ${r} LMS`);
      const idx = row[0];
      const lms = ind === 'wfl' || ind === 'wfh' ? G.lmsAtLength(ind, sex, idx) : G.lmsAtDay(ind, sex, idx);
      for (const col of P_COLS) {
        const p = +col.slice(1), official = row[pi(col)];
        // 2) curva desenhada (LMS + Φ⁻¹) = valor publicado (3 casas decimais)
        const v = G.lmsValue(G.normQuantile(p / 100), lms.L, lms.M, lms.S);
        maxCurveErr = Math.max(maxCurveErr, Math.abs(v - official));
        ok(Math.abs(v - official) <= 0.0005 + 1e-9, `${ind} ${sex} ${idx} ${col}: curva ${v} vs ${official}`);
        // 3) medida = valor publicado de Pxx → percentil apresentado Pxx
        let res;
        if (ind === 'wfa') res = G.weightForAge(sex, idx, official);
        else if (ind === 'lhfa') res = G.lengthForAge(sex, idx, official);
        else if (ind === 'hcfa') res = G.headForAge(sex, idx, official);
        else res = G.weightForLengthHeight(sex, ind === 'wfl' ? 0 : 800, idx, official);
        if (ind !== 'wfl' && ind !== 'wfh' && idx / G.DAYS_PER_MONTH >= 60) { ok(!res.ok && res.reason === 'over-5y', `${ind} ${idx} >= 60 meses devia ficar fora`); continue; }
        ok(res.ok && pctLabel(res.percentile) === col, `${ind} ${sex} ${idx} ${col}: obtido ${res.ok ? pctLabel(res.percentile) + ' z=' + res.z : res.reason}`);
      }
    });
    // 4) medida = SDk publicado → z = k (|k| ≤ 3; tabelas a 3 casas decimais → tolerância 0,01)
    o.z.forEach(row => {
      const idx = row[0];
      if (ind !== 'wfl' && ind !== 'wfh' && idx / G.DAYS_PER_MONTH >= 60) return;
      for (const [col, k] of [['SD3neg', -3], ['SD2neg', -2], ['SD1neg', -1], ['SD0', 0], ['SD1', 1], ['SD2', 2], ['SD3', 3]]) {
        const y = row[zi(col)];
        let res;
        if (ind === 'wfa') res = G.weightForAge(sex, idx, y);
        else if (ind === 'lhfa') res = G.lengthForAge(sex, idx, y);
        else if (ind === 'hcfa') res = G.headForAge(sex, idx, y);
        else res = G.weightForLengthHeight(sex, ind === 'wfl' ? 0 : 800, idx, y);
        ok(res.ok && Math.abs(res.z - k) <= 0.01 + 1e-9, `${ind} ${sex} ${idx} ${col}: z=${res.ok ? res.z : res.reason}`);
      }
    });
    console.log(`${ind} ${sex}: ${o.p.length} linhas; erro máx. da curva vs percentis publicados = ${maxCurveErr.toFixed(6)}`);
  }
}

// 5) Datas (dias civis locais)
const A = G.ageInDays;
ok(A('2026-09-01', '2026-09-28') === 27, 'mesmo mês');
ok(A('2026-08-31', '2026-09-01') === 1, 'mudança de mês');
ok(A('2025-12-31', '2026-01-01') === 1, 'mudança de ano');
ok(A('2024-02-28', '2024-03-01') === 2, 'ano bissexto');
ok(A('2025-09-28', '2026-09-28') === 365, 'aniversário (1 ano, não bissexto)');
ok(A('2025-09-28', '2026-09-27') === 364, 'véspera do aniversário');
ok(A('2026-03-28', '2026-03-30') === 2, 'mudança para a hora de verão (29/03/2026)');
ok(A('2026-10-24', '2026-10-26') === 2, 'mudança para a hora de inverno (25/10/2026)');
ok(A('2026-09-28', '2026-09-27') === -1, 'medição antes do nascimento');
ok(A('2026-02-30', '2026-03-01') === null, 'data inválida');
ok(G.weightForAge('F', -1, 3).reason === 'before-birth', 'antes do nascimento → sem cálculo');
ok(G.weightForAge('F', 1827, 18).reason === 'over-5y', '1827 dias (≥ 60 meses) → sem cálculo');
ok(G.weightForAge('F', 1826, 18).ok, '1826 dias (< 60 meses) → calcula');
ok(G.weightForAge('X', 10, 3).reason === 'no-sex', 'sem sexo → sem cálculo');

// 6) Comprimento (< 731 dias) vs altura (≥ 731 dias)
ok(G.lengthForAge('F', 730, 86).measure === 'length', '730 dias = comprimento');
ok(G.lengthForAge('F', 731, 86).measure === 'height', '731 dias = altura');
ok(G.weightForLengthHeight('F', 730, 86, 12).indicator === 'wfl', '730 dias → peso/comprimento');
ok(G.weightForLengthHeight('F', 731, 86, 12).indicator === 'wfh', '731 dias → peso/altura');
ok(G.weightForLengthHeight('F', 100, 44.9, 3).reason === 'length-out-of-range', 'comprimento < 45 cm → sem cálculo');
ok(G.weightForLengthHeight('F', 800, 64.9, 7).reason === 'length-out-of-range', 'altura < 65 cm → sem cálculo');
ok(G.weightForLengthHeight('F', 100, 110.1, 20).reason === 'length-out-of-range', 'comprimento > 110 cm → sem cálculo');
// 7) interpolação a meio de 0,1 cm (anthro): 60,05 cm → média de 60,0 e 60,1
{ const a = G.lmsAtLength('wfl', 'F', 60.0), b = G.lmsAtLength('wfl', 'F', 60.1), m = G.lmsAtLength('wfl', 'F', 60.05);
  ok(Math.abs(m.M - (a.M + b.M) / 2) < 1e-12 && Math.abs(m.S - (a.S + b.S) / 2) < 1e-12, 'interpolação 60,05 cm'); }
// 8) z ajustado (> 3) só nos indicadores de peso
{ const l = G.lmsAtDay('wfa', 'F', 0), y = G.lmsValue(3.5, l.L, l.M, l.S), sd3 = G.lmsValue(3, l.L, l.M, l.S), sd2 = G.lmsValue(2, l.L, l.M, l.S);
  ok(Math.abs(G.weightForAge('F', 0, y).zRaw - (3 + (y - sd3) / (sd3 - sd2))) < 1e-12, 'wfa usa z ajustado > 3');
  const h = G.lmsAtDay('hcfa', 'F', 0), yh = G.lmsValue(3.5, h.L, h.M, h.S);
  ok(Math.abs(G.headForAge('F', 0, yh).zRaw - 3.5) < 1e-9, 'hcfa usa z sem ajuste'); }

console.log(`\n${checks} verificações, ${fails} falhas`);
process.exit(fails ? 1 : 0);
