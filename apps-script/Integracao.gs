/* =====================================================================
 * Fase 5 — integração e extras
 *  1. Parada realizada → lançamento(s) no Controle de Destinação (destinador, resíduo, kg, MTR),
 *     com o preço do cadastro do destinador no Mapa e a placa/unidade da viagem.
 *  2. Faturamento: o kg destinado de cada solicitação sugere os itens do BM pela tabela de preço.
 *  3. Coletas recorrentes (Rotinas): geram as solicitações das próximas semanas já liberadas.
 *  4. "Minhas solicitações": o consultor acompanha as dele, da chegada até a NF (só leitura).
 * ===================================================================== */

const ROT_FREQUENCIAS = ['Semanal', 'Quinzenal', 'Mensal'];
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

/* ---------------- migração da Fase 5 ---------------- */
/** Reescreve a aba no formato atual das colunas (por nome), preservando dados e auditoria. */
function migrarCabecalho_(nome) {
  const sh = aba_(nome);
  const cabNovo = colunas_(nome);
  const v = sh.getDataRange().getValues();
  const cabAtual = (v[0] || []).map(function (x) { return String(x).trim(); });
  if (cabAtual.join('|') === cabNovo.join('|')) return false;
  const linhas = v.slice(1).filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r) {
    const o = {}; cabAtual.forEach(function (c, i) { if (c) o[c] = r[i]; });
    return cabNovo.map(function (c) { return c in o ? o[c] : ''; });
  });
  sh.clearContents();
  sh.getRange(1, 1, 1, cabNovo.length).setValues([cabNovo]).setFontWeight('bold').setBackground('#dcefe6');
  escreverLinhas_(sh, nome, 2, linhas);
  limparCache_(nome);
  return true;
}
function migrarFase5_() {
  migrarCabecalho_('Lancamentos');
  migrarCabecalho_('Solicitacoes');
  aba_('Rotinas');
  if (!ler_('Parametros').some(function (p) { return p.chave === 'semanasRecorrentes'; }))
    inserir_('Parametros', { chave: 'semanasRecorrentes', valor: '4', vigenciaInicio: dataTexto_(new Date()), descricao: 'Quantas semanas à frente as coletas recorrentes geram solicitações.' }, null, null);
  if (!ler_('Listas').some(function (x) { return x.lista === 'frequenciaRotina'; }))
    ROT_FREQUENCIAS.forEach(function (f, i) { inserir_('Listas', { lista: 'frequenciaRotina', valor: f, ordem: i + 1, ativo: true }, null, null); });
  HIST_BUF_.push([new Date(), '', 'sistema', 'portal', '', '', '', 'migrou', '', '', '', 'Fase 5: lançamentos ligados às paradas, coletas recorrentes e "Minhas solicitações".']);
}

