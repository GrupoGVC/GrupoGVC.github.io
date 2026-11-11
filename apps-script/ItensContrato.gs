/* =====================================================================
 * Portal GVC — itens do contrato do cliente (preço de venda).
 * Substituem as 6 modalidades combinadas (tabela PrecosCliente, que fica só como arquivo):
 * cada item é uma coisa cobrada, com o seu valor e a sua vigência, ligado ao contrato
 * (ou a um aditivo) do cliente:
 *   Transporte por viagem / por km  (por tipo de veículo; vazio = qualquer veículo)
 *   Destinação / Valorização        (por resíduo, R$/kg; valorização é paga ao cliente = desconto)
 *   Entrega / Retirada / Troca / Aluguel de caixa (por capacidade; troca pode ter a destinação inclusa;
 *                                    aluguel por mês cheio ou proporcional aos dias)
 * Vale o item vigente na data da solicitação; o do próprio cliente vem antes do da matriz.
 * ===================================================================== */

const TIPOS_ITEM = {
  'Transporte por viagem': { un: 'viagem', veiculo: true },
  'Transporte por km':     { un: 'km', veiculo: true },
  'Destinação':            { un: 'kg', residuo: true },
  'Valorização':           { un: 'kg', residuo: true, desconto: true },
  'Entrega de caixa':      { un: 'caixa', caixa: true },
  'Retirada de caixa':     { un: 'caixa', caixa: true },
  'Troca de caixa':        { un: 'troca', caixa: true, inclusa: true },
  'Aluguel de caixa':      { un: 'mês', caixa: true, aluguel: true },
};
const COBRANCAS_ALUGUEL = ['Mês cheio', 'Proporcional aos dias'];
const CAPACIDADES_PADRAO = [5, 30, 40];

/* ---------------- leitura ---------------- */
function itemContratoPublico_(r) {
  const o = publico_('ContratoItens', r);
  o.vigenciaInicio = dataTexto_(r.vigenciaInicio); o.vigenciaFim = dataTexto_(r.vigenciaFim);
  o.valor = num_(r.valor); o.capacidade = r.capacidade === '' || r.capacidade == null ? '' : num_(r.capacidade);
  o.destinacaoInclusa = simNao_(r.destinacaoInclusa); o.un = (TIPOS_ITEM[r.tipo] || {}).un || '';
  return o;
}
function chaveItem_(it) { return [it.tipo, it.tipoVeiculoId || '', it.residuoId || '', it.capacidade === '' || it.capacidade == null ? '' : num_(it.capacidade)].join('|'); }
function vigenteEm_(it, data) {
  const ini = dataTexto_(it.vigenciaInicio), fim = dataTexto_(it.vigenciaFim);
  return (!ini || ini <= data) && (!fim || fim >= data);
}
/** Itens vigentes do cliente na data (o próprio antes da matriz; um por chave). */
function itensVigentes_(clienteId, data) {
  const c = porId_('Cadastros', clienteId); if (!c) return [];
  const ids = [String(c.id)]; if (c.cadastroPrincipalId) ids.push(String(c.cadastroPrincipalId));
  const vig = ler_('ContratoItens').filter(function (it) { return it.ativo && ids.indexOf(String(it.cadastroId)) >= 0 && vigenteEm_(it, data); })
    .sort(function (a, b) { return ids.indexOf(String(a.cadastroId)) - ids.indexOf(String(b.cadastroId)) || String(dataTexto_(b.vigenciaInicio)).localeCompare(String(dataTexto_(a.vigenciaInicio))); });
  const vistos = {};
  return vig.filter(function (it) { const k = chaveItem_(it); if (vistos[k]) return false; vistos[k] = 1; return true; });
}
/** Item de transporte (por viagem ou por km) para o tipo de veículo: o do veículo, senão o de "qualquer veículo",
 *  senão o único que houver. Sem veículo definido e vários itens: só responde se todos forem do mesmo tipo de cobrança. */
