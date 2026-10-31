/* =====================================================================
 * Faturamento (analista de faturamento). Um BM = uma NF (1 para 1).
 * O BM junta uma ou mais solicitações realizadas do mesmo cliente, com itens detalhados
 * (cobrança ou desconto de valorização). Fluxo: BM enviado → Aprovado → NF emitida (fim).
 * Cancelar o BM devolve as solicitações para "Realizada".
 * ===================================================================== */

const FAT_STATUS = ['BM enviado', 'Aprovado', 'NF emitida', 'Cancelado'];
const FAT_SENTIDOS = ['Cobrança', 'Desconto'];

function arred2_(v) { return Math.round((Number(v) || 0) * 100) / 100; }
function fatPublico_(f) {
  const o = publico_('Faturamentos', f);
  ['bmData', 'aprovacaoData', 'nfData'].forEach(function (c) { o[c] = dataTexto_(f[c]); });
  o.bmValor = num_(f.bmValor); o.nfValor = f.nfValor === '' ? '' : num_(f.nfValor);
  o.itens = onde_('FaturamentoItens', 'faturamentoId', f.id).map(function (it) {
    const x = publico_('FaturamentoItens', it);
    ['quantidade', 'valorUnitario', 'valor'].forEach(function (c) { x[c] = num_(it[c]); });
    return x;
  });
  return o;
}
function precoPublico_(r) {
  const o = publico_('PrecosCliente', r);
  o.vigenciaInicio = dataTexto_(r.vigenciaInicio); o.vigenciaFim = dataTexto_(r.vigenciaFim);
  o.valorTransporte = r.valorTransporte === '' ? '' : num_(r.valorTransporte); o.precoKg = r.precoKg === '' ? '' : num_(r.precoKg);
  return o;
}
function fatDados_(u) {
  const sols = ler_('Solicitacoes').filter(function (r) { return veUnidade_(u, r.unidadeId) && ['Realizada', 'BM enviado', 'NF emitida'].indexOf(String(r.status)) >= 0; })
    .map(solPublica_);
  return { ok: true,
    unidades: unidadesDoUsuario_(u), todasUnidades: unidadesLista_(),
    faturamentos: ler_('Faturamentos').filter(function (f) { return veUnidade_(u, f.unidadeId); }).map(fatPublico_),
    solicitacoes: sols,
    clientes: clientesLista_(),
    consultores: ler_('Consultores').map(function (r) { return { id: r.id, nome: String(r.nome) }; }),
    residuos: ler_('Residuos').map(function (r) { return { id: r.id, nome: String(r.nome) }; }),
    precos: ler_('PrecosCliente').filter(function (p) { return p.ativo; }).map(precoPublico_),
    listas: { unidadeMedida: listaValores_('unidadeMedida'), sentido: FAT_SENTIDOS } };
}

