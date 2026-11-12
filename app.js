// F.O.L.I.A. — Interface com login, perfis, pedidos na nuvem, consolidação, atas, usuários, histórico e planilhas.
// Depende de: dados.js (FOLIA_DADOS), calc.js (FoliaCalc), xlsx.full.min.js (XLSX) e nuvem.js (FoliaNuvem).

(function () {
  "use strict";

  var D = FOLIA_DADOS;
  var R = D.regras;
  var IDX = {};
  function normalizarTexto(t) { return String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
  function curta(d) {
    var s = String(d || "");
    s = s.replace(/^FORNECIMENTO,\s*(?:MONTAGEM|DESMONTAGEM)[^-]{0,60}-\s*/, "");
    s = s.replace(/^FORNECIMENTO, MONTAGEM, INSTALAÇÃO E DESMONTAGEM DE\s+/, "");
    return s || String(d || "");
  }
  D.itens.forEach(function (i) { i.curta = curta(i.descricao); i.busca = normalizarTexto(i.codigo + " " + i.descricao); IDX[i.codigo] = i; });

  var STATUS = {
    rascunho: "Rascunho", enviado: "Enviado à CLIC", aprovado: "Aprovado — OS emitida",
    em_fiscalizacao: "Em fiscalização", encerrado: "Encerrado", cancelado: "Cancelado"
  };
  var CONTA_NO_SAQUE = ["enviado", "aprovado", "em_fiscalizacao", "encerrado"];
  var PERFIS = { unidade: "Unidade demandante", gestor: "Gestor (CLIC)", fiscal: "Fiscal", consulta: "Consulta" };

  // ---------- utilidades ----------
  var fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function rs(v) { return "R$ " + fmt.format(v || 0); }
  function pct(f) { return fmt.format((f || 0) * 100) + "%"; }
  function num(v) { return fmt.format(v || 0); }
  function numCurto(v) { return num(v).replace(/,00$/, ""); }
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clonar(o) { return JSON.parse(JSON.stringify(o)); }
  function lerNumero(v) { var s = String(v).trim(); if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", "."); return Number(s) || 0; }
  function dataBR(iso) { if (!iso) return ""; var p = String(iso).split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso; }
  function dataHora(ts) {
    if (!ts) return "";
    var d = ts.toDate ? ts.toDate() : (ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts));
    return isNaN(d) ? "" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  }
  function hoje() { return new Date().toISOString().slice(0, 10); }
  function carregar(chave, padrao) { try { var v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } }
  function gravar(chave, valor) { try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* sem armazenamento local */ } }
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg; t.classList.add("visivel");
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("visivel"); }, 3200);
  }
  function selStatus(s) { return '<span class="status st-' + s + '">' + esc(STATUS[s] || s) + "</span>"; }
  function nomeLote(n) { var l = D.lotes.filter(function (x) { return x.lote === Number(n); })[0]; return l ? l.nome : ""; }
  function opOrgaos(sel) {
    return '<option value="">Selecione…</option>' + D.orgaos.map(function (o) {
      return '<option value="' + o.sigla + '"' + (sel === o.sigla ? " selected" : "") + ">" + o.sigla + " — " + esc(o.nome) + "</option>";
    }).join("");
  }
  function ocupado(botao, sim) { if (!botao) return; botao.disabled = sim; botao.style.opacity = sim ? 0.6 : 1; }

  // ---------- estado ----------
  var N = null;              // FoliaNuvem
  var eu = null;             // cadastro do usuário logado
  var atas = [];
  var pedidos = [];
  var usuarios = [];
  var rascunho = null;
  var abaAtual = null;
  var buscaCatalogo = { termo: "", grupo: "", calculo: "" };

  function chaveRascunho() { return "folia.rascunho." + eu.uid; }
  function salvarRascunho() { gravar(chaveRascunho(), rascunho); }
  function novoRascunho() {
    return { id: null, numero: null, status: "rascunho", orgao: eu.perfil === "unidade" ? eu.orgao : "", unidade: eu.perfil === "unidade" ? eu.unidade : "",
      evento: "", municipio: "", local: "", inicio: "", fim: "", dias: 3, responsavel: "", contato: "", ataId: "", estruturas: [], fiscais: [] };
  }
  function atasAtivas() { return atas.filter(function (a) { return a.ativa !== false; }); }
  function acharAta(id) { return atas.filter(function (a) { return a.id === id; })[0] || null; }
  function rotuloAta(a) { return "ARP " + a.numero + " · Lote " + String(a.lote).padStart(2, "0") + " · " + a.fornecedor + " · desconto " + pct(a.desconto); }
  function nomeUsuario(id) { var u = usuarios.filter(function (x) { return x.uid === id; })[0]; return u ? u.nome : ""; }

  function podeEditar(p) {
    if (!eu) return false;
    if (eu.perfil === "gestor") return p.status !== "encerrado" && p.status !== "cancelado";
    if (eu.perfil === "unidade") return (!p.id || p.autorUid === eu.uid) && (p.status === "rascunho" || p.status === "enviado" || !p.status);
    return false;
  }
  function abasDoPerfil() {
    var p = eu.perfil;
    var a = [];
    if (p === "unidade" || p === "gestor") a.push(["pedido", "Novo pedido"]);
    a.push(["pedidos", p === "unidade" ? "Pedidos da unidade" : p === "fiscal" ? "Pedidos designados" : "Pedidos"]);
    if (p === "gestor" || p === "consulta") a.push(["consolidacao", "Consolidação"]);
    if (p === "gestor") { a.push(["atas", "Atas de RP"]); a.push(["usuarios", "Usuários"]); a.push(["historico", "Histórico"]); }
    a.push(["catalogo", "Catálogo"]);
    return a;
  }

  // =====================================================================
  // INÍCIO E SESSÃO
  // =====================================================================
  function iniciar() {
    N = window.FoliaNuvem;
    N.observarSessao(aoMudarSessao);
  }
  if (window.FoliaNuvem) iniciar(); else window.addEventListener("folia-nuvem-pronta", iniciar);
  setTimeout(function () {
    if (!N) document.getElementById("acesso").innerHTML = '<div class="card"><h2>Não foi possível conectar</h2><p class="aviso erro">O módulo de acesso (nuvem.js) não carregou. Verifique a conexão com a internet e se o arquivo nuvem.js está no repositório.</p></div>';
  }, 10000);

  function aoMudarSessao(s) {
    var app = document.getElementById("app"), acesso = document.getElementById("acesso");
    if (s.estado !== "ativo") {
      eu = null; app.style.display = "none"; acesso.style.display = "block";
      document.getElementById("menu").innerHTML = ""; document.getElementById("caixa-usuario").innerHTML = "";
      renderAcesso(s);
      return;
    }
    eu = s.usuario;
    acesso.style.display = "none"; app.style.display = "block";
    document.getElementById("caixa-usuario").innerHTML = "<b>" + esc(eu.nome) + "</b><br>" + esc(PERFIS[eu.perfil]) +
      (eu.orgao ? " · " + esc(eu.orgao) + (eu.unidade ? " / " + esc(eu.unidade) : "") : "") + '<br><button id="btn-sair">Sair</button>';
    document.getElementById("btn-sair").onclick = function () { N.sair(); };
    document.getElementById("menu").innerHTML = abasDoPerfil().map(function (a) { return '<button data-aba="' + a[0] + '">' + a[1] + "</button>"; }).join("");
    rascunho = carregar(chaveRascunho(), null) || novoRascunho();
    carregarDados().then(function () { abrirAba(abasDoPerfil()[0][0]); });
  }

  function carregarDados() {
    var tarefas = [N.listarAtas().then(function (l) { atas = l; }), N.listarPedidos().then(function (l) { pedidos = l; })];
    if (eu.perfil === "gestor") tarefas.push(N.listarUsuarios().then(function (l) { usuarios = l; }));
    return Promise.all(tarefas).catch(function (e) { toast("Erro ao carregar dados: " + e.message); });
  }

  // ---------- tela de acesso ----------
  var modoAcesso = "entrar";
  function renderAcesso(s) {
    var el = document.getElementById("acesso");
    if (s.estado === "nao_verificado") {
      el.innerHTML = '<div class="card"><h2>Confirme seu e-mail</h2><p class="dica">Enviamos um link de confirmação para <b>' + esc(s.email) +
        "</b>. Abra o e-mail (veja também a caixa de spam), clique no link e depois clique em \"Já confirmei\".</p>" +
        '<div class="linha-acoes"><button class="btn" id="ac-recarregar">Já confirmei</button><button class="btn sec" id="ac-reenviar">Reenviar e-mail</button><button class="btn sec" id="ac-sair">Sair</button></div></div>';
      document.getElementById("ac-recarregar").onclick = function () { N.recarregarSessao(); };
      document.getElementById("ac-reenviar").onclick = function () { N.reenviarVerificacao().then(function () { toast("E-mail reenviado."); }, function (e) { toast(e.message); }); };
      document.getElementById("ac-sair").onclick = function () { N.sair(); };
      return;
    }
    if (s.estado === "pendente") {
      el.innerHTML = '<div class="card"><h2>Cadastro aguardando aprovação</h2><p class="dica">Seu cadastro foi recebido. Um gestor da CLIC precisa aprová-lo e definir seu perfil de acesso. Depois disso, entre novamente.</p>' +
        '<div class="linha-acoes"><button class="btn" id="ac-recarregar">Verificar novamente</button><button class="btn sec" id="ac-sair">Sair</button></div></div>';
      document.getElementById("ac-recarregar").onclick = function () { location.reload(); };
      document.getElementById("ac-sair").onclick = function () { N.sair(); };
      return;
    }
    if (s.estado === "sem_cadastro") {
      el.innerHTML = '<div class="card"><h2>Complete seu cadastro</h2><p class="dica">Conta: ' + esc(s.email) + "</p>" +
        '<form id="f-completar"><label>Nome completo<input name="nome" required></label><label>Órgão<select name="orgao" required>' + opOrgaos("") + "</select></label>" +
        '<label>Unidade<input name="unidade" required placeholder="Ex.: CENAR, 1º GBM, DEPOM"></label><button class="btn">Enviar cadastro</button></form>' +
        '<p><button class="btn sec" id="ac-sair">Sair</button></p></div>';
      document.getElementById("ac-sair").onclick = function () { N.sair(); };
      document.getElementById("f-completar").onsubmit = function (e) {
        e.preventDefault(); var f = e.target;
        N.completarCadastro({ nome: f.nome.value, orgao: f.orgao.value, unidade: f.unidade.value }).then(function () { location.reload(); }, function (er) { toast(er.message); });
      };
      return;
    }
    if (s.estado === "erro") {
      el.innerHTML = '<div class="card"><h2>Não foi possível carregar seu cadastro</h2><p class="aviso erro">' + esc(s.erro) + '</p><button class="btn sec" id="ac-sair">Sair</button></div>';
      document.getElementById("ac-sair").onclick = function () { N.sair(); };
      return;
    }
    // anônimo
    var form;
    if (modoAcesso === "entrar") {
      form = '<form id="f-acesso"><label>E-mail<input name="email" type="email" autocomplete="username" required></label>' +
        '<label>Senha<input name="senha" type="password" autocomplete="current-password" required></label><button class="btn">Entrar</button></form>';
    } else if (modoAcesso === "cadastrar") {
      form = '<form id="f-acesso"><label>Nome completo<input name="nome" required></label><label>E-mail<input name="email" type="email" autocomplete="username" required></label>' +
        '<label>Senha (mínimo 6 caracteres)<input name="senha" type="password" minlength="6" autocomplete="new-password" required></label>' +
        '<label>Órgão<select name="orgao" required>' + opOrgaos("") + "</select></label>" +
        '<label>Unidade<input name="unidade" required placeholder="Ex.: CENAR, 1º GBM, DEPOM"></label>' +
        '<p class="dica" style="margin:0">Use o nome da unidade como os colegas usam: quem tiver a mesma unidade verá os mesmos pedidos. O gestor pode corrigir depois.</p>' +
        '<button class="btn">Criar conta</button></form>';
    } else {
      form = '<form id="f-acesso"><label>E-mail cadastrado<input name="email" type="email" required></label><button class="btn">Enviar link para redefinir a senha</button></form>';
    }
    el.innerHTML = '<div class="card"><h2 style="margin-bottom:12px">Acesso ao F.O.L.I.A.</h2><div class="abas-acesso">' +
      [["entrar", "Entrar"], ["cadastrar", "Criar conta"], ["senha", "Esqueci a senha"]].map(function (m) {
        return '<button data-modo="' + m[0] + '" class="' + (modoAcesso === m[0] ? "ativo" : "") + '">' + m[1] + "</button>";
      }).join("") + "</div>" + form + "</div>";
    el.querySelectorAll("[data-modo]").forEach(function (b) { b.onclick = function () { modoAcesso = b.dataset.modo; renderAcesso(s); }; });
    document.getElementById("f-acesso").onsubmit = function (e) {
      e.preventDefault(); var f = e.target; var b = f.querySelector("button"); ocupado(b, true);
      var acao;
      if (modoAcesso === "entrar") acao = N.entrar(f.email.value, f.senha.value);
      else if (modoAcesso === "cadastrar") {
        if (!f.orgao.value) { ocupado(b, false); return toast("Selecione o órgão."); }
        acao = N.cadastrar({ nome: f.nome.value, email: f.email.value, senha: f.senha.value, orgao: f.orgao.value, unidade: f.unidade.value })
          .then(function () { toast("Conta criada. Confirme o e-mail que enviamos."); });
      } else acao = N.redefinirSenha(f.email.value).then(function () { toast("Se o e-mail estiver cadastrado, você receberá o link."); modoAcesso = "entrar"; renderAcesso(s); });
      acao.catch(function (er) { toast(er.message); }).then(function () { ocupado(b, false); });
    };
  }

  // ---------- navegação ----------
  document.getElementById("menu").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-aba]"); if (b) abrirAba(b.dataset.aba);
  });
  function abrirAba(nome) {
    abaAtual = nome;
    document.querySelectorAll("#menu button").forEach(function (b) { b.classList.toggle("ativo", b.dataset.aba === nome); });
    document.querySelectorAll(".aba").forEach(function (s) { s.classList.toggle("ativa", s.id === "aba-" + nome); });
    ({ pedido: renderPedido, pedidos: renderPedidos, consolidacao: renderConsolidacao, atas: renderAtas, usuarios: renderUsuarios,
      historico: renderHistorico, catalogo: renderCatalogo })[nome]();
    window.scrollTo(0, 0);
  }

  // =====================================================================
  // ABA: PEDIDO (criar / editar / visualizar)
  // =====================================================================
  function renderPedido() {
    var el = document.getElementById("aba-pedido");
    var leitura = !podeEditar(rascunho);
    var dis = leitura ? " disabled" : "";
    var ata = acharAta(rascunho.ataId);
    var listaAtas = atasAtivas();
    if (ata && listaAtas.indexOf(ata) < 0) listaAtas = listaAtas.concat([ata]);
    var opAtas = '<option value="">' + (listaAtas.length ? "Selecione a Ata de RP…" : "Nenhuma ata cadastrada pela CLIC") + "</option>" +
      listaAtas.map(function (a) { return '<option value="' + a.id + '"' + (a.id === rascunho.ataId ? " selected" : "") + ">" + esc(rotuloAta(a)) + "</option>"; }).join("");
    var opModelos = D.modelos.map(function (m) { return '<option value="' + m.id + '">' + esc(m.nome) + " — " + m.itens.length + " composições</option>"; }).join("");
    var orgaoFixo = eu.perfil !== "gestor";

    el.innerHTML =
      (rascunho.id ? '<div class="faixa-leitura">Pedido <b>' + esc(rascunho.numero) + "</b> · " + selStatus(rascunho.status) +
        (rascunho.autorNome ? " · criado por " + esc(rascunho.autorNome) : "") + (rascunho.os && rascunho.os.numero ? " · OS nº " + esc(rascunho.os.numero) : "") +
        (leitura ? " · <b>somente leitura</b>" + (eu.perfil === "unidade" ? " (só o autor edita, e apenas até a aprovação da CLIC)" : "") : "") + "</div>" : "") +
      '<div class="layout-pedido"><div>' +
      '<div class="card"><h2>1. Identificação do pedido</h2><p class="dica">Dados da unidade e do evento, usados na Ordem de Serviço e na planilha de fiscalização.</p>' +
      '<div class="grade">' +
      (orgaoFixo ? '<label>Órgão<input value="' + esc(rascunho.orgao) + '" readonly></label><label>Unidade<input value="' + esc(rascunho.unidade) + '" readonly></label>'
        : '<label>Órgão<select data-campo="orgao"' + dis + ">" + opOrgaos(rascunho.orgao) + "</select></label>" +
          '<label>Unidade<input data-campo="unidade" value="' + esc(rascunho.unidade) + '" placeholder="Ex.: CENAR"' + dis + "></label>") +
      campo("Evento / operação", "evento", "Ex.: Carnaval 2027", "largo", "", dis) +
      campo("Município", "municipio", "Ex.: Salvador", "", "", dis) +
      campo("Local / endereço", "local", "Ex.: Campo Grande", "largo", "", dis) +
      campo("Início do evento", "inicio", "", "", "date", dis) +
      campo("Fim do evento", "fim", "", "", "date", dis) +
      campo("Dias de realização do evento", "dias", "", "", "number", dis) +
      campo("Responsável local", "responsavel", "Nome e posto/cargo", "", "", dis) +
      campo("Telefone / e-mail", "contato", "", "", "", dis) +
      '</div><p class="dica" style="margin-top:10px">Dias de realização: só os dias do evento. Montagem e desmontagem já estão nas 85 unidades fixas (TR 7.1.1.1.2.3). Abaixo de 3 dias, a medição considera 3 (TR 7.1.1.1.2.7).</p></div>' +

      '<div class="card"><h2>2. Ata de Registro de Preços</h2><p class="dica">O desconto vem da ata oficial cadastrada pela CLIC e incide só sobre composições de unidade física. Diárias e turnos não recebem desconto.</p>' +
      '<label>Ata de RP<select data-campo="ataId"' + dis + ">" + opAtas + "</select></label>" +
      (ata ? '<div class="ata-info"><b>ARP ' + esc(ata.numero) + "</b> · Lote " + ata.lote + " — " + esc(nomeLote(ata.lote)) +
        "<br>Fornecedor: " + esc(ata.fornecedor) + (ata.cnpj ? " · CNPJ " + esc(ata.cnpj) : "") + "<br>Desconto herdado: <b>" + pct(ata.desconto) + "</b>" +
        (ata.ativa === false ? ' · <b style="color:var(--vermelho)">ata desativada</b>' : "") + "</div>" : "") + "</div>" +

      (leitura ? "" : '<div class="card"><h2>3. Estruturas e composições</h2><p class="dica">Adicione uma estrutura-modelo e ajuste as quantidades, ou crie uma estrutura nova com composições do catálogo.</p>' +
        '<div class="linha-acoes"><label style="flex:1 1 320px">Estrutura-modelo<select id="sel-modelo">' + opModelos + "</select></label>" +
        '<button class="btn" data-acao="add-modelo">Adicionar estrutura-modelo</button><button class="btn sec" data-acao="add-vazia">Criar nova estrutura</button></div></div>') +
      '<div id="lista-estruturas"></div></div><aside class="resumo" id="resumo"></aside></div>';
    renderEstruturas();
  }
  function campo(rotulo, nome, ph, classe, tipo, dis) {
    return '<label class="' + (classe || "") + '">' + rotulo + '<input type="' + (tipo || "text") + '" data-campo="' + nome + '" value="' + esc(rascunho[nome]) +
      '" placeholder="' + esc(ph || "") + '"' + (tipo === "number" ? ' min="1" step="1"' : "") + (dis || "") + "></label>";
  }
  function calcularRascunho() { return FoliaCalc.calcularPedido(rascunho, acharAta(rascunho.ataId) || rascunho.ata || null, IDX, R); }

  function renderEstruturas() {
    var res = calcularRascunho();
    var leitura = !podeEditar(rascunho);
    var alvo = document.getElementById("lista-estruturas");
    alvo.innerHTML = rascunho.estruturas.length ? res.estruturas.map(function (r, ei) { return htmlEstrutura(r, ei, leitura); }).join("")
      : '<div class="card vazio">Nenhuma estrutura adicionada ainda.</div>';
    renderResumo(res, leitura);
  }

  function htmlEstrutura(r, ei, leitura) {
    var est = r.estrutura; var linhas = ""; var secaoAtual = null; var dis = leitura ? " disabled" : "";
    r.linhas.forEach(function (l, ii) {
      if ((l.item.secao || "") !== secaoAtual) { secaoAtual = l.item.secao || ""; if (secaoAtual) linhas += '<tr class="secao"><td colspan="11">' + esc(secaoAtual) + "</td></tr>"; }
      var c = l.calc, comp = l.comp;
      linhas += '<tr><td class="cod">' + esc(l.item.codigo) + "</td>" +
        '<td class="desc"' + (comp ? ' title="' + esc(comp.descricao) + '"' : "") + '><div class="clamp">' + (comp ? esc(comp.curta) : '<b style="color:var(--vermelho)">Código não encontrado no catálogo</b>') + "</div></td>" +
        "<td>" + (comp ? esc(comp.unidade) : "") + "</td>" +
        "<td>" + (comp ? '<span class="tag ' + comp.grupo_calculo + '">' + ({ I: "Física", II: "Tempo", PENDENTE: "Pendente" })[comp.grupo_calculo] + "</span>" : "") + "</td>" +
        '<td class="num"><input class="qtd" data-qtd="' + ei + ":" + ii + '" value="' + numCurto(l.item.quantidade) + '"' + dis + "></td>" +
        '<td class="num">' + (comp ? num(comp.valor_com_bdi) : "") + "</td>" +
        '<td class="num">' + (c && c.calculado ? pct(c.desconto) : "—") + "</td>" +
        '<td class="num">' + (c && c.calculado ? num(c.puContratado) : "—") + "</td>" +
        '<td class="num">' + (c && c.grupo === "I" ? c.unidades : c && c.grupo === "II" ? "diária" : "—") + "</td>" +
        '<td class="num"><b>' + (c && c.calculado ? num(c.valor) : "—") + "</b></td>" +
        "<td>" + (leitura ? "" : '<button class="btn perigo peq" title="Remover composição" data-acao="rem-item" data-ei="' + ei + '" data-ii="' + ii + '">✕</button>') + "</td></tr>";
    });
    return '<div class="estrutura card" style="padding:0"><div class="estrutura-topo">' +
      '<label class="nome">Nome da estrutura<input data-est-nome="' + ei + '" value="' + esc(est.nome) + '"' + dis + "></label>" +
      '<label>Qtd. desta estrutura<input type="number" min="1" step="1" style="width:110px" data-est-unid="' + ei + '" value="' + (est.unidades || 1) + '"' + dis + "></label>" +
      '<div class="subtotal">' + rs(r.subtotal) + "<small>" + r.linhas.length + " composições" + (r.multiplicador > 1 ? " · ×" + r.multiplicador : "") + "</small></div>" +
      '<button class="btn sec peq" data-acao="recolher" data-ei="' + ei + '">' + (est.recolhida ? "▸ Mostrar itens" : "▾ Recolher") + "</button>" +
      (leitura ? "" : '<button class="btn perigo peq" data-acao="rem-est" data-ei="' + ei + '">Remover</button>') + "</div>" +
      (est.recolhida ? "" : ((est.ausentes && est.ausentes.length ? '<div class="aviso" style="margin:10px 14px">Itens do orçamento original fora da tabela consolidada (não incluídos): ' +
        est.ausentes.map(function (a) { return esc(a.codigo); }).join(", ") + ".</div>" : "") +
        '<div class="rolagem"><table class="tabela"><thead><tr><th>Código</th><th>Descrição</th><th>Und</th><th>Tipo</th><th class="num">Quantidade</th><th class="num">PU ref. c/ BDI</th>' +
        '<th class="num">Desconto</th><th class="num">PU contratado</th><th class="num">Unidades</th><th class="num">Valor (R$)</th><th></th></tr></thead><tbody>' +
        (linhas || '<tr><td colspan="11" class="vazio">Sem composições.</td></tr>') + "</tbody></table></div>" +
        (leitura ? "" : '<div class="add-item"><button class="btn" data-acao="abrir-busca" data-ei="' + ei + '">＋ Adicionar composições</button>' +
          '<span class="dica-inline">Busque por palavra (ex.: "tomada", "toldo", "vigilante") ou pelo código.</span></div>'))) + "</div>";
  }

  function renderResumo(res, leitura) {
    var ata = acharAta(rascunho.ataId);
    var avisos = [];
    if (!ata && !leitura) avisos.push("Selecione a Ata de RP para herdar o desconto.");
    if (!(Number(rascunho.dias) >= 1)) avisos.push("Informe os dias de realização do evento.");
    if (res.pendentes) avisos.push(res.pendentes + " composição(ões) CHP/CHI com classificação pendente: não somadas.");
    if (res.estruturas.some(function (e) { return e.linhas.some(function (l) { return l.calc && l.calc.grupo === "II"; }); }))
      avisos.push("Itens de tempo (diárias/turnos): confira se a quantidade corresponde às diárias do evento.");
    var nIt = rascunho.estruturas.reduce(function (s, e) { return s + e.itens.length; }, 0);
    var passos = [["Identificação", !!(rascunho.orgao && rascunho.unidade && rascunho.evento && Number(rascunho.dias) >= 1)], ["Ata de RP", !!ata], ["Estruturas", nIt > 0]];
    var botoes = "";
    if (!leitura) {
      if (eu.perfil === "unidade") {
        botoes = '<button class="btn" data-acao="enviar">' + (rascunho.status === "enviado" ? "Salvar alterações (já enviado)" : "Enviar à CLIC") + "</button>" +
          (rascunho.status !== "enviado" ? '<button class="btn sec" data-acao="salvar">Salvar rascunho</button>' : "");
      } else botoes = '<button class="btn" data-acao="salvar">' + (rascunho.id ? "Salvar alterações" : "Salvar pedido") + "</button>";
    }
    botoes += '<button class="btn sec" data-acao="novo-pedido">' + (rascunho.id ? "Fechar / novo pedido" : "Limpar") + "</button>";
    if (rascunho.id) botoes += '<button class="btn sec" data-acao="xlsx-atual">Planilha de fiscalização</button>';

    document.getElementById("resumo").innerHTML = '<div class="card"><h2>Resumo do pedido</h2><div class="passos">' +
      passos.map(function (p, i) { return '<span class="passo' + (p[1] ? " feito" : "") + '">' + (p[1] ? "✓" : i + 1) + " " + p[0] + "</span>"; }).join("") + "</div><dl>" +
      "<dt>Desconto herdado</dt><dd>" + (ata ? pct(ata.desconto) : "—") + "</dd>" +
      "<dt>Dias informados</dt><dd>" + (Number(rascunho.dias) || 0) + "</dd>" +
      "<dt>Dias para medição</dt><dd>" + res.diasMedicao + "</dd>" +
      "<dt>Unidades (50 + dias + 35)</dt><dd>" + res.unidadesGrupoI + "</dd>" +
      "<dt>Estruturas</dt><dd>" + rascunho.estruturas.length + "</dd>" +
      "<dt>Grupo I — física</dt><dd>" + rs(res.totalI) + "</dd><dt>Grupo II — tempo</dt><dd>" + rs(res.totalII) + "</dd>" +
      '<dt class="total">Total do pedido</dt><dd class="total">' + rs(res.total) + "</dd></dl>" +
      avisos.map(function (a) { return '<div class="aviso">' + esc(a) + "</div>"; }).join("") +
      '<div class="linha-acoes" style="margin-top:12px">' + botoes + "</div></div>";
  }

  var abaPedido = document.getElementById("aba-pedido");
  abaPedido.addEventListener("change", function (e) {
    var t = e.target; if (!podeEditar(rascunho)) return;
    if (t.dataset.campo) {
      rascunho[t.dataset.campo] = t.dataset.campo === "dias" ? Math.max(0, parseInt(t.value, 10) || 0) : (t.dataset.campo === "unidade" ? t.value.trim().toUpperCase() : t.value);
      salvarRascunho(); if (t.dataset.campo === "ataId") renderPedido(); else renderEstruturas(); return;
    }
    if (t.dataset.qtd) { var p = t.dataset.qtd.split(":"); rascunho.estruturas[p[0]].itens[p[1]].quantidade = lerNumero(t.value); salvarRascunho(); renderEstruturas(); return; }
    if (t.dataset.estNome !== undefined) { rascunho.estruturas[t.dataset.estNome].nome = t.value; salvarRascunho(); return; }
    if (t.dataset.estUnid !== undefined) { rascunho.estruturas[t.dataset.estUnid].unidades = Math.max(1, parseInt(t.value, 10) || 1); salvarRascunho(); renderEstruturas(); }
  });
  abaPedido.addEventListener("click", function (e) {
    var b = e.target.closest("[data-acao]"); if (!b) return;
    var a = b.dataset.acao;
    if (a === "recolher") { var e2 = rascunho.estruturas[b.dataset.ei]; e2.recolhida = !e2.recolhida; salvarRascunho(); renderEstruturas(); return; }
    if (a === "novo-pedido") {
      if (!rascunho.id && rascunho.estruturas.length && !confirm("Limpar o formulário? O que não foi salvo será perdido.")) return;
      rascunho = novoRascunho(); salvarRascunho(); renderPedido(); return;
    }
    if (a === "xlsx-atual") { gerarPlanilhaFiscalizacao(rascunho); return; }
    if (!podeEditar(rascunho)) return;
    if (a === "add-modelo") {
      var m = D.modelos.filter(function (x) { return x.id === document.getElementById("sel-modelo").value; })[0];
      rascunho.estruturas.push({ uid: uid(), nome: m.nome, modeloId: m.id, unidades: 1, itens: clonar(m.itens), ausentes: clonar(m.ausentes) });
      salvarRascunho(); renderEstruturas(); toast("Estrutura " + m.nome + " adicionada.");
    } else if (a === "add-vazia") {
      rascunho.estruturas.push({ uid: uid(), nome: "Nova estrutura " + (rascunho.estruturas.length + 1), modeloId: null, unidades: 1, itens: [] });
      salvarRascunho(); renderEstruturas(); abrirBusca(rascunho.estruturas.length - 1);
    } else if (a === "rem-est") {
      if (confirm("Remover esta estrutura do pedido?")) { rascunho.estruturas.splice(Number(b.dataset.ei), 1); salvarRascunho(); renderEstruturas(); }
    } else if (a === "rem-item") {
      rascunho.estruturas[b.dataset.ei].itens.splice(Number(b.dataset.ii), 1); salvarRascunho(); renderEstruturas();
    } else if (a === "abrir-busca") abrirBusca(Number(b.dataset.ei));
    else if (a === "salvar") salvarPedido(false, b);
    else if (a === "enviar") salvarPedido(true, b);
  });

  function salvarPedido(enviar, botao) {
    var ata = acharAta(rascunho.ataId);
    var erros = [];
    if (!rascunho.orgao) erros.push("órgão");
    if (!rascunho.unidade) erros.push("unidade");
    if (!rascunho.evento) erros.push("evento");
    if (!(Number(rascunho.dias) >= 1)) erros.push("dias de realização");
    if (!ata) erros.push("Ata de RP");
    if (!rascunho.estruturas.reduce(function (s, e) { return s + e.itens.length; }, 0)) erros.push("ao menos uma composição");
    if (erros.length) return toast("Falta preencher: " + erros.join(", ") + ".");
    if (ata.ativa === false) return toast("A ata selecionada foi desativada pela CLIC. Escolha outra.");
    if (enviar && rascunho.status !== "enviado" && !confirm("Enviar o pedido à CLIC? Você ainda poderá editá-lo até a aprovação.")) return;

    var res = calcularRascunho();
    var p = clonar(rascunho);
    delete p.recolhida;
    p.estruturas.forEach(function (e) { delete e.recolhida; });
    var novo = !p.id;
    if (novo) {
      p.autorUid = eu.uid; p.autorNome = eu.nome; p.fiscais = [];
      p.numero = p.orgao + "-" + new Date().getFullYear() + "-" + uid().slice(-6).toUpperCase();
    }
    if (eu.perfil === "unidade") { p.orgao = eu.orgao; p.unidade = eu.unidade; p.status = enviar ? "enviado" : (p.status || "rascunho"); }
    else if (!p.status) p.status = "enviado";
    p.ata = { id: ata.id, numero: ata.numero, lote: ata.lote, fornecedor: ata.fornecedor, cnpj: ata.cnpj || "", desconto: ata.desconto };
    p.totais = { grupoI: res.totalI, grupoII: res.totalII, total: res.total };
    ocupado(botao, true);
    N.salvarPedido(p).then(function (id) {
      p.id = id;
      var i = pedidos.findIndex(function (x) { return x.id === id; });
      if (i >= 0) pedidos[i] = Object.assign(pedidos[i], p); else pedidos.push(p);
      rascunho = p; salvarRascunho();
      N.registrar(novo ? "pedido_criado" : (enviar ? "pedido_enviado" : "pedido_alterado"), p.numero, rs(res.total) + " · " + STATUS[p.status]);
      renderPedido();
      toast("Pedido " + p.numero + (enviar ? " enviado à CLIC" : " salvo") + ": " + rs(res.total));
    }, function (er) { toast("Não foi possível salvar: " + er.message); }).then(function () { ocupado(botao, false); });
  }

  // =====================================================================
  // JANELA DE BUSCA DE COMPOSIÇÕES
  // =====================================================================
  var busca = { ei: null, termo: "", grupo: "", tipo: "" };
  var modalEl = document.getElementById("modal");
  function abrirBusca(ei) {
    var est = rascunho.estruturas[ei];
    busca = { ei: ei, termo: "", grupo: "", tipo: "" };
    var secoes = [];
    est.itens.forEach(function (it) { if (it.secao && secoes.indexOf(it.secao) < 0) secoes.push(it.secao); });
    var opG = '<option value="">Todos os grupos</option>' + Object.keys(D.grupos).map(function (g) { return '<option value="' + g + '">' + esc(D.grupos[g]) + "</option>"; }).join("");
    modalEl.innerHTML = '<div class="modal-caixa" role="dialog" aria-modal="true">' +
      '<div class="modal-topo"><div><h2>Adicionar composições</h2><p class="dica" style="margin:0">Estrutura: <b>' + esc(est.nome) + "</b></p></div>" +
      '<button class="btn sec" data-acao="fechar-modal">Concluir</button></div>' +
      '<div class="filtros" style="padding:0 20px"><input id="m-busca" type="search" placeholder="Digite palavras ou código: ex. tomada 20a, toldo, SSP-DIV-003" autocomplete="off">' +
      '<select id="m-grupo">' + opG + '</select><select id="m-tipo"><option value="">Física e tempo</option><option value="I">Só física</option><option value="II">Só tempo</option></select>' +
      '<input id="m-secao" list="m-secoes" placeholder="Seção (opcional)" style="flex:0 1 220px"><datalist id="m-secoes">' +
      secoes.map(function (s) { return '<option value="' + esc(s) + '">'; }).join("") + "</datalist></div>" +
      '<p class="dica" id="m-cont" style="padding:0 20px;margin:4px 0 8px"></p><div id="m-res" class="m-res"></div></div>';
    modalEl.dataset.tipo = "busca";
    modalEl.classList.add("aberto"); document.body.style.overflow = "hidden";
    desenharBusca(); setTimeout(function () { document.getElementById("m-busca").focus(); }, 30);
  }
  function fecharModal() {
    var tipo = modalEl.dataset.tipo;
    modalEl.classList.remove("aberto"); modalEl.innerHTML = ""; document.body.style.overflow = "";
    if (tipo === "busca") renderEstruturas();
  }
  function desenharBusca() {
    var est = rascunho.estruturas[busca.ei]; var ja = {};
    est.itens.forEach(function (it) { ja[it.codigo] = (ja[it.codigo] || 0) + (Number(it.quantidade) || 0); });
    var partes = normalizarTexto(busca.termo.trim()).split(/\s+/).filter(Boolean);
    var lista = D.itens.filter(function (i) {
      return (!busca.grupo || i.grupo === busca.grupo) && (!busca.tipo || i.grupo_calculo === busca.tipo) && partes.every(function (p) { return i.busca.indexOf(p) >= 0; });
    });
    var max = 60;
    document.getElementById("m-cont").textContent = lista.length + " composições encontradas" + (lista.length > max ? " — mostrando as " + max + " primeiras; refine a busca." : "");
    document.getElementById("m-res").innerHTML = lista.slice(0, max).map(function (i) {
      return '<div class="m-item' + (ja[i.codigo] ? " ja" : "") + '"><div class="m-info"><div class="m-linha1"><span class="cod">' + esc(i.codigo) + '</span><span class="tag ' + i.grupo_calculo + '">' +
        ({ I: "Física", II: "Tempo", PENDENTE: "Pendente" })[i.grupo_calculo] + '</span><span class="m-grupo">' + esc(D.grupos[i.grupo] || "") + "</span>" +
        (ja[i.codigo] ? '<span class="tag I">já na estrutura: ' + numCurto(ja[i.codigo]) + "</span>" : "") + "</div>" +
        '<div class="m-desc" title="' + esc(i.descricao) + '">' + esc(i.curta) + '</div></div><div class="m-preco"><b>' + rs(i.valor_com_bdi) + "</b><small>por " + esc(i.unidade) + "</small></div>" +
        '<input class="qtd" inputmode="decimal" placeholder="Qtd (' + esc(i.unidade) + ')" data-mq="' + esc(i.codigo) + '">' +
        '<button class="btn peq" data-acao="m-add" data-cod="' + esc(i.codigo) + '">Adicionar</button></div>';
    }).join("") || '<div class="vazio">Nenhuma composição encontrada. Tente outra palavra.</div>';
  }
  function adicionarDaBusca(cod) {
    var campoQ = modalEl.querySelector('[data-mq="' + cod + '"]'); var qtd = lerNumero(campoQ.value);
    if (!(qtd > 0)) { campoQ.focus(); return toast("Informe a quantidade antes de adicionar."); }
    var sec = (document.getElementById("m-secao").value || "").trim().toUpperCase() || "COMPOSIÇÕES ADICIONADAS";
    rascunho.estruturas[busca.ei].itens.push({ secao: sec, codigo: cod, quantidade: qtd });
    salvarRascunho(); renderEstruturas(); desenharBusca();
    toast(cod + " adicionada (" + numCurto(qtd) + " " + IDX[cod].unidade + ").");
    var b = document.getElementById("m-busca"); b.focus(); b.select();
  }
  modalEl.addEventListener("input", function (e) { if (e.target.id === "m-busca") { busca.termo = e.target.value; desenharBusca(); } });
  modalEl.addEventListener("change", function (e) {
    if (e.target.id === "m-grupo") { busca.grupo = e.target.value; desenharBusca(); }
    if (e.target.id === "m-tipo") { busca.tipo = e.target.value; desenharBusca(); }
  });
  modalEl.addEventListener("click", function (e) {
    if (e.target === modalEl) return fecharModal();
    var b = e.target.closest("[data-acao]"); if (!b) return;
    if (b.dataset.acao === "fechar-modal") fecharModal();
    else if (b.dataset.acao === "m-add") adicionarDaBusca(b.dataset.cod);
    else if (b.dataset.acao === "gerir-salvar") salvarGestao(b);
  });
  modalEl.addEventListener("keydown", function (e) {
    if (e.key === "Escape") fecharModal();
    if (e.key === "Enter" && e.target.dataset.mq) { e.preventDefault(); adicionarDaBusca(e.target.dataset.mq); }
    if (e.key === "Enter" && e.target.id === "m-busca") { e.preventDefault(); var q = modalEl.querySelector("[data-mq]"); if (q) q.focus(); }
  });

  // =====================================================================
  // ABA: PEDIDOS
  // =====================================================================
  var filtroPedidos = { status: "", texto: "" };
  function calcularSalvo(p) { return FoliaCalc.calcularPedido(p, p.ata, IDX, R); }

  function renderPedidos() {
    var el = document.getElementById("aba-pedidos");
    var termo = normalizarTexto(filtroPedidos.texto.trim());
    var lista = pedidos.filter(function (p) {
      return (!filtroPedidos.status || p.status === filtroPedidos.status) &&
        (!termo || normalizarTexto([p.numero, p.orgao, p.unidade, p.evento, p.municipio, p.ata && p.ata.numero].join(" ")).indexOf(termo) >= 0);
    }).sort(function (a, b) { return String(b.numero).localeCompare(String(a.numero)); });
    var linhas = lista.map(function (p) {
      var r = calcularSalvo(p);
      var acoes = '<button class="btn sec peq" data-acao="abrir" data-id="' + p.id + '">' + (podeEditar(p) ? "Abrir / editar" : "Ver") + "</button>" +
        '<button class="btn peq" data-acao="xlsx" data-id="' + p.id + '">Planilha</button>';
      if (eu.perfil === "gestor") acoes += '<button class="btn sec peq" data-acao="gerir" data-id="' + p.id + '">Gerir</button>';
      if ((eu.perfil === "gestor") || (eu.perfil === "unidade" && p.autorUid === eu.uid && p.status === "rascunho"))
        acoes += '<button class="btn perigo peq" data-acao="excluir" data-id="' + p.id + '">Excluir</button>';
      return '<tr><td class="cod">' + esc(p.numero) + "</td><td>" + selStatus(p.status) + "</td><td>" + esc(p.orgao) + " / " + esc(p.unidade) +
        '<br><small style="color:var(--suave)">' + esc(p.autorNome || "") + "</small></td><td>" + esc(p.evento) + (p.municipio ? '<br><small style="color:var(--suave)">' + esc(p.municipio) + "</small>" : "") +
        "</td><td>ARP " + esc(p.ata.numero) + " · L" + p.ata.lote + '</td><td class="num">' + p.dias + '</td><td class="num"><b>' + num(r.total) + "</b></td>" +
        "<td>" + (p.os && p.os.numero ? esc(p.os.numero) : "—") + '</td><td><div class="linha-acoes">' + acoes + "</div></td></tr>";
    }).join("");
    var opSt = '<option value="">Todas as situações</option>' + Object.keys(STATUS).map(function (s) { return '<option value="' + s + '"' + (filtroPedidos.status === s ? " selected" : "") + ">" + STATUS[s] + "</option>"; }).join("");
    el.innerHTML = '<div class="card"><h2>' + esc(abasDoPerfil().filter(function (a) { return a[0] === "pedidos"; })[0][1]) + "</h2>" +
      '<p class="dica">' + ({
        unidade: "Pedidos da sua unidade. Só o autor edita, e apenas até a aprovação da CLIC. Os colegas da unidade veem os pedidos em modo leitura.",
        gestor: "Todos os pedidos. Use \"Gerir\" para aprovar, emitir a OS, designar fiscais e mudar a situação.",
        fiscal: "Pedidos para os quais você foi designado como fiscal.", consulta: "Todos os pedidos, somente leitura."
      })[eu.perfil] + "</p>" +
      '<div class="filtros"><input id="fp-texto" type="search" placeholder="Buscar por número, órgão, evento, município ou ata" value="' + esc(filtroPedidos.texto) + '">' +
      '<select id="fp-status">' + opSt + '</select><button class="btn sec" data-acao="recarregar">Atualizar lista</button></div>' +
      (lista.length ? '<div class="rolagem" style="max-height:none"><table class="tabela"><thead><tr><th>Nº</th><th>Situação</th><th>Órgão / unidade</th><th>Evento</th><th>Ata</th><th class="num">Dias</th><th class="num">Total (R$)</th><th>OS</th><th>Ações</th></tr></thead><tbody>' +
        linhas + "</tbody></table></div>" : '<div class="vazio">Nenhum pedido encontrado.</div>') + "</div>";
  }
  var abaPedidos = document.getElementById("aba-pedidos");
  abaPedidos.addEventListener("input", function (e) { if (e.target.id === "fp-texto") { filtroPedidos.texto = e.target.value; renderPedidosMantendoFoco("fp-texto"); } });
  abaPedidos.addEventListener("change", function (e) { if (e.target.id === "fp-status") { filtroPedidos.status = e.target.value; renderPedidos(); } });
  function renderPedidosMantendoFoco(id) { var pos = document.getElementById(id).selectionStart; renderPedidos(); var c = document.getElementById(id); c.focus(); c.setSelectionRange(pos, pos); }
  abaPedidos.addEventListener("click", function (e) {
    var b = e.target.closest("[data-acao]"); if (!b) return;
    var p = pedidos.filter(function (x) { return x.id === b.dataset.id; })[0];
    var a = b.dataset.acao;
    if (a === "recarregar") { carregarDados().then(renderPedidos); return; }
    if (a === "abrir") { rascunho = clonar(p); salvarRascunho(); if (abasDoPerfil().some(function (x) { return x[0] === "pedido"; })) abrirAba("pedido"); else abrirVisualizacao(p); }
    else if (a === "xlsx") gerarPlanilhaFiscalizacao(p);
    else if (a === "gerir") abrirGestao(p);
    else if (a === "excluir") {
      if (!confirm("Excluir o pedido " + p.numero + "? Esta ação não pode ser desfeita.")) return;
      N.excluirPedido(p.id).then(function () {
        pedidos = pedidos.filter(function (x) { return x.id !== p.id; }); N.registrar("pedido_excluido", p.numero, ""); renderPedidos(); toast("Pedido excluído.");
      }, function (er) { toast(er.message); });
    }
  });
  // Fiscal e consulta não têm a aba de edição: mostram o pedido numa janela
  function abrirVisualizacao(p) {
    var r = calcularSalvo(p);
    modalEl.dataset.tipo = "ver";
    modalEl.innerHTML = '<div class="modal-caixa"><div class="modal-topo"><div><h2>Pedido ' + esc(p.numero) + "</h2><p class=\"dica\" style=\"margin:0\">" + selStatus(p.status) + " · " +
      esc(p.orgao) + " / " + esc(p.unidade) + " · " + esc(p.evento) + " · " + p.dias + " dia(s) · ARP " + esc(p.ata.numero) + " · total " + rs(r.total) + "</p></div>" +
      '<button class="btn sec" data-acao="fechar-modal">Fechar</button></div><div class="m-res">' +
      r.estruturas.map(function (e) {
        return "<h3>" + esc(e.estrutura.nome) + (e.multiplicador > 1 ? " ×" + e.multiplicador : "") + " — " + rs(e.subtotal) + '</h3><table class="tabela"><thead><tr><th>Código</th><th>Descrição</th><th>Und</th><th class="num">Qtd</th><th class="num">Valor</th></tr></thead><tbody>' +
          e.linhas.map(function (l) { return l.comp ? '<tr><td class="cod">' + esc(l.item.codigo) + '</td><td class="desc"><div class="clamp">' + esc(l.comp.curta) + "</div></td><td>" + esc(l.comp.unidade) + '</td><td class="num">' + numCurto(l.calc.quantidade) + '</td><td class="num">' + num(l.calc.valor) + "</td></tr>" : ""; }).join("") + "</tbody></table>";
      }).join("") + "</div></div>";
    modalEl.classList.add("aberto"); document.body.style.overflow = "hidden";
  }

  // ---------- gestão do pedido (gestor) ----------
  var pedidoEmGestao = null;
  function abrirGestao(p) {
    pedidoEmGestao = p;
    var fiscais = usuarios.filter(function (u) { return u.perfil === "fiscal" && u.ativo; });
    modalEl.dataset.tipo = "gestao";
    modalEl.innerHTML = '<div class="modal-caixa" style="width:min(720px,100%)"><div class="modal-topo"><div><h2>Gerir pedido ' + esc(p.numero) + '</h2><p class="dica" style="margin:0">' +
      esc(p.orgao) + " / " + esc(p.unidade) + " · " + esc(p.evento) + " · " + rs(calcularSalvo(p).total) + "</p></div>" +
      '<button class="btn sec" data-acao="fechar-modal">Cancelar</button></div><div class="m-res"><div class="grade">' +
      '<label>Situação<select id="g-status">' + Object.keys(STATUS).map(function (s) { return '<option value="' + s + '"' + (p.status === s ? " selected" : "") + ">" + STATUS[s] + "</option>"; }).join("") + "</select></label>" +
      '<label>Nº da OS<input id="g-os" value="' + esc(p.os && p.os.numero || "") + '" placeholder="Ex.: 015/2027"></label>' +
      '<label>Data da OS<input id="g-os-data" type="date" value="' + esc(p.os && p.os.data || "") + '"></label>' +
      '<label>Nº do contrato (opcional)<input id="g-contrato" value="' + esc(p.contrato || "") + '"></label></div>' +
      '<h3 style="margin:16px 0 6px;font-size:.95rem">Fiscais designados</h3>' +
      (fiscais.length ? '<div class="checks">' + fiscais.map(function (u) {
        return '<label><input type="checkbox" class="g-fiscal" value="' + u.uid + '"' + ((p.fiscais || []).indexOf(u.uid) >= 0 ? " checked" : "") + "> " + esc(u.nome) + " <small>(" + esc(u.orgao || "") + ")</small></label>";
      }).join("") + "</div>" : '<p class="dica">Nenhum usuário com perfil "Fiscal" ativo. Defina o perfil na aba Usuários.</p>') +
      '<p class="dica" style="margin-top:10px">Ao marcar "Aprovado — OS emitida", a unidade deixa de poder editar o pedido.</p>' +
      '<div class="linha-acoes"><button class="btn" data-acao="gerir-salvar">Salvar</button></div></div></div>';
    modalEl.classList.add("aberto"); document.body.style.overflow = "hidden";
  }
  function salvarGestao(botao) {
    var p = pedidoEmGestao;
    var campos = {
      status: document.getElementById("g-status").value,
      os: { numero: document.getElementById("g-os").value.trim(), data: document.getElementById("g-os-data").value },
      contrato: document.getElementById("g-contrato").value.trim(),
      fiscais: Array.prototype.map.call(modalEl.querySelectorAll(".g-fiscal:checked"), function (c) { return c.value; })
    };
    if (campos.status === "aprovado" && !campos.os.numero) return toast("Informe o número da OS para aprovar.");
    ocupado(botao, true);
    N.atualizarPedido(p.id, campos).then(function () {
      Object.assign(p, campos);
      N.registrar("pedido_gestao", p.numero, STATUS[campos.status] + (campos.os.numero ? " · OS " + campos.os.numero : "") + " · fiscais: " + campos.fiscais.map(nomeUsuario).join(", "));
      fecharModal(); renderPedidos(); toast("Pedido " + p.numero + " atualizado.");
    }, function (er) { toast(er.message); ocupado(botao, false); });
  }

  // =====================================================================
  // ABA: CONSOLIDAÇÃO
  // =====================================================================
  function consolidar() {
    var grupos = {};
    pedidos.filter(function (p) { return CONTA_NO_SAQUE.indexOf(p.status) >= 0; }).forEach(function (p) {
      var r = calcularSalvo(p); var k = p.ata.id;
      if (!grupos[k]) grupos[k] = { ata: p.ata, n: 0, I: 0, II: 0, total: 0, porStatus: {} };
      var g = grupos[k]; g.n++;
      g.I = FoliaCalc.arred(g.I + r.totalI); g.II = FoliaCalc.arred(g.II + r.totalII); g.total = FoliaCalc.arred(g.total + r.total);
      g.porStatus[p.status] = FoliaCalc.arred((g.porStatus[p.status] || 0) + r.total);
    });
    return grupos;
  }
  function renderConsolidacao() {
    var el = document.getElementById("aba-consolidacao"); var grupos = consolidar(); var total = 0;
    var linhas = Object.keys(grupos).map(function (k) {
      var g = grupos[k]; var ataCad = acharAta(k); var reg = ataCad && ataCad.valorRegistrado ? ataCad.valorRegistrado : null; total = FoliaCalc.arred(total + g.total);
      return "<tr><td>ARP " + esc(g.ata.numero) + "</td><td>" + g.ata.lote + " — " + esc(nomeLote(g.ata.lote)) + "</td><td>" + esc(g.ata.fornecedor) + '</td><td class="num">' + pct(g.ata.desconto) +
        '</td><td class="num">' + g.n + '</td><td class="num">' + num(g.porStatus.enviado || 0) + '</td><td class="num">' + num((g.porStatus.aprovado || 0) + (g.porStatus.em_fiscalizacao || 0) + (g.porStatus.encerrado || 0)) +
        '</td><td class="num"><b>' + num(g.total) + '</b></td><td class="num">' + (reg ? num(reg) : "—") + '</td><td class="num">' + (reg ? num(reg - g.total) : "—") + "</td></tr>";
    }).join("");
    el.innerHTML = '<div class="card"><h2>Consolidação por Ata de RP</h2><p class="dica">Valor a ser sacado de cada ata. Somam os pedidos enviados, aprovados, em fiscalização e encerrados; rascunhos e cancelados ficam de fora.</p>' +
      '<div class="linha-acoes" style="margin-bottom:12px"><button class="btn" data-acao="xlsx-consolidado">Baixar consolidado (.xlsx)</button></div>' +
      (linhas ? '<div class="rolagem" style="max-height:none"><table class="tabela"><thead><tr><th>Ata</th><th>Lote</th><th>Fornecedor</th><th class="num">Desconto</th><th class="num">Pedidos</th><th class="num">Aguardando aprovação</th><th class="num">Aprovado (OS)</th><th class="num">Total a sacar</th><th class="num">Valor registrado</th><th class="num">Saldo</th></tr></thead><tbody>' +
        linhas + '<tr><td colspan="7"><b>Total geral</b></td><td class="num"><b>' + num(total) + "</b></td><td></td><td></td></tr></tbody></table></div>" : '<div class="vazio">Nenhum pedido enviado ainda.</div>') + "</div>";
  }
  document.getElementById("aba-consolidacao").addEventListener("click", function (e) { if (e.target.closest('[data-acao="xlsx-consolidado"]')) gerarConsolidado(); });

  // =====================================================================
  // ABA: ATAS (gestor)
  // =====================================================================
  function renderAtas() {
    var el = document.getElementById("aba-atas");
    var opLotes = D.lotes.map(function (l) { return '<option value="' + l.lote + '">Lote ' + String(l.lote).padStart(2, "0") + " — " + esc(l.nome) + "</option>"; }).join("");
    var lista = atas.slice().sort(function (a, b) { return a.lote - b.lote; }).map(function (a) {
      return "<tr" + (a.ativa === false ? ' style="opacity:.55"' : "") + "><td>ARP " + esc(a.numero) + "</td><td>" + a.lote + " — " + esc(nomeLote(a.lote)) + "</td><td>" + esc(a.fornecedor) + "</td><td>" + esc(a.cnpj || "") +
        '</td><td class="num">' + pct(a.desconto) + '</td><td class="num">' + (a.valorRegistrado ? num(a.valorRegistrado) : "—") + "</td><td>" + (a.ativa === false ? "Desativada" : "Ativa") +
        '</td><td><button class="btn sec peq" data-acao="alternar-ata" data-id="' + a.id + '">' + (a.ativa === false ? "Reativar" : "Desativar") + "</button></td></tr>";
    }).join("");
    el.innerHTML = '<div class="card"><h2>Cadastrar Ata de RP oficial</h2><p class="dica">As unidades só escolhem a ata; o desconto vem daqui. Lance o desconto exatamente como homologado, com 2 casas decimais (TR 5.6.1.4). O banco recusa pedidos cujo desconto não confira com a ata.</p>' +
      '<div class="grade"><label>Nº da ARP<input id="ata-numero" placeholder="Ex.: 012/2027"></label><label class="largo">Lote<select id="ata-lote">' + opLotes + "</select></label>" +
      '<label class="largo">Fornecedor<input id="ata-fornecedor" placeholder="Razão social"></label><label>CNPJ<input id="ata-cnpj" placeholder="00.000.000/0000-00"></label>' +
      '<label>Desconto (%)<input id="ata-desconto" placeholder="Ex.: 12,35"></label><label>Valor registrado (R$, opcional)<input id="ata-valor" placeholder="Para cálculo de saldo"></label></div>' +
      '<div class="linha-acoes" style="margin-top:12px"><button class="btn" data-acao="add-ata">Cadastrar ata</button></div></div>' +
      '<div class="card"><h2>Atas cadastradas</h2>' + (lista ? '<div class="rolagem" style="max-height:none"><table class="tabela"><thead><tr><th>Ata</th><th>Lote</th><th>Fornecedor</th><th>CNPJ</th><th class="num">Desconto</th><th class="num">Valor registrado</th><th>Situação</th><th></th></tr></thead><tbody>' + lista + "</tbody></table></div>"
        : '<div class="vazio">Nenhuma ata cadastrada.</div>') + "<p class=\"dica\" style=\"margin-top:10px\">Atas não são apagadas, apenas desativadas, para preservar o histórico dos pedidos. Para corrigir um desconto lançado errado, desative a ata e cadastre outra.</p></div>";
  }
  document.getElementById("aba-atas").addEventListener("click", function (e) {
    var b = e.target.closest("[data-acao]"); if (!b) return;
    if (b.dataset.acao === "add-ata") {
      var v = function (id) { return document.getElementById(id).value.trim(); };
      if (!v("ata-numero") || !v("ata-fornecedor")) return toast("Informe o número da ARP e o fornecedor.");
      if (v("ata-desconto") === "") return toast("Informe o desconto.");
      var descPct = lerNumero(v("ata-desconto"));
      if (!(descPct >= 0 && descPct < 100)) return toast("Desconto inválido. Use valores como 12,35.");
      descPct = Math.trunc(descPct * 100 + 1e-9) / 100; // casas além da 2ª são desconsideradas (TR 5.6.1.5)
      var ata = { numero: v("ata-numero"), lote: Number(v("ata-lote")), fornecedor: v("ata-fornecedor"), cnpj: v("ata-cnpj"),
        desconto: Math.round(descPct * 100) / 10000, valorRegistrado: lerNumero(v("ata-valor")) || null, ativa: true };
      if (!confirm("Confirma a ata " + ata.numero + ", lote " + ata.lote + ", com desconto de " + pct(ata.desconto) + "?")) return;
      ocupado(b, true);
      N.salvarAta(ata).then(function (id) { ata.id = id; atas.push(ata); N.registrar("ata_cadastrada", "ARP " + ata.numero, "Lote " + ata.lote + " · " + pct(ata.desconto)); renderAtas(); toast("Ata cadastrada."); },
        function (er) { toast(er.message); ocupado(b, false); });
    } else if (b.dataset.acao === "alternar-ata") {
      var a = acharAta(b.dataset.id); var nova = Object.assign({}, a, { ativa: a.ativa === false });
      N.salvarAta(nova).then(function () { a.ativa = nova.ativa; N.registrar(nova.ativa ? "ata_reativada" : "ata_desativada", "ARP " + a.numero, ""); renderAtas(); }, function (er) { toast(er.message); });
    }
  });

  // =====================================================================
  // ABA: USUÁRIOS (gestor)
  // =====================================================================
  function renderUsuarios() {
    var el = document.getElementById("aba-usuarios");
    var lista = usuarios.slice().sort(function (a, b) { return (a.ativo === b.ativo ? 0 : a.ativo ? 1 : -1) || String(a.nome).localeCompare(b.nome); });
    var pend = lista.filter(function (u) { return !u.ativo; }).length;
    el.innerHTML = '<div class="card"><h2>Usuários</h2><p class="dica">Aprove cadastros, defina o perfil e corrija órgão e unidade. Usuários da mesma unidade (mesmo texto) veem os pedidos uns dos outros. ' +
      (pend ? "<b>" + pend + " cadastro(s) aguardando aprovação.</b>" : "") + '</p><div class="linha-acoes" style="margin-bottom:10px"><button class="btn sec" data-acao="recarregar-usuarios">Atualizar lista</button></div>' +
      '<div class="rolagem" style="max-height:none"><table class="tabela"><thead><tr><th>Nome</th><th>E-mail</th><th>Órgão</th><th>Unidade</th><th>Perfil</th><th>Ativo</th><th></th></tr></thead><tbody>' +
      lista.map(function (u) {
        var proprio = u.uid === eu.uid;
        return '<tr class="' + (u.ativo ? "" : "pendente") + '"><td>' + esc(u.nome) + (proprio ? " <small>(você)</small>" : "") + "</td><td>" + esc(u.email) + "</td>" +
          '<td><select data-u="' + u.uid + '" data-f="orgao">' + opOrgaos(u.orgao) + "</select></td>" +
          '<td><input data-u="' + u.uid + '" data-f="unidade" value="' + esc(u.unidade || "") + '" style="width:150px"></td>' +
          '<td><select data-u="' + u.uid + '" data-f="perfil"' + (proprio ? " disabled" : "") + ">" + Object.keys(PERFIS).map(function (p) { return '<option value="' + p + '"' + (u.perfil === p ? " selected" : "") + ">" + PERFIS[p] + "</option>"; }).join("") + "</select></td>" +
          '<td><input type="checkbox" data-u="' + u.uid + '" data-f="ativo"' + (u.ativo ? " checked" : "") + (proprio ? " disabled" : "") + "></td>" +
          '<td><button class="btn peq" data-acao="salvar-usuario" data-u="' + u.uid + '">Salvar</button></td></tr>';
      }).join("") + "</tbody></table></div></div>";
  }
  document.getElementById("aba-usuarios").addEventListener("click", function (e) {
    var b = e.target.closest("[data-acao]"); if (!b) return;
    if (b.dataset.acao === "recarregar-usuarios") { N.listarUsuarios().then(function (l) { usuarios = l; renderUsuarios(); }); return; }
    var id = b.dataset.u; var u = usuarios.filter(function (x) { return x.uid === id; })[0];
    var campo = function (f) { return document.querySelector('[data-u="' + id + '"][data-f="' + f + '"]'); };
    var campos = { orgao: campo("orgao").value, unidade: campo("unidade").value.trim().toUpperCase(), perfil: campo("perfil").value, ativo: campo("ativo").checked };
    ocupado(b, true);
    N.atualizarUsuario(id, campos).then(function () {
      Object.assign(u, campos); N.registrar("usuario_alterado", u.email, PERFIS[campos.perfil] + " · " + (campos.ativo ? "ativo" : "inativo") + " · " + campos.orgao + "/" + campos.unidade);
      renderUsuarios(); toast("Usuário " + u.nome + " atualizado.");
    }, function (er) { toast(er.message); ocupado(b, false); });
  });

  // =====================================================================
  // ABA: HISTÓRICO (gestor)
  // =====================================================================
  var ACOES = { pedido_criado: "Pedido criado", pedido_enviado: "Pedido enviado", pedido_alterado: "Pedido alterado", pedido_gestao: "Gestão do pedido", pedido_excluido: "Pedido excluído",
    ata_cadastrada: "Ata cadastrada", ata_desativada: "Ata desativada", ata_reativada: "Ata reativada", usuario_alterado: "Usuário alterado" };
  function renderHistorico() {
    var el = document.getElementById("aba-historico");
    el.innerHTML = '<div class="card"><h2>Histórico de alterações</h2><p class="dica">Últimos 200 registros. O histórico não pode ser editado nem apagado.</p><div id="hist-corpo" class="vazio">Carregando…</div></div>';
    N.listarAuditoria(200).then(function (l) {
      document.getElementById("hist-corpo").outerHTML = l.length ? '<div class="rolagem" style="max-height:none"><table class="tabela"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Alvo</th><th>Detalhe</th></tr></thead><tbody>' +
        l.map(function (h) { return "<tr><td>" + dataHora(h.em) + "</td><td>" + esc(h.nome) + "</td><td>" + esc(ACOES[h.acao] || h.acao) + '</td><td class="cod">' + esc(h.alvo) + "</td><td>" + esc(h.detalhe) + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : '<div class="vazio">Sem registros.</div>';
    }, function (er) { document.getElementById("hist-corpo").textContent = er.message; });
  }

  // =====================================================================
  // ABA: CATÁLOGO
  // =====================================================================
  function renderCatalogo() {
    var el = document.getElementById("aba-catalogo");
    var opG = '<option value="">Todos os grupos</option>' + Object.keys(D.grupos).map(function (g) { return '<option value="' + g + '">' + g + " — " + esc(D.grupos[g]) + "</option>"; }).join("");
    el.innerHTML = '<div class="card"><h2>Catálogo de composições</h2><p class="dica">' + esc(D.meta.fonte) + " · BDI " + pct(D.meta.bdi) + " · Data-base: " + esc(D.meta.data_base) + "</p>" +
      '<div class="filtros"><input id="cat-busca" type="search" placeholder="Buscar por palavras ou código" value="' + esc(buscaCatalogo.termo) + '"><select id="cat-grupo">' + opG + "</select>" +
      '<select id="cat-calc"><option value="">Todos os tipos</option><option value="I">Física (com desconto)</option><option value="II">Tempo (sem desconto)</option><option value="PENDENTE">Pendente</option></select></div>' +
      '<p class="dica" id="cat-cont"></p><div class="rolagem" style="max-height:640px"><table class="tabela"><thead><tr><th>Código</th><th>Descrição</th><th>Und</th><th class="num">Sem BDI</th><th class="num">Com BDI</th><th>Tipo</th></tr></thead><tbody id="cat-linhas"></tbody></table></div></div>';
    document.getElementById("cat-grupo").value = buscaCatalogo.grupo; document.getElementById("cat-calc").value = buscaCatalogo.calculo;
    desenharCatalogo();
  }
  function desenharCatalogo() {
    var partes = normalizarTexto(buscaCatalogo.termo.trim()).split(/\s+/).filter(Boolean);
    var f = D.itens.filter(function (i) {
      return (!buscaCatalogo.grupo || i.grupo === buscaCatalogo.grupo) && (!buscaCatalogo.calculo || i.grupo_calculo === buscaCatalogo.calculo) && partes.every(function (p) { return i.busca.indexOf(p) >= 0; });
    });
    document.getElementById("cat-cont").textContent = f.length + " de " + D.itens.length + " composições";
    document.getElementById("cat-linhas").innerHTML = f.map(function (i) {
      return '<tr><td class="cod">' + esc(i.codigo) + '</td><td class="desc" title="' + esc(i.descricao) + '"><div class="clamp">' + esc(i.curta) + "</div></td><td>" + esc(i.unidade) + '</td><td class="num">' + num(i.valor_sem_bdi) +
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
  function montarAba(linhas, larguras) {
    var ws = {}; var maxC = 0;
    linhas.forEach(function (linha, r) {
      (linha || []).forEach(function (cel, c) {
        if (cel === null || cel === undefined || cel === "") return;
        var o = (typeof cel === "object") ? cel : { v: cel };
        var celula = { v: o.v === undefined ? 0 : o.v, t: (typeof o.v === "number" || o.f) ? "n" : "s" };
        if (typeof o.v === "string" && !o.f) celula.t = "s";
        if (o.f) celula.f = o.f; if (o.z) celula.z = o.z;
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
    var osNum = p.os && p.os.numero ? p.os.numero : "____/" + new Date().getFullYear();
    var nomesFiscais = (p.fiscais || []).map(nomeUsuario).filter(Boolean).join(", ");

    var L2 = [["PLANILHA ORÇAMENTÁRIA — OS nº " + osNum + " — Pedido " + p.numero], ["ARP " + p.ata.numero + " · Lote " + p.ata.lote + " · " + p.ata.fornecedor + " · Desconto " + pct(p.ata.desconto)],
      ["Dias de realização informados: " + p.dias + " · Dias para medição: " + r.diasMedicao + " (mínimo 3, TR 7.1.1.1.2.7)"], [],
      ["GRUPO I — Unidade de fornecimento por diárias equivalentes (m, m², m³, kit, un etc.)"],
      ["Estrutura", "Seção", "Código", "Descrição", "Und", "Quantidade", "PU referencial c/ BDI", "Desconto", "PU contratado (PC)", "Valor total do item (Q×PC)", "DC (Valor ÷ 100)", "Dias (DE)", "Mob./Desm. (MD)", "Unidades (DE+MD)", "Subtotal (DC × Unidades)"]];
    var iniI = L2.length; var itensFisc = [];
    r.estruturas.forEach(function (e) {
      e.linhas.forEach(function (l) {
        if (!l.calc || l.calc.grupo !== "I") return;
        var n = L2.length + 1; var c = l.calc;
        L2.push([e.estrutura.nome + (e.multiplicador > 1 ? " (×" + e.multiplicador + ")" : ""), l.item.secao || "", l.item.codigo, l.comp.descricao, l.comp.unidade,
          { v: c.quantidade, z: "#,##0.00" }, { v: c.puReferencial, z: M }, { v: c.desconto, z: P }, { v: c.puContratado, f: "ROUND(G" + n + "*(1-H" + n + "),2)", z: M },
          { v: c.valorTotalItem, f: "ROUND(F" + n + "*I" + n + ",2)", z: M }, { v: c.valorTotalItem / 100, f: "J" + n + "/100", z: "#,##0.0000" }, r.diasMedicao, R.mobilizacao + R.desmobilizacao,
          { v: c.unidades, f: "L" + n + "+M" + n }, { v: c.valor, f: "ROUND(K" + n + "*N" + n + ",2)", z: M }]);
        itensFisc.push({ est: e.estrutura.nome, l: l, ref: "'2-Planilha Orçamentária'!O" + n });
      });
    });
    var fimI = L2.length;
    L2.push(["TOTAL GRUPO I", "", "", "", "", "", "", "", "", "", "", "", "", "", { v: r.totalI, f: fimI > iniI ? "SUM(O" + (iniI + 1) + ":O" + fimI + ")" : "0", z: M }]);
    var linTotI = L2.length;
    L2.push([], ["GRUPO II — Unidade de fornecimento por intervalo de tempo (diárias, turnos) — sem desconto"], ["Estrutura", "Seção", "Código", "Descrição", "Und", "Quantidade", "Preço referencial", "Desconto", "Preço contratado", "Valor"]);
    var iniII = L2.length;
    r.estruturas.forEach(function (e) {
      e.linhas.forEach(function (l) {
        if (!l.calc || l.calc.grupo !== "II") return;
        var n = L2.length + 1; var c = l.calc;
        L2.push([e.estrutura.nome, l.item.secao || "", l.item.codigo, l.comp.descricao, l.comp.unidade, { v: c.quantidade, z: "#,##0.00" }, { v: c.puReferencial, z: M }, { v: c.desconto, z: P },
          { v: c.puContratado, f: "ROUND(G" + n + "*(1-H" + n + "),2)", z: M }, { v: c.valor, f: "ROUND(F" + n + "*I" + n + ",2)", z: M }]);
        itensFisc.push({ est: e.estrutura.nome, l: l, ref: "'2-Planilha Orçamentária'!J" + n });
      });
    });
    var fimII = L2.length;
    L2.push(["TOTAL GRUPO II", "", "", "", "", "", "", "", "", { v: r.totalII, f: fimII > iniII ? "SUM(J" + (iniII + 1) + ":J" + fimII + ")" : "0", z: M }]);
    var linTotII = L2.length;
    L2.push([], ["TOTAL GRUPOS I + II", "", "", "", "", "", "", "", "", { v: r.total, f: "O" + linTotI + "+J" + linTotII, z: M }]);
    var linTotal = L2.length;
    L2.push([], ["Os preços correspondem aos preços referenciais da Tabela Consolidada SSP/BA, com o desconto registrado aplicado aos itens do Grupo I (metodologia do TR, subitens 7.1.1.1.2.1 a 7.1.1.1.2.11)."],
      [], ["Elaborado por:", p.autorNome || "", "", "Conferido por:"], ["Data:"]);

    var L1 = [["ORDEM DE SERVIÇO Nº " + osNum + (p.os && p.os.data ? " — " + dataBR(p.os.data) : "") + " — Pedido " + p.numero], [],
      ["Ata de Registro de Preços nº", p.ata.numero], ["Contrato nº", p.contrato || ""], ["Lote", p.ata.lote + " — " + nomeLote(p.ata.lote)], [],
      ["1. IDENTIFICAÇÃO DA DEMANDA"], ["Evento/Operação", p.evento], ["Órgão / Unidade requisitante", p.orgao + " / " + p.unidade], ["Município", p.municipio], ["Endereço / Localidade", p.local],
      ["Período do evento", periodo], ["Dias de realização", p.dias], ["Responsável local", p.responsavel], ["Telefone/e-mail", p.contato], [],
      ["2. CONTRATADA"], ["Fornecedor", p.ata.fornecedor], ["CNPJ", p.ata.cnpj], ["Preposto", ""], ["Telefone", ""], ["E-mail", ""], [],
      ["3. VALOR"], ["Item", "Tipo de estrutura", "Quantidade", "Valor total (R$)"]];
    r.estruturas.forEach(function (e, i) { L1.push([i + 1, e.estrutura.nome, e.multiplicador, { v: e.subtotal, z: M }]); });
    L1.push(["TOTAL", "", "", { v: r.total, f: "'2-Planilha Orçamentária'!J" + linTotal, z: M }], [],
      ["4. CONTROLE DO SALDO"], ["Valor máximo do contrato", ""], ["Saldo anterior", ""], ["Valor desta OS", { v: r.total, z: M }], ["Saldo posterior", ""], [],
      ["5. RESPONSÁVEIS"], ["Gestor", ""], ["Fiscal técnico", nomesFiscais], ["Fiscal setorial", ""], ["Responsável local", p.responsavel], [],
      ["Documentos integrantes: Planilha Orçamentária; Cronograma de Execução e Layout; Checklist e Registro de Fiscalização; Medição, Aceite e Encerramento."]);

    var L3 = [["CRONOGRAMA DE EXECUÇÃO — OS nº " + osNum], ["Evento", p.evento], ["Local", p.local], [], ["Etapa", "Data inicial", "Data final", "Responsável"],
      ["Mobilização, montagem e instalação", "", "", ""], ["Vistoria (até 2 dias antes do evento)", "", "", ""], ["Evento", p.inicio ? dataBR(p.inicio) : "", p.fim ? dataBR(p.fim) : "", ""],
      ["Desmobilização, desmontagem e desinstalação", "", "", ""], [], ["Condições específicas"], ["Horário autorizado para montagem", ""], ["Horário autorizado para desmontagem", ""],
      ["Restrições de acesso", ""], ["Pontos de energia", ""], ["Condições especiais de segurança", ""], ["Outras condições", ""], [],
      ["Layout/planta: documento, versão e data", ""], ["Documentação técnica: ART/RRT, projeto/memorial, documentação elétrica, certificados, prevenção contra incêndio", ""]];

    var L4 = [["CHECKLIST DE EXECUÇÃO E REGISTRO DE FISCALIZAÇÃO — OS nº " + osNum], ["Data da vistoria:", "", "Fiscal técnico:", nomesFiscais, "Fiscal setorial:"], [],
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
    L4.push([], ["Classes de glosa (TR 7.1.1.1.2, VI) — sobre o valor do item afetado"], ["a", "Divisória dupla trocada por simples, com autorização: 100% da diferença entre os PUs (lançar em 'Glosa classe a')"],
      ["b", "Divisória dupla trocada por simples, sem autorização: 30%"], ["c", "Falha estética leve: 10%"], ["d", "Falha funcional moderada: 20%"], ["e", "Falha grave: 50%"],
      ["f", "Falha crítica de segurança ou serviço não executado: 100%"], [], ["Condições gerais (marcar S/N)"], ["Estruturas montadas no local correto", ""], ["Quantidades conferidas", ""],
      ["Especificações atendidas", ""], ["Estruturas em condições adequadas de utilização", ""], ["Instalações concluídas", ""], ["Documentação técnica apresentada, quando exigível", ""], ["Cronograma cumprido", ""], [],
      ["Registro de ocorrências"], ["Data/hora", "Ocorrência", "Providência", "Responsável", "Regularização"], [], [], [], [], [],
      ["Registro fotográfico: antes da montagem · durante a montagem · estrutura concluída · durante o evento · não conformidades · desmontagem · local após retirada"]);

    var L5 = [["TERMO DE MEDIÇÃO, RECEBIMENTO E ENCERRAMENTO — OS nº " + osNum], ["Evento", p.evento], ["Período", periodo], [],
      ["Valor autorizado na OS", { v: r.total, f: "'2-Planilha Orçamentária'!J" + linTotal, z: M }], ["Glosas", { v: 0, f: "'4-Checklist'!K" + linGlosa, z: M }],
      ["Valor efetivamente medido", { v: r.total, f: "B5-B6", z: M }], ["Valor autorizado para faturamento", { v: r.total, f: "B7", z: M }], [],
      ["Resultado da execução (marcar)"], ["Executados integralmente", ""], ["Executados parcialmente", ""], ["Não conformidades identificadas", ""], ["Itens não executados", ""], ["Necessidade de glosa", ""], [],
      ["Termo de aceite (marcar)"], ["Recebimento integral e sem ressalvas", ""], ["Recebimento com ressalvas", ""], ["Recebimento parcial", ""], ["Não recebimento", ""], [],
      ["Encerramento financeiro"], ["Valor da OS", { v: r.total, f: "B5", z: M }], ["Valor medido", { v: r.total, f: "B7", z: M }], ["Valor faturado", ""], ["Saldo não utilizado", { v: 0, f: "B24-B25", z: M }], [],
      ["Fiscal técnico", nomesFiscais], ["Fiscal setorial", ""], ["Preposto da CONTRATADA", ""]];

    XLSX.utils.book_append_sheet(wb, montarAba(L1, [34, 48, 14, 18]), "1-OS");
    XLSX.utils.book_append_sheet(wb, montarAba(L2, [26, 22, 15, 60, 6, 11, 13, 9, 13, 15, 12, 8, 10, 11, 15]), "2-Planilha Orçamentária");
    XLSX.utils.book_append_sheet(wb, montarAba(L3, [44, 16, 16, 24]), "3-Cronograma");
    XLSX.utils.book_append_sheet(wb, montarAba(L4, [26, 15, 60, 6, 12, 12, 11, 13, 10, 15, 14, 16, 30]), "4-Checklist");
    XLSX.utils.book_append_sheet(wb, montarAba(L5, [40, 18]), "5-Medição");
    XLSX.writeFile(wb, "FOLIA_" + p.numero + "_fiscalizacao.xlsx");
    toast("Planilha de fiscalização gerada.");
  }

  function gerarConsolidado() {
    var wb = XLSX.utils.book_new(); var grupos = consolidar();
    var cons = [["CONSOLIDAÇÃO POR ATA DE RP — gerado em " + dataBR(hoje()) + " (pedidos enviados, aprovados, em fiscalização e encerrados)"], [],
      ["ARP", "Lote", "Nome do lote", "Fornecedor", "CNPJ", "Desconto", "Nº de pedidos", "Grupo I (R$)", "Grupo II (R$)", "Total a sacar (R$)", "Valor registrado (R$)", "Saldo (R$)"]];
    Object.keys(grupos).forEach(function (k) {
      var g = grupos[k]; var ataCad = acharAta(k); var reg = ataCad && ataCad.valorRegistrado ? ataCad.valorRegistrado : ""; var n = cons.length + 1;
      cons.push([g.ata.numero, g.ata.lote, nomeLote(g.ata.lote), g.ata.fornecedor, g.ata.cnpj, { v: g.ata.desconto, z: P }, g.n, { v: g.I, z: M }, { v: g.II, z: M }, { v: g.total, z: M },
        reg === "" ? "" : { v: reg, z: M }, reg === "" ? "" : { v: reg - g.total, f: "K" + n + "-J" + n, z: M }]);
    });
    var peds = [["Pedido", "Situação", "OS", "Órgão", "Unidade", "Autor", "Evento", "Município", "Início", "Fim", "Dias", "ARP", "Lote", "Fornecedor", "Desconto", "Grupo I", "Grupo II", "Total"]];
    var itens = [["Pedido", "Situação", "Órgão", "Evento", "ARP", "Lote", "Estrutura", "Código", "Descrição", "Und", "Tipo", "Quantidade", "PU ref.", "Desconto", "PU contratado", "Unidades", "Valor (R$)"]];
    pedidos.forEach(function (p) {
      var r = calcularSalvo(p);
      peds.push([p.numero, STATUS[p.status], p.os && p.os.numero || "", p.orgao, p.unidade, p.autorNome || "", p.evento, p.municipio, dataBR(p.inicio), dataBR(p.fim), p.dias, p.ata.numero, p.ata.lote, p.ata.fornecedor,
        { v: p.ata.desconto, z: P }, { v: r.totalI, z: M }, { v: r.totalII, z: M }, { v: r.total, z: M }]);
      r.estruturas.forEach(function (e) {
        e.linhas.forEach(function (l) {
          if (!l.calc) return;
          itens.push([p.numero, STATUS[p.status], p.orgao, p.evento, p.ata.numero, p.ata.lote, e.estrutura.nome, l.item.codigo, l.comp.descricao, l.comp.unidade, l.calc.grupo,
            { v: l.calc.quantidade, z: "#,##0.00" }, { v: l.calc.puReferencial, z: M }, { v: l.calc.desconto || 0, z: P }, { v: l.calc.puContratado || 0, z: M }, l.calc.unidades || "", { v: l.calc.valor, z: M }]);
        });
      });
    });
    XLSX.utils.book_append_sheet(wb, montarAba(cons, [12, 6, 40, 30, 20, 10, 10, 15, 15, 17, 17, 15]), "Consolidado por Ata");
    XLSX.utils.book_append_sheet(wb, montarAba(peds, [18, 18, 12, 8, 16, 22, 26, 14, 11, 11, 6, 12, 6, 28, 10, 14, 14, 14]), "Pedidos");
    XLSX.utils.book_append_sheet(wb, montarAba(itens, [18, 16, 8, 22, 12, 6, 22, 15, 60, 6, 6, 11, 12, 9, 12, 9, 14]), "Itens");
    XLSX.writeFile(wb, "FOLIA_consolidado_" + hoje() + ".xlsx");
    toast("Consolidado gerado.");
  }
})();