function transporteDoVeiculo_(itens, tipoVeiculoId) {
  const ts = itens.filter(function (it) { return it.tipo === 'Transporte por viagem' || it.tipo === 'Transporte por km'; });
  if (!ts.length) return null;
  const exato = tipoVeiculoId ? ts.filter(function (it) { return String(it.tipoVeiculoId) === String(tipoVeiculoId); })[0] : null;
  if (exato) return exato;
  const geral = ts.filter(function (it) { return !it.tipoVeiculoId; })[0];
  if (geral) return geral;
  if (ts.length === 1) return ts[0];
  if (!tipoVeiculoId && ts.every(function (it) { return it.tipo === ts[0].tipo; })) return ts[0];
  return null;
}
/** {solicitacaoId: tipoVeiculoId} do veículo que fez a coleta (parada realizada), senão o da parada pendente, senão o da frustrada. */
function veiculosDasSols_(sols) {
  const quer = {}; (sols || []).forEach(function (s) { quer[s.id] = 1; });
  const vi = {}; ler_('Viagens').forEach(function (v) { if (v.status !== 'Cancelada') vi[v.id] = v; });
  const ve = {}; ler_('Veiculos').forEach(function (v) { ve[v.id] = String(v.tipoVeiculoId || ''); });
  const peso = { 'Realizada': 3, 'Pendente': 2, '': 2, 'Frustrada': 1 };
  const out = {}, pr = {};
  ler_('Paradas').forEach(function (p) {
    const v = vi[p.viagemId], w = peso[String(p.resultado || '')];
    if (!quer[p.solicitacaoId] || !v || !w || !v.veiculoId || !ve[v.veiculoId]) return;
    if (w >= (pr[p.solicitacaoId] || 0)) { pr[p.solicitacaoId] = w; out[p.solicitacaoId] = ve[v.veiculoId]; }
  });
  return out;
}
function tipoVeiculoDaSol_(sid) { return sid ? veiculosDasSols_([{ id: sid }])[sid] || '' : ''; }
/** Preço por km vigente do cliente (ou da matriz) na data, para o tipo de veículo (null se o transporte não é por km). */
function precoKmVigente_(clienteId, data, tipoVeiculoId) {
  const it = transporteDoVeiculo_(itensVigentes_(clienteId, data || hojeTxt_()), tipoVeiculoId || '');
  return it && it.tipo === 'Transporte por km' ? { id: it.id, modalidade: 'Transporte por km', valorKm: num_(it.valor), cadastroId: String(it.cadastroId), tipoVeiculoId: String(it.tipoVeiculoId || '') } : null;
}
function nomeTipoVeiculo_(id) { const t = id ? porId_('TiposVeiculo', id) : null; return t ? String(t.nome) : ''; }
function rotuloItem_(it) {
  const res = it.residuoId ? porId_('Residuos', it.residuoId) : null;
  return [it.tipo, nomeTipoVeiculo_(it.tipoVeiculoId), res ? String(res.nome) : '', it.capacidade !== '' && it.capacidade != null ? it.capacidade + ' m³' : ''].filter(Boolean).join(' · ');
}

/** Tela do Mapa: itens do cliente, contrato/aditivos para a origem e as listas. */
function itensContratoDados_(cadastroId) {
  const cad = porId_('Cadastros', cadastroId); if (!cad) return erroDados_('Cadastro não encontrado.');
  const ct = contratoDoCliente_(cad.id) || (cad.cadastroPrincipalId ? contratoDoCliente_(cad.cadastroPrincipalId) : null);
  const caps = CAPACIDADES_PADRAO.slice();
  ler_('Caixas').forEach(function (c) { const n = num_(c.capacidade); if (n > 0 && caps.indexOf(n) < 0) caps.push(n); });
  return { ok: true,
    itens: onde_('ContratoItens', 'cadastroId', cad.id).map(itemContratoPublico_)
      .sort(function (a, b) { return (b.ativo - a.ativo) || Object.keys(TIPOS_ITEM).indexOf(a.tipo) - Object.keys(TIPOS_ITEM).indexOf(b.tipo) || String(b.vigenciaInicio).localeCompare(String(a.vigenciaInicio)); }),
    contrato: ct ? { id: ct.id, numero: String(ct.numero || ''), inicio: dataTexto_(ct.inicio),
      aditivos: aditivosDe_(ct.id).map(function (a) { return { id: a.id, numero: String(a.numero || ''), data: dataTexto_(a.data) }; }) } : null,
    tipos: Object.keys(TIPOS_ITEM).map(function (k) { return Object.assign({ nome: k }, TIPOS_ITEM[k]); }),
    cobrancasAluguel: COBRANCAS_ALUGUEL, capacidades: caps.sort(function (a, b) { return a - b; }),
    tiposVeiculo: ler_('TiposVeiculo').filter(function (t) { return t.ativo; }).map(function (t) { return { id: t.id, nome: String(t.nome) }; }),
    residuos: ler_('Residuos').filter(function (r) { return r.ativo; }).map(function (r) { return { id: r.id, nome: String(r.nome) }; })
      .sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); }) };
}

