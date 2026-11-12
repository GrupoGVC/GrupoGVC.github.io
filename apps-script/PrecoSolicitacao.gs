/* =====================================================================
 * Portal GVC — preço previsto da solicitação (etapa 4 do plano de preço/contrato).
 * Perfil Contrato: quadro com os itens do contrato vigentes na data da solicitação
 *   (transporte pelo tipo de veículo, kg por resíduo, caixas); o valor da tabela é calculado
 *   e, se o valor previsto for diferente, a justificativa é obrigatória.
 * Perfil Proposta: itens da proposta (mesmos tipos, valores digitados), nº e data da proposta;
 *   o valor previsto é a soma dos itens. Para liberar: nº, data e pelo menos um item.
 * Tabela SolicitacaoPrecos (SPR): uma linha por item previsto. Valorização entra como desconto.
 * ===================================================================== */

function precoSolPublico_(r) {
  const o = publico_('SolicitacaoPrecos', r);
  o.quantidade = num_(r.quantidade); o.valorUnitario = num_(r.valorUnitario); o.ordem = num_(r.ordem);
  o.capacidade = r.capacidade === '' || r.capacidade == null ? '' : num_(r.capacidade);
  o.destinacaoInclusa = simNao_(r.destinacaoInclusa); o.un = (TIPOS_ITEM[r.tipo] || {}).un || '';
  return o;
}
function precosDaSolicitacao_(sid) {
  return onde_('SolicitacaoPrecos', 'solicitacaoId', sid).sort(function (a, b) { return num_(a.ordem) - num_(b.ordem); });
}
function valorLinhaSol_(p) { return r2_(num_(p.quantidade) * num_(p.valorUnitario) * (p.tipo === 'Valorização' ? -1 : 1)); }
function totalPrecosSol_(linhas) { return r2_(linhas.reduce(function (t, p) { return t + valorLinhaSol_(p); }, 0)); }
function resumoPrecosSol_(linhas) {
  return linhas.map(function (p) { return rotuloItem_(p) + ': ' + num_(p.quantidade) + ' ' + ((TIPOS_ITEM[p.tipo] || {}).un || '') + ' × ' + num_(p.valorUnitario); }).join(' | ');
}

/** Confere as linhas enviadas pela tela. sol = dados já validados (perfil, clienteId, dataSolicitacao…).
 *  Devolve {erro} ou {linhas, total}. Do contrato, o valor unitário vem sempre da tabela. */
