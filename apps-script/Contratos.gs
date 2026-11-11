/* =====================================================================
 * Portal GVC — contrato do cliente, vínculo matriz/filial e referência de preço.
 *  • Preço de venda: vale o preço vigente na DATA DA SOLICITAÇÃO, e só para solicitação com
 *    perfil "Contrato" (perfil "Proposta" = serviço avulso, com os valores da proposta).
 *  • Vínculo: cadastro auxiliar (filial) ligado ao principal (matriz), um nível só.
 *    faturaPara = '' (o próprio CNPJ) ou 'principal' (o BM/NF sai no CNPJ da matriz).
 *  • Contrato: um por cliente, com aditivos; arquivo escaneado na pasta restrita do Drive;
 *    só vê o arquivo quem tem "Vê os contratos dos clientes" (admin do portal sempre);
 *    alerta por e-mail 30 dias antes do vencimento e no vencimento para quem tem
 *    "Recebe alerta de vencimento de contrato".
 * ===================================================================== */

const DIAS_ALERTA_CONTRATO = 30;
const ARQ_CONTRATO_MAX = 14000000; // ~10 MB em base64
const TIPOS_ARQ_CONTRATO = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

/* ---------------- referência de preço ---------------- */
function dataRefPreco_(s) { return dataTexto_(s && s.dataSolicitacao) || dataTexto_(s && s.dataDesejada) || dataTexto_(s && s.dataColeta) || hojeTxt_(); }
function usaTabelaContrato_(s) { return !!s && String(s.perfil || '') === 'Contrato'; }
/** Preço por km da solicitação (só perfil Contrato, vigente na data da solicitação). */
function precoKmSol_(s) { return usaTabelaContrato_(s) ? precoKmVigente_(s.clienteId, dataRefPreco_(s)) : null; }

/* ---------------- vínculo matriz / filial ---------------- */
/** Cadastro que recebe o BM/NF das coletas deste cliente. */
function faturavelDe_(clienteId) {
  const c = porId_('Cadastros', clienteId); if (!c) return String(clienteId || '');
  return c.cadastroPrincipalId && String(c.faturaPara) === 'principal' && porId_('Cadastros', c.cadastroPrincipalId) ? String(c.cadastroPrincipalId) : String(c.id);
}
/** x = {id, principalId, faturaPara: ''|'principal'} */
function salvarVinculo_(x, u) {
  x = x || {};
  const c = porId_('Cadastros', String(x.id || '')); if (!c) return erroDados_('Cadastro não encontrado.');
  const principalId = String(x.principalId || '');
  const faturaPara = principalId && x.faturaPara === 'principal' ? 'principal' : '';
  if (principalId) {
    if (principalId === c.id) return erroDados_('O cadastro não pode ser vinculado a ele mesmo.');
    const p = porId_('Cadastros', principalId); if (!p) return erroDados_('Cadastro principal não encontrado.');
    if (!p.ativo) return erroDados_('O cadastro principal está inativo.');
    if (p.cadastroPrincipalId) return erroDados_(String(p.nome) + ' já é filial de outro cadastro. O vínculo tem um nível só: escolha a matriz.');
    const filhos = ler_('Cadastros').filter(function (y) { return String(y.cadastroPrincipalId) === c.id; });
    if (filhos.length) return erroDados_(String(c.nome) + ' é matriz de ' + filhos.length + ' cadastro(s). Uma matriz não pode ser filial de outro.');
  }
  if (String(c.cadastroPrincipalId || '') === principalId && String(c.faturaPara || '') === faturaPara) return { ok: true };
  atualizar_('Cadastros', c.id, { cadastroPrincipalId: principalId, faturaPara: faturaPara }, u, 'mapa', { registroNome: String(c.nome) });
  return { ok: true };
}

