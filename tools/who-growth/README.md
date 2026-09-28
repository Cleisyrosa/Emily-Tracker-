# Padrões de crescimento da OMS — dados e validação

A app usa os **WHO Child Growth Standards (0–5 anos)**, com os dados exatamente como a OMS os publica.

| Ficheiro | Conteúdo |
|---|---|
| `who-growth-data.js` (raiz) | Só dados: L, M, S oficiais. **Gerado; não editar à mão.** |
| `who-growth.js` (raiz) | Só cálculos: idade em dias, z-score LMS, percentil e curvas. Não tem DOM. |
| `index.html` | Só apresentação (secção Evolução). |

## Fonte

Os dados vêm das "expanded tables" oficiais da OMS (20 ficheiros `.xlsx`), com os URLs em `sources.txt`. As páginas de origem são:
- https://www.who.int/tools/child-growth-standards/standards/weight-for-age
- https://www.who.int/tools/child-growth-standards/standards/length-height-for-age
- https://www.who.int/tools/child-growth-standards/standards/head-circumference-for-age
- https://www.who.int/tools/child-growth-standards/standards/weight-for-length-height

O SHA-256 de cada ficheiro está em `EXPECTED_SHA256` (`build_who_growth.py`). Os scripts falham se algum ficheiro for diferente.

O método de cálculo segue o pacote oficial da OMS `anthro` (github.com/WorldHealthOrganization/anthro). O resumo está no topo de `who-growth.js`.

## Regenerar e validar

1. Descarregar os ficheiros:
   ```
   mkdir -p /tmp/who && cd /tmp/who && while read u; do curl -sSLO "$u"; done < tools/who-growth/sources.txt
   ```
   Se o `curl` guardar os nomes com o sufixo `?sfvrsn=…`, é preciso remover esse sufixo.
2. Gerar os dados:
   ```
   python3 tools/who-growth/build_who_growth.py /tmp/who
   ```
3. Exportar e validar:
   ```
   python3 tools/who-growth/export_official_json.py /tmp/who /tmp/who-official.json
   node tools/who-growth/validate_who_growth.js /tmp/who-official.json
   ```

## O que a validação verifica

Verifica todas as linhas das tabelas, para os dois sexos e os 5 indicadores:

1. L, M e S em `who-growth-data.js` são iguais aos das tabelas oficiais.
2. As curvas desenhadas (P1 a P99) coincidem com os percentis publicados, até ao arredondamento de 3 casas decimais.
3. Uma medida igual ao valor publicado de Pxx é apresentada como Pxx.
4. Uma medida igual ao valor publicado de SD−3 a SD+3 dá o z correspondente, com uma tolerância de ±0,01.
5. Casos de datas, de fronteira (730/731 dias, 45/65/110/120 cm, 60 meses), a interpolação por comprimento e o z ajustado.