function validarPrecosSol_(sol, linhas) {
  const out = [];
  const perfil = String(sol.perfil || '');
  const vig = perfil === 'Contrato' ? itensVigentes_(sol.clienteId, dataRefPreco_(sol)) : [];
  for (let i = 0; i < (linhas || []).length; i++) {
    const x = linhas[i] || {}; const n = 'Item ' + (i + 1) + ': ';
    const qtd = x.quantidade === '' || x.quantidade == null ? 0 : num_(x.quantidade);
    if (qtd < 0) return { erro: n + 'quantidade inválida.' };
    if (perfil === 'Contrato') {
      const it = vig.filter(function (v) { return v.id === String(x.contratoItemId || ''); })[0];
      if (!it) return { erro: n + 'o item não está vigente no contrato do cliente na data da solicitação. Atualize a página.' };
      if (!(qtd > 0)) continue; // sem quantidade não entra na previsão
      out.push({ origem: 'Contrato', contratoItemId: it.id, tipo: String(it.tipo), tipoVeiculoId: String(it.tipoVeiculoId || ''), residuoId: String(it.residuoId || ''),
        capacidade: it.capacidade === '' || it.capacidade == null ? '' : num_(it.capacidade), destinacaoInclusa: simNao_(it.destinacaoInclusa) ? 'SIM' : 'NÃO',
        cobrancaAluguel: String(it.cobrancaAluguel || ''), quantidade: qtd, valorUnitario: num_(it.valor), obs: String(x.obs || '').trim() });
    } else if (perfil === 'Proposta') {
      const r = { origem: 'Proposta', contratoItemId: '', tipo: String(x.tipo || ''), tipoVeiculoId: String(x.tipoVeiculoId || ''), residuoId: String(x.residuoId || ''),
        capacidade: x.capacidade === '' || x.capacidade == null ? '' : num_(x.capacidade), destinacaoInclusa: x.destinacaoInclusa === true ? 'SIM' : 'NÃO',
        cobrancaAluguel: String(x.cobrancaAluguel || ''), quantidade: qtd, valorUnitario: x.valorUnitario === '' || x.valorUnitario == null ? '' : num_(x.valorUnitario), obs: String(x.obs || '').trim() };
      const t = TIPOS_ITEM[r.tipo]; if (!t) return { erro: n + 'escolha o tipo do item da proposta.' };
      if (!t.veiculo) r.tipoVeiculoId = ''; if (!t.residuo) r.residuoId = ''; if (!t.caixa) r.capacidade = '';
      if (!t.inclusa) r.destinacaoInclusa = 'NÃO'; if (!t.aluguel) r.cobrancaAluguel = '';
      if (r.tipoVeiculoId && !porId_('TiposVeiculo', r.tipoVeiculoId)) return { erro: n + 'tipo de veículo não encontrado.' };
      if (t.residuo && !porId_('Residuos', r.residuoId)) return { erro: n + 'escolha o resíduo.' };
      if (t.caixa && !(num_(r.capacidade) > 0)) return { erro: n + 'informe a capacidade da caixa (m³).' };
      if (t.aluguel && COBRANCAS_ALUGUEL.indexOf(r.cobrancaAluguel) < 0) return { erro: n + 'escolha como cobra o aluguel.' };
      if (r.valorUnitario === '' || !(r.valorUnitario >= 0)) return { erro: n + 'informe o valor unitário da proposta.' };
      if (!(qtd > 0)) return { erro: n + 'informe a quantidade.' };
      out.push(r);
    } else if (linhas.length) return { erro: 'Escolha o perfil (Contrato ou Proposta) para informar os itens previstos.' };
  }
  return { linhas: out, total: totalPrecosSol_(out) };
}
/** Troca as linhas previstas da solicitação (histórico quando mudam). */
function salvarPrecosSol_(sol, linhas, u) {
  const atuais = precosDaSolicitacao_(sol.id);
  const antes = resumoPrecosSol_(atuais), depois = resumoPrecosSol_(linhas);
  if (antes === depois) return;
  atuais.sort(function (a, b) { return b._linha - a._linha; }).forEach(function (a) { aba_('SolicitacaoPrecos').deleteRow(a._linha); });
  limparCache_('SolicitacaoPrecos');
  inserirLote_('SolicitacaoPrecos', linhas.map(function (p, i) { return Object.assign({ solicitacaoId: sol.id, ordem: i + 1 }, p); }), u);
  hist_(u, 'solicitacoes', 'Solicitacoes', sol.id, rotuloSol_(sol), 'alterou', 'Itens previstos (' + (sol.perfil || 'sem perfil') + ')', antes, depois, '');
}
/** Regras do valor previsto na gravação. r = campos da solicitação (mutado). Devolve '' ou o erro. */
function aplicarPrecoPrevisto_(r, calc) {
  if (r.perfil === 'Contrato' && calc.linhas.length) {
    r.valorTabela = calc.total;
    if (r.valorPrevisto === '' || r.valorPrevisto == null) r.valorPrevisto = calc.total;
    if (Math.abs(num_(r.valorPrevisto) - calc.total) > 0.005) {
      if (!String(r.justificativaValor || '').trim()) return 'O valor previsto (R$ ' + num_(r.valorPrevisto) + ') é diferente do contrato (R$ ' + calc.total + '): informe a justificativa.';
      r.justificativaValor = String(r.justificativaValor).trim();
    } else r.justificativaValor = '';
  } else if (r.perfil === 'Proposta' && calc.linhas.length) {
    r.valorPrevisto = calc.total; r.valorTabela = ''; r.justificativaValor = '';
  } else { r.valorTabela = ''; r.justificativaValor = ''; }
  return '';
}
/** O que falta da proposta para liberar (vazio = nada). */
function faltaProposta_(s, precosNovos) {
  if (String(s.perfil || '') !== 'Proposta') return [];
  const f = [];
  if (!String(s.propostaNumero || '').trim()) f.push('o nº da proposta');
  if (!dataTexto_(s.propostaData)) f.push('a data da proposta');
  const n = precosNovos ? precosNovos.length : (s.id ? precosDaSolicitacao_(s.id).length : 0);
  if (!n) f.push('os itens da proposta');
  return f;
}

/* ---------------- migração (ESQUEMA 15) ---------------- */
function migrarPrecoSolicitacao_() {
  migrarCabecalho_('Solicitacoes');
  aba_('SolicitacaoPrecos');
  HIST_BUF_.push([new Date(), '', 'sistema', 'solicitacoes', 'Solicitacoes', '', '', 'migrou', '', '', '',
    'Preço previsto da solicitação: tipo de veículo, quadro do contrato (valor da tabela e justificativa), itens, nº e data da proposta.']);
}
