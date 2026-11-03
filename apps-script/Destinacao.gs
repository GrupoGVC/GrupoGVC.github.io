/* =====================================================================
 * Etapa Destinação (ESQUEMA 9)
 *  Solicitação → Programada → Realizada → Destinação → BM enviado → NF emitida.
 *  1. Solicitação: resíduos com peso estimado e destinador/reciclador previsto (da precificação),
 *     km prevista, diárias e pernoites previstos. Destinador obrigatório para liberar.
 *  2. Programação: pode trocar o destinador (com justificativa); avisa solicitante e consultor por e-mail;
 *     km inicial do veículo no dia; ao marcar Realizada, um MTR por destinador (nº, resíduos e peso do MTR):
 *     vira lançamento PENDENTE no Controle de Destinação.
 *  3. Controle › A destinar: confirma por MTR o destinador, o resíduo, o peso do ticket da balança e a km
 *     na volta à base. Os lançamentos ficam DESTINADOS e a solicitação vai para "Destinação".
 *  Lançamento feito direto no Controle = Operação interna (gerador = unidade GVC).
 *  Serviço marcado em "servicoSemDestinacao" (locação, limpeza…) pula a Destinação.
 * ===================================================================== */

const FONTE_COLETA = 'Coleta de cliente', FONTE_INTERNA = 'Operação interna';
const SIT_PENDENTE = 'Pendente', SIT_DESTINADO = 'Destinado';
const LIMITE_DIVERGENCIA = 0.2; // 20% de diferença de peso ou km acende o alerta
const TIPOS_EMAIL = { programacao: 'Programação confirmada ou alterada', dp: 'Pernoite a pagar (DP)' };

/* ---------------- utilidades ---------------- */
function exigeDestinacao_(s) { return !!s && listaValores_('servicoSemDestinacao').indexOf(String(s.servico || '')) < 0; }
function statusAntesDoBm_(s) { return exigeDestinacao_(s) ? 'Destinação' : 'Realizada'; }
function prontaParaBm_(s) { return s.status === 'Destinação' || (s.status === 'Realizada' && !exigeDestinacao_(s)); }
function ehDestinador_(c) { const t = separar_(c && c.tipos); return t.indexOf('destinador') >= 0 || t.indexOf('reciclador') >= 0; }
function naturezaDestino_(destId, resId) {
  const r = ler_('CadastroResiduos').filter(function (x) { return x.cadastroId === destId && x.residuoId === resId; })[0];
  if (r && r.natureza) return String(r.natureza);
  const t = separar_((porId_('Cadastros', destId) || {}).tipos);
  return t.indexOf('reciclador') >= 0 && t.indexOf('destinador') < 0 ? 'receita' : 'custo';
}
function nomeCad_(id) { const c = porId_('Cadastros', id); return c ? String(c.nome || c.razaoSocial || c.id) : ''; }
function nomeRes_(id) { const r = porId_('Residuos', id); return r ? String(r.nome) : ''; }
function kgTxt_(v) { return (Math.round(num_(v) * 100) / 100).toString().replace('.', ',') + ' kg'; }
function numOuVazio_(v) { return v === '' || v == null ? '' : num_(v); }

