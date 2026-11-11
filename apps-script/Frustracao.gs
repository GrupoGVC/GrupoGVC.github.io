/* =====================================================================
 * Portal GVC — motivos padrão, cancelamento de coleta e cobrança de viagem frustrada.
 *
 * Motivos (tabela Motivos): tipo Frustração ou Cancelamento, com o responsável (Cliente / Interno /
 * Externo / Na hora = a programadora escolhe). Sempre motivo + observação obrigatória.
 * Cancelamento: o solicitante cancela na tela de Solicitações até a véspera da saída da viagem (a
 * coleta sai da viagem e a programadora é avisada por e-mail e na tela). A partir do dia da saída só a
 * programadora cancela, na parada, dizendo se a equipe já tinha saído da base.
 * Cobrança: parada frustrada (ou cancelada com a equipe na rua) por culpa do cliente gera uma cobrança
 * "A decidir"; quem tem a autorização no cadastro do usuário decide Cobrar (valor) ou Não cobrar
 * (justificativa). A cobrada vai para o Faturamento ("Frustradas a cobrar").
 * ===================================================================== */

const MOTIVO_TIPOS = ['Frustração', 'Cancelamento'];
const MOTIVO_RESPONSAVEIS = ['Cliente', 'Interno', 'Externo', 'Na hora'];
const MOTIVOS_INICIAIS = [
  ['Frustração', 'Problema com documentação do cliente', 'Cliente'],
  ['Frustração', 'Problema no cliente (acesso, local fechado, resíduo não disponível)', 'Cliente'],
  ['Frustração', 'Cliente ausente / não recebeu (no-show)', 'Cliente'],
  ['Frustração', 'Quebra de horário pelo cliente', 'Cliente'],
  ['Frustração', 'Atraso ou quebra de horário da equipe', 'Interno'],
  ['Frustração', 'Erro interno administrativo', 'Interno'],
  ['Frustração', 'Problema com veículo ou equipamento', 'Interno'],
  ['Frustração', 'Clima / estrada / causa externa', 'Externo'],
  ['Frustração', 'Outro', 'Na hora'],
  ['Cancelamento', 'Cliente desistiu', 'Cliente'],
  ['Cancelamento', 'Preço / proposta não aprovada', 'Cliente'],
  ['Cancelamento', 'Sem documentação a tempo', 'Cliente'],
  ['Cancelamento', 'Solicitação duplicada ou lançada errada', 'Interno'],
  ['Cancelamento', 'Outro', 'Na hora'],
];
const COB_DECISOES = ['A decidir', 'Cobrar', 'Não cobrar'];

function hojeTxt_() { return dataTexto_(new Date()); }
function dataBr_(d) { return dataTexto_(d).split('-').reverse().join('/'); }

