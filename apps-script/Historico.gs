/* =====================================================================
 * Consulta do histórico (planilha "Portal GVC — Histórico", aba Historico).
 * ===================================================================== */

// Tabela → módulo que precisa poder ler para ver o histórico.
const MODULO_DA_TABELA = { Cadastros: 'mapa', Residuos: 'mapa', Equipamentos: 'mapa', Lancamentos: 'destinacao', LocacaoMensal: 'frota', Veiculos: 'frota', Caixas: 'frota', TiposVeiculo: 'frota',
  Solicitacoes: 'solicitacoes', Consultores: 'solicitacoes', TiposDocumento: 'solicitacoes', Faturamentos: 'faturamento',
  Viagens: 'programacao', Colaboradores: 'programacao', Adiantamentos: 'dp', Rotinas: 'solicitacoes' };

function linhaHistorico_(r) {
  return { quando: isoMomento_(r[0]), email: String(r[1]), nome: String(r[2]), modulo: String(r[3]), tabela: String(r[4]),
           registroId: String(r[5]), registroNome: String(r[6]), acao: String(r[7]), campo: String(r[8]), de: String(r[9]),
           para: String(r[10]), detalhe: String(r[11]) };
}

/** Histórico de um registro (mais recente primeiro). */
function historicoRegistro_(tabela, id, u) {
  const mod = MODULO_DA_TABELA[tabela];
  if (!mod && !u.adminPortal) return semPermissao_('Histórico não disponível.');
  if (mod && !podeLer_(u, mod) && !u.adminPortal) return semPermissao_('Você não tem acesso a este módulo.');
  const sh = abaHist_();
  const n = sh.getLastRow();
  if (n < 2) return { ok: true, itens: [] };
  const achados = sh.getRange(2, 6, n - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findAll();
  const itens = achados.map(function (c) { return linhaHistorico_(sh.getRange(c.getRow(), 1, 1, HISTORICO_COLUNAS.length).getValues()[0]); })
    .filter(function (x) { return !x.tabela || x.tabela === tabela || !tabela; });
  itens.reverse();
  return { ok: true, itens: itens.slice(0, 500) };
}

/** Histórico geral, para o administrador do portal. Lê as últimas 5.000 linhas e aplica os filtros. */
function historicoGeral_(f) {
  f = f || {};
  const sh = abaHist_();
  const n = sh.getLastRow();
  if (n < 2) return { ok: true, itens: [], total: 0, pessoas: [] };
  const qtd = Math.min(5000, n - 1);
  const vals = sh.getRange(n - qtd + 1, 1, qtd, HISTORICO_COLUNAS.length).getValues();
  const de = f.de ? String(f.de) : '', ate = f.ate ? String(f.ate) + 'T23:59:59' : '';
  const busca = semAcento_(f.registro || '');
  const pessoas = {};
  const itens = [];
  for (let i = vals.length - 1; i >= 0; i--) {
    const x = linhaHistorico_(vals[i]);
    pessoas[x.nome] = true;
    if (de && x.quando < de) continue;
    if (ate && x.quando > ate) continue;
    if (f.modulo && x.modulo !== f.modulo) continue;
    if (f.pessoa && x.nome !== f.pessoa) continue;
    if (busca && semAcento_(x.registroId + ' ' + x.registroNome).indexOf(busca) < 0) continue;
    if (!f.acessos && x.acao === 'entrou') continue;
    itens.push(x);
  }
  return { ok: true, total: itens.length, itens: itens.slice(0, 300), pessoas: Object.keys(pessoas).sort(), lidas: qtd };
}
