#!/usr/bin/env python3
"""Exporta as tabelas oficiais da OMS (.xlsx, todas as linhas) para JSON, para validate_who_growth.js.

Uso:
    python3 tools/who-growth/export_official_json.py <pasta-com-os-xlsx> <saida.json>
"""
import json, os, re, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_who_growth import read_xlsx, INDICATORS, SEXES, EXPECTED_SHA256, sha256

if len(sys.argv) != 3:
    sys.exit(__doc__)
src, dest = sys.argv[1], sys.argv[2]
for name, digest in EXPECTED_SHA256.items():
    if sha256(os.path.join(src, name)) != digest:
        sys.exit(f'SHA-256 diferente em {name}')
out = {}
for ind, (_, _, _, _, tpl) in INDICATORS.items():
    out[ind] = {}
    for sex, word in SEXES.items():
        zname = tpl.format(s=word)
        pname = re.sub(r'zscore-expanded-tables?', 'percentiles-expanded-tables', zname)
        z = read_xlsx(os.path.join(src, zname))
        p = read_xlsx(os.path.join(src, pname))
        out[ind][sex] = {'zh': z[0], 'ph': p[0],
                         'z': [[float(x) for x in r] for r in z[1:]],
                         'p': [[float(x) for x in r] for r in p[1:]]}
with open(dest, 'w') as f:
    json.dump(out, f)
print('escrito', dest)
