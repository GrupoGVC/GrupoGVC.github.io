/* =====================================================================
 * Portal GVC — indicadores previsto × real das coletas (Solicitações › Previsto × real).
 * Previsto = o que o solicitante informou (resíduos com peso e destinador, km, diárias, pernoites).
 * Real = destinação confirmada no Controle (ticket da balança) + viagem (km rodada, dias, pernoites).
 * Viagem com mais de uma coleta: km, dias e pernoites são divididos pela km prevista de cada coleta
 * (sem km prevista, em partes iguais).
 * ===================================================================== */

const STATUS_COM_REAL = ['Realizada', 'Destinação', 'BM enviado', 'NF emitida'];
function r2_(v) { return Math.round(v * 100) / 100; }

/** de/ate = 'AAAA-MM' (mês da coleta). */
function previstoReal_(de, ate, u) {
  const hoje = dataTexto_(new Date());
  ate = /^\d{4}-\d{2}$/.test(String(ate || '')) ? String(ate) : hoje.slice(0, 7);
  de = /^\d{4}-\d{2}$/.test(String(de || '')) ? String(de) : addMes_(ate, -2);
  if (de > ate) { const t = de; de = ate; ate = t; }
  const sols = ler_('Solicitacoes').filter(function (s) {
    const m = dataTexto_(s.dataColeta).slice(0, 7);
    return m && m >= de && m <= ate && STATUS_COM_REAL.indexOf(String(s.status)) >= 0 && veUnidade_(u, s.unidadeId);
  });
  const ids = {}; sols.forEach(function (s) { ids[s.id] = 1; });
  // natureza (custo/receita) por destinador e resíduo, sem ler a tabela a cada linha
  const natCR = {}, precoCR = {};
  ler_('CadastroResiduos').forEach(function (r) { if (r.natureza) natCR[r.cadastroId + '|' + r.residuoId] = String(r.natureza); precoCR[r.cadastroId + '|' + r.residuoId] = num_(r.precoKg); });
  const tipos = {}; ler_('Cadastros').forEach(function (c) { tipos[c.id] = separar_(c.tipos); });
  const natureza = function (d, r) { if (natCR[d + '|' + r]) return natCR[d + '|' + r]; const t = tipos[d] || []; return t.indexOf('reciclador') >= 0 && t.indexOf('destinador') < 0 ? 'receita' : 'custo'; };
  const itens = {}; ler_('SolicitacaoItens').forEach(function (it) { if (ids[it.solicitacaoId]) (itens[it.solicitacaoId] = itens[it.solicitacaoId] || []).push(it); });
  const lancs = {}; ler_('Lancamentos').forEach(function (l) { if (l.ativo && l.situacao !== SIT_PENDENTE && ids[l.solicitacaoId]) (lancs[l.solicitacaoId] = lancs[l.solicitacaoId] || []).push(l); });
  // viagens das coletas e a parte de cada coleta na viagem
  const viagens = {}; ler_('Viagens').forEach(function (v) { if (v.status !== 'Cancelada') viagens[v.id] = v; });
  const paradasV = {}; ler_('Paradas').forEach(function (p) { if (viagens[p.viagemId] && p.resultado === 'Realizada') (paradasV[p.viagemId] = paradasV[p.viagemId] || []).push(p); });
  const kmPrevSol = {}; ler_('Solicitacoes').forEach(function (s) { kmPrevSol[s.id] = num_(s.kmPrevista); });
  const viagemDe = {}; Object.keys(paradasV).forEach(function (vid) { paradasV[vid].forEach(function (p) { if (ids[p.solicitacaoId]) (viagemDe[p.solicitacaoId] = viagemDe[p.solicitacaoId] || []).push(vid); }); });
  // previsto = destinador escolhido pelo solicitante (se a programadora trocou, vale o preço do previsto)
  const prevItem = function (it) {
    const dp = String(it.destinadorPrevistoId || it.destinadorId || ''), r = String(it.residuoId);
    const trocou = it.destinadorPrevistoId && String(it.destinadorPrevistoId) !== String(it.destinadorId);
    return { destinadorId: dp, preco: trocou ? (precoCR[dp + '|' + r] || 0) : num_(it.precoKg), natureza: trocou || !it.natureza ? natureza(dp, r) : String(it.natureza) };
  };
  const parte = function (vid, sid) {
    const ps = paradasV[vid] || []; const tot = ps.reduce(function (t, p) { return t + (p.solicitacaoId ? kmPrevSol[p.solicitacaoId] || 0 : 0); }, 0);
    return tot > 0 ? (kmPrevSol[sid] || 0) / tot : 1 / Math.max(1, ps.length);
  };
  const linhas = sols.map(function (s) {
    const its = (itens[s.id] || []), ls = (lancs[s.id] || []);
    const prev = { kg: '', custo: '', receita: '', km: numOuVazio_(s.kmPrevista), diarias: numOuVazio_(s.diariasPrevistas), pernoites: numOuVazio_(s.pernoitesPrevistos) };
    if (its.some(function (it) { return it.pesoEstimado !== ''; })) {
      prev.kg = 0; prev.custo = 0; prev.receita = 0;
      its.forEach(function (it) { const pi = prevItem(it), kg = num_(it.pesoEstimado), v = kg * pi.preco; prev.kg += kg; if (pi.natureza === 'receita') prev.receita += v; else prev.custo += v; });
      prev.kg = r2_(prev.kg); prev.custo = r2_(prev.custo); prev.receita = r2_(prev.receita);
    }
    const destinada = ls.length > 0;
    const real = { kg: '', custo: '', receita: '', km: '', diarias: '', pernoites: '' };
    if (destinada) {
      real.kg = 0; real.custo = 0; real.receita = 0;
      ls.forEach(function (l) { real.kg += num_(l.kg); if (natureza(String(l.destinadorId), String(l.residuoId)) === 'receita') real.receita += num_(l.valor); else real.custo += num_(l.valor); });
      real.kg = r2_(real.kg); real.custo = r2_(real.custo); real.receita = r2_(real.receita);
    }
    const vids = (viagemDe[s.id] || []).filter(function (x, i, a) { return a.indexOf(x) === i; });
    const proprias = vids.map(function (vid) { return viagens[vid]; }).filter(function (v) { return v.execucao !== 'Terceirizada'; });
    if (proprias.length) {
      let km = 0, kmOk = true, dias = 0, diasOk = true, pern = 0;
      proprias.forEach(function (v) {
        const f = parte(v.id, s.id);
        const ki = numOuVazio_(v.kmInicial), kf = numOuVazio_(v.kmFinal);
        if (ki !== '' && kf !== '' && kf >= ki) km += (kf - ki) * f; else kmOk = false;
        const ret = v.status === 'Concluída' ? dataTexto_(v.dataRetorno) : '';
        if (ret) { dias += (diasEntre_(dataTexto_(v.dataSaida), ret) + 1) * f; pern += num_(v.pernoitesRealizados) * f; } else diasOk = false;
      });
      if (kmOk) real.km = Math.round(km);
      if (diasOk) { real.diarias = r2_(dias); real.pernoites = r2_(pern); }
    }
    // por destinador: previsto pelo solicitante × para onde foi
    const porD = {};
    const d = function (id) { return porD[id] || (porD[id] = { destinadorId: id, prevKg: 0, prevValor: 0, realKg: 0, realValor: 0, natureza: '' }); };
    its.forEach(function (it) { const pi = prevItem(it); if (!pi.destinadorId) return; const x = d(pi.destinadorId); x.prevKg += num_(it.pesoEstimado); x.prevValor += num_(it.pesoEstimado) * pi.preco; x.natureza = x.natureza || pi.natureza; });
    ls.forEach(function (l) { const x = d(String(l.destinadorId)); x.realKg += num_(l.kg); x.realValor += num_(l.valor); x.natureza = x.natureza || natureza(String(l.destinadorId), String(l.residuoId)); });
    const trocas = its.filter(function (it) { return it.destinadorPrevistoId && it.destinadorId && it.destinadorPrevistoId !== it.destinadorId; }).length +
      ls.filter(function (l) { return l.destinadorPrevistoId && String(l.destinadorPrevistoId) !== String(l.destinadorId); }).length;
    return { id: s.id, clienteId: String(s.clienteId), consultorId: String(s.consultorId || ''), unidadeId: String(s.unidadeId || ''), dataColeta: dataTexto_(s.dataColeta),
      status: String(s.status), servico: String(s.servico || ''), destinada: destinada, kmCobranca: String(s.kmCobranca || ''), kmCobrado: numOuVazio_(s.kmCobrado), viagens: vids.length, trocas: trocas, prev: prev, real: real,
      destinos: Object.keys(porD).map(function (k) { const x = porD[k]; return { destinadorId: k, prevKg: r2_(x.prevKg), prevValor: r2_(x.prevValor), realKg: r2_(x.realKg), realValor: r2_(x.realValor), natureza: x.natureza || 'custo' }; }) };
  });
  const usados = {}; linhas.forEach(function (l) { usados[l.clienteId] = 1; l.destinos.forEach(function (x) { usados[x.destinadorId] = 1; }); });
  const nomes = {}; ler_('Cadastros').forEach(function (c) { if (usados[c.id]) nomes[c.id] = String(c.nome || c.razaoSocial || c.id); });
  return { ok: true, de: de, ate: ate, linhas: linhas, nomes: nomes, limite: LIMITE_DIVERGENCIA };
}