/* ---------------- itens da solicitação ---------------- */
function itensDaSolicitacao_(solId) {
  return onde_('SolicitacaoItens', 'solicitacaoId', solId).sort(function (a, b) { return num_(a.ordem) - num_(b.ordem); });
}
function itemPublico_(it) {
  return { id: it.id, solicitacaoId: String(it.solicitacaoId), ordem: num_(it.ordem), residuoId: String(it.residuoId || ''), pesoEstimado: numOuVazio_(it.pesoEstimado),
           destinadorId: String(it.destinadorId || ''), destinadorPrevistoId: String(it.destinadorPrevistoId || ''), precoKg: numOuVazio_(it.precoKg),
           natureza: String(it.natureza || ''), justificativaTroca: String(it.justificativaTroca || '') };
}
function resumoItensSol_(itens) {
  return itens.map(function (it) { return nomeRes_(it.residuoId) + (it.pesoEstimado !== '' ? ' ' + kgTxt_(it.pesoEstimado) : '') + (it.destinadorId ? ' → ' + nomeCad_(it.destinadorId) : ''); }).join('; ');
}
/** Substitui os itens da solicitação (solicitante). itens = [{id?, residuoId, pesoEstimado, destinadorId}] */
function salvarItensSolicitacao_(sol, itens, u) {
  const limpos = [];
  for (let i = 0; i < (itens || []).length; i++) {
    const x = itens[i] || {};
    const it = { id: String(x.id || ''), residuoId: String(x.residuoId || ''), pesoEstimado: x.pesoEstimado === '' || x.pesoEstimado == null ? '' : num_(x.pesoEstimado),
                 destinadorId: String(x.destinadorId || '') };
    if (!it.residuoId && !it.destinadorId && it.pesoEstimado === '') continue;
    if (!porId_('Residuos', it.residuoId)) return 'Resíduo ' + (i + 1) + ': escolha o resíduo.';
    if (it.pesoEstimado !== '' && it.pesoEstimado < 0) return 'Resíduo ' + (i + 1) + ': peso inválido.';
    if (it.destinadorId && !ehDestinador_(porId_('Cadastros', it.destinadorId))) return 'Resíduo ' + (i + 1) + ': o destinador precisa ser um cadastro destinador ou reciclador do Mapa.';
    limpos.push(it);
  }
  const atuais = itensDaSolicitacao_(sol.id);
  const antes = resumoItensSol_(atuais.map(itemPublico_));
  const usados = {}; ler_('Lancamentos').forEach(function (l) { if (l.itemId) usados[String(l.itemId)] = 1; });
  const ficam = {}; limpos.forEach(function (it) { if (it.id) ficam[it.id] = 1; });
  if (atuais.some(function (a) { return !ficam[a.id] && usados[a.id]; })) return 'Um dos resíduos já tem MTR lançado na Programação e não pode sair da solicitação.';
  const manter = {};
  limpos.forEach(function (it, i) {
    const a = it.id ? atuais.filter(function (y) { return y.id === it.id; })[0] : null;
    const campos = { ordem: i + 1, residuoId: it.residuoId, pesoEstimado: it.pesoEstimado, destinadorId: it.destinadorId, destinadorPrevistoId: it.destinadorId, justificativaTroca: '' };
    // mesmo destinador de antes (inclusive o trocado pela programadora): mantém o previsto e a justificativa
    if (a && a.destinadorId === it.destinadorId && a.residuoId === it.residuoId) { campos.destinadorPrevistoId = String(a.destinadorPrevistoId || it.destinadorId); campos.justificativaTroca = String(a.justificativaTroca || ''); }
    const mudouPreco = !a || a.destinadorId !== it.destinadorId || a.residuoId !== it.residuoId;
    campos.precoKg = it.destinadorId ? (mudouPreco ? precoDestino_(it.destinadorId, it.residuoId) : num_(a.precoKg)) : '';
    campos.natureza = it.destinadorId ? naturezaDestino_(it.destinadorId, it.residuoId) : '';
    if (a) { atualizar_('SolicitacaoItens', a.id, campos, u, null); manter[a.id] = 1; }
    else { campos.solicitacaoId = sol.id; manter[inserir_('SolicitacaoItens', campos, u, null).id] = 1; }
  });
  const sobra = atuais.filter(function (a) { return !manter[a.id]; });
  sobra.sort(function (a, b) { return b._linha - a._linha; }).forEach(function (a) { aba_('SolicitacaoItens').deleteRow(porId_('SolicitacaoItens', a.id)._linha); limparCache_('SolicitacaoItens'); });
  limparCache_('SolicitacaoItens');
  const novos = itensDaSolicitacao_(sol.id);
  const depois = resumoItensSol_(novos.map(itemPublico_));
  if (antes !== depois) hist_(u, 'solicitacoes', 'Solicitacoes', sol.id, rotuloSol_(sol), 'alterou', 'Resíduos e destinação prevista', antes, depois, '');
  const ids = novos.map(function (x) { return String(x.residuoId); }).filter(function (v, i, l) { return l.indexOf(v) === i; }).join('; ');
  if (String(sol.residuoIds || '') !== ids) atualizar_('Solicitacoes', sol.id, { residuoIds: ids }, u, null);
  return '';
}
/** O que falta para liberar para programar (vazio = pode). */
function faltaParaLiberar_(s, itensNovos) {
  if (!exigeDestinacao_(s)) return '';
  const itens = itensNovos ? itensNovos.filter(function (x) { return x && (x.residuoId || x.destinadorId || (x.pesoEstimado !== '' && x.pesoEstimado != null)); })
    : itensDaSolicitacao_(s.id);
  const f = [];
  if (!itens.length) f.push('os resíduos com o destinador previsto');
  itens.forEach(function (it, i) {
    const n = nomeRes_(it.residuoId) || ('resíduo ' + (i + 1));
    if (!(num_(it.pesoEstimado) > 0)) f.push('o peso estimado de ' + n);
    if (!it.destinadorId) f.push('o destinador ou reciclador de ' + n);
  });
  if (!(num_(s.kmPrevista) > 0)) f.push('a km prevista');
  if (!(num_(s.diariasPrevistas) > 0)) f.push('as diárias previstas (dias de operação)');
  return f.length ? 'Para liberar, informe ' + f.join(', ') + '.' : '';
}
/** Troca do destinador pela programadora: justificativa obrigatória (voltar ao previsto não precisa). */
function trocarDestinadorItem_(sol, x, u) {
  const it = porId_('SolicitacaoItens', x.id);
  if (!it || String(it.solicitacaoId) !== String(sol.id)) return 'Resíduo da solicitação não encontrado. Atualize a página.';
  const novo = String(x.destinadorId || '');
  if (novo === String(it.destinadorId || '')) return '';
  if (!ehDestinador_(porId_('Cadastros', novo))) return 'Escolha um destinador ou reciclador do Mapa para ' + nomeRes_(it.residuoId) + '.';
  const voltou = novo === String(it.destinadorPrevistoId || '');
  const just = String(x.justificativa || '').trim();
  if (!voltou && !just) return 'Informe a justificativa da troca do destinador de ' + nomeRes_(it.residuoId) + ' (previsto: ' + nomeCad_(it.destinadorPrevistoId) + ').';
  atualizar_('SolicitacaoItens', it.id, { destinadorId: novo, justificativaTroca: voltou ? '' : just, precoKg: precoDestino_(novo, it.residuoId), natureza: naturezaDestino_(novo, it.residuoId) },
    u, 'programacao', { tabela: 'Solicitacoes', registroId: sol.id, registroNome: rotuloSol_(sol), prefixoCampo: nomeRes_(it.residuoId) + ' · ' });
  return '';
}

