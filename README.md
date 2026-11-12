# F.O.L.I.A. — Frente Operacional de Logística, Infraestrutura e Apoio

Plataforma web para os órgãos do Sistema Estadual de Segurança Pública da Bahia elaborarem pedidos de estruturas provisórias contra as Atas de Registro de Preços da SSP/BA, consolidarem o valor a sacar por ata e gerarem a planilha de fiscalização.

Base normativa: Termo de Referência de Estruturas Provisórias (proc. 020.16859.2026.0006453-43) e Tabela Consolidada de Composições SSP/BA (CEIRF).

## Arquivos (todos na raiz, sem pastas)

| Arquivo | Função |
| --- | --- |
| `index.html` | Página e visual |
| `app.js` | Telas: pedido, consolidação, atas, catálogo e geração do .xlsx |
| `calc.js` | Motor de cálculo (regras do TR) |
| `dados.js` | Catálogo (409 composições), 36 lotes, 4 estruturas-modelo, órgãos e regras |
| `xlsx.full.min.js` | Biblioteca SheetJS 0.18.5 (Apache 2.0) para gerar planilhas |

## Regras de cálculo

- **Grupo I (unidade física):**
  - PU contratado = ARRED(PU c/ BDI × (1 − desconto); 2)
  - Valor = ARRED(Qtd × PU contratado ÷ 100 × (50 + dias + 35); 2)
  - Mínimo de 3 dias.
- **Grupo II (diária ou turno):** Valor = Qtd × PU c/ BDI, sem desconto.
- **CHP/CHI:** classificação pendente; não somam.

## Onde os dados ficam

Os dados ficam no navegador de quem usa (localStorage). Nenhum dado de órgão é gravado neste repositório.

## Como executar no computador

Na pasta do projeto, rode:

```
python -m http.server 8000
```

Depois abra http://localhost:8000.
