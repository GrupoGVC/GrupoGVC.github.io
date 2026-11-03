/* =====================================================================
 * Portal GVC — módulo Ambiental: todos os MTRs (coleta de cliente e operação interna),
 * a destinar e destinados, e o registro do CDF (sim, data e nº; sem anexo).
 * Um MTR = lançamentos com o mesmo nº de MTR e o mesmo destinador. Um CDF cobre um ou vários MTRs
 * do mesmo destinador (Lancamentos.cdfId).
 * ===================================================================== */

function chaveMtr_(l) { return String(l.mtr || '').trim() + '|' + String(l.destinadorId || ''); }
function prazoCdf_() { return num_(parametro_('diasPrazoCdf')) || 30; }

/** Agrupa os lançamentos ativos com MTR que o usuário vê. */
function mtrsDoUsuario_(u) {
  const grupos = {}, ordem = [];
  ler_('Lancamentos').forEach(function (l) {
    if (!l.ativo || !String(l.mtr || '').trim() || !veUnidade_(u, l.unidadeId)) return;
    const k = chaveMtr_(l);
    if (!grupos[k]) { grupos[k] = []; ordem.push(k); }
    grupos[k].push(l);
  });
  return ordem.map(function (k) { return { chave: k, lancs: grupos[k] }; });
}
function mtrPublico_(g, sols) {
  const ls = g.lancs, l0 = ls[0];
  const pend = ls.some(function (l) { return l.situacao === SIT_PENDENTE; });
  const datasCol = ls.map(function (l) { return dataTexto_(l.dataColeta) || (l.situacao === SIT_PENDENTE ? dataTexto_(l.data) : ''); }).filter(String).sort();
  const datasDest = pend ? [] : ls.map(function (l) { return dataTexto_(l.data); }).filter(String).sort();
  const cdfs = ls.map(function (l) { return String(l.cdfId || ''); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  const sol = l0.solicitacaoId ? sols[l0.solicitacaoId] : null;
  const res = ls.map(function (l) { return String(l.residuoId || ''); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  const soma = function (c) { return Math.round(ls.reduce(function (t, l) { return t + num_(l[c]); }, 0) * 100) / 100; };
  return { chave: g.chave, mtr: String(l0.mtr).trim(), destinadorId: String(l0.destinadorId || ''), unidadeId: String(l0.unidadeId || ''),
    gerador: String(l0.gerador || ''), fonte: String(l0.fonte || FONTE_INTERNA), negocio: normNegocio_(l0.negocio), placa: String(l0.placa || ''),
    solicitacaoId: String(l0.solicitacaoId || ''), clienteId: sol ? String(sol.clienteId) : '',
    situacao: pend ? SIT_PENDENTE : SIT_DESTINADO, dataColeta: datasCol[0] || '', dataDestinacao: datasDest.length ? datasDest[datasDest.length - 1] : '',
    residuoIds: res, kgMtr: soma('pesoMtr'), kg: pend ? '' : soma('kg'), valor: pend ? '' : soma('valor'),
    tickets: ls.map(function (l) { return String(l.ticket || '').trim(); }).filter(function (x, i, a) { return x && a.indexOf(x) === i; }),
    cdfId: cdfs.length === 1 && ls.every(function (l) { return String(l.cdfId || '') === cdfs[0]; }) ? cdfs[0] : (cdfs[0] || ''),
    cdfParcial: cdfs.length > 1 || (cdfs.length === 1 && ls.some(function (l) { return !l.cdfId; })),
    divergencia: ls.map(function (l) { return String(l.motivoDivergencia || ''); }).filter(String).join(' · '), lancamentos: ls.length };
}
function cdfPublico_(c, n) {
  return { id: c.id, numero: String(c.numero || ''), data: dataTexto_(c.data), destinadorId: String(c.destinadorId || ''), obs: String(c.obs || ''),
           mtrs: n || 0, criadoEm: c.criadoEm, criadoPor: c.criadoPor, atualizadoEm: c.atualizadoEm, atualizadoPor: c.atualizadoPor };
}

function ambDados_(u) {
  const sols = {}; ler_('Solicitacoes').forEach(function (s) { sols[s.id] = s; });
  const mtrs = mtrsDoUsuario_(u).map(function (g) { return mtrPublico_(g, sols); });
  const nPorCdf = {}; mtrs.forEach(function (m) { if (m.cdfId) nPorCdf[m.cdfId] = (nPorCdf[m.cdfId] || 0) + 1; });
  const cdfs = ler_('Cdfs').filter(function (c) { return c.ativo && nPorCdf[c.id]; }).map(function (c) { return cdfPublico_(c, nPorCdf[c.id]); });
  const destIds = {}, cliIds = {};
  mtrs.forEach(function (m) { destIds[m.destinadorId] = 1; if (m.clienteId) cliIds[m.clienteId] = 1; });
  const nomes = {}; ler_('Cadastros').forEach(function (c) { if (destIds[c.id] || cliIds[c.id]) nomes[c.id] = String(c.nome || c.razaoSocial || c.id); });
  const semMtr = ler_('Lancamentos').filter(function (l) { return l.ativo && !String(l.mtr || '').trim() && veUnidade_(u, l.unidadeId); }).length;
  return { ok: true, unidades: unidadesDoUsuario_(u), todasUnidades: unidadesLista_(), mtrs: mtrs, cdfs: cdfs, nomes: nomes,
    residuos: ler_('Residuos').map(function (r) { return { id: r.id, nome: String(r.nome) }; }), prazoCdf: prazoCdf_(), semMtr: semMtr, hoje: dataTexto_(new Date()) };
}

/** Grava o CDF nos lançamentos (uma escrita na coluna cdfId). */
function gravarCdfLancamentos_(mapa) {
  const sh = aba_('Lancamentos'), cab = colunas_('Lancamentos'), col = cab.indexOf('cdfId') + 1, ult = sh.getLastRow();
  if (ult < 2 || col < 1) return;
  const porLinha = {}; ler_('Lancamentos').forEach(function (l) { porLinha[l._linha] = l; });
  const vals = [];
  for (let r = 2; r <= ult; r++) { const l = porLinha[r]; vals.push([l ? (l.id in mapa ? mapa[l.id] : String(l.cdfId || '')) : '']); }
  sh.getRange(2, col, ult - 1, 1).setNumberFormat('@').setValues(vals);
  limparCache_('Lancamentos');
}
/** Confere as chaves de MTR escolhidas: visíveis, destinadas, do mesmo destinador. */
function mtrsEscolhidos_(chaves, u, cdfAtualId) {
  const todos = {}; mtrsDoUsuario_(u).forEach(function (g) { todos[g.chave] = g; });
  const lista = [];
  for (let i = 0; i < (chaves || []).length; i++) {
    const g = todos[String(chaves[i])];
    if (!g) return { erro: 'O MTR ' + String(chaves[i]).split('|')[0] + ' não foi encontrado (ou é de outra unidade). Atualize a página.' };
    if (g.lancs.some(function (l) { return l.situacao === SIT_PENDENTE; })) return { erro: 'O MTR ' + String(g.lancs[0].mtr).trim() + ' ainda está a destinar: o CDF só é registrado depois da destinação confirmada no Controle.' };
    const outro = g.lancs.filter(function (l) { return l.cdfId && String(l.cdfId) !== String(cdfAtualId || ''); })[0];
    if (outro) { const c = porId_('Cdfs', outro.cdfId); return { erro: 'O MTR ' + String(g.lancs[0].mtr).trim() + ' já está no CDF ' + (c ? c.numero : outro.cdfId) + '. Tire de lá antes.' }; }
    lista.push(g);
  }
  if (!lista.length) return { erro: 'Escolha pelo menos um MTR.' };
  const dests = lista.map(function (g) { return String(g.lancs[0].destinadorId || ''); }).filter(function (x, i, a) { return a.indexOf(x) === i; });
  if (dests.length > 1) return { erro: 'Um CDF é de um destinador só: os MTRs escolhidos são de ' + dests.map(nomeCad_).join(' e ') + '.' };
  return { lista: lista, destinadorId: dests[0] };
}
function rotuloCdf_(c) { return 'CDF ' + (c.numero || 's/nº') + ' · ' + nomeCad_(c.destinadorId); }

/**
 * Ações do Ambiental (editor).
 * registrar {numero, data, obs, chaves}   — CDF novo (ou mais MTRs num CDF já registrado com o mesmo nº, destinador e data)
 * editar    {id, numero, data, obs, adicionar: [chaves], remover: [chaves]}
 * desfazer  {id}                           — tira o CDF dos MTRs (o registro fica inativo, com o histórico)
 */
function ambCdf_(tipo, x, u) {
  x = x || {};
  if (tipo === 'registrar') {
    const numero = String(x.numero || '').trim(), data = dataTexto_(x.data);
    if (!numero) return erroDados_('Informe o nº do CDF.');
    if (!data) return erroDados_('Informe a data de emissão do CDF.');
    if (data > dataTexto_(new Date())) return erroDados_('A data do CDF está no futuro.');
    const e = mtrsEscolhidos_(x.chaves, u, null); if (e.erro) return erroDados_(e.erro);
    let cdf = ler_('Cdfs').filter(function (c) { return c.ativo && String(c.destinadorId) === e.destinadorId && semAcento_(c.numero) === semAcento_(numero); })[0];
    if (cdf && dataTexto_(cdf.data) !== data)
      return erroDados_('O CDF ' + numero + ' de ' + nomeCad_(e.destinadorId) + ' já está registrado com a data ' + dataTexto_(cdf.data).split('-').reverse().join('/') + '. Confira o nº ou a data.');
    const novo = !cdf;
    if (novo) cdf = inserir_('Cdfs', { numero: numero, data: data, destinadorId: e.destinadorId, obs: String(x.obs || '').trim() }, u, 'ambiental', 'CDF ' + numero + ' · ' + nomeCad_(e.destinadorId));
    const mapa = {}; e.lista.forEach(function (g) { g.lancs.forEach(function (l) { mapa[l.id] = cdf.id; }); });
    gravarCdfLancamentos_(mapa);
    hist_(u, 'ambiental', 'Cdfs', cdf.id, rotuloCdf_(cdf), novo ? 'vinculou' : 'alterou', 'MTRs', '', e.lista.map(function (g) { return String(g.lancs[0].mtr).trim(); }).join(', '),
      e.lista.length + ' MTR(s) ' + (novo ? 'no CDF.' : 'incluído(s) no CDF já registrado.'));
    return { ok: true, id: cdf.id, novo: novo };
  }
  const cdf = porId_('Cdfs', String(x.id || ''));
  if (!cdf || !cdf.ativo) return erroDados_('CDF não encontrado. Atualize a página.');
  const meus = mtrsDoUsuario_(u).filter(function (g) { return g.lancs.some(function (l) { return String(l.cdfId) === cdf.id; }); });
  if (!meus.length && !u.adminPortal) return semPermissao_('Este CDF é de MTRs de outra unidade.');
  if (tipo === 'desfazer') {
    const mapa = {}; ler_('Lancamentos').forEach(function (l) { if (String(l.cdfId) === cdf.id) mapa[l.id] = ''; });
    gravarCdfLancamentos_(mapa);
    atualizar_('Cdfs', cdf.id, { ativo: false }, u, 'ambiental', { registroNome: rotuloCdf_(cdf) });
    return { ok: true };
  }
  if (tipo === 'editar') {
    const numero = String(x.numero || cdf.numero).trim(), data = dataTexto_(x.data || cdf.data);
    if (!numero) return erroDados_('Informe o nº do CDF.');
    if (!data || data > dataTexto_(new Date())) return erroDados_('Informe uma data de emissão válida.');
    const dup = ler_('Cdfs').filter(function (c) { return c.ativo && c.id !== cdf.id && String(c.destinadorId) === String(cdf.destinadorId) && semAcento_(c.numero) === semAcento_(numero); })[0];
    if (dup) return erroDados_('Já existe o CDF ' + numero + ' para ' + nomeCad_(cdf.destinadorId) + '.');
    const mapa = {};
    if ((x.adicionar || []).length) {
      const e = mtrsEscolhidos_(x.adicionar, u, cdf.id); if (e.erro) return erroDados_(e.erro);
      if (e.destinadorId !== String(cdf.destinadorId)) return erroDados_('Os MTRs incluídos precisam ser de ' + nomeCad_(cdf.destinadorId) + '.');
      e.lista.forEach(function (g) { g.lancs.forEach(function (l) { mapa[l.id] = cdf.id; }); });
    }
    const tirar = {}; (x.remover || []).forEach(function (k) { tirar[String(k)] = 1; });
    meus.forEach(function (g) { if (tirar[g.chave]) g.lancs.forEach(function (l) { mapa[l.id] = ''; }); });
    const ficam = ler_('Lancamentos').filter(function (l) { return String(l.cdfId) === cdf.id && !(l.id in mapa && mapa[l.id] === ''); }).length + Object.keys(mapa).filter(function (k) { return mapa[k]; }).length;
    if (!ficam) return erroDados_('O CDF ficaria sem MTR. Para tirar todos, use "Desfazer CDF".');
    atualizar_('Cdfs', cdf.id, { numero: numero, data: data, obs: x.obs === undefined ? cdf.obs : String(x.obs || '').trim() }, u, 'ambiental', { registroNome: rotuloCdf_(cdf) });
    if (Object.keys(mapa).length) {
      gravarCdfLancamentos_(mapa);
      const add = (x.adicionar || []).map(function (k) { return String(k).split('|')[0]; }), rem = (x.remover || []).map(function (k) { return String(k).split('|')[0]; });
      hist_(u, 'ambiental', 'Cdfs', cdf.id, rotuloCdf_(cdf), 'alterou', 'MTRs', rem.join(', '), add.join(', '), (add.length ? add.length + ' incluído(s). ' : '') + (rem.length ? rem.length + ' retirado(s).' : ''));
    }
    return { ok: true };
  }
  return erroDados_('Ação desconhecida.');
}

/* ---------------- migração (ESQUEMA 10) ---------------- */
function migrarAmbiental_() {
  aba_('Cdfs');
  migrarCabecalho_('Lancamentos');
  ler_('Usuarios').forEach(function (us) {
    if (!simNao_(us.adminPortal)) return;
    if (!onde_('UsuarioModulos', 'usuarioId', us.id).some(function (m) { return m.modulo === 'ambiental'; })) inserir_('UsuarioModulos', { usuarioId: us.id, modulo: 'ambiental', nivel: 'admin' }, null, null);
  });
  if (!ler_('Parametros').some(function (p) { return p.chave === 'diasPrazoCdf'; }))
    inserir_('Parametros', { chave: 'diasPrazoCdf', valor: '30', vigenciaInicio: dataTexto_(new Date()), descricao: 'Dias depois da destinação para cobrar o CDF do destinador.' }, null, null);
  const fun = ler_('Listas').filter(function (x) { return x.lista === 'funcaoPessoa'; });
  if (fun.length && !fun.some(function (x) { return String(x.valor) === 'Ambiental'; }))
    inserir_('Listas', { lista: 'funcaoPessoa', valor: 'Ambiental', ordem: fun.length + 1, ativo: true }, null, null);
  HIST_BUF_.push([new Date(), '', 'sistema', 'ambiental', 'Cdfs', '', '', 'migrou', '', '', '', 'Módulo Ambiental: tabela de CDFs e coluna cdfId nos lançamentos.']);
}