/* ---------------- contrato ---------------- */
function veContratos_(u) { return !!(u && (u.adminPortal || u.veContratos)); }
function pastaContratos_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('CONTRATOS_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.getFolderById(p.getProperty('PASTA_ID')).createFolder('Contratos de clientes (restrito)');
  p.setProperty('CONTRATOS_ID', f.getId());
  return f;
}
function aditivosDe_(contratoId) {
  return onde_('ContratoAditivos', 'contratoId', contratoId).filter(function (a) { return a.ativo; })
    .sort(function (a, b) { return String(dataTexto_(a.data)).localeCompare(String(dataTexto_(b.data))); });
}
/** Validade valendo: a do contrato ou a maior nova validade dos aditivos. */
function validadeEfetiva_(c, aditivos) {
  let v = dataTexto_(c.validade);
  (aditivos || aditivosDe_(c.id)).forEach(function (a) { const n = dataTexto_(a.novaValidade); if (n && (!v || n > v)) v = n; });
  return v;
}
function diasEntre_(de, ate) { return Math.round((paraData_(ate).getTime() - paraData_(de).getTime()) / 864e5); }
function situacaoContrato_(c, validade, hoje) {
  hoje = hoje || hojeTxt_();
  if (simNao_(c.encerrado)) return 'Encerrado';
  if (!validade) return 'A completar';
  if (validade < hoje) return 'Vencido';
  if (diasEntre_(hoje, validade) <= DIAS_ALERTA_CONTRATO) return 'Vencendo';
  return 'Vigente';
}
function contratoDoCliente_(cadastroId) {
  return onde_('Contratos', 'cadastroId', cadastroId).filter(function (c) { return c.ativo; })[0] || null;
}
function contratoPublico_(c, u) {
  const ads = aditivosDe_(c.id);
  const validade = validadeEfetiva_(c, ads);
  const ve = veContratos_(u);
  const o = { id: c.id, cadastroId: String(c.cadastroId), numero: String(c.numero || ''), objeto: String(c.objeto || ''), inicio: dataTexto_(c.inicio),
    validade: dataTexto_(c.validade), validadeEfetiva: validade, renovacaoAutomatica: simNao_(c.renovacaoAutomatica), encerrado: simNao_(c.encerrado),
    obs: String(c.obs || ''), situacao: situacaoContrato_(c, validade), diasParaVencer: validade ? diasEntre_(hojeTxt_(), validade) : '',
    temArquivo: !!c.arquivoId, arquivoNome: String(c.arquivoNome || ''), podeVerArquivo: ve,
    aditivos: ads.map(function (a) { return { id: a.id, numero: String(a.numero || ''), data: dataTexto_(a.data), descricao: String(a.descricao || ''),
      novaValidade: dataTexto_(a.novaValidade), temArquivo: !!a.arquivoId, arquivoNome: String(a.arquivoNome || '') }; }) };
  const au = auditoria_(c); Object.keys(au).forEach(function (k) { o[k] = au[k]; });
  return o;
}
/** Contrato do cliente (ou da matriz, quando a filial não tem o próprio). */
function contratoDados_(cadastroId, u) {
  const cad = porId_('Cadastros', cadastroId); if (!cad) return erroDados_('Cadastro não encontrado.');
  const c = contratoDoCliente_(cad.id);
  const p = cad.cadastroPrincipalId ? porId_('Cadastros', cad.cadastroPrincipalId) : null;
  const cm = !c && p ? contratoDoCliente_(p.id) : null;
  return { ok: true, contrato: c ? contratoPublico_(c, u) : null,
    daMatriz: cm ? Object.assign(contratoPublico_(cm, u), { matrizNome: String(p.nome) }) : null,
    podeVerArquivo: veContratos_(u), diasAlerta: DIAS_ALERTA_CONTRATO };
}
/** x = {id?, cadastroId, numero, objeto, inicio, validade, renovacaoAutomatica, encerrado, obs} */
function salvarContrato_(x, u) {
  x = x || {};
  const atual = x.id ? porId_('Contratos', x.id) : null;
  if (x.id && !atual) return erroDados_('Contrato não encontrado. Atualize.');
  const cad = porId_('Cadastros', atual ? atual.cadastroId : String(x.cadastroId || '')); if (!cad) return erroDados_('Cadastro não encontrado.');
  if (!atual && contratoDoCliente_(cad.id)) return erroDados_('Este cliente já tem contrato. Serviços novos entram como aditivo.');
  const r = { cadastroId: cad.id, numero: String(x.numero || '').trim(), objeto: String(x.objeto || '').trim(), inicio: dataTexto_(x.inicio), validade: dataTexto_(x.validade),
    renovacaoAutomatica: x.renovacaoAutomatica === true ? 'SIM' : 'NÃO', encerrado: x.encerrado === true ? 'SIM' : 'NÃO', obs: String(x.obs || '').trim() };
  if (!r.inicio) return erroDados_('Informe a data de início do contrato.');
  if (!r.validade) return erroDados_('Informe a validade do contrato.');
  if (r.validade < r.inicio) return erroDados_('A validade é antes do início.');
  const opc = { tabela: 'Cadastros', registroId: cad.id, registroNome: String(cad.nome), prefixoCampo: 'Contrato · ' };
  if (atual) { atualizar_('Contratos', atual.id, r, u, 'mapa', opc); return { ok: true, id: atual.id }; }
  r.ativo = true;
  const novo = inserir_('Contratos', r, u, null);
  hist_(u, 'mapa', 'Cadastros', cad.id, String(cad.nome), 'alterou', 'Contrato incluído', '', [r.numero, 'validade ' + dataBr_(r.validade)].filter(Boolean).join(' · '), '');
  return { ok: true, id: novo.id };
}
/** x = {id?, contratoId, numero, data, descricao, novaValidade} */
function salvarAditivo_(x, u) {
  x = x || {};
  const atual = x.id ? porId_('ContratoAditivos', x.id) : null;
  if (x.id && !atual) return erroDados_('Aditivo não encontrado. Atualize.');
  const c = porId_('Contratos', atual ? atual.contratoId : String(x.contratoId || '')); if (!c) return erroDados_('Contrato não encontrado.');
  const cad = porId_('Cadastros', c.cadastroId) || {};
  const r = { contratoId: c.id, numero: String(x.numero || '').trim(), data: dataTexto_(x.data), descricao: String(x.descricao || '').trim(), novaValidade: dataTexto_(x.novaValidade) };
  if (!r.data) return erroDados_('Informe a data do aditivo.');
  if (!r.descricao) return erroDados_('Descreva o aditivo (serviços novos, prorrogação…).');
  if (r.novaValidade && r.novaValidade < dataTexto_(c.inicio)) return erroDados_('A nova validade é antes do início do contrato.');
  const opc = { tabela: 'Cadastros', registroId: cad.id, registroNome: String(cad.nome || ''), prefixoCampo: 'Aditivo ' + (r.numero || '') + ' · ' };
  if (atual) { atualizar_('ContratoAditivos', atual.id, r, u, 'mapa', opc); return { ok: true, id: atual.id }; }
  r.ativo = true;
  const novo = inserir_('ContratoAditivos', r, u, null);
  hist_(u, 'mapa', 'Cadastros', cad.id, String(cad.nome || ''), 'alterou', 'Aditivo incluído', '', [r.numero, r.descricao, r.novaValidade ? 'nova validade ' + dataBr_(r.novaValidade) : ''].filter(Boolean).join(' · '), '');
  return { ok: true, id: novo.id };
}
function excluirAditivo_(id, u) {
  const a = porId_('ContratoAditivos', id); if (!a) return { ok: true };
  const c = porId_('Contratos', a.contratoId) || {}; const cad = porId_('Cadastros', c.cadastroId) || {};
  atualizar_('ContratoAditivos', a.id, { ativo: false }, null, null);
  hist_(u, 'mapa', 'Cadastros', cad.id || '', String(cad.nome || ''), 'alterou', 'Aditivo excluído', [a.numero, a.descricao].filter(Boolean).join(' · '), '', '');
  return { ok: true };
}
/** Anexa (ou troca) o arquivo do contrato ou do aditivo: x = {tipo: 'contrato'|'aditivo', id, nome, dataUrl} */
function anexarContrato_(x, u) {
  x = x || {};
  if (!veContratos_(u)) return semPermissao_('Você não está autorizado a ver os contratos dos clientes. Peça ao administrador do portal.');
  const tabela = x.tipo === 'aditivo' ? 'ContratoAditivos' : 'Contratos';
  const reg = porId_(tabela, String(x.id || '')); if (!reg) return erroDados_('Contrato não encontrado. Atualize.');
  const m = String(x.dataUrl || '').match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!m || !TIPOS_ARQ_CONTRATO[m[1].toLowerCase()]) return erroDados_('Envie o contrato em PDF, JPG ou PNG.');
  if (m[2].length > ARQ_CONTRATO_MAX) return erroDados_('Arquivo grande demais (máximo 10 MB).');
  const c = tabela === 'Contratos' ? reg : porId_('Contratos', reg.contratoId);
  const cad = porId_('Cadastros', c.cadastroId) || {};
  const nomeArq = String(x.nome || '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120) || (reg.id + '.' + TIPOS_ARQ_CONTRATO[m[1].toLowerCase()]);
  const blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1].toLowerCase(), (cad.codigoUplog ? cad.codigoUplog + ' - ' : '') + reg.id + ' - ' + nomeArq);
  const arq = pastaContratos_().createFile(blob);
  if (reg.arquivoId) { try { DriveApp.getFileById(String(reg.arquivoId)).setTrashed(true); } catch (e) {} }
  atualizar_(tabela, reg.id, { arquivoId: arq.getId(), arquivoNome: nomeArq }, null, null);
  hist_(u, 'mapa', 'Cadastros', cad.id || '', String(cad.nome || ''), 'alterou', (tabela === 'Contratos' ? 'Contrato' : 'Aditivo ' + (reg.numero || '')) + ' · Arquivo',
    String(reg.arquivoNome || ''), nomeArq, '');
  return { ok: true, arquivoNome: nomeArq };
}
function verArquivoContrato_(x, u) {
  x = x || {};
  if (!veContratos_(u)) return semPermissao_('Você não está autorizado a ver os contratos dos clientes. Peça ao administrador do portal.');
  const reg = porId_(x.tipo === 'aditivo' ? 'ContratoAditivos' : 'Contratos', String(x.id || ''));
  if (!reg || !reg.arquivoId) return erroDados_('Sem arquivo anexado.');
  try {
    const b = DriveApp.getFileById(String(reg.arquivoId)).getBlob();
    return { ok: true, nome: String(reg.arquivoNome || 'contrato'), dataUrl: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) };
  } catch (e) { return erroDados_('Não consegui abrir o arquivo no Drive.'); }
}