/** Coordenadas para sugerir a km prevista pela rota (unidade → cliente → destinadores → unidade). */
function coordenadasCadastros_() {
  const cad = {};
  ler_('Locais').forEach(function (l) {
    const lat = Number(l.lat), lng = Number(l.lng);
    if (!l.cadastroId || cad[l.cadastroId] || !isFinite(lat) || !isFinite(lng) || (!lat && !lng) || l.lat === '' || l.lng === '') return;
    if (l.ativo === false) return;
    cad[String(l.cadastroId)] = [lat, lng];
  });
  const uni = {};
  ler_('Unidades').forEach(function (x) { if (x.cadastroId && cad[x.cadastroId]) uni[x.id] = cad[x.cadastroId]; });
  return { cad: cad, uni: uni };
}

/* ---------------- MTR na coleta realizada → lançamentos pendentes ---------------- */
// mtrs = [{destinadorId, mtr, negocio, linhas: [{id?, itemId?, residuoId, kg}]}] (um MTR por destinador)
function validarMtrsParada_(mtrs, n) {
  const vistos = {};
  for (let i = 0; i < mtrs.length; i++) {
    const b = mtrs[i] || {};
    const rot = 'Parada ' + n + ', MTR ' + (i + 1);
    if (!ehDestinador_(porId_('Cadastros', b.destinadorId))) return rot + ': escolha o destinador ou reciclador.';
    if (vistos[b.destinadorId]) return 'Parada ' + n + ': é um MTR por destinador; junte os resíduos de ' + nomeCad_(b.destinadorId) + ' no mesmo MTR.';
    vistos[b.destinadorId] = 1;
    if (!String(b.mtr || '').trim()) return rot + ': informe o número do MTR (emitido pelo gerador).';
    const ls = (b.linhas || []).filter(function (l) { return l && (l.residuoId || l.kg); });
    if (!ls.length) return rot + ': informe o resíduo e o peso do MTR.';
    for (let j = 0; j < ls.length; j++) {
      if (!porId_('Residuos', ls[j].residuoId)) return rot + ': escolha o resíduo do MTR.';
      if (!(num_(ls[j].kg) > 0)) return rot + ': informe o peso lançado no MTR (kg).';
    }
  }
  return '';
}
function lancamentosAtivosDaParada_(paradaId) {
  return ler_('Lancamentos').filter(function (l) { return l.ativo && String(l.paradaId) === String(paradaId); });
}
function paradaTemDestinado_(paradaId) {
  return !!paradaId && lancamentosAtivosDaParada_(paradaId).some(function (l) { return l.situacao !== SIT_PENDENTE; });
}
/** Grava os MTRs da parada como lançamentos pendentes (os já destinados não mudam por aqui). */
function sincronizarMtrsParada_(v, p, mtrs, u) {
  const atuais = lancamentosAtivosDaParada_(p.id).filter(function (l) { return l.situacao === SIT_PENDENTE; });
  const cli = porId_('Cadastros', p.clienteId) || {};
  const loc = cli.id ? (localPrincipal_(cli.id) || {}) : {};
  const transp = v.execucao === 'Terceirizada' ? String((porId_('Cadastros', v.transportadorId) || {}).nome || 'Terceirizada') : 'Retec';
  const data = dataTexto_(p.data) || dataTexto_(v.dataSaida);
  const manter = {};
  mtrs.forEach(function (b) {
    (b.linhas || []).filter(function (l) { return l && l.residuoId; }).forEach(function (l) {
      const a = l.id ? atuais.filter(function (x) { return x.id === String(l.id); })[0] : null;
      const kg = num_(l.kg);
      const it = l.itemId ? porId_('SolicitacaoItens', l.itemId) : null;
      const preco = a && String(a.destinadorId) === String(b.destinadorId) && String(a.residuoId) === String(l.residuoId) ? num_(a.preco) : precoDestino_(b.destinadorId, l.residuoId);
      const campos = { unidadeId: String(v.unidadeId || ''), data: data, mes: data.slice(0, 7), dataColeta: data, mtr: String(b.mtr || '').trim(),
        destinadorId: String(b.destinadorId), destinadorPrevistoId: it && (it.destinadorPrevistoId || it.destinadorId) ? String(it.destinadorPrevistoId || it.destinadorId) : String(b.destinadorId),
        gerador: String(cli.nome || '').toUpperCase(), origem: [loc.cidade, loc.uf].filter(function (x) { return x; }).join('/'),
        residuoId: String(l.residuoId), transportadora: transp, placa: String(v.placa || ''), kg: kg, pesoMtr: kg, preco: preco, valorFixo: '',
        valor: Math.round(kg * preco * 100) / 100, negocio: normNegocio_(b.negocio), paradaId: p.id, viagemId: v.id, solicitacaoId: String(p.solicitacaoId || ''),
        itemId: it ? it.id : '', fonte: FONTE_COLETA, situacao: SIT_PENDENTE };
      // coleta em andamento sem destinador previsto: o MTR define o destinador do resíduo
      if (it && !it.destinadorId) atualizar_('SolicitacaoItens', it.id, { destinadorId: String(b.destinadorId), destinadorPrevistoId: String(b.destinadorId),
        precoKg: precoDestino_(b.destinadorId, it.residuoId), natureza: naturezaDestino_(b.destinadorId, it.residuoId) }, u, 'programacao', { tabela: 'Solicitacoes', registroId: String(p.solicitacaoId || ''), registroNome: 'Destinador pelo MTR', prefixoCampo: nomeRes_(it.residuoId) + ' · ' });
      const rot = 'MTR ' + campos.mtr + ' · ' + nomeCad_(b.destinadorId);
      if (a) { atualizar_('Lancamentos', a.id, campos, u, 'destinacao', { registroNome: rot }); manter[a.id] = 1; }
      else {
        campos.obs = 'MTR da coleta (' + rotuloViagem_(v) + '). Aguardando a destinação.'; campos.idOrigem = ''; campos.ticket = ''; campos.motivoDivergencia = ''; campos.ativo = true;
        manter[inserir_('Lancamentos', campos, u, 'destinacao', rot).id] = 1;
      }
    });
  });
  atuais.forEach(function (a) { if (!manter[a.id]) atualizar_('Lancamentos', a.id, { ativo: false }, u, 'destinacao', { registroNome: 'MTR ' + a.mtr }); });
}

