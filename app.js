// F.O.L.I.A. — Etapa 1: exibição do catálogo de composições
// Lê dados/catalogo.json e permite buscar e filtrar. Nenhum dado é enviado para fora do navegador.

const ROTULO_CALCULO = {
  I: "Grupo I · física",
  II: "Grupo II · tempo",
  PENDENTE: "Pendente",
};

const moeda = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Remove acentos e põe em minúsculas, para a busca achar "toldo" e "TÓLDO" igualmente.
function normalizar(texto) {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function escapar(texto) {
  return texto.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

async function iniciar() {
  let catalogo;
  try {
    const resposta = await fetch("dados/catalogo.json");
    if (!resposta.ok) throw new Error("HTTP " + resposta.status);
    catalogo = await resposta.json();
  } catch (erro) {
    document.getElementById("fonte").textContent =
      "Erro ao carregar o catálogo (" + erro.message + "). Abra a página por um servidor (GitHub Pages ou http://localhost), não com duplo clique no arquivo.";
    return;
  }

  const { meta, grupos, itens } = catalogo;
  document.getElementById("fonte").textContent =
    `${meta.fonte} · BDI ${(meta.bdi * 100).toFixed(2).replace(".", ",")}% · Data-base: ${meta.data_base} · ${meta.total_itens} composições`;

  const selGrupo = document.getElementById("filtroGrupo");
  for (const [codigo, nome] of Object.entries(grupos)) {
    selGrupo.add(new Option(`${codigo} — ${nome}`, codigo));
  }

  const busca = document.getElementById("busca");
  const selCalculo = document.getElementById("filtroCalculo");

  function desenhar() {
    const termo = normalizar(busca.value.trim());
    const grupo = selGrupo.value;
    const calculo = selCalculo.value;

    const filtrados = itens.filter(
      (i) =>
        (!grupo || i.grupo === grupo) &&
        (!calculo || i.grupo_calculo === calculo) &&
        (!termo || normalizar(i.codigo + " " + i.descricao).includes(termo))
    );

    document.getElementById("linhas").innerHTML = filtrados
      .map(
        (i) => `<tr>
          <td class="cod">${escapar(i.codigo)}</td>
          <td>${escapar(i.descricao)}</td>
          <td>${escapar(i.unidade)}</td>
          <td class="num">${moeda.format(i.valor_sem_bdi)}</td>
          <td class="num">${moeda.format(i.valor_com_bdi)}</td>
          <td><span class="tag ${i.grupo_calculo}">${ROTULO_CALCULO[i.grupo_calculo]}</span></td>
        </tr>`
      )
      .join("");

    document.getElementById("contador").textContent = `${filtrados.length} de ${itens.length} composições exibidas`;
  }

  busca.addEventListener("input", desenhar);
  selGrupo.addEventListener("change", desenhar);
  selCalculo.addEventListener("change", desenhar);
  desenhar();
}

iniciar();
