# F.O.L.I.A. — Frente Operacional de Logística, Infraestrutura e Apoio

Plataforma web para os órgãos do Sistema Estadual de Segurança Pública da Bahia planejarem as estruturas provisórias de eventos e gerarem a planilha de fiscalização, conforme o Termo de Referência de Estruturas Provisórias (proc. 020.16859.2026.0006453-43).

## Estado atual

**Etapa 1 — Catálogo de composições** (em validação)

- `dados/catalogo.json`: 409 composições da Tabela Consolidada Retificada (CEIRF), BDI de 19,85%.
- Cada composição está classificada como:
  - Grupo I: unidade física, com desconto;
  - Grupo II: unidade de tempo, sem desconto;
  - Pendente: CHP e CHI.

## Estrutura de pastas

```
index.html          página principal
assets/style.css    aparência
assets/app.js       lógica da página
dados/catalogo.json catálogo de preços referenciais
```

## Como executar no computador

Na pasta do projeto, rode:

```
python -m http.server 8000
```

Depois abra http://localhost:8000.

## Publicação

GitHub Pages, branch `main`, pasta raiz (`/`).

## Privacidade

Nenhum dado de órgão é gravado neste repositório. O repositório contém apenas código e a tabela referencial.