/* ---------------- gravação ---------------- */
/** Contrato do cliente; sem contrato, cria um "a completar" (sem validade nem arquivo). */
function contratoParaItens_(cad, inicio, u) {
  const ct = contratoDoCliente_(cad.id) || (cad.cadastroPrincipalId ? contratoDoCliente_(cad.cadastroPrincipalId) : null); if (ct) return ct;
  const novo = inserir_('Contratos', { cadastroId: cad.id, numero: '', objeto: '', inicio: inicio || hojeTxt_(), validade: '', renovacaoAutomatica: 'NÃO', encerrado: 'NÃO',
    obs: 'Criado com os itens de preço: complete o número, a validade e anexe o contrato.', ativo: true }, u, null);
  if (u) hist_(u, 'mapa', 'Cadastros', cad.id, String(cad.nome), 'alterou', 'Contrato incluído', '', 'a completar (criado com os itens de preço)', '');
  return novo;
}
function validarItem_(r) {
  const t = TIPOS_ITEM[r.tipo]; if (!t) return 'Escolha o tipo do item.';
  if (!t.veiculo) r.tipoVeiculoId = '';
  if (!t.residuo) r.residuoId = '';
  if (!t.caixa) r.capacidade = '';
  if (!t.inclusa) r.destinacaoInclusa = 'NÃO';
  if (!t.aluguel) r.cobrancaAluguel = '';
  if (r.tipoVeiculoId && !porId_('TiposVeiculo', r.tipoVeiculoId)) return 'Tipo de veículo não encontrado.';
  if (t.residuo && !r.residuoId) return 'Escolha o resíduo.';
  if (r.residuoId && !porId_('Residuos', r.residuoId)) return 'Resíduo não encontrado.';
  if (t.caixa && !(num_(r.capacidade) > 0)) return 'Informe a capacidade da caixa (m³).';
  if (t.aluguel && COBRANCAS_ALUGUEL.indexOf(r.cobrancaAluguel) < 0) return 'Escolha como cobra o aluguel: mês cheio ou proporcional aos dias.';
  if (r.valor === '' || !(num_(r.valor) >= 0)) return 'Informe o valor.';
  if (!r.vigenciaInicio) return 'Informe o início da vigência.';
  if (r.vigenciaFim && r.vigenciaFim < r.vigenciaInicio) return 'O fim da vigência é antes do início.';
  return '';
}
/** reg = {id?, cadastroId, tipo, tipoVeiculoId, residuoId, capacidade, destinacaoInclusa, cobrancaAluguel, valor, vigenciaInicio, vigenciaFim, aditivoId, obs} */
function salvarItemContrato_(reg, u) {
  reg = reg || {};
  const atual = reg.id ? porId_('ContratoItens', reg.id) : null;
  if (reg.id && !atual) return erroDados_('Item não encontrado. Atualize.');
  const cad = porId_('Cadastros', atual ? atual.cadastroId : String(reg.cadastroId || '')); if (!cad) return erroDados_('Cadastro não encontrado.');
  const r = { cadastroId: cad.id, tipo: String(reg.tipo || ''), tipoVeiculoId: String(reg.tipoVeiculoId || ''), residuoId: String(reg.residuoId || ''),
    capacidade: reg.capacidade === '' || reg.capacidade == null ? '' : num_(reg.capacidade), destinacaoInclusa: reg.destinacaoInclusa === true ? 'SIM' : 'NÃO',
    cobrancaAluguel: String(reg.cobrancaAluguel || ''), valor: reg.valor === '' || reg.valor == null ? '' : num_(reg.valor),
    vigenciaInicio: dataTexto_(reg.vigenciaInicio), vigenciaFim: dataTexto_(reg.vigenciaFim), aditivoId: String(reg.aditivoId || ''), obs: String(reg.obs || '').trim() };
  const erro = validarItem_(r); if (erro) return erroDados_(erro);
  const ct = contratoParaItens_(cad, r.vigenciaInicio, u);
  r.contratoId = ct.id;
  if (r.aditivoId) { const a = porId_('ContratoAditivos', r.aditivoId); if (!a || String(a.contratoId) !== ct.id) return erroDados_('Aditivo não encontrado neste contrato.'); }
  // mesmo item com vigência que se sobrepõe: encerre o anterior (campo "Até") ou altere o existente
  const k = chaveItem_(r);
  const choca = onde_('ContratoItens', 'cadastroId', cad.id).filter(function (x) {
    if (!x.ativo || (atual && x.id === atual.id) || chaveItem_(x) !== k) return false;
    const i1 = dataTexto_(x.vigenciaInicio), f1 = dataTexto_(x.vigenciaFim) || '9999-12-31', f2 = r.vigenciaFim || '9999-12-31';
    return i1 <= f2 && r.vigenciaInicio <= f1;
  })[0];
  if (choca) return erroDados_('Já existe "' + rotuloItem_(choca) + '" vigente de ' + dataBr_(choca.vigenciaInicio) + (choca.vigenciaFim ? ' até ' + dataBr_(choca.vigenciaFim) : ' sem fim') +
    '. Para reajuste, informe o "Até" no item atual e cadastre o novo a partir do dia seguinte.');
  const opc = { tabela: 'Cadastros', registroId: cad.id, registroNome: String(cad.nome), prefixoCampo: 'Preço · ' + rotuloItem_(r) + ' · ' };
  if (atual) { atualizar_('ContratoItens', atual.id, r, u, 'mapa', opc); return { ok: true, id: atual.id }; }
  r.ativo = true;
  const novo = inserir_('ContratoItens', r, u, null);
  hist_(u, 'mapa', 'Cadastros', cad.id, String(cad.nome), 'alterou', 'Preço incluído', '', rotuloItem_(r) + ' · R$ ' + num_(r.valor) + ' por ' + TIPOS_ITEM[r.tipo].un + ' · desde ' + dataBr_(r.vigenciaInicio), '');
  return { ok: true, id: novo.id };
}
function excluirItemContrato_(id, u) {
  const it = porId_('ContratoItens', id); if (!it) return { ok: true };
  const cad = porId_('Cadastros', it.cadastroId) || {};
  const usos = usos_('ContratoItens', id);
  if (usos.length) {
    atualizar_('ContratoItens', id, { ativo: false }, u, 'mapa', { tabela: 'Cadastros', registroId: cad.id, registroNome: String(cad.nome || ''), prefixoCampo: 'Preço · ' + rotuloItem_(it) + ' · ' });
    return { ok: true, inativado: true, mensagem: 'O preço já foi usado em BM: ficou inativo (o histórico do BM continua).' };
  }
  aba_('ContratoItens').deleteRow(it._linha); limparCache_('ContratoItens');
  hist_(u, 'mapa', 'Cadastros', cad.id || '', String(cad.nome || ''), 'alterou', 'Preço excluído', rotuloItem_(it) + ' · R$ ' + num_(it.valor), '', '');
  return { ok: true };
}