/* ---------------- motivos ---------------- */
function motivoPublico_(m) { return { id: m.id, tipo: String(m.tipo), nome: String(m.nome), responsavel: String(m.responsavel), ordem: num_(m.ordem), ativo: m.ativo }; }
function motivosTodos_() {
  return ler_('Motivos').map(motivoPublico_).sort(function (a, b) { return a.tipo.localeCompare(b.tipo) || (a.ordem - b.ordem) || a.nome.localeCompare(b.nome, 'pt-BR'); });
}
function podeCadastrarMotivos_(u) { return u.adminPortal || u.modulos.solicitacoes === 'admin' || u.modulos.programacao === 'admin'; }
/** reg = {id?, tipo, nome, responsavel, ordem, ativo} */
function motSalvar_(reg, u) {
  if (!podeCadastrarMotivos_(u)) return semPermissao_('Só o administrador de Solicitações ou de Programação cadastra motivos.');
  reg = reg || {};
  const atual = reg.id ? porId_('Motivos', reg.id) : null;
  if (reg.id && !atual) return erroDados_('Motivo não encontrado. Atualize a página.');
  const r = { tipo: atual ? String(atual.tipo) : String(reg.tipo || ''), nome: String(reg.nome || '').trim().replace(/\s+/g, ' '),
              responsavel: String(reg.responsavel || ''), ordem: reg.ordem === '' || reg.ordem == null ? (atual ? num_(atual.ordem) : 99) : num_(reg.ordem) };
  if (MOTIVO_TIPOS.indexOf(r.tipo) < 0) return erroDados_('Escolha se é motivo de frustração ou de cancelamento.');
  if (!r.nome) return erroDados_('Informe o motivo.');
  if (MOTIVO_RESPONSAVEIS.indexOf(r.responsavel) < 0) return erroDados_('Escolha o responsável (Cliente, Interno, Externo ou Na hora).');
  if (ler_('Motivos').some(function (m) { return m.id !== (atual && atual.id) && m.tipo === r.tipo && String(m.nome).toLowerCase() === r.nome.toLowerCase(); })) return erroDados_('Já existe o motivo "' + r.nome + '".');
  if ('ativo' in reg) r.ativo = reg.ativo !== false;
  const rot = r.tipo + ': ' + r.nome;
  if (atual) { atualizar_('Motivos', atual.id, r, u, 'solicitacoes', { registroNome: rot }); return { ok: true, id: atual.id }; }
  r.ativo = true;
  return { ok: true, id: inserir_('Motivos', r, u, 'solicitacoes', rot).id };
}
function motExcluir_(id, u) {
  if (!podeCadastrarMotivos_(u)) return semPermissao_('Só o administrador de Solicitações ou de Programação cadastra motivos.');
  return excluir_('Motivos', String(id), u, 'solicitacoes');
}
function motivoValido_(id, tipo, atualId) {
  const m = porId_('Motivos', id);
  if (!m || String(m.tipo) !== tipo) return null;
  if (!m.ativo && String(atualId || '') !== String(id)) return null;
  return m;
}

