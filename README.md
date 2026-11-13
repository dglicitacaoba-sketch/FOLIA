# F.O.L.I.A. — Frente Operacional de Logística, Infraestrutura e Apoio

Plataforma web para os órgãos do Sistema Estadual de Segurança Pública da Bahia elaborarem pedidos de estruturas provisórias contra as Atas de Registro de Preços da SSP/BA, consolidarem o valor a sacar por ata e gerarem a planilha de fiscalização.

Base normativa: Termo de Referência de Estruturas Provisórias (proc. 020.16859.2026.0006453-43) e Tabela Consolidada de Composições SSP/BA (CEIRF).

## Arquitetura

- **Site:** GitHub Pages, com arquivos estáticos na raiz.
- **Login e dados:** Firebase, no plano Spark gratuito.
  - Authentication por e-mail e senha.
  - Cloud Firestore na região southamerica-east1.
- **Segurança:** as regras ficam em `firestore.rules`, coladas no console do Firebase. Esse arquivo não precisa estar no GitHub.

| Arquivo | Função |
| --- | --- |
| `index.html` | Página e visual |
| `app.js` | Telas: acesso, pedido, pedidos, consolidação, atas, usuários, histórico, catálogo e planilhas |
| `calc.js` | Motor de cálculo (regras do TR) |
| `dados.js` | Catálogo (409 composições), 36 lotes, 4 estruturas-modelo, órgãos e regras |
| `nuvem.js` | Firebase SDK 13.3.0 empacotado, mais a configuração do projeto folia-ssp-eeb47 |
| `xlsx.full.min.js` | SheetJS 0.18.5 (Apache 2.0) |

## Perfis

| Perfil | Pode |
| --- | --- |
| Unidade | Criar pedidos da própria unidade e editá-los até a aprovação (só o autor). Ver os pedidos da unidade. |
| Gestor (CLIC) | Tudo: aprovar usuários, cadastrar lotes e atas, aprovar pedidos e emitir a OS, designar fiscais, consolidar e ver o histórico. |
| Fiscal | Ver os pedidos para os quais foi designado e gerar a planilha de fiscalização. |
| Consulta | Ver todos os pedidos e a consolidação. |

## Lote, ata e desconto

- **O desconto pertence ao lote.**
  - Há 36 lotes do PE 44/2026, com identificador fixo `lote-01` a `lote-36`, o que impede duplicidade.
  - O pedido escolhe o lote e herda dele o desconto, o fornecedor e o CNPJ.
- **A ata reúne um ou mais lotes de um mesmo fornecedor.** Ela herda o fornecedor e o CNPJ dos lotes.
  - Um lote só pode estar em uma ata ativa.
  - O banco recusa pedidos cujo desconto não seja igual ao desconto atual do lote.
- **Estruturas-modelo:** são 16, lidas das planilhas ORÇA SIN assinadas.
  - Os itens cujo código não está na tabela consolidada ficam fora do modelo e aparecem como pendência para validação da CEIRF.

## Situação do pedido

Rascunho → Enviado à CLIC → Aprovado (OS emitida) → Em fiscalização → Encerrado. Também pode ser Cancelado.

## Regras de cálculo

- **Grupo I (unidade física):**
  - PU contratado = ARRED(PU c/ BDI × (1 − desconto); 2)
  - Valor = ARRED(Qtd × PU contratado ÷ 100 × (50 + dias + 35); 2)
  - Mínimo de 3 dias.
- **Grupo II (diária ou turno):** Valor = Qtd × PU c/ BDI, sem desconto.
- **CHP/CHI:** classificação pendente; não somam.
