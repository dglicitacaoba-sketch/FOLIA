// F.O.L.I.A. — Motor de cálculo (regras RN03 a RN07 e RN11 do documento de regras)
// Funções puras: recebem dados e devolvem números. Não mexem na tela.

var FoliaCalc = (function () {
  // ARRED do Excel com 2 casas: 0,005 arredonda para cima (TR 5.6.1.6 e 5.6.4).
  function arred(valor, casas) {
    var c = casas === undefined ? 2 : casas;
    var f = Math.pow(10, c);
    var sinal = valor < 0 ? -1 : 1;
    return (sinal * Math.round(Math.abs(valor) * f + 1e-9)) / f;
  }

  // Dias considerados na medição: mínimo de 3 (TR 7.1.1.1.2.7).
  function diasMedicao(dias, regras) {
    var d = Math.max(0, Math.floor(Number(dias) || 0));
    return Math.max(d, regras.dias_minimos);
  }

  // Unidades de medição do Grupo I: 50 + dias + 35 (TR 7.1.1.1.2.9).
  function unidadesGrupoI(dias, regras) {
    return regras.mobilizacao + diasMedicao(dias, regras) + regras.desmobilizacao;
  }

  // Calcula uma linha (uma composição dentro de uma estrutura).
  // composicao: item do catálogo; quantidade: quantidade física já multiplicada;
  // desconto: fração (0,1234 = 12,34%); dias: dias de realização do evento.
  function calcularLinha(composicao, quantidade, desconto, dias, regras) {
    var q = Number(quantidade) || 0;
    var pu = composicao.valor_com_bdi;
    var grupo = composicao.grupo_calculo;

    if (grupo === "I") {
      var puContratado = arred(pu * (1 - desconto));
      var valorTotalItem = arred(q * puContratado); // valor do item para o evento de referência (100 unidades)
      var unidades = unidadesGrupoI(dias, regras);
      var valor = arred((valorTotalItem / regras.base_unidades) * unidades);
      return { grupo: "I", quantidade: q, puReferencial: pu, desconto: desconto, puContratado: puContratado,
        valorTotalItem: valorTotalItem, unidades: unidades, valor: valor, calculado: true };
    }

    if (grupo === "II") {
      var d2 = regras.desconto_grupo_II ? desconto : 0; // RN04: tempo sem desconto
      var puc2 = arred(pu * (1 - d2));
      return { grupo: "II", quantidade: q, puReferencial: pu, desconto: d2, puContratado: puc2,
        valorTotalItem: null, unidades: null, valor: arred(q * puc2), calculado: true };
    }

    // CHP/CHI: classificação pendente, não entra no total.
    return { grupo: "PENDENTE", quantidade: q, puReferencial: pu, desconto: null, puContratado: null,
      valorTotalItem: null, unidades: null, valor: 0, calculado: false };
  }

  // Calcula um pedido inteiro. indice: mapa código -> composição do catálogo.
  function calcularPedido(pedido, ata, indice, regras) {
    var desconto = ata ? ata.desconto : 0;
    var resultado = { estruturas: [], totalI: 0, totalII: 0, total: 0, pendentes: 0, desconto: desconto,
      diasMedicao: diasMedicao(pedido.dias, regras), unidadesGrupoI: unidadesGrupoI(pedido.dias, regras) };

    (pedido.estruturas || []).forEach(function (est) {
      var mult = Math.max(1, Number(est.unidades) || 1);
      var linhas = [];
      var subtotal = 0;
      (est.itens || []).forEach(function (it) {
        var comp = indice[it.codigo];
        if (!comp) {
          linhas.push({ item: it, comp: null, calc: null });
          return;
        }
        var calc = calcularLinha(comp, (Number(it.quantidade) || 0) * mult, desconto, pedido.dias, regras);
        subtotal = arred(subtotal + calc.valor);
        if (calc.grupo === "I") resultado.totalI = arred(resultado.totalI + calc.valor);
        else if (calc.grupo === "II") resultado.totalII = arred(resultado.totalII + calc.valor);
        else resultado.pendentes += 1;
        linhas.push({ item: it, comp: comp, calc: calc });
      });
      resultado.estruturas.push({ estrutura: est, multiplicador: mult, linhas: linhas, subtotal: subtotal });
    });
    resultado.total = arred(resultado.totalI + resultado.totalII);
    return resultado;
  }

  return { arred: arred, diasMedicao: diasMedicao, unidadesGrupoI: unidadesGrupoI,
    calcularLinha: calcularLinha, calcularPedido: calcularPedido };
})();

if (typeof module !== "undefined") module.exports = FoliaCalc;