/* ---------------- vencimentos e alertas ---------------- */
/** Contratos que pedem atenção (vencendo em até 30 dias ou vencidos), para quem recebe o alerta. */
function contratosAtencao_() {
  const hoje = hojeTxt_();
  return ler_('Contratos').filter(function (c) { return c.ativo && !simNao_(c.encerrado); }).map(function (c) {
    const v = validadeEfetiva_(c); const sit = situacaoContrato_(c, v, hoje);
    const cad = porId_('Cadastros', c.cadastroId) || {};
    return { id: c.id, cadastroId: String(c.cadastroId), cliente: String(cad.nome || ''), codigoUplog: String(cad.codigoUplog || ''), numero: String(c.numero || ''),
      validade: v, situacao: sit, dias: v ? diasEntre_(hoje, v) : '', renovacaoAutomatica: simNao_(c.renovacaoAutomatica) };
  }).filter(function (x) { return x.situacao === 'Vencendo' || x.situacao === 'Vencido'; })
    .sort(function (a, b) { return String(a.validade).localeCompare(String(b.validade)); });
}
function contratosAlertas_(u) {
  if (!u.alertaContratos) return { ok: true, itens: [] };
  // reserva do gatilho diário: quem recebe o alerta abriu o portal e o e-mail do dia ainda não saiu
  if (PropertiesService.getScriptProperties().getProperty('CONTRATOS_ALERTA_DIA') !== hojeTxt_()) {
    const lock = LockService.getScriptLock();
    if (lock.tryLock(3000)) { try { avisarContratos_(false); } finally { lock.releaseLock(); } }
  }
  return { ok: true, itens: contratosAtencao_(), diasAlerta: DIAS_ALERTA_CONTRATO };
}
/** Resumo por cliente para as telas (selo "contrato vencido" etc.). */
function situacaoContratosPorCliente_() {
  const out = {}; const hoje = hojeTxt_();
  ler_('Contratos').filter(function (c) { return c.ativo; }).forEach(function (c) {
    const v = validadeEfetiva_(c); out[String(c.cadastroId)] = { situacao: situacaoContrato_(c, v, hoje), validade: v, numero: String(c.numero || '') };
  });
  return out;
}
/**
 * Gatilho diário (7h): manda um e-mail-resumo para quem recebe o alerta quando um contrato entra
 * nos 30 dias antes do vencimento e quando vence (uma vez em cada caso, por validade).
 */