/* ---------------- Controle › A destinar ---------------- */
function lancDestPublico_(l) {
  return { id: l.id, mtr: String(l.mtr || ''), ticket: String(l.ticket || ''), destinadorId: String(l.destinadorId || ''), destinadorPrevistoId: String(l.destinadorPrevistoId || ''),
           residuoId: String(l.residuoId || ''), kg: numOuVazio_(l.kg), pesoMtr: numOuVazio_(l.pesoMtr), preco: num_(l.preco), negocio: normNegocio_(l.negocio),
           paradaId: String(l.paradaId || ''), viagemId: String(l.viagemId || ''), solicitacaoId: String(l.solicitacaoId || ''), itemId: String(l.itemId || ''),
           dataColeta: dataTexto_(l.dataColeta) || dataTexto_(l.data), situacao: String(l.situacao || '') };
}
function viagemDaSolicitacao_(solId) {
  const r = paradasAtivasDaSolicitacao_(solId).filter(function (x) { return x.p.resultado === 'Realizada'; })
    .sort(function (a, b) { return String(dataTexto_(a.p.data)).localeCompare(String(dataTexto_(b.p.data))); }).pop();
  return r ? r.v : null;
}
function viagemResumo_(v) {
  if (!v) return null;
  const sols = {}; onde_('Paradas', 'viagemId', v.id).forEach(function (p) { if (p.solicitacaoId) sols[p.solicitacaoId] = 1; });
  const kmPrev = Object.keys(sols).reduce(function (t, id) { return t + num_((porId_('Solicitacoes', id) || {}).kmPrevista); }, 0);
  return { id: v.id, rotulo: rotuloViagem_(v), execucao: String(v.execucao), placa: String(v.placa || ''), dataSaida: dataTexto_(v.dataSaida),
           kmInicial: numOuVazio_(v.kmInicial), kmFinal: numOuVazio_(v.kmFinal), kmPrevista: kmPrev, status: String(v.status) };
}
/** Coletas realizadas que aguardam a confirmação da destinação. */
function aDestinar_(u) {
  const pend = ler_('Lancamentos').filter(function (l) { return l.ativo && l.situacao === SIT_PENDENTE; });
  const porSol = {}, porParada = {};
  pend.forEach(function (l) {
    if (l.solicitacaoId) (porSol[l.solicitacaoId] = porSol[l.solicitacaoId] || []).push(l);
    else (porParada[l.paradaId] = porParada[l.paradaId] || []).push(l);
  });
  const hoje = dataTexto_(new Date());
  const out = [];
  ler_('Solicitacoes').filter(function (s) { return s.status === 'Realizada' && exigeDestinacao_(s) && veUnidade_(u, s.unidadeId); }).forEach(function (s) {
    const dc = dataTexto_(s.dataColeta);
    out.push({ chave: 'S:' + s.id, solicitacaoId: s.id, paradaId: '', clienteId: String(s.clienteId), cliente: nomeCad_(s.clienteId), unidadeId: String(s.unidadeId || ''),
      dataColeta: dc, dias: dc ? diasEntre_(dc, hoje) : '', kmPrevista: numOuVazio_(s.kmPrevista), itens: itensDaSolicitacao_(s.id).map(itemPublico_),
      pendentes: (porSol[s.id] || []).map(lancDestPublico_), viagem: viagemResumo_(viagemDaSolicitacao_(s.id)) });
  });
  Object.keys(porParada).forEach(function (pid) {
    const p = porId_('Paradas', pid); if (!p) return;
    const v = porId_('Viagens', p.viagemId); if (!v || !veUnidade_(u, v.unidadeId)) return;
    const dc = dataTexto_(p.data) || dataTexto_(v.dataSaida);
    out.push({ chave: 'P:' + pid, solicitacaoId: '', paradaId: pid, clienteId: String(p.clienteId), cliente: nomeCad_(p.clienteId), unidadeId: String(v.unidadeId || ''),
      dataColeta: dc, dias: dc ? diasEntre_(dc, hoje) : '', kmPrevista: '', itens: [], pendentes: porParada[pid].map(lancDestPublico_), viagem: viagemResumo_(v) });
  });
  return out.sort(function (a, b) { return String(a.dataColeta).localeCompare(String(b.dataColeta)); });
}
/**
 * Confirma a destinação de uma coleta.
 * x = {solicitacaoId | paradaId, kmFinal?, blocos: [{destinadorId, mtr, ticket, data, negocio, motivoDestinador, linhas: [{id?, residuoId, kg, motivoPeso?}]}]}
 */
