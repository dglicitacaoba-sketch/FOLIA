// F.O.L.I.A. — Interface: pedidos, consolidação, atas, catálogo e geração da planilha de fiscalização.
// Os dados ficam no navegador (localStorage). Nada é enviado a servidores.

(function () {
  "use strict";

  var D = FOLIA_DADOS;
  var R = D.regras;
  var IDX = {};
  D.itens.forEach(function (i) { IDX[i.codigo] = i; });

  // ---------- utilidades ----------
  var fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function rs(v) { return "R$ " + fmt.format(v || 0); }
  function pct(f) { return fmt.format((f || 0) * 100) + "%"; }
  function num(v) { return fmt.format(v || 0); }
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function normalizar(t) { return String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function clonar(o) { return JSON.parse(JSON.stringify(o)); }
  function lerNumero(v) { return Number(String(v).replace(/\./g, "").replace(",", ".")) || 0; }
  function dataBR(iso) { if (!iso) return ""; var p = iso.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }

  function carregar(chave, padrao) {
    try { var v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; }
  }
  function gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { toast("Não foi possível salvar neste navegador."); }
  }
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("visivel");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("visivel"); }, 2600);
  }
  function baixar(nome, conteudo, tipo) {
    var blob = new Blob([conteudo], { type: tipo || "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------- estado ----------
  var atasLocais = carregar("folia.atas", []);
  var pedidos = carregar("folia.pedidos", []);
  var rascunho = carregar("folia.rascunho", null) || novoRascunho();
  var buscaCatalogo = { termo: "", grupo: "", calculo: "" };

  function novoRascunho() {
    return { id: null, numero: null, orgao: "", unidade: "", evento: "", municipio: "", local: "", inicio: "", fim: "",
      dias: 3, responsavel: "", contato: "", ataId: "", estruturas: [] };
  }
  function todasAtas() {
    return D.atasOficiais.map(function (a) { return Object.assign({ oficial: true }, a); }).concat(atasLocais);
  }
  function acharAta(id) { return todasAtas().filter(function (a) { return a.id === id; })[0] || null; }
  function rotuloAta(a) {
    return "ARP " + a.numero + " · Lote " + String(a.lote).padStart(2, "0") + " · " + a.fornecedor + " · desconto " + pct(a.desconto);
  }
  function salvarRascunho() { gravar("folia.rascunho", rascunho); }

  // ---------- navegação ----------
  document.getElementById("menu").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-aba]"); if (!b) return;
    abrirAba(b.dataset.aba);
  });
  function abrirAba(nome) {
    document.querySelectorAll("#menu button").forEach(function (b) { b.classList.toggle("ativo", b.dataset.aba === nome); });
    document.querySelectorAll(".aba").forEach(function (s) { s.classList.toggle("ativa", s.id === "aba-" + nome); });
    ({ pedido: renderPedido, pedidos: renderPedidos, atas: renderAtas, catalogo: renderCatalogo })[nome]();
    window.scrollTo(0, 0);
  }

  // lista para o campo de busca de composições
  document.getElementById("lista-catalogo").innerHTML = D.itens.map(function (i) {
    return '<option value="' + esc(i.codigo + " — " + i.descricao.slice(0, 110)) + '">';
  }).join("");

  // =====================================================================
  // ABA: NOVO PEDIDO
  // =====================================================================
  function renderPedido() {
    var el = document.getElementById("aba-pedido");
    var atas = todasAtas();
    var ata = acharAta(rascunho.ataId);

    var orgaos = '<option value="">Selecione…</option>' + D.orgaos.map(function (o) {
      return '<option value="' + o.sigla + '"' + (rascunho.orgao === o.sigla ? " selected" : "") + ">" + o.sigla + " — " + esc(o.nome) + "</option>";
    }).join("");
    var opAtas = '<option value="">' + (atas.length ? "Selecione a Ata de RP…" : "Nenhuma ata cadastrada — cadastre na aba Atas de RP") + "</option>" +
      atas.map(function (a) { return '<option value="' + a.id + '"' + (a.id === rascunho.ataId ? " selected" : "") + ">" + esc(rotuloAta(a)) + "</option>"; }).join("");
    var opModelos = D.modelos.map(function (m) { return '<option value="' + m.id + '">' + esc(m.nome) + " — " + m.itens.length + " composições</option>"; }).join("");

    el.innerHTML =
      '<div class="layout-pedido"><div>' +
      '<div class="card"><h2>' + (rascunho.numero ? "Editando pedido " + esc(rascunho.numero) : "1. Identificação do pedido") + "</h2>" +
      '<p class="dica">Dados da unidade e do evento. Eles serão usados na Ordem de Serviço e na planilha de fiscalização.</p>' +
      '<div class="grade">' +
      campoSel("Órgão", "orgao", orgaos) +
      campo("Unidade requisitante", "unidade", "Ex.: 1º GBM / CENAR") +
      campo("Evento / operação", "evento", "Ex.: Carnaval 2027", "largo") +
      campo("Município", "municipio", "Ex.: Salvador") +
      campo("Local / endereço", "local", "Ex.: Campo Grande", "largo") +
      campo("Início do evento", "inicio", "", "", "date") +
      campo("Fim do evento", "fim", "", "", "date") +
      campo("Dias de realização do evento", "dias", "", "", "number") +
      campo("Responsável local", "responsavel", "Nome e posto/cargo") +
      campo("Telefone / e-mail", "contato", "") +
      "</div>" +
      '<p class="dica" style="margin-top:10px">Dias de realização: só os dias do evento. Montagem e desmontagem já estão nas 85 unidades fixas (TR 7.1.1.1.2.3). Abaixo de 3 dias, a medição considera 3 (TR 7.1.1.1.2.7).</p>' +
      "</div>" +

      '<div class="card"><h2>2. Ata de Registro de Preços</h2>' +
      '<p class="dica">O desconto é herdado da ata e aplicado às composições de unidade física. Itens de tempo (diárias e turnos) não recebem desconto.</p>' +
      '<label>Ata de RP<select data-campo="ataId">' + opAtas + "</select></label>" +
      (ata ? '<div class="ata-info"><b>ARP ' + esc(ata.numero) + "</b> · Lote " + ata.lote + " — " + esc(nomeLote(ata.lote)) +
        "<br>Fornecedor: " + esc(ata.fornecedor) + (ata.cnpj ? " · CNPJ " + esc(ata.cnpj) : "") +
        "<br>Desconto herdado: <b>" + pct(ata.desconto) + "</b>" + (ata.oficial ? "" : " · <i>ata cadastrada neste navegador</i>") + "</div>" : "") +
      "</div>" +

      '<div class="card"><h2>3. Estruturas e composições</h2>' +
      '<p class="dica">Adicione uma estrutura-modelo (e ajuste as quantidades) ou crie uma estrutura nova com as composições do catálogo.</p>' +
      '<div class="linha-acoes">' +
      '<label style="flex:1 1 320px">Estrutura-modelo<select id="sel-modelo">' + opModelos + "</select></label>" +
      '<button class="btn" data-acao="add-modelo">Adicionar estrutura-modelo</button>' +
      '<button class="btn sec" data-acao="add-vazia">Criar nova estrutura</button>' +
      "</div></div>" +
      '<div id="lista-estruturas"></div>' +
      "</div>" +
      '<aside class="resumo" id="resumo"></aside></div>';

    renderEstruturas();
  }

  function campo(rotulo, nome, ph, classe, tipo) {
    return '<label class="' + (classe || "") + '">' + rotulo + '<input type="' + (tipo || "text") + '" data-campo="' + nome +
      '" value="' + esc(rascunho[nome]) + '" placeholder="' + esc(ph || "") + '"' + (tipo === "number" ? ' min="1" step="1"' : "") + "></label>";
  }
  function campoSel(rotulo, nome, opcoes) { return "<label>" + rotulo + '<select data-campo="' + nome + '">' + opcoes + "</select></label>"; }
  function nomeLote(n) { var l = D.lotes.filter(function (x) { return x.lote === Number(n); })[0]; return l ? l.nome : ""; }

  function calcularRascunho() {
    var ata = acharAta(rascunho.ataId);
    return FoliaCalc.calcularPedido(rascunho, ata, IDX, R);
  }

  function renderEstruturas() {
    var res = calcularRascunho();
    var alvo = document.getElementById("lista-estruturas");
    if (!rascunho.estruturas.length) {
      alvo.innerHTML = '<div class="card vazio">Nenhuma estrutura adicionada ainda.</div>';
    } else {
      alvo.innerHTML = res.estruturas.map(function (r, ei) { return htmlEstrutura(r, ei); }).join("");
    }
    renderResumo(res);
  }

  function htmlEstrutura(r, ei) {
    var est = r.estrutura;
    var linhas = ""; var secaoAtual = null;
    r.linhas.forEach(function (l, ii) {
      if ((l.item.secao || "") !== secaoAtual) {
        secaoAtual = l.item.secao || "";
        if (secaoAtual) linhas += '<tr class="secao"><td colspan="11">' + esc(secaoAtual) + "</td></tr>";
      }
      var c = l.calc; var comp = l.comp;
      linhas += "<tr>" +
        '<td class="cod">' + esc(l.item.codigo) + "</td>" +
        '<td class="desc"' + (comp ? ' title="' + esc(comp.descricao) + '"' : '') + '><div class="clamp">' + (comp ? esc(comp.descricao) : '<b style="color:var(--vermelho)">Código não encontrado no catálogo</b>') + "</div></td>" +
        "<td>" + (comp ? esc(comp.unidade) : "") + "</td>" +
        "<td>" + (comp ? '<span class="tag ' + comp.grupo_calculo + '">' + ({ I: "Física", II: "Tempo", PENDENTE: "Pendente" })[comp.grupo_calculo] + "</span>" : "") + "</td>" +
        '<td class="num"><input class="qtd" data-qtd="' + ei + ":" + ii + '" value="' + num(l.item.quantidade).replace(/,00$/, "") + '"></td>' +
        '<td class="num">' + (comp ? num(comp.valor_com_bdi) : "") + "</td>" +
        '<td class="num">' + (c && c.calculado ? pct(c.desconto) : "—") + "</td>" +
        '<td class="num">' + (c && c.calculado ? num(c.puContratado) : "—") + "</td>" +
        '<td class="num">' + (c && c.grupo === "I" ? c.unidades : c && c.grupo === "II" ? "diária" : "—") + "</td>" +
        '<td class="num"><b>' + (c && c.calculado ? num(c.valor) : "—") + "</b></td>" +
        '<td><button class="btn perigo peq" title="Remover composição" data-acao="rem-item" data-ei="' + ei + '" data-ii="' + ii + '">✕</button></td>' +
        "</tr>";
    });
    return '<div class="estrutura card" style="padding:0">' +
      '<div class="estrutura-topo">' +
      '<label class="nome">Nome da estrutura<input data-est-nome="' + ei + '" value="' + esc(est.nome) + '"></label>' +
      '<label>Qtd. desta estrutura<input type="number" min="1" step="1" style="width:110px" data-est-unid="' + ei + '" value="' + (est.unidades || 1) + '"></label>' +
      '<div class="subtotal">' + rs(r.subtotal) + "<small>" + r.linhas.length + " composições" + (r.multiplicador > 1 ? " · ×" + r.multiplicador : "") + "</small></div>" +
      '<button class="btn perigo peq" data-acao="rem-est" data-ei="' + ei + '">Remover estrutura</button>' +
      "</div>" +
      (est.ausentes && est.ausentes.length ? '<div class="aviso" style="margin:10px 14px">Itens do orçamento original fora da tabela consolidada (não incluídos): ' +
        est.ausentes.map(function (a) { return esc(a.codigo); }).join(", ") + ".</div>" : "") +
      '<div class="rolagem"><table class="tabela"><thead><tr><th>Código</th><th>Descrição</th><th>Und</th><th>Tipo</th>' +
      '<th class="num">Quantidade</th><th class="num">PU ref. c/ BDI</th><th class="num">Desconto</th><th class="num">PU contratado</th>' +
      '<th class="num">Unidades</th><th class="num">Valor (R$)</th><th></th></tr></thead><tbody>' +
      (linhas || '<tr><td colspan="11" class="vazio">Sem composições. Adicione abaixo.</td></tr>') + "</tbody></table></div>" +
      '<div class="add-item">' +
      '<input list="lista-catalogo" placeholder="Buscar composição por código ou descrição…" data-add-cod="' + ei + '">' +
      '<input class="qtd" placeholder="Quantidade" data-add-qtd="' + ei + '">' +
      '<input placeholder="Seção (opcional)" style="width:180px" data-add-sec="' + ei + '">' +
      '<button class="btn sec" data-acao="add-item" data-ei="' + ei + '">Adicionar composição</button>' +
      "</div></div>";
  }

  function renderResumo(res) {
    var ata = acharAta(rascunho.ataId);
    var avisos = [];
    if (!ata) avisos.push("Selecione a Ata de RP para herdar o desconto.");
    if (!(Number(rascunho.dias) >= 1)) avisos.push("Informe os dias de realização do evento.");
    if (res.pendentes) avisos.push(res.pendentes + " composição(ões) CHP/CHI com classificação pendente: não somadas.");
    var temII = res.estruturas.some(function (e) { return e.linhas.some(function (l) { return l.calc && l.calc.grupo === "II"; }); });
    if (temII) avisos.push("Itens de tempo (diárias/turnos): confira se a quantidade corresponde às diárias do evento.");

    document.getElementById("resumo").innerHTML =
      '<div class="card"><h2>Resumo do pedido</h2><dl>' +
      "<dt>Desconto herdado</dt><dd>" + (ata ? pct(ata.desconto) : "—") + "</dd>" +
      "<dt>Dias informados</dt><dd>" + (Number(rascunho.dias) || 0) + "</dd>" +
      "<dt>Dias para medição</dt><dd>" + res.diasMedicao + "</dd>" +
      "<dt>Unidades (50 + dias + 35)</dt><dd>" + res.unidadesGrupoI + "</dd>" +
      "<dt>Estruturas</dt><dd>" + rascunho.estruturas.length + "</dd>" +
      "<dt>Grupo I — física</dt><dd>" + rs(res.totalI) + "</dd>" +
      "<dt>Grupo II — tempo</dt><dd>" + rs(res.totalII) + "</dd>" +
      '<dt class="total">Total do pedido</dt><dd class="total">' + rs(res.total) + "</dd></dl>" +
      avisos.map(function (a) { return '<div class="aviso">' + esc(a) + "</div>"; }).join("") +
      '<div class="linha-acoes" style="margin-top:12px">' +
      '<button class="btn" data-acao="salvar-pedido">' + (rascunho.id ? "Salvar alterações" : "Salvar pedido") + "</button>" +
      '<button class="btn sec" data-acao="novo-pedido">Limpar / novo</button>' +
      "</div></div>";
  }

  // eventos da aba pedido
  var abaPedido = document.getElementById("aba-pedido");
  abaPedido.addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset.campo) {
      rascunho[t.dataset.campo] = t.dataset.campo === "dias" ? Math.max(0, parseInt(t.value, 10) || 0) : t.value;
      salvarRascunho();
      if (t.dataset.campo === "ataId") renderPedido(); else renderEstruturas();
      return;
    }
    if (t.dataset.qtd) {
      var p = t.dataset.qtd.split(":");
      rascunho.estruturas[p[0]].itens[p[1]].quantidade = lerNumero(t.value);
      salvarRascunho(); renderEstruturas(); return;
    }
    if (t.dataset.estNome !== undefined) { rascunho.estruturas[t.dataset.estNome].nome = t.value; salvarRascunho(); return; }
    if (t.dataset.estUnid !== undefined) {
      rascunho.estruturas[t.dataset.estUnid].unidades = Math.max(1, parseInt(t.value, 10) || 1);
      salvarRascunho(); renderEstruturas();
    }
  });
  abaPedido.addEventListener("click", function (e) {
    var b = e.target.closest("[data-acao]"); if (!b) return;
    var a = b.dataset.acao;
    if (a === "add-modelo") {
      var m = D.modelos.filter(function (x) { return x.id === document.getElementById("sel-modelo").value; })[0];
      rascunho.estruturas.push({ uid: uid(), nome: m.nome, modeloId: m.id, unidades: 1, itens: clonar(m.itens), ausentes: clonar(m.ausentes) });
      salvarRascunho(); renderEstruturas(); toast("Estrutura " + m.nome + " adicionada.");
    } else if (a === "add-vazia") {
      rascunho.estruturas.push({ uid: uid(), nome: "Nova estrutura " + (rascunho.estruturas.length + 1), modeloId: null, unidades: 1, itens: [] });
      salvarRascunho(); renderEstruturas();
    } else if (a === "rem-est") {
      if (confirm("Remover esta estrutura do pedido?")) { rascunho.estruturas.splice(Number(b.dataset.ei), 1); salvarRascunho(); renderEstruturas(); }
    } else if (a === "rem-item") {
      rascunho.estruturas[b.dataset.ei].itens.splice(Number(b.dataset.ii), 1); salvarRascunho(); renderEstruturas();
    } else if (a === "add-item") {
      var ei = b.dataset.ei;
      var bruto = (document.querySelector('[data-add-cod="' + ei + '"]').value || "").trim();
      var cod = bruto.split(" ")[0].toUpperCase();
      var qtd = lerNumero(document.querySelector('[data-add-qtd="' + ei + '"]').value);
      var sec = (document.querySelector('[data-add-sec="' + ei + '"]').value || "").trim().toUpperCase();
      if (!IDX[cod]) { toast("Escolha uma composição da lista (código do catálogo)."); return; }
      if (!(qtd > 0)) { toast("Informe uma quantidade maior que zero."); return; }
      rascunho.estruturas[ei].itens.push({ secao: sec || "COMPOSIÇÕES ADICIONADAS", codigo: cod, quantidade: qtd });
      salvarRascunho(); renderEstruturas(); toast(cod + " adicionada.");
    } else if (a === "salvar-pedido") {
      salvarPedido();
    } else if (a === "novo-pedido") {
      if (confirm("Limpar o formulário? Pedidos já salvos não serão afetados.")) { rascunho = novoRascunho(); salvarRascunho(); renderPedido(); }
    }
  });

  function salvarPedido() {
    var ata = acharAta(rascunho.ataId);
    var erros = [];
    if (!rascunho.orgao) erros.push("órgão");
    if (!rascunho.evento) erros.push("evento");
    if (!(Number(rascunho.dias) >= 1)) erros.push("dias de realização");
    if (!ata) erros.push("Ata de RP");
    var nItens = rascunho.estruturas.reduce(function (s, e) { return s + e.itens.length; }, 0);
    if (!nItens) erros.push("ao menos uma composição");
    if (erros.length) { toast("Falta preencher: " + erros.join(", ") + "."); return; }

    var res = calcularRascunho();
    var p = clonar(rascunho);
    if (!p.id) {
      var seq = carregar("folia.seq", 0) + 1; gravar("folia.seq", seq);
      p.id = uid();
      p.numero = p.orgao + "-" + new Date().getFullYear() + "-" + String(seq).padStart(4, "0");
      p.criadoEm = new Date().toISOString();
    }
    p.atualizadoEm = new Date().toISOString();
    // a ata vai junto com o pedido, para que a consolidação funcione em outro computador
    p.ata = { id: ata.id, numero: ata.numero, lote: ata.lote, fornecedor: ata.fornecedor, cnpj: ata.cnpj || "", desconto: ata.desconto };
    p.totais = { grupoI: res.totalI, grupoII: res.totalII, total: res.total };
    var i = pedidos.findIndex(function (x) { return x.id === p.id; });
    if (i >= 0) pedidos[i] = p; else pedidos.push(p);
    gravar("folia.pedidos", pedidos);
    rascunho = p; salvarRascunho();
    renderPedido();
    toast("Pedido " + p.numero + " salvo: " + rs(res.total));
  }

  // =====================================================================
  // ABA: PEDIDOS E CONSOLIDAÇÃO
  // =====================================================================
  function calcularSalvo(p) { return FoliaCalc.calcularPedido(p, p.ata, IDX, R); }

  function renderPedidos() {
    var el = document.getElementById("aba-pedidos");
    var linhas = pedidos.map(function (p) {
      var r = calcularSalvo(p);
      return "<tr><td class=\"cod\">" + esc(p.numero) + (p.importado ? ' <span class="tag II">importado</span>' : "") + "</td>" +
        "<td>" + esc(p.orgao) + (p.unidade ? " / " + esc(p.unidade) : "") + "</td>" +
        "<td>" + esc(p.evento) + "</td>" +
        "<td>ARP " + esc(p.ata.numero) + " · L" + p.ata.lote + "</td>" +
        '<td class="num">' + p.dias + "</td>" +
        '<td class="num">' + p.estruturas.length + "</td>" +
        '<td class="num"><b>' + num(r.total) + "</b></td>" +
        '<td><div class="linha-acoes">' +
        '<button class="btn peq" data-acao="xlsx" data-id="' + p.id + '">Planilha de fiscalização</button>' +
        '<button class="btn sec peq" data-acao="editar" data-id="' + p.id + '">Editar</button>' +
        '<button class="btn sec peq" data-acao="exportar" data-id="' + p.id + '">Exportar</button>' +
        '<button class="btn perigo peq" data-acao="excluir" data-id="' + p.id + '">Excluir</button>' +
        "</div></td></tr>";
    }).join("");

    // consolidação por ata
    var grupos = {};
    pedidos.forEach(function (p) {
      var k = p.ata.numero + "|" + p.ata.lote + "|" + p.ata.cnpj;
      var r = calcularSalvo(p);
      if (!grupos[k]) grupos[k] = { ata: p.ata, n: 0, I: 0, II: 0, total: 0 };
      var g = grupos[k]; g.n++; g.I = FoliaCalc.arred(g.I + r.totalI); g.II = FoliaCalc.arred(g.II + r.totalII); g.total = FoliaCalc.arred(g.total + r.total);
    });
    var cons = Object.keys(grupos).map(function (k) {
      var g = grupos[k]; var ataCad = acharAta(g.ata.id);
      var reg = ataCad && ataCad.valorRegistrado ? ataCad.valorRegistrado : null;
      return "<tr><td>ARP " + esc(g.ata.numero) + "</td><td>" + g.ata.lote + " — " + esc(nomeLote(g.ata.lote)) + "</td><td>" + esc(g.ata.fornecedor) +
        '</td><td class="num">' + pct(g.ata.desconto) + '</td><td class="num">' + g.n + '</td><td class="num">' + num(g.I) +
        '</td><td class="num">' + num(g.II) + '</td><td class="num"><b>' + num(g.total) + "</b></td>" +
        '<td class="num">' + (reg ? num(reg) : "—") + '</td><td class="num">' + (reg ? num(reg - g.total) : "—") + "</td></tr>";
    }).join("");
    var totalGeral = Object.keys(grupos).reduce(function (s, k) { return FoliaCalc.arred(s + grupos[k].total); }, 0);

    el.innerHTML =
      '<div class="card"><h2>Pedidos</h2><p class="dica">Cada unidade salva seus pedidos neste navegador e usa "Exportar" para enviar o arquivo à consolidação. Quem consolida usa "Importar pedidos".</p>' +
      '<div class="linha-acoes" style="margin-bottom:12px">' +
      '<label class="btn sec" style="flex-direction:row">Importar pedidos (.json)<input type="file" accept=".json" multiple id="imp-pedidos" style="display:none"></label>' +
      '<button class="btn sec" data-acao="exportar-todos">Exportar todos</button>' +
      '<button class="btn" data-acao="xlsx-consolidado">Baixar consolidado (.xlsx)</button>' +
      "</div>" +
      (pedidos.length ? '<div class="rolagem"><table class="tabela"><thead><tr><th>Nº</th><th>Órgão / unidade</th><th>Evento</th><th>Ata</th><th class="num">Dias</th><th class="num">Estruturas</th><th class="num">Total (R$)</th><th>Ações</th></tr></thead><tbody>' + linhas + "</tbody></table></div>"
        : '<div class="vazio">Nenhum pedido salvo ainda.</div>') +
      "</div>" +
      '<div class="card"><h2>Consolidação por Ata de RP</h2><p class="dica">Valor a ser sacado de cada ata, somando todos os pedidos acima. O saldo aparece quando o valor registrado da ata foi informado na aba Atas de RP.</p>' +
      (cons ? '<div class="rolagem"><table class="tabela"><thead><tr><th>Ata</th><th>Lote</th><th>Fornecedor</th><th class="num">Desconto</th><th class="num">Pedidos</th><th class="num">Grupo I (R$)</th><th class="num">Grupo II (R$)</th><th class="num">Total a sacar (R$)</th><th class="num">Valor registrado</th><th class="num">Saldo</th></tr></thead><tbody>' + cons +
        '<tr><td colspan="7"><b>Total geral</b></td><td class="num"><b>' + num(totalGeral) + "</b></td><td></td><td></td></tr></tbody></table></div>"
        : '<div class="vazio">A consolidação aparece quando houver pedidos.</div>') +
      "</div>";
  }

  var abaPedidos = document.getElementById("aba-pedidos");
  abaPedidos.addEventListener("click", function (e) {
    var b = e.target.closest("[data-acao]"); if (!b) return;
    var p = pedidos.filter(function (x) { return x.id === b.dataset.id; })[0];
    var a = b.dataset.acao;
    if (a === "editar") { rascunho = clonar(p); if (!acharAta(rascunho.ataId)) { atasLocais.push(Object.assign({}, p.ata)); gravar("folia.atas", atasLocais); } salvarRascunho(); abrirAba("pedido"); }
    else if (a === "exportar") baixar("FOLIA_pedido_" + p.numero + ".json", JSON.stringify(p, null, 1));
    else if (a === "excluir") { if (confirm("Excluir o pedido " + p.numero + "?")) { pedidos = pedidos.filter(function (x) { return x !== p; }); gravar("folia.pedidos", pedidos); renderPedidos(); } }
    else if (a === "xlsx") gerarPlanilhaFiscalizacao(p);
    else if (a === "exportar-todos") { if (!pedidos.length) return toast("Nenhum pedido para exportar."); baixar("FOLIA_pedidos_" + hoje() + ".json", JSON.stringify(pedidos, null, 1)); }
    else if (a === "xlsx-consolidado") { if (!pedidos.length) return toast("Nenhum pedido para consolidar."); gerarConsolidado(); }
  });
  abaPedidos.addEventListener("change", function (e) {
    if (e.target.id !== "imp-pedidos") return;
    var arquivos = Array.prototype.slice.call(e.target.files); var cont = 0;
    Promise.all(arquivos.map(function (f) { return f.text(); })).then(function (textos) {
      textos.forEach(function (t) {
        try {
          var dado = JSON.parse(t); var lista = Array.isArray(dado) ? dado : (dado.pedidos || [dado]);
          lista.forEach(function (p) {
            if (!p || !p.id || !p.ata || !p.estruturas) return;
            p.importado = true;
            var i = pedidos.findIndex(function (x) { return x.id === p.id; });
            if (i >= 0) pedidos[i] = p; else pedidos.push(p);
            cont++;
          });
        } catch (err) { /* arquivo inválido: ignorado */ }
      });
      gravar("folia.pedidos", pedidos); renderPedidos(); toast(cont + " pedido(s) importado(s).");
    });
  });
  function hoje() { return new Date().toISOString().slice(0, 10); }

  // =====================================================================
  // ABA: ATAS DE RP
  // =====================================================================
  function renderAtas() {
    var el = document.getElementById("aba-atas");
    var opLotes = D.lotes.map(function (l) { return '<option value="' + l.lote + '">Lote ' + String(l.lote).padStart(2, "0") + " — " + esc(l.nome) + "</option>"; }).join("");
    var lista = todasAtas().map(function (a) {
      return "<tr><td>ARP " + esc(a.numero) + "</td><td>" + a.lote + " — " + esc(nomeLote(a.lote)) + "</td><td>" + esc(a.fornecedor) + "</td><td>" + esc(a.cnpj || "") +
        '</td><td class="num">' + pct(a.desconto) + '</td><td class="num">' + (a.valorRegistrado ? num(a.valorRegistrado) : "—") + "</td><td>" +
        (a.oficial ? '<span class="tag I">oficial</span>' : '<button class="btn perigo peq" data-acao="rem-ata" data-id="' + a.id + '">Excluir</button>') + "</td></tr>";
    }).join("");
    el.innerHTML =
      '<div class="card"><h2>Cadastrar Ata de RP</h2>' +
      '<p class="dica">Uso do gestor das atas. O desconto deve ser lançado exatamente como homologado, com 2 casas decimais (TR 5.6.1.4). Atas cadastradas aqui ficam neste navegador; exporte o arquivo para distribuí-lo às unidades.</p>' +
      '<div class="grade">' +
      '<label>Nº da ARP<input id="ata-numero" placeholder="Ex.: 012/2027"></label>' +
      '<label class="largo">Lote<select id="ata-lote">' + opLotes + "</select></label>" +
      '<label class="largo">Fornecedor<input id="ata-fornecedor" placeholder="Razão social"></label>' +
      '<label>CNPJ<input id="ata-cnpj" placeholder="00.000.000/0000-00"></label>' +
      '<label>Desconto (%)<input id="ata-desconto" placeholder="Ex.: 12,35"></label>' +
      '<label>Valor registrado (R$, opcional)<input id="ata-valor" placeholder="Para cálculo de saldo"></label>' +
      "</div>" +
      '<div class="linha-acoes" style="margin-top:12px"><button class="btn" data-acao="add-ata">Cadastrar ata</button>' +
      '<label class="btn sec" style="flex-direction:row">Importar atas (.json)<input type="file" accept=".json" id="imp-atas" style="display:none"></label>' +
      '<button class="btn sec" data-acao="exp-atas">Exportar atas</button></div></div>' +
      '<div class="card"><h2>Atas disponíveis</h2>' +
      (lista ? '<div class="rolagem"><table class="tabela"><thead><tr><th>Ata</th><th>Lote</th><th>Fornecedor</th><th>CNPJ</th><th class="num">Desconto</th><th class="num">Valor registrado</th><th></th></tr></thead><tbody>' + lista + "</tbody></table></div>"
        : '<div class="vazio">Nenhuma ata cadastrada.</div>') + "</div>";
  }
  var abaAtas = document.getElementById("aba-atas");
  abaAtas.addEventListener("click", function (e) {
    var b = e.target.closest("[data-acao]"); if (!b) return;
    if (b.dataset.acao === "add-ata") {
      var v = function (id) { return document.getElementById(id).value.trim(); };
      var descPct = lerNumero(v("ata-desconto"));
      if (!v("ata-numero") || !v("ata-fornecedor")) return toast("Informe o número da ARP e o fornecedor.");
      if (!(descPct >= 0 && descPct < 100) || v("ata-desconto") === "") return toast("Desconto inválido. Use valores como 12,35.");
      descPct = Math.trunc(descPct * 100) / 100; // casas além da 2ª são desconsideradas (TR 5.6.1.5)
      atasLocais.push({ id: uid(), numero: v("ata-numero"), lote: Number(v("ata-lote")), fornecedor: v("ata-fornecedor"), cnpj: v("ata-cnpj"),
        desconto: Math.round(descPct * 100) / 10000, valorRegistrado: lerNumero(v("ata-valor")) || null });
      gravar("folia.atas", atasLocais); renderAtas(); toast("Ata cadastrada.");
    } else if (b.dataset.acao === "rem-ata") {
      if (confirm("Excluir esta ata? Pedidos já salvos mantêm os dados da ata.")) { atasLocais = atasLocais.filter(function (a) { return a.id !== b.dataset.id; }); gravar("folia.atas", atasLocais); renderAtas(); }
    } else if (b.dataset.acao === "exp-atas") {
      baixar("FOLIA_atas_" + hoje() + ".json", JSON.stringify(atasLocais, null, 1));
    }
  });
  abaAtas.addEventListener("change", function (e) {
    if (e.target.id !== "imp-atas" || !e.target.files[0]) return;
    e.target.files[0].text().then(function (t) {
      try {
        var lista = JSON.parse(t); var n = 0;
        lista.forEach(function (a) { if (a.id && a.numero && typeof a.desconto === "number" && !atasLocais.some(function (x) { return x.id === a.id; })) { atasLocais.push(a); n++; } });
        gravar("folia.atas", atasLocais); renderAtas(); toast(n + " ata(s) importada(s).");
      } catch (err) { toast("Arquivo de atas inválido."); }
    });
  });

  // =====================================================================
  // ABA: CATÁLOGO
  // =====================================================================
  function renderCatalogo() {
    var el = document.getElementById("aba-catalogo");
    var opG = '<option value="">Todos os grupos</option>' + Object.keys(D.grupos).map(function (g) { return '<option value="' + g + '">' + g + " — " + esc(D.grupos[g]) + "</option>"; }).join("");
    el.innerHTML = '<div class="card"><h2>Catálogo de composições</h2><p class="dica">' + esc(D.meta.fonte) + " · BDI " + pct(D.meta.bdi) + " · Data-base: " + esc(D.meta.data_base) + "</p>" +
      '<div class="filtros"><input id="cat-busca" type="search" placeholder="Buscar por código ou descrição" value="' + esc(buscaCatalogo.termo) + '">' +
      '<select id="cat-grupo">' + opG + "</select>" +
      '<select id="cat-calc"><option value="">Todos os tipos</option><option value="I">Física (com desconto)</option><option value="II">Tempo (sem desconto)</option><option value="PENDENTE">Pendente</option></select></div>' +
      '<p class="dica" id="cat-cont"></p><div class="rolagem" style="max-height:640px"><table class="tabela"><thead><tr><th>Código</th><th>Descrição</th><th>Und</th><th class="num">Sem BDI</th><th class="num">Com BDI</th><th>Tipo</th></tr></thead><tbody id="cat-linhas"></tbody></table></div></div>';
    document.getElementById("cat-grupo").value = buscaCatalogo.grupo;
    document.getElementById("cat-calc").value = buscaCatalogo.calculo;
    desenharCatalogo();
  }
  function desenharCatalogo() {
    var termo = normalizar(buscaCatalogo.termo.trim());
    var f = D.itens.filter(function (i) {
      return (!buscaCatalogo.grupo || i.grupo === buscaCatalogo.grupo) && (!buscaCatalogo.calculo || i.grupo_calculo === buscaCatalogo.calculo) &&
        (!termo || normalizar(i.codigo + " " + i.descricao).indexOf(termo) >= 0);
    });
    document.getElementById("cat-cont").textContent = f.length + " de " + D.itens.length + " composições";
    document.getElementById("cat-linhas").innerHTML = f.map(function (i) {
      return '<tr><td class="cod">' + esc(i.codigo) + '</td><td class="desc">' + esc(i.descricao) + "</td><td>" + esc(i.unidade) + '</td><td class="num">' + num(i.valor_sem_bdi) +
        '</td><td class="num">' + num(i.valor_com_bdi) + '</td><td><span class="tag ' + i.grupo_calculo + '">' + ({ I: "Física", II: "Tempo", PENDENTE: "Pendente" })[i.grupo_calculo] + "</span></td></tr>";
    }).join("");
  }
  var abaCat = document.getElementById("aba-catalogo");
  abaCat.addEventListener("input", function (e) { if (e.target.id === "cat-busca") { buscaCatalogo.termo = e.target.value; desenharCatalogo(); } });
  abaCat.addEventListener("change", function (e) {
    if (e.target.id === "cat-grupo") buscaCatalogo.grupo = e.target.value;
    if (e.target.id === "cat-calc") buscaCatalogo.calculo = e.target.value;
    desenharCatalogo();
  });

  // =====================================================================
  // PLANILHAS (.xlsx)
  // =====================================================================
  function enc(c, r) { return XLSX.utils.encode_cell({ c: c, r: r }); }
  // Monta uma aba a partir de linhas; células podem ser valor simples ou {v, f, z} (f = fórmula, z = formato)
  function montarAba(linhas, larguras) {
    var ws = {}; var maxC = 0;
    linhas.forEach(function (linha, r) {
      (linha || []).forEach(function (cel, c) {
        if (cel === null || cel === undefined || cel === "") return;
        var o = (typeof cel === "object") ? cel : { v: cel };
        var celula = { v: o.v === undefined ? 0 : o.v, t: typeof o.v === "number" || o.f ? "n" : "s" };
        if (typeof o.v === "string" && !o.f) celula.t = "s";
        if (o.f) celula.f = o.f;
        if (o.z) celula.z = o.z;
        ws[enc(c, r)] = celula; if (c > maxC) maxC = c;
      });
    });
    ws["!ref"] = XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: maxC, r: Math.max(0, linhas.length - 1) } });
    if (larguras) ws["!cols"] = larguras.map(function (w) { return { wch: w }; });
    return ws;
  }
  var M = "#,##0.00", P = "0.00%";

  function gerarPlanilhaFiscalizacao(p) {
    var r = calcularSalvo(p);
    var wb = XLSX.utils.book_new();
    var periodo = (p.inicio ? dataBR(p.inicio) : "___/___/____") + " a " + (p.fim ? dataBR(p.fim) : "___/___/____");

    // ---- 2. Planilha orçamentária (montada primeiro para as referências) ----
    var L2 = [["PLANILHA ORÇAMENTÁRIA — Pedido " + p.numero], ["ARP " + p.ata.numero + " · Lote " + p.ata.lote + " · " + p.ata.fornecedor + " · Desconto " + pct(p.ata.desconto)],
      ["Dias de realização informados: " + p.dias + " · Dias para medição: " + r.diasMedicao + " (mínimo 3, TR 7.1.1.1.2.7)"], [],
      ["GRUPO I — Unidade de fornecimento por diárias equivalentes (m, m², m³, kit, un etc.)"],
      ["Estrutura", "Seção", "Código", "Descrição", "Und", "Quantidade", "PU referencial c/ BDI", "Desconto", "PU contratado (PC)", "Valor total do item (Q×PC)", "DC (Valor ÷ 100)", "Dias (DE)", "Mob./Desm. (MD)", "Unidades (DE+MD)", "Subtotal (DC × Unidades)"]];
    var iniI = L2.length;
    var itensFisc = [];
    r.estruturas.forEach(function (e) {
      e.linhas.forEach(function (l) {
        if (!l.calc || l.calc.grupo !== "I") return;
        var n = L2.length + 1; var c = l.calc;
        L2.push([e.estrutura.nome + (e.multiplicador > 1 ? " (×" + e.multiplicador + ")" : ""), l.item.secao || "", l.item.codigo, l.comp.descricao, l.comp.unidade,
          { v: c.quantidade, z: "#,##0.00" }, { v: c.puReferencial, z: M }, { v: c.desconto, z: P },
          { v: c.puContratado, f: "ROUND(G" + n + "*(1-H" + n + "),2)", z: M }, { v: c.valorTotalItem, f: "ROUND(F" + n + "*I" + n + ",2)", z: M },
          { v: c.valorTotalItem / 100, f: "J" + n + "/100", z: "#,##0.0000" }, r.diasMedicao, R.mobilizacao + R.desmobilizacao,
          { v: c.unidades, f: "L" + n + "+M" + n }, { v: c.valor, f: "ROUND(K" + n + "*N" + n + ",2)", z: M }]);
        itensFisc.push({ est: e.estrutura.nome, l: l, ref: "'2-Planilha Orçamentária'!O" + n });
      });
    });
    var fimI = L2.length;
    L2.push(["TOTAL GRUPO I", "", "", "", "", "", "", "", "", "", "", "", "", "", { v: r.totalI, f: fimI > iniI ? "SUM(O" + (iniI + 1) + ":O" + fimI + ")" : "0", z: M }]);
    var linTotI = L2.length;
    L2.push([], ["GRUPO II — Unidade de fornecimento por intervalo de tempo (diárias, turnos) — sem desconto"],
      ["Estrutura", "Seção", "Código", "Descrição", "Und", "Quantidade", "Preço referencial", "Desconto", "Preço contratado", "Valor"]);
    var iniII = L2.length;
    r.estruturas.forEach(function (e) {
      e.linhas.forEach(function (l) {
        if (!l.calc || l.calc.grupo !== "II") return;
        var n = L2.length + 1; var c = l.calc;
        L2.push([e.estrutura.nome, l.item.secao || "", l.item.codigo, l.comp.descricao, l.comp.unidade, { v: c.quantidade, z: "#,##0.00" },
          { v: c.puReferencial, z: M }, { v: c.desconto, z: P }, { v: c.puContratado, f: "ROUND(G" + n + "*(1-H" + n + "),2)", z: M },
          { v: c.valor, f: "ROUND(F" + n + "*I" + n + ",2)", z: M }]);
        itensFisc.push({ est: e.estrutura.nome, l: l, ref: "'2-Planilha Orçamentária'!J" + n });
      });
    });
    var fimII = L2.length;
    L2.push(["TOTAL GRUPO II", "", "", "", "", "", "", "", "", { v: r.totalII, f: fimII > iniII ? "SUM(J" + (iniII + 1) + ":J" + fimII + ")" : "0", z: M }]);
    var linTotII = L2.length;
    L2.push([], ["TOTAL GRUPOS I + II", "", "", "", "", "", "", "", "", { v: r.total, f: "O" + linTotI + "+J" + linTotII, z: M }]);
    var linTotal = L2.length;
    L2.push([], ["Os preços correspondem aos preços referenciais da Tabela Consolidada SSP/BA, com o desconto registrado aplicado aos itens do Grupo I (metodologia do TR, subitens 7.1.1.1.2.1 a 7.1.1.1.2.11)."],
      [], ["Elaborado por:", "", "", "Conferido por:"], ["Data:"]);

    // ---- 1. Ordem de serviço ----
    var L1 = [["ORDEM DE SERVIÇO Nº ____/" + new Date().getFullYear() + " — Pedido " + p.numero], [],
      ["Ata de Registro de Preços nº", p.ata.numero], ["Contrato nº", ""], ["Lote", p.ata.lote + " — " + nomeLote(p.ata.lote)], [],
      ["1. IDENTIFICAÇÃO DA DEMANDA"], ["Evento/Operação", p.evento], ["Órgão / Unidade requisitante", p.orgao + (p.unidade ? " / " + p.unidade : "")],
      ["Município", p.municipio], ["Endereço / Localidade", p.local], ["Período do evento", periodo], ["Dias de realização", p.dias],
      ["Responsável local", p.responsavel], ["Telefone/e-mail", p.contato], [],
      ["2. CONTRATADA"], ["Fornecedor", p.ata.fornecedor], ["CNPJ", p.ata.cnpj], ["Preposto", ""], ["Telefone", ""], ["E-mail", ""], [],
      ["3. VALOR"], ["Item", "Tipo de estrutura", "Quantidade", "Valor total (R$)"]];
    r.estruturas.forEach(function (e, i) { L1.push([i + 1, e.estrutura.nome, e.multiplicador, { v: e.subtotal, z: M }]); });
    L1.push(["TOTAL", "", "", { v: r.total, f: "'2-Planilha Orçamentária'!J" + linTotal, z: M }], [],
      ["4. CONTROLE DO SALDO"], ["Valor máximo do contrato", ""], ["Saldo anterior", ""], ["Valor desta OS", { v: r.total, z: M }], ["Saldo posterior", ""], [],
      ["5. RESPONSÁVEIS"], ["Gestor", ""], ["Fiscal técnico", ""], ["Fiscal setorial", ""], ["Responsável local", p.responsavel], [],
      ["Documentos integrantes: Planilha Orçamentária; Cronograma de Execução e Layout; Checklist e Registro de Fiscalização; Medição, Aceite e Encerramento."]);

    // ---- 3. Cronograma ----
    var L3 = [["CRONOGRAMA DE EXECUÇÃO — Pedido " + p.numero], ["Evento", p.evento], ["Local", p.local], [],
      ["Etapa", "Data inicial", "Data final", "Responsável"],
      ["Mobilização, montagem e instalação", "", "", ""], ["Vistoria (até 2 dias antes do evento)", "", "", ""],
      ["Evento", p.inicio ? dataBR(p.inicio) : "", p.fim ? dataBR(p.fim) : "", ""], ["Desmobilização, desmontagem e desinstalação", "", "", ""], [],
      ["Condições específicas"], ["Horário autorizado para montagem", ""], ["Horário autorizado para desmontagem", ""], ["Restrições de acesso", ""],
      ["Pontos de energia", ""], ["Condições especiais de segurança", ""], ["Outras condições", ""], [],
      ["Layout/planta: documento, versão e data", ""], ["Documentação técnica: ART/RRT, projeto/memorial, documentação elétrica, certificados, prevenção contra incêndio", ""]];

    // ---- 4. Checklist e glosas ----
    var L4 = [["CHECKLIST DE EXECUÇÃO E REGISTRO DE FISCALIZAÇÃO — Pedido " + p.numero], ["Data da vistoria:", "", "Fiscal técnico:", "", "Fiscal setorial:"], [],
      ["Estrutura", "Código", "Especificação", "Und", "Qtd. autorizada", "Qtd. instalada", "Conforme (S/N)", "Classe de glosa (b a f)", "% de glosa", "Valor do item (R$)", "Glosa (R$)", "Glosa classe a (R$, manual)", "Observação"]];
    var ini4 = L4.length;
    itensFisc.forEach(function (it) {
      var n = L4.length + 1;
      L4.push([it.est, it.l.item.codigo, it.l.comp.descricao, it.l.comp.unidade, { v: it.l.calc.quantidade, z: "#,##0.00" }, "", "", "",
        { v: 0, f: 'IF(H' + n + '="b",' + R.glosas.b + ',IF(H' + n + '="c",' + R.glosas.c + ',IF(H' + n + '="d",' + R.glosas.d + ',IF(H' + n + '="e",' + R.glosas.e + ',IF(H' + n + '="f",' + R.glosas.f + ',0)))))', z: P },
        { v: it.l.calc.valor, f: it.ref, z: M }, { v: 0, f: "ROUND(J" + n + "*I" + n + ",2)+L" + n, z: M }, "", ""]);
    });
    var fim4 = L4.length;
    L4.push(["TOTAL DE GLOSAS", "", "", "", "", "", "", "", "", "", { v: 0, f: fim4 > ini4 ? "SUM(K" + (ini4 + 1) + ":K" + fim4 + ")" : "0", z: M }]);
    var linGlosa = L4.length;
    L4.push([], ["Classes de glosa (TR 7.1.1.1.2, VI) — sobre o valor do item afetado"],
      ["a", "Divisória dupla trocada por simples, com autorização: 100% da diferença entre os PUs (lançar em 'Glosa classe a')"],
      ["b", "Divisória dupla trocada por simples, sem autorização: 30%"], ["c", "Falha estética leve: 10%"], ["d", "Falha funcional moderada: 20%"],
      ["e", "Falha grave: 50%"], ["f", "Falha crítica de segurança ou serviço não executado: 100%"], [],
      ["Condições gerais (marcar S/N)"], ["Estruturas montadas no local correto", ""], ["Quantidades conferidas", ""], ["Especificações atendidas", ""],
      ["Estruturas em condições adequadas de utilização", ""], ["Instalações concluídas", ""], ["Documentação técnica apresentada, quando exigível", ""], ["Cronograma cumprido", ""], [],
      ["Registro de ocorrências"], ["Data/hora", "Ocorrência", "Providência", "Responsável", "Regularização"], [], [], [], [], [],
      ["Registro fotográfico: antes da montagem · durante a montagem · estrutura concluída · durante o evento · não conformidades · desmontagem · local após retirada"]);

    // ---- 5. Medição ----
    var L5 = [["TERMO DE MEDIÇÃO, RECEBIMENTO E ENCERRAMENTO — Pedido " + p.numero], ["Evento", p.evento], ["Período", periodo], [],
      ["Valor autorizado na OS", { v: r.total, f: "'2-Planilha Orçamentária'!J" + linTotal, z: M }],
      ["Glosas", { v: 0, f: "'4-Checklist'!K" + linGlosa, z: M }],
      ["Valor efetivamente medido", { v: r.total, f: "B5-B6", z: M }],
      ["Valor autorizado para faturamento", { v: r.total, f: "B7", z: M }], [],
      ["Resultado da execução (marcar)"], ["Executados integralmente", ""], ["Executados parcialmente", ""], ["Não conformidades identificadas", ""], ["Itens não executados", ""], ["Necessidade de glosa", ""], [],
      ["Termo de aceite (marcar)"], ["Recebimento integral e sem ressalvas", ""], ["Recebimento com ressalvas", ""], ["Recebimento parcial", ""], ["Não recebimento", ""], [],
      ["Encerramento financeiro"], ["Valor da OS", { v: r.total, f: "B5", z: M }], ["Valor medido", { v: r.total, f: "B7", z: M }], ["Valor faturado", ""], ["Saldo não utilizado", { v: 0, f: "B24-B25", z: M }], [],
      ["Fiscal técnico", ""], ["Fiscal setorial", ""], ["Preposto da CONTRATADA", ""]];

    XLSX.utils.book_append_sheet(wb, montarAba(L1, [34, 48, 14, 18]), "1-OS");
    XLSX.utils.book_append_sheet(wb, montarAba(L2, [26, 22, 15, 60, 6, 11, 13, 9, 13, 15, 12, 8, 10, 11, 15]), "2-Planilha Orçamentária");
    XLSX.utils.book_append_sheet(wb, montarAba(L3, [44, 16, 16, 24]), "3-Cronograma");
    XLSX.utils.book_append_sheet(wb, montarAba(L4, [26, 15, 60, 6, 12, 12, 11, 13, 10, 15, 14, 16, 30]), "4-Checklist");
    XLSX.utils.book_append_sheet(wb, montarAba(L5, [40, 18]), "5-Medição");
    XLSX.writeFile(wb, "FOLIA_" + p.numero + "_fiscalizacao.xlsx");
    toast("Planilha de fiscalização gerada.");
  }

  function gerarConsolidado() {
    var wb = XLSX.utils.book_new();
    var grupos = {}; var itens = [["Pedido", "Órgão", "Evento", "ARP", "Lote", "Estrutura", "Código", "Descrição", "Und", "Tipo", "Quantidade", "PU ref.", "Desconto", "PU contratado", "Unidades", "Valor (R$)"]];
    var peds = [["Pedido", "Órgão", "Unidade", "Evento", "Município", "Início", "Fim", "Dias", "ARP", "Lote", "Fornecedor", "Desconto", "Grupo I", "Grupo II", "Total"]];
    pedidos.forEach(function (p) {
      var r = calcularSalvo(p);
      var k = p.ata.numero + "|" + p.ata.lote + "|" + p.ata.cnpj;
      if (!grupos[k]) grupos[k] = { ata: p.ata, n: 0, I: 0, II: 0, t: 0 };
      var g = grupos[k]; g.n++; g.I = FoliaCalc.arred(g.I + r.totalI); g.II = FoliaCalc.arred(g.II + r.totalII); g.t = FoliaCalc.arred(g.t + r.total);
      peds.push([p.numero, p.orgao, p.unidade, p.evento, p.municipio, dataBR(p.inicio), dataBR(p.fim), p.dias, p.ata.numero, p.ata.lote, p.ata.fornecedor,
        { v: p.ata.desconto, z: P }, { v: r.totalI, z: M }, { v: r.totalII, z: M }, { v: r.total, z: M }]);
      r.estruturas.forEach(function (e) {
        e.linhas.forEach(function (l) {
          if (!l.calc) return;
          itens.push([p.numero, p.orgao, p.evento, p.ata.numero, p.ata.lote, e.estrutura.nome, l.item.codigo, l.comp.descricao, l.comp.unidade, l.calc.grupo,
            { v: l.calc.quantidade, z: "#,##0.00" }, { v: l.calc.puReferencial, z: M }, { v: l.calc.desconto || 0, z: P }, { v: l.calc.puContratado || 0, z: M },
            l.calc.unidades || "", { v: l.calc.valor, z: M }]);
        });
      });
    });
    var cons = [["CONSOLIDAÇÃO POR ATA DE RP — gerado em " + dataBR(hoje())], [],
      ["ARP", "Lote", "Nome do lote", "Fornecedor", "CNPJ", "Desconto", "Nº de pedidos", "Grupo I (R$)", "Grupo II (R$)", "Total a sacar (R$)", "Valor registrado (R$)", "Saldo (R$)"]];
    Object.keys(grupos).forEach(function (k) {
      var g = grupos[k]; var ataCad = acharAta(g.ata.id); var reg = ataCad && ataCad.valorRegistrado ? ataCad.valorRegistrado : "";
      var n = cons.length + 1;
      cons.push([g.ata.numero, g.ata.lote, nomeLote(g.ata.lote), g.ata.fornecedor, g.ata.cnpj, { v: g.ata.desconto, z: P }, g.n, { v: g.I, z: M }, { v: g.II, z: M },
        { v: g.t, z: M }, reg === "" ? "" : { v: reg, z: M }, reg === "" ? "" : { v: reg - g.t, f: "K" + n + "-J" + n, z: M }]);
    });
    XLSX.utils.book_append_sheet(wb, montarAba(cons, [12, 6, 40, 30, 20, 10, 10, 15, 15, 17, 17, 15]), "Consolidado por Ata");
    XLSX.utils.book_append_sheet(wb, montarAba(peds, [18, 8, 20, 26, 14, 11, 11, 6, 12, 6, 28, 10, 14, 14, 14]), "Pedidos");
    XLSX.utils.book_append_sheet(wb, montarAba(itens, [18, 8, 22, 12, 6, 22, 15, 60, 6, 6, 11, 12, 9, 12, 9, 14]), "Itens");
    XLSX.writeFile(wb, "FOLIA_consolidado_" + hoje() + ".xlsx");
    toast("Consolidado gerado.");
  }

  // início
  renderPedido();
})();