function alertaContratosDiario() {
  if (!baseInstalada_()) return;
  const r = avisarContratos_(false); gravarHistorico_(); return r;
}
function avisarContratos_(forcar) {
  const p = PropertiesService.getScriptProperties(); const hoje = hojeTxt_();
  if (!forcar && p.getProperty('CONTRATOS_ALERTA_DIA') === hoje) return { ok: true, enviados: 0 };
  p.setProperty('CONTRATOS_ALERTA_DIA', hoje);
  const novos = [];
  contratosAtencao_().forEach(function (x) {
    const c = porId_('Contratos', x.id);
    if (x.situacao === 'Vencendo' && dataTexto_(c.alertaValidade) !== x.validade) { novos.push(x); atualizar_('Contratos', c.id, { alertaValidade: x.validade }, null, null); }
    if (x.situacao === 'Vencido' && dataTexto_(c.alertaVencidoValidade) !== x.validade) { novos.push(x); atualizar_('Contratos', c.id, { alertaValidade: x.validade, alertaVencidoValidade: x.validade }, null, null); }
  });
  if (!novos.length) return { ok: true, enviados: 0 };
  const dest = usuariosAtivos_().filter(function (u) { return u.alertaContratos; }).map(function (u) { return u.email; })
    .filter(function (e, i, l) { return l.indexOf(e) === i && aceitaEmail_(e, 'contrato'); });
  if (!dest.length) return { ok: true, enviados: 0 };
  const linha = function (x) {
    return '• ' + x.cliente + (x.codigoUplog ? ' (' + x.codigoUplog + ')' : '') + (x.numero ? ' · contrato ' + x.numero : '') + ' · ' +
      (x.situacao === 'Vencido' ? 'VENCEU em ' + dataBr_(x.validade) : 'vence em ' + dataBr_(x.validade) + ' (' + x.dias + ' dia' + (x.dias === 1 ? '' : 's') + ')') +
      (x.renovacaoAutomatica ? ' · renovação automática' : '');
  };
  try {
    MailApp.sendEmail({ to: dest.join(','), subject: 'Contratos de clientes: ' + novos.length + ' perto do vencimento ou vencido(s)',
      body: 'Olá.\n\nContratos de clientes que pedem atenção:\n\n' + novos.map(linha).join('\n') +
            '\n\nAtualize a validade ou inclua o aditivo no cadastro do cliente, no Mapa Operacional: ' + URL_PORTAL + 'mapa/\n\n' +
            '(Mensagem automática do Portal Grupo GVC. Para não receber, peça para desligar na sua ficha em Pessoas.)' });
  } catch (e) { return { ok: true, enviados: 0 }; }
  return { ok: true, enviados: novos.length, para: dest.length };
}
function criarGatilhoContratos_() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'alertaContratosDiario') ScriptApp.deleteTrigger(t); });
    ScriptApp.newTrigger('alertaContratosDiario').timeBased().everyDays(1).atHour(7).create();
  } catch (e) { /* sem permissão para gatilhos: o alerta sai quando alguém que recebe o alerta abre o portal */ }
}

/* ---------------- migração (ESQUEMA 13) ---------------- */
function migrarContratos_() {
  ['Cadastros', 'Usuarios'].forEach(migrarCabecalho_);
  aba_('Contratos'); aba_('ContratoAditivos');
  criarGatilhoContratos_();
  HIST_BUF_.push([new Date(), '', 'sistema', 'mapa', 'Contratos', '', '', 'migrou', '', '', '',
    'Contrato do cliente (anexo, aditivos, validade e alertas), vínculo matriz/filial com "fatura para" e preço pela data da solicitação.']);
}