function confirmarDestinacao_(x, u) {
  x = x || {};
  const s = x.solicitacaoId ? porId_('Solicitacoes', x.solicitacaoId) : null;
  const par = !s && x.paradaId ? porId_('Paradas', x.paradaId) : null;
  if (!s && !par) return erroDados_('Coleta não encontrada. Atualize a página.');
  if (s && !veUnidade_(u, s.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  if (s && s.status !== 'Realizada') return erroDados_('Esta solicitação não está aguardando destinação (status: ' + s.status + ').');
  const pend = ler_('Lancamentos').filter(function (l) { return l.ativo && l.situacao === SIT_PENDENTE && (s ? String(l.solicitacaoId) === s.id : String(l.paradaId) === par.id); });
  const v = s ? viagemDaSolicitacao_(s.id) : porId_('Viagens', par.viagemId);
  if (v && !veUnidade_(u, v.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  const blocos = (x.blocos || []).filter(function (b) { return b && (b.destinadorId || (b.linhas || []).length); });
  if (!blocos.length) return erroDados_('Informe pelo menos um MTR com a destinação.');
  const vistos = {};
  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i], rot = 'MTR ' + (i + 1);
    if (!ehDestinador_(porId_('Cadastros', b.destinadorId))) return erroDados_(rot + ': escolha o destinador ou reciclador que recebeu.');
    if (vistos[b.destinadorId]) return erroDados_('É um MTR por destinador: junte os resíduos de ' + nomeCad_(b.destinadorId) + ' no mesmo MTR.');
    vistos[b.destinadorId] = 1;
    if (!String(b.mtr || '').trim()) return erroDados_(rot + ': informe o número do MTR.');
    if (!String(b.ticket || '').trim()) return erroDados_(rot + ': informe o número do ticket de pesagem.');
    if (!dataTexto_(b.data)) return erroDados_(rot + ': informe a data da destinação.');
    const ls = (b.linhas || []).filter(function (l) { return l && (l.residuoId || l.kg); });
    if (!ls.length) return erroDados_(rot + ': informe o resíduo e o peso do ticket.');
    for (let j = 0; j < ls.length; j++) {
      if (!porId_('Residuos', ls[j].residuoId)) return erroDados_(rot + ': escolha o resíduo.');
      if (!(num_(ls[j].kg) > 0)) return erroDados_(rot + ': informe o peso do ticket da balança (kg).');
    }
    // compara com o destinador do MTR (o programado; a troca na programação já tem justificativa)
    const prev = pend.filter(function (l) { return (b.linhas || []).some(function (y) { return String(y.id) === l.id; }); }).map(function (l) { return String(l.destinadorId); })[0]
      || (s ? itensDaSolicitacao_(s.id).filter(function (it) { return ls.some(function (y) { return y.residuoId === it.residuoId; }); }).map(function (it) { return String(it.destinadorId || it.destinadorPrevistoId); })[0] : '');
    b._previsto = prev || '';
    if (prev && prev !== String(b.destinadorId) && !String(b.motivoDestinador || '').trim())
      return erroDados_(rot + ': foi para ' + nomeCad_(b.destinadorId) + ', mas o previsto era ' + nomeCad_(prev) + '. Informe o motivo.');
  }
  // km na volta à base (viagem própria)
  const propria = v && v.execucao !== 'Terceirizada';
  const kmIni = v ? numOuVazio_(v.kmInicial) : '';
  const kmFim = x.kmFinal === '' || x.kmFinal == null ? (v ? numOuVazio_(v.kmFinal) : '') : num_(x.kmFinal);
  if (propria && kmIni !== '' && kmFim === '') return erroDados_('Informe a km do veículo na volta à base (a viagem saiu com ' + kmIni + ' km).');
  if (propria && kmIni !== '' && kmFim !== '' && kmFim < kmIni) return erroDados_('A km na volta à base (' + kmFim + ') é menor que a km inicial (' + kmIni + ').');
  if (v && kmFim !== '' && kmFim !== numOuVazio_(v.kmFinal)) atualizar_('Viagens', v.id, { kmFinal: kmFim }, u, 'destinacao', { registroNome: rotuloViagem_(v) });
  // grava os lançamentos destinados
  const cliId = s ? String(s.clienteId) : String(par.clienteId);
  const cli = porId_('Cadastros', cliId) || {}, loc = cli.id ? (localPrincipal_(cli.id) || {}) : {};
  const transp = v && v.execucao === 'Terceirizada' ? String((porId_('Cadastros', v.transportadorId) || {}).nome || 'Terceirizada') : 'Retec';
  const usados = {};
  blocos.forEach(function (b) {
    const data = dataTexto_(b.data);
    (b.linhas || []).filter(function (l) { return l && l.residuoId; }).forEach(function (l) {
      const a = l.id ? pend.filter(function (y) { return y.id === String(l.id); })[0] : null;
      const kg = num_(l.kg);
      const mesmo = a && String(a.destinadorId) === String(b.destinadorId) && String(a.residuoId) === String(l.residuoId);
      const preco = mesmo ? num_(a.preco) : precoDestino_(b.destinadorId, l.residuoId);
      const motivos = [];
      if (b._previsto && b._previsto !== String(b.destinadorId)) motivos.push('Destinador diferente do MTR (' + nomeCad_(b._previsto) + '): ' + String(b.motivoDestinador || '').trim());
      const pm = a ? num_(a.pesoMtr) : 0;
      if (pm > 0 && Math.abs(kg - pm) / pm > LIMITE_DIVERGENCIA)
        motivos.push('Peso ' + (kg > pm ? '+' : '') + Math.round((kg - pm) / pm * 100) + '% em relação ao MTR (' + kgTxt_(pm) + ')' + (String(l.motivoPeso || '').trim() ? ': ' + String(l.motivoPeso).trim() : ''));
      const campos = { data: data, mes: data.slice(0, 7), mtr: String(b.mtr).trim(), ticket: String(b.ticket).trim(), destinadorId: String(b.destinadorId), residuoId: String(l.residuoId),
        kg: kg, preco: preco, valorFixo: '', valor: Math.round(kg * preco * 100) / 100, negocio: normNegocio_(b.negocio || (a && a.negocio)), situacao: SIT_DESTINADO,
        motivoDivergencia: motivos.join(' · ') };
      const rot = 'MTR ' + campos.mtr + ' · ' + nomeCad_(b.destinadorId);
      if (a) { atualizar_('Lancamentos', a.id, campos, u, 'destinacao', { registroNome: rot }); usados[a.id] = 1; }
      else {
        const dc = s ? dataTexto_(s.dataColeta) : dataTexto_(par.data);
        Object.assign(campos, { unidadeId: String((s && s.unidadeId) || (v && v.unidadeId) || ''), dataColeta: dc || data, gerador: String(cli.nome || '').toUpperCase(),
          origem: [loc.cidade, loc.uf].filter(function (z) { return z; }).join('/'), transportadora: transp, placa: String((v && v.placa) || ''), pesoMtr: '',
          paradaId: par ? par.id : '', viagemId: v ? v.id : '', solicitacaoId: s ? s.id : '', itemId: '', destinadorPrevistoId: b._previsto || String(b.destinadorId),
          fonte: FONTE_COLETA, idOrigem: '', obs: 'Destinação confirmada no Controle.', ativo: true });
        inserir_('Lancamentos', campos, u, 'destinacao', rot);
      }
    });
  });
  pend.forEach(function (l) { if (!usados[l.id]) atualizar_('Lancamentos', l.id, { ativo: false, obs: (String(l.obs || '') + ' Não destinado na confirmação.').trim() }, u, 'destinacao', { registroNome: 'MTR ' + l.mtr }); });
  if (s) atualizar_('Solicitacoes', s.id, { status: 'Destinação' }, u, 'destinacao', { registroNome: rotuloSol_(s) });
  return { ok: true };
}

/* ---------------- e-mails (cada pessoa pode desligar) ---------------- */
function pessoaPorEmail_(email) {
  email = normEmail_(email); if (!email) return null;
  const us = ler_('Usuarios').filter(function (x) { return normEmail_(x.email) === email; })[0];
  if (us && us.pessoaId) { const p = porId_('Pessoas', us.pessoaId); if (p) return p; }
  return ler_('Pessoas').filter(function (p) { return p.email && normEmail_(p.email) === email; })[0] || null;
}
function aceitaEmail_(email, tipo) {
  const p = pessoaPorEmail_(email);
  return !(p && separar_(p.emailsDesligados).indexOf(tipo) >= 0);
}
/** "Programação confirmada/alterada" para o solicitante (quem registrou) e o consultor da solicitação. */
function avisarProgramacao_(v, solIds, alterada) {
  if (!solIds.length) return;
  const nomeP = function (pid) { const c = porId_('Pessoas', pid); return c ? String(c.nome) : ''; };
  const eq = onde_('ViagemEquipe', 'viagemId', v.id).map(function (e) { return nomeP(e.colaboradorId); }).filter(String);
  const ve = porId_('Veiculos', v.veiculoId), tipo = ve ? porId_('TiposVeiculo', ve.tipoVeiculoId) : null;
  const d = function (x) { return dataTexto_(x).split('-').reverse().join('/'); };
  solIds.forEach(function (sid) {
    const s = porId_('Solicitacoes', sid); if (!s) return;
    const dest = [];
    if (String(s.criadoPor || '').indexOf('@') > 0) dest.push(normEmail_(s.criadoPor));
    const con = s.consultorId ? porId_('Pessoas', s.consultorId) : null;
    if (con && con.email) dest.push(normEmail_(con.email));
    const para = dest.filter(function (e, i, l) { return l.indexOf(e) === i && aceitaEmail_(e, 'programacao'); });
    if (!para.length) return;
    const p = onde_('Paradas', 'viagemId', v.id).filter(function (x) { return String(x.solicitacaoId) === sid; })[0] || {};
    const itens = itensDaSolicitacao_(sid).map(itemPublico_);
    const cliente = nomeCad_(s.clienteId);
    const linhas = ['Cliente: ' + cliente, 'Data da coleta: ' + d(p.data || v.dataSaida) + (dataTexto_(v.dataRetornoPrevisto) && dataTexto_(v.dataRetornoPrevisto) !== dataTexto_(v.dataSaida) ? ' (retorno previsto ' + d(v.dataRetornoPrevisto) + ')' : '')];
    if (v.execucao === 'Terceirizada') linhas.push('Execução: terceirizada (' + nomeCad_(v.transportadorId) + ')');
    else {
      linhas.push('Veículo: ' + (ve ? ve.placa + (tipo ? ' · ' + tipo.nome : '') : '—'));
      linhas.push('Motorista: ' + (nomeP(v.motoristaId) || '—'));
      if (eq.length) linhas.push('Ajudantes: ' + eq.join(', '));
    }
    if (itens.length) linhas.push('Resíduos e destino: ' + resumoItensSol_(itens));
    if (String(v.obs || '').trim()) linhas.push('Observações da programação: ' + String(v.obs).trim());
    if (String(p.obs || '').trim()) linhas.push('Observação da parada: ' + String(p.obs).trim());
    try {
      MailApp.sendEmail({ to: para.join(','), subject: (alterada ? 'Programação alterada' : 'Programação confirmada') + ' · ' + cliente + ' · ' + d(p.data || v.dataSaida),
        body: 'Olá.\n\nA coleta de ' + cliente + ' foi ' + (alterada ? 'reprogramada' : 'programada') + ':\n\n' + linhas.join('\n') +
              '\n\nAcompanhe no portal: ' + URL_PORTAL + 'solicitacoes/\n\n(Mensagem automática do Portal Grupo GVC. Para não receber, peça para desligar na sua ficha em Pessoas.)' });
    } catch (e) { /* sem cota de e-mail: a programação continua valendo */ }
  });
}

/* ---------------- migração (ESQUEMA 9) ---------------- */
function migrarDestinacao_() {
  aba_('SolicitacaoItens');
  ['Solicitacoes', 'Viagens', 'Lancamentos', 'Pessoas'].forEach(function (t) { migrarCabecalho_(t); });
  aba_('Listas');
  // lançamentos que já existem: origem do descarte e situação "Destinado" (escrita em bloco, sem histórico por linha)
  const unidades = {};
  ler_('Unidades').forEach(function (x) { unidades[semAcento_(x.nome)] = 1; });
  ler_('Cadastros').forEach(function (c) { if (separar_(c.tipos).indexOf('empresa') >= 0) unidades[semAcento_(c.nome)] = 1; });
  const solDaParada = {}; ler_('Paradas').forEach(function (p) { if (p.solicitacaoId) solDaParada[p.id] = String(p.solicitacaoId); });
  const sh = aba_('Lancamentos'), cab = colunas_('Lancamentos');
  const lancs = ler_('Lancamentos');
  let nColeta = 0, nInterna = 0;
  if (lancs.length) {
    const col = function (c) { return cab.indexOf(c) + 1; };
    const fonte = [], sit = [], sol = [];
    const porLinha = {}; lancs.forEach(function (l) { porLinha[l._linha] = l; });
    const ult = sh.getLastRow();
    for (let r = 2; r <= ult; r++) {
      const l = porLinha[r];
      if (!l) { fonte.push(['']); sit.push(['']); sol.push(['']); continue; }
      const ger = semAcento_(l.gerador);
      const coleta = !!l.paradaId || (ger && !unidades[ger]);
      if (coleta) nColeta++; else nInterna++;
      fonte.push([l.fonte || (coleta ? FONTE_COLETA : FONTE_INTERNA)]);
      sit.push([l.situacao || SIT_DESTINADO]);
      sol.push([l.solicitacaoId || solDaParada[l.paradaId] || '']);
    }
    if (ult >= 2) {
      sh.getRange(2, col('fonte'), ult - 1, 1).setValues(fonte);
      sh.getRange(2, col('situacao'), ult - 1, 1).setValues(sit);
      sh.getRange(2, col('solicitacaoId'), ult - 1, 1).setNumberFormat('@').setValues(sol);
    }
    limparCache_('Lancamentos');
  }
  // itens das solicitações a partir dos resíduos (o destinador vem do lançamento da coleta, quando houver)
  const destPorSolRes = {};
  ler_('Lancamentos').forEach(function (l) { if (l.ativo && l.solicitacaoId && l.residuoId) destPorSolRes[l.solicitacaoId + '|' + l.residuoId] = String(l.destinadorId || ''); });
  const ja = {}; ler_('SolicitacaoItens').forEach(function (it) { ja[it.solicitacaoId] = 1; });
  const novos = [];
  ler_('Solicitacoes').forEach(function (s) {
    if (ja[s.id]) return;
    separar_(s.residuoIds).forEach(function (rid, i) {
      if (!porId_('Residuos', rid)) return;
      const dest = destPorSolRes[s.id + '|' + rid] || '';
      novos.push({ solicitacaoId: s.id, ordem: i + 1, residuoId: rid, pesoEstimado: '', destinadorId: dest, destinadorPrevistoId: dest,
        precoKg: dest ? precoDestino_(dest, rid) : '', natureza: dest ? naturezaDestino_(dest, rid) : '', justificativaTroca: '' });
    });
  });
  inserirLote_('SolicitacaoItens', novos, null);
  // coletas já realizadas não entram na fila "A destinar": passam direto para Destinação
  const shS = aba_('Solicitacoes'), cabS = colunas_('Solicitacoes'), cSt = cabS.indexOf('status') + 1;
  let nSol = 0;
  ler_('Solicitacoes').forEach(function (s) { if (s.status === 'Realizada') { shS.getRange(s._linha, cSt).setValue('Destinação'); nSol++; } });
  limparCache_('Solicitacoes');
  HIST_BUF_.push([new Date(), '', 'sistema', 'destinacao', 'Lancamentos', '', '', 'migrou', '', '', '',
    'Etapa Destinação: ' + nColeta + ' lançamento(s) de coleta de cliente e ' + nInterna + ' de operação interna (todos destinados); ' + novos.length +
    ' resíduo(s) de solicitação; ' + nSol + ' solicitação(ões) realizada(s) passaram para Destinação.']);
}
