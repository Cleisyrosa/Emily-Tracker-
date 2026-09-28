#!/usr/bin/env python3
"""Gera ../../who-growth-data.js a partir das tabelas oficiais da OMS (WHO Child Growth Standards).

Uso:
    python3 tools/who-growth/build_who_growth.py <pasta-com-os-xlsx>

Os 20 ficheiros .xlsx ("expanded tables") descarregam-se dos URLs em sources.txt
(páginas oficiais: https://www.who.int/tools/child-growth-standards/standards).
O script:
  * lê só a biblioteca-padrão do Python (xlsx = zip + XML);
  * verifica o SHA-256 de cada ficheiro contra EXPECTED_SHA256 (falha se a OMS mudar a tabela);
  * usa L, M, S das tabelas "zscore" e confirma que coincidem com as das tabelas "percentiles";
  * confirma que os índices são contínuos (dia 0..1856; 45.0..110.0 cm e 65.0..120.0 cm em passos de 0,1);
  * escreve os valores exatamente como publicados (repr do float = representação decimal mais curta).
Nada é arredondado, interpolado ou inventado aqui.
"""
import hashlib, json, os, re, sys, zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

EXPECTED_SHA256 = {
    'hcfa-boys-percentiles-expanded-tables.xlsx': '3e4d401a557841a93d56d552889d2778e4ad4e42585c8d768f5514aaf65979ff',
    'hcfa-boys-zscore-expanded-tables.xlsx': '89a657bc466e85f6c8f2e5e7f4635e969bdcf982bb71e519273e43896a1c3314',
    'hcfa-girls-percentiles-expanded-tables.xlsx': '3e097ab1c73c9b376faea2bde2f10de761efbde486c9d6092a8ef63d21f2a5ff',
    'hcfa-girls-zscore-expanded-tables.xlsx': '8eec3770d1027ce1b3b96a7b89fd1e77070558a7791b17b4462cda8a813324a3',
    'lhfa-boys-percentiles-expanded-tables.xlsx': '8e163405223fcdf749f6689a8b8233d15182117c8a8b87f46c957fcfc498c7f2',
    'lhfa-boys-zscore-expanded-tables.xlsx': 'c4b1c9029ab9751a5f0888e32f35c7c0287a16d361885cf911ecf23b3f7f6b4f',
    'lhfa-girls-percentiles-expanded-tables.xlsx': '92b5b0306d87f32eeb1d0c68f32aceda55121ff9a2600af517ba2a5b8dc84851',
    'lhfa-girls-zscore-expanded-tables.xlsx': '6aa2876319449a6b1f4d825848128902114ff53c67b92b86a0c5140846013059',
    'wfa-boys-percentiles-expanded-tables.xlsx': 'c4e251201c6cd352fbdd7797a7a298aff8c78b7525bd242fedec4494f3ccb095',
    'wfa-boys-zscore-expanded-tables.xlsx': 'b5b4748c6bfa5230e2eddafa1767629c349178b08d457f400b59422b8bfef86c',
    'wfa-girls-percentiles-expanded-tables.xlsx': '5bdfd79de222d0f660c1662adc02995e879374f5b3260571a357a2ec771da629',
    'wfa-girls-zscore-expanded-tables.xlsx': 'ee3ae12cb96c6c5541cdf43665c03ce6c984f877859a183a5f6104eb06a49a6e',
    'wfh-boys-percentiles-expanded-tables.xlsx': 'ac6d18ef3790e242aff64b42e66337942219188998c9dc5207588ff035a39e8a',
    'wfh-boys-zscore-expanded-tables.xlsx': 'ed3b590f9c65937a138408b13618f33684bb6406a0c56d6a2ce3fd9053a3f59f',
    'wfh-girls-percentiles-expanded-tables.xlsx': '27803da855d1fcb560708958b7aabb3fd5eb72ce0a5e3b47aab43e28e7f4a5b4',
    'wfh-girls-zscore-expanded-tables.xlsx': 'fca340d5f04aa1556ac410b176b65b290e1b9ff467fc854a97f9b54ad94c9b8a',
    'wfl-boys-percentiles-expanded-tables.xlsx': '388fe58e33ab9a27459ac3cac2b892bc9b2b61fe8d53e9c9b4d9191f9422aa8c',
    'wfl-boys-zscore-expanded-table.xlsx': '1a6e9a002d2692d038161bc6572a10f8b9fa0657163808141d2981a2132c59cc',
    'wfl-girls-percentiles-expanded-tables.xlsx': '2fb6f867050854db19c06a1b0131e07ac02b904d1367ec0a444b1360f6335035',
    'wfl-girls-zscore-expanded-table.xlsx': 'ec116b8e618ad311d34a87231346badf16c75f5c4f82222ec846e05c582bf16a',
}

# indicador → (índice, primeiro valor, passo, n.º de linhas, nome do ficheiro zscore por sexo)
INDICATORS = {
    'wfa':  ('day', 0, 1, 1857, 'wfa-{s}-zscore-expanded-tables.xlsx'),
    'lhfa': ('day', 0, 1, 1857, 'lhfa-{s}-zscore-expanded-tables.xlsx'),
    'hcfa': ('day', 0, 1, 1857, 'hcfa-{s}-zscore-expanded-tables.xlsx'),
    'wfl':  ('length_cm', 45, 0.1, 651, 'wfl-{s}-zscore-expanded-table.xlsx'),
    'wfh':  ('height_cm', 65, 0.1, 551, 'wfh-{s}-zscore-expanded-tables.xlsx'),
}
SEXES = {'M': 'boys', 'F': 'girls'}   # chaves iguais às do campo "sexo" da app