/* ---------------- 1. destinação da parada → Controle de Destinação ---------------- */
function destinadoresProgramacao_() {
  return ler_('Cadastros').filter(function (c) { const t = separar_(c.tipos); return c.ativo && (t.indexOf('destinador') >= 0 || t.indexOf('reciclador') >= 0); })
    .map(function (c) {
      const precos = {}; onde_('CadastroResiduos', 'cadastroId', c.id).forEach(function (r) { precos[r.residuoId] = r.precoKg === '' || r.precoKg == null ? '' : num_(r.precoKg); });
      return { id: c.id, nome: String(c.nome || c.razaoSocial || c.id), precos: precos };
    }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
}
function lancParadaPublico_(l) {
  return { id: l.id, paradaId: String(l.paradaId || ''), viagemId: String(l.viagemId || ''), destinadorId: String(l.destinadorId || ''), residuoId: String(l.residuoId || ''),
           kg: l.kg === '' ? '' : num_(l.kg), preco: num_(l.preco), valor: num_(l.valor), mtr: String(l.mtr || ''), ticket: String(l.ticket || ''), negocio: String(l.negocio || '') };
}
function validarLancamentosParada_(lancs, n) {
  for (let i = 0; i < lancs.length; i++) {
    const l = lancs[i];
    if (!porId_('Cadastros', l.destinadorId)) return 'Parada ' + n + ', destinação ' + (i + 1) + ': escolha o destinador.';
    if (!porId_('Residuos', l.residuoId)) return 'Parada ' + n + ', destinação ' + (i + 1) + ': escolha o resíduo.';
    if (!(num_(l.kg) > 0)) return 'Parada ' + n + ', destinação ' + (i + 1) + ': informe o peso (kg).';
  }
  return '';
}
function precoDestino_(destinadorId, residuoId) {
  const r = ler_('CadastroResiduos').filter(function (x) { return x.cadastroId === destinadorId && x.residuoId === residuoId; })[0];
  return r && r.precoKg !== '' && r.precoKg != null ? num_(r.precoKg) : 0;
}
function inativarLancamentosParada_(paradaId, u, motivo) {
  if (!paradaId) return;
  ler_('Lancamentos').filter(function (l) { return l.ativo && String(l.paradaId) === String(paradaId); }).forEach(function (l) {
    atualizar_('Lancamentos', l.id, { ativo: false, obs: (String(l.obs || '') + ' ' + motivo).trim() }, u, 'destinacao', { registroNome: (l.mtr ? 'MTR ' + l.mtr : 'sem MTR') });
  });
}
/** Cria, altera ou inativa os lançamentos de uma parada realizada. */
function sincronizarLancamentosParada_(v, p, lancs, u) {
  const atuais = ler_('Lancamentos').filter(function (l) { return l.ativo && String(l.paradaId) === String(p.id); });
  const cli = porId_('Cadastros', p.clienteId) || {};
  const loc = cli.id ? (localPrincipal_(cli.id) || {}) : {};
  const transp = v.execucao === 'Terceirizada' ? String((porId_('Cadastros', v.transportadorId) || {}).nome || 'Terceirizada') : 'Retec';
  const data = dataTexto_(p.data) || dataTexto_(v.dataSaida);
  const manter = {};
  lancs.forEach(function (l) {
    const a = l.id ? atuais.filter(function (x) { return x.id === String(l.id); })[0] : null;
    const kg = num_(l.kg);
    const dest = porId_('Cadastros', l.destinadorId);
    // preço congelado: só busca de novo se mudou destinador ou resíduo
    const preco = a && String(a.destinadorId) === String(l.destinadorId) && String(a.residuoId) === String(l.residuoId) ? num_(a.preco) : precoDestino_(l.destinadorId, l.residuoId);
    const campos = { unidadeId: String(v.unidadeId || ''), data: data, mes: data.slice(0, 7), mtr: String(l.mtr || '').trim(), ticket: String(l.ticket || '').trim(),
      destinadorId: String(l.destinadorId), gerador: String(cli.nome || ''), origem: [loc.cidade, loc.uf].filter(function (x) { return x; }).join('/'),
      residuoId: String(l.residuoId), transportadora: transp, placa: String(v.placa || ''), kg: kg, preco: preco, valorFixo: '',
      valor: Math.round(kg * preco * 100) / 100, negocio: normNegocio_(l.negocio), paradaId: p.id, viagemId: v.id };
    const rot = (campos.mtr ? 'MTR ' + campos.mtr : 'sem MTR') + ' · ' + (dest ? dest.nome : '');
    if (a) { atualizar_('Lancamentos', a.id, campos, u, 'destinacao', { registroNome: rot }); manter[a.id] = 1; }
    else {
      campos.obs = 'Lançado pela Programação (' + rotuloViagem_(v) + ').'; campos.idOrigem = ''; campos.ativo = true;
      manter[inserir_('Lancamentos', campos, u, 'destinacao', rot).id] = 1;
    }
  });
  atuais.forEach(function (a) { if (!manter[a.id]) atualizar_('Lancamentos', a.id, { ativo: false }, u, 'destinacao', { registroNome: (a.mtr ? 'MTR ' + a.mtr : 'sem MTR') }); });
}

/* ---------------- 2. destinação por solicitação (para o BM) ---------------- */
function destinacaoPorSolicitacao_() {
  const vs = {}; ler_('Viagens').forEach(function (v) { if (v.status !== 'Cancelada') vs[v.id] = v; });
  const parSol = {}, viagensSol = {};
  ler_('Paradas').forEach(function (p) {
    if (!p.solicitacaoId || !vs[p.viagemId] || p.resultado !== 'Realizada') return;
    parSol[p.id] = String(p.solicitacaoId);
    (viagensSol[p.solicitacaoId] = viagensSol[p.solicitacaoId] || {})[p.viagemId] = 1;
  });
  const out = {};
  Object.keys(viagensSol).forEach(function (s) { out[s] = { viagens: Object.keys(viagensSol[s]).length, kg: {} }; });
  ler_('Lancamentos').forEach(function (l) {
    const s = parSol[l.paradaId]; if (!s || !l.ativo) return;
    out[s].kg[l.residuoId] = (out[s].kg[l.residuoId] || 0) + num_(l.kg);
  });
  return out;
}

/* ---------------- 3. coletas recorrentes ---------------- */
function rotPublica_(r) {
  const o = publico_('Rotinas', r);
  ['dataInicio', 'dataFim', 'geradaAte'].forEach(function (c) { o[c] = dataTexto_(r[c]); });
  o.residuoIds = separar_(r.residuoIds); o.valorPrevisto = r.valorPrevisto === '' ? '' : num_(r.valorPrevisto);
  o.diaSemana = r.diaSemana === '' ? '' : num_(r.diaSemana); o.diaMes = r.diaMes === '' ? '' : num_(r.diaMes);
  return o;
}
function rotuloRotina_(r) {
  const c = porId_('Cadastros', r.clienteId);
  const quando = r.frequencia === 'Mensal' ? 'dia ' + r.diaMes : DIAS_SEMANA[Number(r.diaSemana)] || '';
  return (c ? c.nome : 'Rotina') + ' · ' + r.frequencia + ' (' + quando + ')';
}
/** Datas da rotina entre ini e fim (aaaa-mm-dd, inclusive). */
function datasRotina_(r, ini, fim) {
  const out = [];
  const inicio = dataTexto_(r.dataInicio); const ate = dataTexto_(r.dataFim);
  if (ate && ate < fim) fim = ate;
  if (inicio > ini) ini = inicio;
  if (ini > fim) return out;
  const d = paraData_(ini), dFim = paraData_(fim);
  if (r.frequencia === 'Mensal') {
    const dia = Number(r.diaMes) || 1;
    let y = d.getFullYear(), m = d.getMonth();
    for (let k = 0; k < 24; k++) {
      const ult = new Date(y, m + 1, 0).getDate();
      const x = Utilities.formatDate(new Date(y, m, Math.min(dia, ult), 12), tz_(), 'yyyy-MM-dd');
      if (x > fim) break;
      if (x >= ini) out.push(x);
      m++; if (m > 11) { m = 0; y++; }
    }
    return out;
  }
  // semanal / quinzenal: a partir da 1ª ocorrência do dia da semana desde o início da rotina
  const ds = Number(r.diaSemana);
  const base = paraData_(inicio);
  while (base.getDay() !== ds) base.setDate(base.getDate() + 1);
  const passo = r.frequencia === 'Quinzenal' ? 14 : 7;
  for (let x = new Date(base.getTime()); x <= dFim; x.setDate(x.getDate() + passo)) {
    const t = Utilities.formatDate(x, tz_(), 'yyyy-MM-dd');
    if (t >= ini) out.push(t);
  }
  return out;
}
/** Gera as solicitações das rotinas até N semanas à frente. Roda no máximo uma vez por dia (ou quando forçado). */
function gerarRecorrentes_(u, forcar) {
  const p = PropertiesService.getScriptProperties();
  const hoje = dataTexto_(new Date());
  if (!forcar && p.getProperty('ROTINAS_DIA') === hoje) return { ok: true, geradas: 0 };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { ok: true, geradas: 0 };
  try {
    p.setProperty('ROTINAS_DIA', hoje);
    const semanas = num_(parametro_('semanasRecorrentes')) || 4;
    const horizonte = Utilities.formatDate(new Date(paraData_(hoje).getTime() + semanas * 7 * 864e5), tz_(), 'yyyy-MM-dd');
    const existe = {}; ler_('Solicitacoes').forEach(function (s) { if (s.idOrigem) existe[String(s.idOrigem)] = 1; });
    const novas = [], porRotina = {};
    ler_('Rotinas').filter(function (r) { return r.ativo; }).forEach(function (r) {
      const desde = dataTexto_(r.geradaAte) ? Utilities.formatDate(new Date(paraData_(dataTexto_(r.geradaAte)).getTime() + 864e5), tz_(), 'yyyy-MM-dd') : hoje;
      const ini = desde < hoje ? hoje : desde;
      datasRotina_(r, ini, horizonte).forEach(function (d) {
        const k = 'ROT|' + r.id + '|' + d; if (existe[k]) return; existe[k] = 1;
        novas.push({ unidadeId: String(r.unidadeId), clienteId: String(r.clienteId), consultorId: String(r.consultorId || ''), servico: String(r.servico || ''),
          demanda: 'Recorrente', perfil: 'Contrato', execucao: 'Própria', residuoIds: String(r.residuoIds || ''), descricao: String(r.descricao || ''),
          dataSolicitacaoConsultor: '', dataSolicitacao: hoje, dataPrevista: d, dataColeta: '', valorPrevisto: r.valorPrevisto === '' ? '' : num_(r.valorPrevisto),
          status: 'Liberada para programar', motivo: '', obs: 'Coleta recorrente: ' + rotuloRotina_(r) + '.', solicitanteNome: '', programadorNome: '',
          origem: 'rotina', idOrigem: k, rotinaId: r.id, ativo: true });
        porRotina[r.id] = (porRotina[r.id] || 0) + 1;
      });
      if (dataTexto_(r.geradaAte) < horizonte) atualizar_('Rotinas', r.id, { geradaAte: horizonte }, u, null);
    });
    inserirLote_('Solicitacoes', novas, u);
    Object.keys(porRotina).forEach(function (rid) { const r = porId_('Rotinas', rid);
      hist_(u, 'solicitacoes', 'Rotinas', rid, rotuloRotina_(r), 'gerou', '', '', '', porRotina[rid] + ' solicitação(ões) até ' + horizonte.split('-').reverse().join('/') + '.'); });
    gravarHistorico_();
    return { ok: true, geradas: novas.length };
  } finally { lock.releaseLock(); }
}
/** Tira as solicitações futuras da rotina que ainda não foram programadas (para regerar com a regra nova ou parar). */
function limparFuturasRotina_(rid, u) {
  const hoje = dataTexto_(new Date());
  const tem = {}; ler_('Paradas').forEach(function (p) { if (p.solicitacaoId) tem[p.solicitacaoId] = 1; });
  const fora = ler_('Solicitacoes').filter(function (s) { return String(s.rotinaId) === rid && s.status === 'Liberada para programar' && !tem[s.id] && dataTexto_(s.dataPrevista) >= hoje; });
  fora.sort(function (a, b) { return b._linha - a._linha; }).forEach(function (s) { aba_('Solicitacoes').deleteRow(s._linha); });
  limparCache_('Solicitacoes');
  if (fora.length) hist_(u, 'solicitacoes', 'Rotinas', rid, rotuloRotina_(porId_('Rotinas', rid)), 'alterou', 'Solicitações futuras removidas', String(fora.length), '', 'Ainda não programadas; serão geradas de novo com a regra atual.');
  return fora.length;
}
function rotSalvar_(reg, u) {
  reg = reg || {};
  const atual = reg.id ? porId_('Rotinas', reg.id) : null;
  if (reg.id && !atual) return erroDados_('Rotina não encontrada.');
  const r = { unidadeId: String(reg.unidadeId || ''), clienteId: String(reg.clienteId || ''), consultorId: String(reg.consultorId || ''), servico: String(reg.servico || ''),
              residuoIds: (Array.isArray(reg.residuoIds) ? reg.residuoIds : separar_(reg.residuoIds)).filter(function (x) { return porId_('Residuos', x); }).join('; '),
              descricao: String(reg.descricao || '').trim(), frequencia: String(reg.frequencia || ''), diaSemana: reg.diaSemana === '' || reg.diaSemana == null ? '' : Number(reg.diaSemana),
              diaMes: reg.diaMes === '' || reg.diaMes == null ? '' : Number(reg.diaMes), dataInicio: dataTexto_(reg.dataInicio), dataFim: dataTexto_(reg.dataFim),
              valorPrevisto: reg.valorPrevisto === '' || reg.valorPrevisto == null ? '' : num_(reg.valorPrevisto), obs: String(reg.obs || '').trim() };
  if (!porId_('Unidades', r.unidadeId) || !veUnidade_(u, r.unidadeId)) return erroDados_('Escolha a unidade.');
  if (!porId_('Cadastros', r.clienteId)) return erroDados_('Escolha o cliente.');
  if (r.consultorId && !porId_('Consultores', r.consultorId)) return erroDados_('Consultor não encontrado.');
  if (ROT_FREQUENCIAS.indexOf(r.frequencia) < 0) return erroDados_('Escolha a frequência.');
  if (r.frequencia === 'Mensal') { if (!(r.diaMes >= 1 && r.diaMes <= 31)) return erroDados_('Informe o dia do mês (1 a 31).'); r.diaSemana = ''; }
  else { if (!(r.diaSemana >= 0 && r.diaSemana <= 6)) return erroDados_('Escolha o dia da semana.'); r.diaMes = ''; }
  if (!r.dataInicio) return erroDados_('Informe a partir de quando.');
  if (r.dataFim && r.dataFim < r.dataInicio) return erroDados_('O fim é antes do início.');
  let id;
  if (atual) {
    id = atual.id;
    const mudouRegra = ['frequencia', 'diaSemana', 'diaMes', 'dataInicio', 'dataFim', 'clienteId', 'unidadeId'].some(function (c) { return String(textoComparavel_('Rotinas', c, atual[c])) !== String(textoComparavel_('Rotinas', c, r[c])); });
    atualizar_('Rotinas', id, r, u, 'solicitacoes', { registroNome: rotuloRotina_(r) });
    if (mudouRegra) { limparFuturasRotina_(id, u); atualizar_('Rotinas', id, { geradaAte: '' }, u, null); }
  } else { r.geradaAte = ''; r.ativo = true; id = inserir_('Rotinas', r, u, 'solicitacoes', rotuloRotina_(r)).id; }
  const g = gerarRecorrentes_(u, true);
  return { ok: true, id: id, geradas: g.geradas };
}
function rotAtivo_(id, ativo, u) {
  const r = porId_('Rotinas', id); if (!r) return erroDados_('Rotina não encontrada.');
  atualizar_('Rotinas', id, { ativo: !!ativo }, u, 'solicitacoes', { registroNome: rotuloRotina_(r) });
  let removidas = 0;
  if (!ativo) removidas = limparFuturasRotina_(id, u);
  else { atualizar_('Rotinas', id, { geradaAte: '' }, u, null); gerarRecorrentes_(u, true); }
  return { ok: true, removidas: removidas };
}

/* ---------------- 4. Minhas solicitações (consultor) ---------------- */
function consultoresDoUsuario_(u) {
  return ler_('Consultores').filter(function (c) { return normEmail_(c.email) === u.email; }).map(function (c) { return c.id; });
}
function minhasDados_(u) {
  const meus = consultoresDoUsuario_(u);
  if (!meus.length) return { ok: true, vinculado: false, solicitacoes: [], clientes: [] };
  const fat = faturamentoPorSolicitacao_();
  const vs = {}; ler_('Viagens').forEach(function (v) { if (v.status !== 'Cancelada') vs[v.id] = v; });
  const prog = {};
  ler_('Paradas').forEach(function (p) { const v = vs[p.viagemId]; if (!v || !p.solicitacaoId) return;
    const x = { data: dataTexto_(p.data) || dataTexto_(v.dataSaida), resultado: String(p.resultado || '') };
    if (!prog[p.solicitacaoId] || prog[p.solicitacaoId].data <= x.data) prog[p.solicitacaoId] = x; });
  const sols = ler_('Solicitacoes').filter(function (s) { return meus.indexOf(String(s.consultorId)) >= 0; }).map(function (s) {
    const f = fat[s.id];
    return { id: s.id, clienteId: String(s.clienteId), unidadeId: String(s.unidadeId), status: String(s.status), motivo: String(s.motivo || ''),
             dataSolicitacao: dataTexto_(s.dataSolicitacao), dataSolicitacaoConsultor: dataTexto_(s.dataSolicitacaoConsultor), dataPrevista: dataTexto_(s.dataPrevista),
             dataColeta: dataTexto_(s.dataColeta), descricao: String(s.descricao || ''), demanda: String(s.demanda || ''), valorPrevisto: s.valorPrevisto === '' ? '' : num_(s.valorPrevisto),
             programacao: prog[s.id] || null, faturamento: f ? { status: f.status, bmNumero: f.bmNumero, bmData: f.bmData, nfNumero: f.nfNumero, nfData: f.nfData, valor: f.nfValor !== '' ? f.nfValor : f.bmValor } : null };
  });
  const cIds = {}; sols.forEach(function (s) { cIds[s.clienteId] = 1; });
  return { ok: true, vinculado: true, solicitacoes: sols, unidades: unidadesLista_(),
           clientes: ler_('Cadastros').filter(function (c) { return cIds[c.id]; }).map(function (c) { return { id: c.id, nome: String(c.nome), codigoUplog: String(c.codigoUplog || '') }; }) };
}
/** Linha do tempo: as mudanças de status registradas no histórico. */
function minhasLinhaTempo_(id, u) {
  const s = porId_('Solicitacoes', id);
  if (!s || consultoresDoUsuario_(u).indexOf(String(s.consultorId)) < 0) return semPermissao_('Esta solicitação não é sua.');
  const sh = abaHist_(); const n = sh.getLastRow();
  const eventos = [{ quando: isoMomento_(s.criadoEm), texto: s.origem === 'planilha' ? 'Importada da planilha de acompanhamento' : s.origem === 'rotina' ? 'Gerada pela coleta recorrente (liberada para programar)' : 'Solicitação registrada' }];
  if (n >= 2) {
    sh.getRange(2, 6, n - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findAll().forEach(function (c) {
      const h = linhaHistorico_(sh.getRange(c.getRow(), 1, 1, HISTORICO_COLUNAS.length).getValues()[0]);
      if (h.campo === 'Status' && h.para) eventos.push({ quando: h.quando, texto: h.para });
    });
  }
  eventos.sort(function (a, b) { return String(a.quando).localeCompare(String(b.quando)); });
  return { ok: true, eventos: eventos };
}