function rotuloFat_(f) {
  const c = porId_('Cadastros', f.clienteId);
  return 'BM ' + (f.bmNumero || 's/nº') + ' · ' + (c ? String(c.nome) : '');
}
function resumoItens_(itens) {
  return itens.map(function (it) {
    return (it.sentido === 'Desconto' ? '− ' : '') + it.descricao + ': ' + it.quantidade + ' ' + (it.unidadeMedida || '') + ' × ' + it.valorUnitario + ' = ' + it.valor;
  }).join(' | ');
}
/** Muda o status das solicitações do BM (sem passar pela trava de status do módulo Solicitações). */
function statusSolicitacoes_(ids, status, u, motivo) {
  ids.forEach(function (id) {
    const s = porId_('Solicitacoes', id); if (!s || s.status === status) return;
    atualizar_('Solicitacoes', id, { status: status }, u, 'faturamento', { registroNome: rotuloSol_(s) });
  });
}
/** Cria ou altera um BM. reg = {id?, clienteId, bmNumero, bmData, obs, itens:[{solicitacaoId, precoClienteId, descricao, quantidade, unidadeMedida, valorUnitario, sentido}]} */
function fatSalvar_(reg, u) {
  reg = reg || {};
  const atual = reg.id ? porId_('Faturamentos', reg.id) : null;
  if (reg.id && !atual) return erroDados_('BM não encontrado. Atualize a página.');
  if (atual && !veUnidade_(u, atual.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  if (atual && (atual.status === 'NF emitida' || atual.status === 'Cancelado')) return erroDados_('BM com NF emitida ou cancelado não pode ser alterado.');
  const cli = porId_('Cadastros', reg.clienteId); if (!cli) return erroDados_('Escolha o cliente.');
  const bmData = dataTexto_(reg.bmData); if (!bmData) return erroDados_('Informe a data de envio do BM.');
  const bmNumero = String(reg.bmNumero || '').trim();
  if (bmNumero && ler_('Faturamentos').some(function (f) { return String(f.bmNumero).trim() === bmNumero && f.id !== reg.id && f.status !== 'Cancelado'; }))
    return erroDados_('Já existe um BM com o número ' + bmNumero + '.');
  const jaNoBm = faturamentoPorSolicitacao_();
  const itens = [];
  let erro = '', unidadeId = '';
  (reg.itens || []).forEach(function (x, i) {
    if (erro) return;
    const it = { solicitacaoId: String(x.solicitacaoId || ''), precoClienteId: String(x.precoClienteId || ''), descricao: String(x.descricao || '').trim(),
                 quantidade: num_(x.quantidade), unidadeMedida: String(x.unidadeMedida || '').trim(), valorUnitario: num_(x.valorUnitario),
                 sentido: FAT_SENTIDOS.indexOf(x.sentido) >= 0 ? x.sentido : 'Cobrança' };
    if (!it.descricao) { erro = 'Item ' + (i + 1) + ': informe a descrição.'; return; }
    if (!(it.quantidade > 0)) { erro = 'Item ' + (i + 1) + ': a quantidade precisa ser maior que zero.'; return; }
    if (it.precoClienteId && !porId_('PrecosCliente', it.precoClienteId)) it.precoClienteId = '';
    if (it.solicitacaoId) {
      const s = porId_('Solicitacoes', it.solicitacaoId);
      if (!s) { erro = 'Item ' + (i + 1) + ': solicitação não encontrada.'; return; }
      if (!veUnidade_(u, s.unidadeId)) { erro = 'Você não tem acesso à unidade da solicitação.'; return; }
      if (String(s.clienteId) !== cli.id && String(cli.cadastroPrincipalId) !== String(s.clienteId) &&
          String((porId_('Cadastros', s.clienteId) || {}).cadastroPrincipalId) !== cli.id) { erro = 'Todas as solicitações do BM precisam ser do mesmo cliente.'; return; }
      const outro = jaNoBm[s.id];
      if (outro && outro.id !== reg.id) { erro = 'A solicitação de ' + dataTexto_(s.dataColeta).split('-').reverse().join('/') + ' já está no BM ' + (outro.bmNumero || outro.id) + '.'; return; }
      if (!outro && s.status !== 'Realizada') { erro = 'Só entram no BM solicitações com status Realizada.'; return; }
      unidadeId = unidadeId || String(s.unidadeId || '');
    }
    it.valor = arred2_(it.quantidade * it.valorUnitario);
    itens.push(it);
  });
  if (erro) return erroDados_(erro);
  const solIds = itens.map(function (it) { return it.solicitacaoId; }).filter(String).filter(function (v, i, a) { return a.indexOf(v) === i; });
  if (!solIds.length) return erroDados_('Inclua pelo menos uma solicitação realizada no BM.');
  const total = arred2_(itens.reduce(function (t, it) { return t + (it.sentido === 'Desconto' ? -it.valor : it.valor); }, 0));
  const campos = { unidadeId: unidadeId, clienteId: cli.id, bmNumero: bmNumero, bmData: bmData, bmValor: total, obs: String(reg.obs || '').trim() };
  let id;
  if (atual) {
    id = atual.id;
    atualizar_('Faturamentos', id, campos, u, 'faturamento', { registroNome: rotuloFat_(campos) });
    const antigos = onde_('FaturamentoItens', 'faturamentoId', id);
    const antes = resumoItens_(antigos.map(function (a) { return { descricao: a.descricao, quantidade: num_(a.quantidade), unidadeMedida: a.unidadeMedida, valorUnitario: num_(a.valorUnitario), valor: num_(a.valor), sentido: a.sentido }; }));
    const depois = resumoItens_(itens);
    const solAntes = antigos.map(function (a) { return String(a.solicitacaoId); }).filter(String);
    antigos.sort(function (a, b) { return b._linha - a._linha; }).forEach(function (a) { aba_('FaturamentoItens').deleteRow(a._linha); });
    limparCache_('FaturamentoItens');
    inserirLote_('FaturamentoItens', itens.map(function (it) { return Object.assign({ faturamentoId: id }, it); }), u);
    if (antes !== depois) hist_(u, 'faturamento', 'Faturamentos', id, rotuloFat_(campos), 'alterou', 'Itens do BM', antes, depois, '');
    const voltam = solAntes.filter(function (x) { return solIds.indexOf(x) < 0; });
    statusSolicitacoes_(voltam, 'Realizada', u);
    statusSolicitacoes_(solIds, atual.status === 'NF emitida' ? 'NF emitida' : 'BM enviado', u);
  } else {
    campos.status = 'BM enviado'; campos.origem = 'portal'; campos.ativo = true;
    id = inserir_('Faturamentos', campos, u, 'faturamento', rotuloFat_(campos)).id;
    inserirLote_('FaturamentoItens', itens.map(function (it) { return Object.assign({ faturamentoId: id }, it); }), u);
    hist_(u, 'faturamento', 'Faturamentos', id, rotuloFat_(campos), 'alterou', 'Itens do BM', '', resumoItens_(itens), '');
    statusSolicitacoes_(solIds, 'BM enviado', u);
  }
  return { ok: true, id: id };
}
function solicitacoesDoBm_(id) {
  return onde_('FaturamentoItens', 'faturamentoId', id).map(function (it) { return String(it.solicitacaoId); }).filter(String)
    .filter(function (v, i, a) { return a.indexOf(v) === i; });
}
/** acao: 'aprovar' {aprovacaoData} | 'nf' {nfNumero, nfData, nfValor} | 'cancelar' {motivo} | 'reabrir' (NF emitida → Aprovado, só admin) */
function fatAcao_(id, acao, x, u) {
  x = x || {};
  const f = porId_('Faturamentos', id); if (!f) return erroDados_('BM não encontrado.');
  if (!veUnidade_(u, f.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  const rot = rotuloFat_(f);
  if (acao === 'aprovar') {
    if (f.status !== 'BM enviado' && f.status !== 'Aprovado') return erroDados_('Só BM enviado pode ser aprovado.');
    const d = dataTexto_(x.aprovacaoData); if (!d) return erroDados_('Informe a data em que o cliente aprovou.');
    atualizar_('Faturamentos', id, { aprovacaoData: d, status: 'Aprovado' }, u, 'faturamento', { registroNome: rot });
    return { ok: true };
  }
  if (acao === 'nf') {
    if (f.status !== 'BM enviado' && f.status !== 'Aprovado') return erroDados_('Este BM não está aberto.');
    const nfNumero = String(x.nfNumero || '').trim(); if (!nfNumero) return erroDados_('Informe o número da NF.');
    const nfData = dataTexto_(x.nfData); if (!nfData) return erroDados_('Informe a data de emissão da NF.');
    const nfValor = x.nfValor === '' || x.nfValor == null ? num_(f.bmValor) : num_(x.nfValor);
    if (ler_('Faturamentos').some(function (o) { return String(o.nfNumero).trim() === nfNumero && o.id !== id && o.status !== 'Cancelado'; }))
      return erroDados_('A NF ' + nfNumero + ' já está registrada em outro BM.');
    const campos = { nfNumero: nfNumero, nfData: nfData, nfValor: nfValor, status: 'NF emitida' };
    if (!dataTexto_(f.aprovacaoData)) campos.aprovacaoData = dataTexto_(x.aprovacaoData) || nfData;
    atualizar_('Faturamentos', id, campos, u, 'faturamento', { registroNome: rot });
    statusSolicitacoes_(solicitacoesDoBm_(id), 'NF emitida', u);
    return { ok: true };
  }
  if (acao === 'cancelar') {
    if (f.status === 'Cancelado') return { ok: true };
    if (f.status === 'NF emitida' && u.modulos.faturamento !== 'admin') return semPermissao_('Só o administrador do Faturamento cancela um BM com NF emitida.');
    const m = String(x.motivo || '').trim(); if (!m) return erroDados_('Informe o motivo do cancelamento.');
    atualizar_('Faturamentos', id, { status: 'Cancelado', motivo: m }, u, 'faturamento', { registroNome: rot });
    statusSolicitacoes_(solicitacoesDoBm_(id), 'Realizada', u);
    return { ok: true };
  }
  if (acao === 'reabrir') {
    if (u.modulos.faturamento !== 'admin') return semPermissao_('Só o administrador do Faturamento reabre um BM.');
    if (f.status !== 'NF emitida') return erroDados_('Só BM com NF emitida pode ser reaberto.');
    atualizar_('Faturamentos', id, { status: 'Aprovado' }, u, 'faturamento', { registroNome: rot });
    statusSolicitacoes_(solicitacoesDoBm_(id), 'BM enviado', u);
    return { ok: true };
  }
  return erroDados_('Ação inválida.');
}

/* ---------------- preço de venda por cliente (mantido no Mapa Operacional) ---------------- */
// Modalidades: Por kg · Transporte + kg · Valorização com transporte (cobra transporte, paga o kg ao cliente)
//              · Valorização sem transporte (só o kg, pago ao cliente / desconto)
function precosVenda_(cadastroId) {
  return { ok: true, precos: onde_('PrecosCliente', 'cadastroId', cadastroId).map(precoPublico_)
    .sort(function (a, b) { return (b.ativo - a.ativo) || String(b.vigenciaInicio).localeCompare(String(a.vigenciaInicio)); }),
    modalidades: listaValores_('modalidadePreco'),
    residuos: ler_('Residuos').filter(function (r) { return r.ativo; }).map(function (r) { return { id: r.id, nome: String(r.nome) }; })
      .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); }) };
}
function rotuloPreco_(r) {
  const c = porId_('Cadastros', r.cadastroId); const res = porId_('Residuos', r.residuoId);
  return (c ? String(c.nome) : '') + ' · ' + (res ? String(res.nome) : 'transporte') + ' · ' + r.modalidade;
}
function salvarPrecoVenda_(reg, u) {
  reg = reg || {};
  const atual = reg.id ? porId_('PrecosCliente', reg.id) : null;
  if (reg.id && !atual) return erroDados_('Preço não encontrado. Atualize.');
  const r = { cadastroId: String(atual ? atual.cadastroId : reg.cadastroId || ''), residuoId: String(reg.residuoId || ''), modalidade: String(reg.modalidade || ''),
              valorTransporte: reg.valorTransporte === '' || reg.valorTransporte == null ? '' : num_(reg.valorTransporte),
              precoKg: reg.precoKg === '' || reg.precoKg == null ? '' : num_(reg.precoKg),
              vigenciaInicio: dataTexto_(reg.vigenciaInicio), vigenciaFim: dataTexto_(reg.vigenciaFim), obs: String(reg.obs || '').trim() };
  if (!porId_('Cadastros', r.cadastroId)) return erroDados_('Cadastro não encontrado.');
  if (listaValores_('modalidadePreco').indexOf(r.modalidade) < 0) return erroDados_('Escolha a modalidade.');
  const comTransporte = r.modalidade === 'Transporte + kg' || r.modalidade === 'Valorização com transporte';
  if (!comTransporte) r.valorTransporte = '';
  if (r.residuoId && !porId_('Residuos', r.residuoId)) return erroDados_('Resíduo não encontrado.');
  if (!r.residuoId && r.modalidade !== 'Transporte + kg' && r.modalidade !== 'Valorização com transporte') return erroDados_('Escolha o resíduo.');
  if (r.precoKg === '' && !(comTransporte && r.valorTransporte !== '')) return erroDados_('Informe o preço por kg' + (comTransporte ? ' e/ou o valor do transporte.' : '.'));
  if (!r.vigenciaInicio) return erroDados_('Informe a data de início da vigência.');
  if (r.vigenciaFim && r.vigenciaFim < r.vigenciaInicio) return erroDados_('O fim da vigência é antes do início.');
  if (atual) { atualizar_('PrecosCliente', atual.id, r, u, 'mapa', { tabela: 'Cadastros', registroId: r.cadastroId, registroNome: rotuloPreco_(r), prefixoCampo: 'Preço de venda · ' }); return { ok: true, id: atual.id }; }
  r.ativo = true;
  const novo = inserir_('PrecosCliente', r, u, null);
  hist_(u, 'mapa', 'Cadastros', r.cadastroId, String(porId_('Cadastros', r.cadastroId).nome), 'alterou', 'Preço de venda incluído', '', resumo_('PrecosCliente', novo), '');
  return { ok: true, id: novo.id };
}
function excluirPrecoVenda_(id, u) {
  const p = porId_('PrecosCliente', id); if (!p) return { ok: true };
  const usos = usos_('PrecosCliente', id);
  const nomeCad = String((porId_('Cadastros', p.cadastroId) || {}).nome || '');
  if (usos.length) {
    atualizar_('PrecosCliente', id, { ativo: false }, u, 'mapa', { tabela: 'Cadastros', registroId: p.cadastroId, registroNome: nomeCad, prefixoCampo: 'Preço de venda · ' });
    return { ok: true, inativado: true, mensagem: 'Este preço já foi usado em BM e foi inativado (o histórico continua).' };
  }
  aba_('PrecosCliente').deleteRow(p._linha); limparCache_('PrecosCliente');
  hist_(u, 'mapa', 'Cadastros', p.cadastroId, nomeCad, 'alterou', 'Preço de venda excluído', resumo_('PrecosCliente', p), '', '');
  return { ok: true };
}