/* ---------------- cancelamento pela solicitação ---------------- */
/** dados = {motivoId, obs}. Até a véspera da saída; se já estava numa viagem, a coleta sai dela e a programadora é avisada. */
function cancelarSolicitacao_(s, dados, u) {
  const m = motivoValido_(dados.motivoId, 'Cancelamento');
  if (!m) return erroDados_('Escolha o motivo do cancelamento.');
  const obs = String(dados.obs || dados.observacao || '').trim();
  if (!obs) return erroDados_('Escreva a observação do cancelamento.');
  if (['Realizada', 'Destinação', 'BM enviado', 'NF emitida', 'Cancelada'].indexOf(String(s.status)) >= 0) return erroDados_('Solicitação ' + s.status.toLowerCase() + ' não pode ser cancelada aqui.');
  const ativas = paradasAtivasDaSolicitacao_(s.id);
  if (ativas.some(function (x) { return x.p.resultado === 'Realizada'; })) return erroDados_('A coleta já foi realizada na Programação.');
  const pend = ativas.filter(function (x) { return !x.p.resultado || x.p.resultado === 'Pendente'; });
  let viagem = null;
  if (pend.length) {
    viagem = pend[0].v;
    if (hojeTxt_() >= dataTexto_(viagem.dataSaida))
      return erroDados_('A viagem sai em ' + dataBr_(viagem.dataSaida) + ': a partir do dia da saída, só a programadora cancela a coleta (na Programação).');
    pend.forEach(function (x) {
      const pr = porId_('Paradas', x.p.id); if (!pr) return;
      aba_('Paradas').deleteRow(pr._linha); limparCache_('Paradas');
      hist_(u, 'programacao', 'Viagens', x.v.id, rotuloViagem_(x.v), 'alterou', 'Parada removida', nomeCad_(x.p.clienteId) + ' (pendente)', '', 'Solicitação cancelada pelo solicitante: ' + m.nome + ' — ' + obs);
    });
    // reordena as paradas que ficaram
    onde_('Paradas', 'viagemId', viagem.id).sort(function (a, b) { return num_(a.ordem) - num_(b.ordem); })
      .forEach(function (p, i) { if (num_(p.ordem) !== i + 1) atualizar_('Paradas', p.id, { ordem: i + 1 }, u, null); });
  }
  atualizar_('Solicitacoes', s.id, { status: 'Cancelada', motivoId: m.id, motivo: m.nome + ' — ' + obs, dataPrevista: '', dataColeta: '',
    canceladaDaViagemId: viagem ? viagem.id : '', cancelCiente: '' }, u, 'solicitacoes', { registroNome: rotuloSol_(s) });
  if (viagem) avisarCancelamento_(porId_('Solicitacoes', s.id), viagem, m.nome + ' — ' + obs, u);
  return { ok: true, saiuDaViagem: !!viagem };
}
/** Programadora marca que viu o cancelamento. */
function progCiente_(solicitacaoId, u) {
  const s = porId_('Solicitacoes', solicitacaoId); if (!s) return erroDados_('Solicitação não encontrada.');
  if (!veUnidade_(u, s.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  atualizar_('Solicitacoes', s.id, { cancelCiente: 'SIM' }, u, 'programacao', { registroNome: rotuloSol_(s) });
  return { ok: true };
}
function cancelamentosAvisar_(u) {
  return ler_('Solicitacoes').filter(function (s) { return s.status === 'Cancelada' && s.canceladaDaViagemId && !simNao_(s.cancelCiente) && veUnidade_(u, s.unidadeId); })
    .map(function (s) { const v = porId_('Viagens', s.canceladaDaViagemId);
      return { id: s.id, clienteId: String(s.clienteId), unidadeId: String(s.unidadeId), motivo: String(s.motivo || ''), viagemId: String(s.canceladaDaViagemId),
               viagem: v ? rotuloViagem_(v) : '', saida: v ? dataTexto_(v.dataSaida) : '', quando: isoMomento_(s.atualizadoEm), por: String(s.atualizadoPor || '') }; });
}

/* ---------------- parada frustrada ou cancelada ---------------- */
/** Confere motivo, responsável, observação e "a equipe saiu" de uma parada. Devolve o texto do erro ou ''. */
function conferirParadaFrustrada_(x, antes, v, n) {
  if (x.resultado !== 'Frustrada' && x.resultado !== 'Cancelada') { x.motivoId = ''; x.responsavel = ''; x.equipeSaiu = ''; return ''; }
  const tipo = x.resultado === 'Frustrada' ? 'Frustração' : 'Cancelamento';
  const mudou = !antes || antes.resultado !== x.resultado;
  if (mudou && hojeTxt_() < dataTexto_(v.dataSaida))
    return 'Parada ' + n + ': ' + (x.resultado === 'Frustrada' ? 'frustrada' : 'cancelada') + ' só a partir do dia da saída (' + dataBr_(v.dataSaida) + '). Antes disso, tire a coleta da viagem.';
  const m = motivoValido_(x.motivoId, tipo, antes && antes.motivoId);
  if (!m) return 'Parada ' + n + ': escolha o motivo ' + (tipo === 'Frustração' ? 'da frustração.' : 'do cancelamento.');
  if (!x.motivo) return 'Parada ' + n + ': escreva a observação (' + x.resultado.toLowerCase() + ').';
  if (m.responsavel === 'Na hora') {
    if (['Cliente', 'Interno', 'Externo'].indexOf(x.responsavel) < 0) return 'Parada ' + n + ': escolha o responsável (Cliente, Interno ou Externo).';
  } else x.responsavel = String(m.responsavel);
  if (x.resultado === 'Cancelada') {
    if (x.equipeSaiu !== 'SIM' && x.equipeSaiu !== 'NÃO') return 'Parada ' + n + ': informe se a equipe já tinha saído da base.';
  } else x.equipeSaiu = '';
  return '';
}
function geraCobranca_(x) { return x.responsavel === 'Cliente' && (x.resultado === 'Frustrada' || (x.resultado === 'Cancelada' && x.equipeSaiu === 'SIM')); }

/* ---------------- cobranças ---------------- */
function cobrancaDaParada_(paradaId) { return ler_('CobrancasFrustracao').filter(function (c) { return c.ativo && String(c.paradaId) === String(paradaId); })[0] || null; }
/** {cobrancaId: faturamento ativo} */
function cobrancasNoBm_() {
  const fats = {}; ler_('Faturamentos').forEach(function (f) { if (f.status !== 'Cancelado') fats[f.id] = f; });
  const out = {};
  ler_('FaturamentoItens').forEach(function (it) { const f = fats[it.faturamentoId]; if (f && it.cobrancaId) out[it.cobrancaId] = { id: f.id, bmNumero: String(f.bmNumero || ''), status: String(f.status) }; });
  return out;
}
/** Antes de gravar a viagem: cobrança já num BM não pode sumir. */
function conferirCobrancasViagem_(paradas, pAntes) {
  const noBm = cobrancasNoBm_();
  const erros = [];
  pAntes.forEach(function (a) {
    const c = cobrancaDaParada_(a.id); if (!c || !noBm[c.id]) return;
    const x = paradas.filter(function (y) { return y.id === a.id; })[0];
    if (!x || !geraCobranca_(x)) erros.push('A frustração de ' + nomeCad_(a.clienteId) + ' já está cobrada no BM ' + (noBm[c.id].bmNumero || 's/nº') + '. Cancele o BM antes de mudar esta parada.');
  });
  return erros;
}
/** Depois de gravar a viagem: cria, atualiza ou anula as cobranças das paradas. */
function sincronizarCobrancasViagem_(v, paradas, removidas, u) {
  paradas.forEach(function (x) {
    const pid = x._id || x.id; const c = cobrancaDaParada_(pid);
    if (geraCobranca_(x)) {
      const m = porId_('Motivos', x.motivoId) || {};
      const sol = x.solicitacaoId ? porId_('Solicitacoes', x.solicitacaoId) : null;
      const campos = { solicitacaoId: x.solicitacaoId || '', paradaId: pid, viagemId: v.id, clienteId: x.clienteId, unidadeId: String((sol && sol.unidadeId) || v.unidadeId || ''),
        data: x.data || dataTexto_(v.dataSaida), tipo: x.resultado === 'Frustrada' ? 'Frustrada' : 'Cancelada no dia', motivoId: x.motivoId, motivo: String(m.nome || ''), obsProgramacao: x.motivo };
      const rot = 'Cobrança de frustrada · ' + nomeCad_(x.clienteId) + ' · ' + dataBr_(campos.data);
      if (c) atualizar_('CobrancasFrustracao', c.id, campos, u, 'solicitacoes', { registroNome: rot });
      else {
        campos.decisao = 'A decidir'; campos.valor = ''; campos.justificativa = ''; campos.decididoPor = ''; campos.decididoEm = ''; campos.ativo = true;
        const novo = inserir_('CobrancasFrustracao', campos, u, 'solicitacoes', rot);
        if (x.solicitacaoId) hist_(u, 'solicitacoes', 'Solicitacoes', x.solicitacaoId, rotuloSol_(sol), 'alterou', 'Cobrança da viagem frustrada', '', 'A decidir',
          campos.tipo + ' em ' + dataBr_(campos.data) + ': ' + campos.motivo + ' — ' + x.motivo);
        avisarCobranca_(porId_('CobrancasFrustracao', novo.id));
      }
    } else if (c) anularCobranca_(c, u, 'A parada deixou de ser frustrada por responsabilidade do cliente.');
  });
  (removidas || []).forEach(function (pid) { const c = cobrancaDaParada_(pid); if (c) anularCobranca_(c, u, 'A parada saiu da viagem.'); });
}
function anularCobranca_(c, u, porque) {
  atualizar_('CobrancasFrustracao', c.id, { ativo: false, decisao: 'Anulada' }, u, 'solicitacoes', { registroNome: 'Cobrança de frustrada · ' + nomeCad_(c.clienteId) + ' · ' + dataBr_(c.data) });
  if (c.solicitacaoId) hist_(u, 'solicitacoes', 'Solicitacoes', c.solicitacaoId, rotuloSol_(porId_('Solicitacoes', c.solicitacaoId) || {}), 'alterou', 'Cobrança da viagem frustrada', String(c.decisao), 'Anulada', porque);
}
/** Valor sugerido pelo preço de transporte do cliente: por viagem, ou km × R$/km. */
function sugestaoCobranca_(c) {
  const cli = porId_('Cadastros', c.clienteId); if (!cli) return { valor: '', base: '' };
  const ids = [String(cli.id)]; if (cli.cadastroPrincipalId) ids.push(String(cli.cadastroPrincipalId));
  const solC = c.solicitacaoId ? porId_('Solicitacoes', c.solicitacaoId) : null;
  // preço do contrato só para solicitação com perfil Contrato, vigente na data da solicitação
  if (solC && !usaTabelaContrato_(solC)) return { valor: '', base: 'Solicitação de proposta: use o valor da proposta.' };
  const data = solC ? dataRefPreco_(solC) : (dataTexto_(c.data) || hojeTxt_());
  const ps = ler_('PrecosCliente').filter(function (p) {
    if (!p.ativo || p.valorTransporte === '' || ids.indexOf(String(p.cadastroId)) < 0 || !modalidadeComTransporte_(p.modalidade)) return false;
    const ini = dataTexto_(p.vigenciaInicio), fim = dataTexto_(p.vigenciaFim);
    return (!ini || ini <= data) && (!fim || fim >= data);
  }).sort(function (a, b) { return ids.indexOf(String(a.cadastroId)) - ids.indexOf(String(b.cadastroId)); });
  const p = ps[0]; if (!p) return { valor: '', base: 'Cliente sem preço de transporte no Mapa.' };
  if (!modalidadeKm_(p.modalidade)) return { valor: num_(p.valorTransporte), base: 'Transporte por viagem (' + p.modalidade + ').' };
  const v = porId_('Viagens', c.viagemId), sol = c.solicitacaoId ? porId_('Solicitacoes', c.solicitacaoId) : null;
  const ki = v ? numOuVazio_(v.kmInicial) : '', kf = v ? numOuVazio_(v.kmFinal) : '';
  const sozinha = v && onde_('Paradas', 'viagemId', v.id).length === 1;
  if (sozinha && ki !== '' && kf !== '' && kf > ki) return { valor: r2_((kf - ki) * num_(p.valorTransporte)), base: (kf - ki) + ' km rodados × R$ ' + num_(p.valorTransporte) + '/km.' };
  const kmp = sol ? num_(sol.kmPrevista) : 0;
  return kmp > 0 ? { valor: r2_(kmp * num_(p.valorTransporte)), base: kmp + ' km previstos × R$ ' + num_(p.valorTransporte) + '/km.' } : { valor: '', base: 'Transporte por km (R$ ' + num_(p.valorTransporte) + '/km): informe o km.' };
}
function cobrancaPublica_(c, noBm) {
  const o = publico_('CobrancasFrustracao', c);
  o.data = dataTexto_(c.data); o.decididoEm = dataTexto_(c.decididoEm); o.valor = c.valor === '' ? '' : num_(c.valor);
  o.noBm = noBm[c.id] || null;
  if (c.decisao === 'A decidir') o.sugestao = sugestaoCobranca_(c);
  const v = porId_('Viagens', c.viagemId); o.viagem = v ? rotuloViagem_(v) : '';
  return o;
}
function cobrancasVisiveis_(u) {
  const noBm = cobrancasNoBm_();
  return ler_('CobrancasFrustracao').filter(function (c) { return c.ativo && veUnidade_(u, c.unidadeId); }).map(function (c) { return cobrancaPublica_(c, noBm); });
}
/** x = {id, decisao: 'Cobrar'|'Não cobrar', valor, obs} — só quem tem a autorização no cadastro do usuário. */
function solCobranca_(x, u) {
  x = x || {};
  if (!(u.adminPortal || u.decideCobranca)) return semPermissao_('Você não está autorizado a decidir a cobrança de viagem frustrada. Peça ao administrador do portal.');
  const c = porId_('CobrancasFrustracao', x.id); if (!c || !c.ativo) return erroDados_('Cobrança não encontrada. Atualize a página.');
  if (!veUnidade_(u, c.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  const fat = cobrancasNoBm_()[c.id]; if (fat) return erroDados_('Esta cobrança já está no BM ' + (fat.bmNumero || 's/nº') + '. Para mudar, o Faturamento precisa cancelar o BM.');
  const decisao = String(x.decisao || '');
  const obs = String(x.obs || '').trim();
  const campos = { decisao: decisao, decididoPor: String(u.nome || u.email), decididoEm: hojeTxt_() };
  if (decisao === 'Cobrar') {
    const valor = num_(x.valor); if (!(valor > 0)) return erroDados_('Informe o valor a cobrar.');
    campos.valor = r2_(valor); campos.justificativa = obs;
  } else if (decisao === 'Não cobrar') {
    if (!obs) return erroDados_('Escreva a justificativa de não cobrar a viagem frustrada.');
    campos.valor = ''; campos.justificativa = obs;
  } else return erroDados_('Escolha cobrar ou não cobrar.');
  const sol = c.solicitacaoId ? porId_('Solicitacoes', c.solicitacaoId) : null;
  atualizar_('CobrancasFrustracao', c.id, campos, u, 'solicitacoes', sol ? { tabela: 'Solicitacoes', registroId: sol.id, registroNome: rotuloSol_(sol), prefixoCampo: 'Cobrança da frustrada de ' + dataBr_(c.data) + ' · ' }
    : { registroNome: 'Cobrança de frustrada · ' + nomeCad_(c.clienteId) });
  return { ok: true };
}

/* ---------------- e-mails ---------------- */
function usuariosAtivos_() { return ler_('Usuarios').filter(function (r) { return r.ativo; }).map(function (r) { return acharUsuario_(r.email); }).filter(Boolean); }
function veUnidadeUsuario_(us, unidadeId) { return us.adminPortal || !us.unidades.length || !unidadeId || us.unidades.indexOf(String(unidadeId)) >= 0; }
function avisarCobranca_(c) {
  if (!c) return;
  const us = usuariosAtivos_();
  let para = us.filter(function (x) { return x.decideCobranca && veUnidadeUsuario_(x, c.unidadeId); });
  if (!para.length) para = us.filter(function (x) { return x.adminPortal; });
  const dest = para.map(function (x) { return x.email; }).filter(function (e, i, l) { return l.indexOf(e) === i && aceitaEmail_(e, 'cobranca'); });
  if (!dest.length) return;
  const cliente = nomeCad_(c.clienteId);
  try {
    MailApp.sendEmail({ to: dest.join(','), subject: 'Cobrança de viagem frustrada a decidir · ' + cliente + ' · ' + dataBr_(c.data),
      body: 'Olá.\n\nA coleta de ' + cliente + ' em ' + dataBr_(c.data) + ' foi ' + (c.tipo === 'Frustrada' ? 'frustrada' : 'cancelada no dia, com a equipe já na rua') +
            ' por responsabilidade do cliente.\n\nMotivo: ' + c.motivo + '\nObservação da programação: ' + c.obsProgramacao +
            '\n\nDecida no portal se a viagem será cobrada (e quanto) ou não (com justificativa): ' + URL_PORTAL + 'solicitacoes/\n\n(Mensagem automática do Portal Grupo GVC. Para não receber, peça para desligar na sua ficha em Pessoas.)' });
  } catch (e) { /* sem cota: a decisão continua pendente na Fila */ }
}
function avisarCancelamento_(s, v, motivo, u) {
  const dest = usuariosAtivos_().filter(function (x) { return (x.modulos.programacao === 'editor' || x.modulos.programacao === 'admin') && veUnidadeUsuario_(x, s.unidadeId) && x.email !== normEmail_(u.email); })
    .map(function (x) { return x.email; }).filter(function (e, i, l) { return l.indexOf(e) === i && aceitaEmail_(e, 'cancelamento'); });
  if (!dest.length) return;
  const cliente = nomeCad_(s.clienteId);
  try {
    MailApp.sendEmail({ to: dest.join(','), subject: 'Coleta cancelada · ' + cliente + ' · viagem de ' + dataBr_(v.dataSaida),
      body: 'Olá.\n\n' + (u.nome || u.email) + ' cancelou a solicitação de ' + cliente + ', que estava programada na viagem ' + rotuloViagem_(v) + '. A coleta já saiu da viagem.\n\n' +
            'Motivo: ' + motivo + '\n\nConfira a viagem: ' + URL_PORTAL + 'programacao/\n\n(Mensagem automática do Portal Grupo GVC. Para não receber, peça para desligar na sua ficha em Pessoas.)' });
  } catch (e) { /* sem cota: o alerta continua na tela da Programação */ }
}

/* ---------------- migração (ESQUEMA 12) ---------------- */
function migrarFrustracao_() {
  ['Solicitacoes', 'Paradas', 'FaturamentoItens', 'Usuarios'].forEach(migrarCabecalho_);
  aba_('Motivos'); aba_('CobrancasFrustracao');
  if (!ler_('Motivos').length) {
    const ord = {};
    inserirLote_('Motivos', MOTIVOS_INICIAIS.map(function (m) { ord[m[0]] = (ord[m[0]] || 0) + 1; return { tipo: m[0], nome: m[1], responsavel: m[2], ordem: ord[m[0]], ativo: true }; }), null);
  }
  // resultado da parada: no-show vira motivo de frustração; entra "Cancelada"
  const res = ler_('Listas').filter(function (x) { return x.lista === 'resultadoParada'; });
  res.forEach(function (x) { if (String(x.valor) === 'No-show' && x.ativo) atualizar_('Listas', x.id, { ativo: false }, null, null); });
  if (!res.some(function (x) { return String(x.valor) === 'Cancelada'; })) inserir_('Listas', { lista: 'resultadoParada', valor: 'Cancelada', ordem: res.length + 1, ativo: true }, null, null);
  const mot = function (tipo, nome) { return (ler_('Motivos').filter(function (m) { return m.tipo === tipo && String(m.nome) === nome; })[0] || {}).id || ''; };
  const noShow = mot('Frustração', 'Cliente ausente / não recebeu (no-show)'), outroF = mot('Frustração', 'Outro');
  ler_('Paradas').filter(function (p) { return (p.resultado === 'No-show' || p.resultado === 'Frustrada') && !p.motivoId; }).forEach(function (p) {
    atualizar_('Paradas', p.id, { resultado: 'Frustrada', motivoId: p.resultado === 'No-show' ? noShow : outroF, responsavel: p.resultado === 'No-show' ? 'Cliente' : '' }, null, null);
  });
  // e-mails novos
  // datas: prevista = saída da viagem, coleta = data da parada; a "prevista" digitada vira "desejada pelo cliente"
  const vs = {}; ler_('Viagens').forEach(function (v) { if (v.status !== 'Cancelada') vs[v.id] = v; });
  const porSol = {};
  ler_('Paradas').forEach(function (p) {
    if (!p.solicitacaoId || !vs[p.viagemId] || ['Pendente', 'Realizada', ''].indexOf(String(p.resultado)) < 0) return;
    const x = { p: p, v: vs[p.viagemId] }; const atual = porSol[p.solicitacaoId];
    const rx = x.p.resultado === 'Realizada' ? 1 : 0, ra = atual ? (atual.p.resultado === 'Realizada' ? 1 : 0) : -1;
    if (!atual || rx > ra || (rx === ra && dataTexto_(x.p.data) > dataTexto_(atual.p.data))) porSol[p.solicitacaoId] = x;
  });
  const sh = aba_('Solicitacoes'), cab = colunas_('Solicitacoes'), ult = sh.getLastRow();
  if (ult >= 2) {
    const vals = sh.getRange(2, 1, ult - 1, cab.length).getValues();
    const ci = function (c) { return cab.indexOf(c); };
    let n = 0;
    vals.forEach(function (r) {
      const id = String(r[0] || ''); if (!id) return;
      const prog = porSol[id];
      if (prog) {
        r[ci('dataPrevista')] = paraData_(dataTexto_(prog.v.dataSaida));
        if (dataTexto_(prog.p.data)) r[ci('dataColeta')] = paraData_(dataTexto_(prog.p.data));
      } else {
        if (dataTexto_(r[ci('dataPrevista')]) && !dataTexto_(r[ci('dataDesejada')])) r[ci('dataDesejada')] = r[ci('dataPrevista')];
        r[ci('dataPrevista')] = '';
      }
      n++;
    });
    sh.getRange(2, 1, ult - 1, cab.length).setValues(vals);
    limparCache_('Solicitacoes');
    HIST_BUF_.push([new Date(), '', 'sistema', 'solicitacoes', 'Solicitacoes', '', '', 'migrou', '', '', '', n + ' solicitação(ões): data prevista = saída da viagem e data da coleta = data da parada; a prevista digitada passou para "Data desejada pelo cliente".']);
  }
  HIST_BUF_.push([new Date(), '', 'sistema', 'solicitacoes', 'Motivos', '', '', 'migrou', '', '', '', 'Motivos padrão de frustração e cancelamento; no-show virou motivo; cobrança de viagem frustrada.']);
}