/* ---------------- modalidades antigas → itens ---------------- */
/** Uma linha no formato antigo (modalidade + transporte + R$/kg) vira 1 ou 2 itens. */
function itensDaModalidade_(p) {
  const out = []; const m = String(p.modalidade || '');
  const base = { cadastroId: String(p.cadastroId), vigenciaInicio: dataTexto_(p.vigenciaInicio), vigenciaFim: dataTexto_(p.vigenciaFim), obs: String(p.obs || '') };
  const temTr = p.valorTransporte !== '' && p.valorTransporte != null;
  if (temTr && (m === 'Transporte + kg' || m === 'Valorização com transporte' || modalidadeKm_(m)))
    out.push(Object.assign({ tipo: modalidadeKm_(m) ? 'Transporte por km' : 'Transporte por viagem', valor: num_(p.valorTransporte) }, base));
  if (p.residuoId && p.precoKg !== '' && p.precoKg != null)
    out.push(Object.assign({ tipo: /valoriza/i.test(m) ? 'Valorização' : 'Destinação', residuoId: String(p.residuoId), valor: num_(p.precoKg) }, base));
  return out;
}
/** Compatibilidade: o formato antigo (mapa.salvarPrecoVenda) grava como itens do contrato. */
function salvarPrecoVendaAntigo_(reg, u) {
  reg = reg || {};
  if (listaValores_('modalidadePreco').indexOf(String(reg.modalidade || '')) < 0) return erroDados_('Escolha a modalidade.');
  const comTr = modalidadeComTransporte_(reg.modalidade), porKm = modalidadeKm_(reg.modalidade);
  if (!reg.residuoId && !comTr) return erroDados_('Escolha o resíduo.');
  if (!reg.residuoId && (reg.valorTransporte === '' || reg.valorTransporte == null)) return erroDados_(porKm ? 'Informe o valor do transporte por km.' : 'Informe o valor do transporte.');
  if ((reg.precoKg === '' || reg.precoKg == null) && !(comTr && reg.valorTransporte !== '' && reg.valorTransporte != null)) return erroDados_('Informe o preço por kg' + (comTr ? ' e/ou o valor do transporte' + (porKm ? ' por km.' : '.') : '.'));
  const itens = itensDaModalidade_(reg); let id = '';
  for (let i = 0; i < itens.length; i++) {
    const r = salvarItemContrato_(itens[i], u); if (!r.ok) return r; id = id || r.id;
  }
  return { ok: true, id: id };
}