def read_xlsx(path):
    z = zipfile.ZipFile(path)
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            ss.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    sheet = sorted(n for n in z.namelist() if n.startswith('xl/worksheets/sheet'))[0]
    rows = []
    for r in ET.fromstring(z.read(sheet)).iter('{%s}row' % NS['m']):
        vals = {}
        for c in r.findall('m:c', NS):
            col = re.match(r'[A-Z]+', c.get('r')).group(0)
            v = c.find('m:v', NS)
            if v is None:
                continue
            vals[col] = ss[int(v.text)] if c.get('t') == 's' else v.text
        if vals:
            rows.append(vals)
    cols = sorted({k for r in rows for k in r}, key=lambda x: (len(x), x))
    return [[r.get(c) for c in cols] for r in rows]


def num(s):
    return float(s)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()


def main(src):
    for name, digest in EXPECTED_SHA256.items():
        got = sha256(os.path.join(src, name))
        if got != digest:
            sys.exit(f'SHA-256 diferente em {name}: {got}')
    out = {}
    for ind, (index, start, step, n, tpl) in INDICATORS.items():
        out[ind] = {'index': index, 'start': start, 'step': step, 'n': n}
        for sex, word in SEXES.items():
            zname = tpl.format(s=word)
            pname = re.sub(r'zscore-expanded-tables?', 'percentiles-expanded-tables', zname)
            z = read_xlsx(os.path.join(src, zname))
            p = read_xlsx(os.path.join(src, pname))
            assert z[0][1:4] == ['L', 'M', 'S'], (zname, z[0])
            zi = z[0].index('L')
            pi = p[0].index('L')
            zr, pr = z[1:], p[1:]
            assert len(zr) == n and len(pr) == n, (zname, len(zr), len(pr))
            L, M, S = [], [], []
            for i, (a, b) in enumerate(zip(zr, pr)):
                expect = start + i * step
                assert abs(num(a[0]) - expect) < 1e-6, (zname, i, a[0])
                # A tabela de percentis dos dias tem coluna "Age"/"Day" + (às vezes) outra; comparar L/M/S
                la, ma, sa = (num(x) for x in a[zi:zi + 3])
                lb, mb, sb = (num(x) for x in b[pi:pi + 3])
                assert (la, ma, sa) == (lb, mb, sb), (zname, i, (la, ma, sa), (lb, mb, sb))
                L.append(la); M.append(ma); S.append(sa)
            out[ind][sex] = {'L': L, 'M': M, 'S': S}
    return out


def fmt(v):
    r = repr(v)
    return r[:-2] if r.endswith('.0') else r


def write_js(data, dest):
    lines = []
    lines.append('/* WHO Child Growth Standards (0–5 anos) — tabelas oficiais L, M, S.')
    lines.append(' * FICHEIRO GERADO por tools/who-growth/build_who_growth.py — NÃO EDITAR À MÃO.')
    lines.append(' * Fonte: Organização Mundial da Saúde, https://www.who.int/tools/child-growth-standards/standards')
    lines.append(' * Ficheiros de origem ("expanded tables", .xlsx) e SHA-256: tools/who-growth/sources.txt e EXPECTED_SHA256 no script.')
    lines.append(' * Chaves de sexo: "F" = girls, "M" = boys (iguais ao campo "sexo" da app).')
    lines.append(' * wfa/lhfa/hcfa: índice = idade em dias completos (0..1856).')
    lines.append(' * lhfa: dias 0–730 = comprimento (deitado); dias 731+ = altura (em pé), como na tabela da OMS.')
    lines.append(' * wfl: índice = comprimento 45,0–110,0 cm; wfh: índice = altura 65,0–120,0 cm (passo 0,1 cm).')
    lines.append(' * Só dados — sem lógica. Os cálculos estão em who-growth.js. */')
    lines.append('window.WHO_GROWTH_DATA = {')
    lines.append('  source: "WHO Child Growth Standards — expanded tables (who.int)",')
    lines.append('  lhfaHeightFromDay: 731,')
    for ind, d in data.items():
        lines.append(f'  {ind}: {{ index: "{d["index"]}", start: {d["start"]}, step: {d["step"]}, n: {d["n"]},')
        for sex in ('F', 'M'):
            t = d[sex]
            lines.append(f'    {sex}: {{')
            for k in ('L', 'M', 'S'):
                lines.append(f'      {k}: [' + ','.join(fmt(v) for v in t[k]) + '],')
            lines.append('    },')
        lines.append('  },')
    lines.append('};')
    with open(dest, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    here = os.path.dirname(os.path.abspath(__file__))
    dest = os.path.normpath(os.path.join(here, '..', '..', 'who-growth-data.js'))
    write_js(main(sys.argv[1]), dest)
    print('escrito', dest, os.path.getsize(dest), 'bytes')
