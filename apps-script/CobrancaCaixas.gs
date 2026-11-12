/* =====================================================================
 * Portal GVC — caixas estacionárias na cobrança (etapa 5 do plano de preço/contrato).
 * - Movimento de caixa de cada coleta (paradas realizadas): entregou + retirou = troca;
 *   só entregou = entrega; só retirou = retirada. Vai para o "Sugerir itens" do BM.
 * - Permanência de cada caixa em cada cliente (entrega → retirada), base do aluguel. As caixas
 *   que já estavam no cliente antes do portal usam a data de entrega informada à mão na Frota.
 * ===================================================================== */

/** {solicitacaoId: [{paradaId, data, entregue:{id,numero,capacidade}|null, retirada:{...}|null}]} */
function caixasDasSols_(sols) {
  const quer = {}; (sols || []).forEach(function (s) { quer[s.id] = 1; });
  const vi = {}; ler_('Viagens').forEach(function (v) { if (v.status !== 'Cancelada') vi[v.id] = 1; });
  const cx = {}; ler_('Caixas').forEach(function (c) { cx[c.id] = { id: c.id, numero: String(c.numero), capacidade: num_(c.capacidade) }; });
  const out = {};
  ler_('Paradas').forEach(function (p) {
    if (!quer[p.solicitacaoId] || !vi[p.viagemId] || p.resultado !== 'Realizada' || !(p.caixaEntregueId || p.caixaRetiradaId)) return;
    (out[p.solicitacaoId] = out[p.solicitacaoId] || []).push({ paradaId: p.id, data: dataTexto_(p.data),
      entregue: p.caixaEntregueId ? cx[p.caixaEntregueId] || null : null, retirada: p.caixaRetiradaId ? cx[p.caixaRetiradaId] || null : null });
  });
  return out;
}

/** Períodos de cada caixa em cada cliente: [{caixaId, numero, capacidade, clienteId, inicio ('' = antes do portal), fim ('' = ainda lá)}] */
function permanenciasCaixas_() {
  const vi = {}; ler_('Viagens').forEach(function (v) { if (v.status !== 'Cancelada') vi[v.id] = 1; });
  const cx = {}; ler_('Caixas').forEach(function (c) { cx[c.id] = c; });
  const ev = [];
  ler_('Paradas').forEach(function (p) {
    if (!vi[p.viagemId] || p.resultado !== 'Realizada') return;
    const d = dataTexto_(p.data);
    // no mesmo dia, a retirada vem antes da entrega (troca: sai a cheia, fica a vazia)
    if (p.caixaRetiradaId) ev.push({ cx: String(p.caixaRetiradaId), cli: String(p.clienteId), data: d, tipo: 0 });
    if (p.caixaEntregueId) ev.push({ cx: String(p.caixaEntregueId), cli: String(p.clienteId), data: d, tipo: 1 });
  });
  ev.sort(function (a, b) { return a.cx.localeCompare(b.cx) || a.data.localeCompare(b.data) || a.tipo - b.tipo; });
  const out = [], aberto = {}, visto = {};
  const novo = function (id, cli, ini) { const c = cx[id] || {}; return { caixaId: id, numero: String(c.numero || ''), capacidade: num_(c.capacidade), unidadeId: String(c.unidadeId || ''), clienteId: cli, inicio: ini, fim: '' }; };
  ev.forEach(function (e) {
    const primeiro = !visto[e.cx]; visto[e.cx] = 1;
    if (e.tipo === 1) { if (aberto[e.cx]) aberto[e.cx].fim = e.data; aberto[e.cx] = novo(e.cx, e.cli, e.data); out.push(aberto[e.cx]); return; }
    if (aberto[e.cx]) { aberto[e.cx].fim = e.data; aberto[e.cx] = null; return; }
    // retirada sem entrega registrada: a caixa já estava lá — desde a data de entrega informada na Frota, se houver
    const de = primeiro && cx[e.cx] ? dataTexto_(cx[e.cx].dataEntrega) : '';
    out.push(Object.assign(novo(e.cx, e.cli, de && de <= e.data ? de : ''), { fim: e.data }));
  });
  // caixas no cliente sem entrega pelo portal: data de entrega informada na Frota
  Object.keys(cx).forEach(function (id) {
    const c = cx[id];
    if (c.situacao !== 'Em cliente' || !c.cadastroAtualId || aberto[id]) return;
    if (out.some(function (o) { return o.caixaId === id && !o.fim; })) return;
    out.push(novo(id, String(c.cadastroAtualId), dataTexto_(c.dataEntrega)));
  });
  return out;
}

/* ---------------- migração (ESQUEMA 16) ---------------- */
function migrarCaixasCobranca_() {
  migrarCabecalho_('Caixas');
  migrarCabecalho_('Paradas');
  HIST_BUF_.push([new Date(), '', 'sistema', 'programacao', 'Caixas', '', '', 'migrou', '', '', '',
    'Cobrança de caixas e veículo: data de entrega da caixa no cliente, troca do veículo combinada com o cliente na parada.']);
}