/* ---------------- migração (ESQUEMA 14) ---------------- */
function migrarItensContrato_() {
  aba_('ContratoItens');
  const um = ler_('Listas').filter(function (x) { return x.lista === 'unidadeMedida'; });
  ['caixa', 'troca'].forEach(function (val, i) {
    if (!um.some(function (x) { return String(x.valor) === val; })) inserir_('Listas', { lista: 'unidadeMedida', valor: val, ordem: um.length + i + 1, ativo: true }, null, null);
  });
  if (ler_('ContratoItens').length) return;
  const porCli = {};
  ler_('PrecosCliente').filter(function (p) { return p.ativo; }).forEach(function (p) { (porCli[p.cadastroId] = porCli[p.cadastroId] || []).push(p); });
  const cids = Object.keys(porCli).filter(function (cid) { return porId_('Cadastros', cid); });
  // contrato "a completar" para quem tem preço e não tem contrato (nem a matriz) — gravados de uma vez
  const semCt = cids.filter(function (cid) { const c = porId_('Cadastros', cid); return !contratoDoCliente_(cid) && !(c.cadastroPrincipalId && contratoDoCliente_(c.cadastroPrincipalId)); });
  inserirLote_('Contratos', semCt.map(function (cid) {
    const ini = porCli[cid].map(function (p) { return dataTexto_(p.vigenciaInicio); }).filter(String).sort()[0] || hojeTxt_();
    return { cadastroId: cid, numero: '', objeto: '', inicio: ini, validade: '', renovacaoAutomatica: 'NÃO', encerrado: 'NÃO',
      obs: 'Criado com os itens de preço: complete o número, a validade e anexe o contrato.', ativo: true };
  }), null);
  const novos = [];
  cids.forEach(function (cid) {
    const ct = contratoParaItens_(porId_('Cadastros', cid), '', null);
    const vistos = {};
    porCli[cid].forEach(function (p) {
      itensDaModalidade_(p).forEach(function (it) {
        const k = chaveItem_(it) + '|' + it.vigenciaInicio + '|' + it.vigenciaFim;
        if (vistos[k]) return; vistos[k] = 1; // o mesmo transporte repetido em várias linhas vira um item só
        novos.push(Object.assign({ contratoId: ct.id, tipoVeiculoId: '', residuoId: '', capacidade: '', destinacaoInclusa: 'NÃO', cobrancaAluguel: '',
          aditivoId: '', precoOrigemId: p.id, ativo: true }, it));
      });
    });
  });
  inserirLote_('ContratoItens', novos, null);
  const n = novos.length;
  HIST_BUF_.push([new Date(), '', 'sistema', 'mapa', 'ContratoItens', '', '', 'migrou', '', '', '',
    'Preço de venda em itens do contrato: ' + n + ' item(ns) criados a partir das modalidades antigas (tabela PrecosCliente fica como arquivo).']);
}
