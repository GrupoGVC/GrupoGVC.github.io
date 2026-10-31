/* =====================================================================
 * Instalação da planilha central e migração (rodar UMA vez pelo editor: função instalarBase)
 * ---------------------------------------------------------------------
 * 1. Cria a pasta "Portal GVC" no Drive, com as planilhas "Portal GVC — Base" e
 *    "Portal GVC — Histórico" e a subpasta "Backups".
 * 2. Copia os dados do Controle (abas desta planilha) e do Mapa (planilha MAPA_PLANILHA_ID).
 *    As planilhas antigas não são alteradas: ficam como cópia de segurança.
 * 3. Agenda o backup semanal da Base (domingo, 3h).
 * ===================================================================== */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Portal GVC')
    .addItem('Fazer backup da Base agora', 'backupSemanal')
    .addItem('Desconectar todos os aparelhos', 'encerrarTodasSessoes')
    .addToUi();
}

function instalarBase() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty('BASE_ID')) { Logger.log('A Base já está instalada: ' + p.getProperty('BASE_ID')); return 'já instalada'; }
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    const pasta = DriveApp.createFolder('Portal GVC');
    const backups = pasta.createFolder('Backups');
    const ssBase = SpreadsheetApp.create('Portal GVC — Base');
    const ssHist = SpreadsheetApp.create('Portal GVC — Histórico');
    DriveApp.getFileById(ssBase.getId()).moveTo(pasta);
    DriveApp.getFileById(ssHist.getId()).moveTo(pasta);
    ssBase.setSpreadsheetTimeZone('America/Bahia'); ssHist.setSpreadsheetTimeZone('America/Bahia');
    BASE_SS_ = ssBase; HIST_SS_ = ssHist;
    Object.keys(TABELAS).forEach(function (nome) {
      const sh = ssBase.insertSheet(nome);
      prepararAba_(sh, colunas_(nome), TABELAS[nome]);
    });
    const hs = ssHist.insertSheet('Historico');
    prepararAba_(hs, HISTORICO_COLUNAS, {});
    [ssBase, ssHist].forEach(function (ss) {
      ss.getSheets().forEach(function (s) { if (['Sheet1', 'Página1', 'Planilha1'].indexOf(s.getName()) >= 0) ss.deleteSheet(s); });
    });
    const resumo = migrarDados_();
    p.setProperties({ BASE_ID: ssBase.getId(), HIST_ID: ssHist.getId(), PASTA_ID: pasta.getId(), BACKUP_ID: backups.getId() });
    gravarHistorico_();
    criarGatilhoBackup_();
    Logger.log('Pronto. ' + JSON.stringify(resumo));
    return resumo;
  } finally { lock.releaseLock(); }
}

/* ---------------- migração ---------------- */
function lerAntiga_(ss, aba) {
  const sh = ss.getSheetByName(aba);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getValues();
  const cab = v[0].map(function (x) { return String(x).trim(); });
  return v.slice(1).filter(function (r) { return String(r[0]).trim() !== ''; })
    .map(function (r) { const o = {}; cab.forEach(function (c, i) { if (c) o[c] = r[i]; }); return o; });
}
function seq_(prefixo, n) { return prefixo + '-' + ('00000' + n).slice(-6); }
function tituloResiduo_(s) {
  const ligacoes = ['de', 'da', 'do', 'das', 'dos', 'e'];
  return String(s).trim().toLowerCase().split(/\s+/).map(function (w) {
    if (ligacoes.indexOf(w) >= 0) return w;
    if (w.length <= 3) return w.toUpperCase(); // siglas: RCC, RSS, EPI
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function migrarDados_() {
  const agora = new Date();
  const SIS = 'migração';
  const ctl = SpreadsheetApp.getActive();
  const mapa = SpreadsheetApp.openById(MAPA_PLANILHA_ID);
  const cont = {}; // contadores por prefixo
  const novoSeq = function (nome) { const pre = TABELAS[nome].prefixo; cont[pre] = (cont[pre] || 0) + 1; return seq_(pre, cont[pre]); };
  const linhas = {}; Object.keys(TABELAS).forEach(function (n) { linhas[n] = []; });
  const add = function (nome, o, criadoEm, criadoPor, atualizadoEm, atualizadoPor) {
    o.id = o.id || novoSeq(nome);
    o.criadoEm = criadoEm || agora; o.criadoPor = criadoPor || SIS;
    o.atualizadoEm = atualizadoEm || o.criadoEm; o.atualizadoPor = atualizadoPor || o.criadoPor;
    linhas[nome].push(linhaDe_(nome, o));
    return o.id;
  };

  // Unidades
  const uniSA = add('Unidades', { nome: 'Retec S/A', ativo: true });
  add('Unidades', { nome: 'Retec Oeste', ativo: true });

  // Usuários
  lerAntiga_(ctl, 'Usuarios').forEach(function (r) {
    const email = normEmail_(r.email); if (!email) return;
    const admin = simNao_(r.adminPortal);
    const id = add('Usuarios', { email: email, nome: r.nome, adminPortal: admin ? 'SIM' : 'NÃO', unidades: '', ativo: simNao_(r.ativo) || String(r.ativo).trim() === '',
      senhaHash: r.senhaHash, salt: r.salt, ultimoAcesso: r.ultimoAcesso || '' }, r.criadoEm instanceof Date ? r.criadoEm : agora);
    ['destinacao', 'mapa'].forEach(function (m) {
      const niv = String(r[m] || (m === 'destinacao' ? r.nivel : '') || '').trim().toLowerCase();
      if (NIVEIS.indexOf(niv) >= 0) add('UsuarioModulos', { usuarioId: id, modulo: m, nivel: niv });
    });
  });

  // Catálogos
  const resPorChave = {}, eqPorChave = {};
  const addRes = function (nome) {
    const k = semAcento_(nome); if (!k) return '';
    if (!resPorChave[k]) resPorChave[k] = add('Residuos', { nome: String(nome).trim(), ativo: true });
    return resPorChave[k];
  };
  const addEq = function (nome) {
    const k = semAcento_(nome); if (!k) return '';
    if (!eqPorChave[k]) eqPorChave[k] = add('Equipamentos', { nome: String(nome).trim(), ativo: true });
    return eqPorChave[k];
  };
  lerAntiga_(mapa, 'Residuos').forEach(function (r) { addRes(r.residuo); });
  lerAntiga_(mapa, 'Equipamentos').forEach(function (r) { addEq(r.equipamento); });
  const resDoTexto = function (txt) {
    const k = semAcento_(txt); if (!k) return '';
    if (resPorChave[k]) return resPorChave[k];
    if (RESIDUO_APELIDOS[k] && resPorChave[semAcento_(RESIDUO_APELIDOS[k])]) return resPorChave[semAcento_(RESIDUO_APELIDOS[k])];
    return addRes(tituloResiduo_(txt));
  };

  // Cadastros do Mapa
  const cadPorIdAntigo = {};
  lerAntiga_(mapa, 'Pontos').forEach(function (r) {
    const idAntigo = String(r.id);
    const cid = add('Cadastros', { codigoUplog: '', tipos: separar_(r.tipos || r.tipo).join(', '), nome: r.nome, razaoSocial: r.razaoSocial, categoria: r.cat,
      cnpj: r.cnpj, contatoNome: r.contatoNome, telefones: r.telefones || r.tel, emails: r.emails || r.email, obs: r.obs, cadastroPrincipalId: '',
      idOrigem: idAntigo, ativo: true });
    cadPorIdAntigo[idAntigo] = cid;
    const lat = r.lat === '' || r.lat == null ? '' : Number(r.lat), lng = r.lng === '' || r.lng == null ? '' : Number(r.lng);
    const lid = add('Locais', { cadastroId: cid, nome: 'Principal', logradouro: r.logradouro, numero: r.numero, bairro: r.bairro, cidade: r.cidade,
      uf: r.uf, cep: r.cep, lat: isNaN(lat) ? '' : lat, lng: isNaN(lng) ? '' : lng, ativo: true });
    add('CadastroLocais', { cadastroId: cid, localId: lid, situacao: 'ativo' });
    separar_(r.equipamentos).forEach(function (e) {
      const eid = addEq(e); if (eid) add('CadastroEquipamentos', { cadastroId: cid, equipamentoId: eid });
    });
  });
  lerAntiga_(mapa, 'ResiduosCadastro').forEach(function (r) {
    const cid = cadPorIdAntigo[String(r.id_cadastro)]; if (!cid) return;
    const rid = addRes(r.residuo); if (!rid) return;
    add('CadastroResiduos', { cadastroId: cid, residuoId: rid, precoKg: r.preco_kg === '' || r.preco_kg == null ? '' : Number(r.preco_kg), natureza: r.natureza });
  });

  // Destinadores antigos do Controle que não existem no Mapa: entram inativos, só para o histórico
  const destAntigos = {}; lerAntiga_(ctl, 'Destinadores').forEach(function (d) { destAntigos[String(d.id).trim()] = d; });
  const destinadorDe = function (idCtl) {
    idCtl = String(idCtl || '').trim(); if (!idCtl) return '';
    if (cadPorIdAntigo['cd-' + idCtl]) return cadPorIdAntigo['cd-' + idCtl];
    if (cadPorIdAntigo[idCtl]) return cadPorIdAntigo[idCtl];
    const d = destAntigos[idCtl] || { nome: idCtl, tipo: 'custo' };
    const cid = add('Cadastros', { tipos: String(d.tipo).toLowerCase() === 'receita' ? 'reciclador' : 'destinador', nome: d.nome || idCtl,
      obs: 'Destinador antigo do Controle de Destinação (não existia no Mapa).', idOrigem: 'controle:' + idCtl, ativo: false });
    cadPorIdAntigo[idCtl] = cid;
    return cid;
  };

  // Lançamentos
  let semDest = 0;
  lerAntiga_(ctl, 'Lancamentos').forEach(function (r) {
    const data = dataTexto_(r.data);
    const quem = String(r.atualizadoPor || SIS);
    const quando = r.atualizadoEm instanceof Date ? r.atualizadoEm : agora;
    const did = destinadorDe(r.destinador); if (!did) semDest++;
    add('Lancamentos', { unidadeId: '', data: data, mes: mesTexto_(r.mes) || data.slice(0, 7), mtr: r.mtr, ticket: r.ticket, destinadorId: did,
      gerador: r.gerador, origem: r.origem, residuoId: resDoTexto(r.residuo), transportadora: r.transportadora, placa: String(r.placa || '').toUpperCase(),
      kg: r.kg === '' || r.kg == null ? '' : num_(r.kg), preco: r.preco === '' ? '' : num_(r.preco),
      valorFixo: r.valorFixo === '' || r.valorFixo == null ? '' : num_(r.valorFixo), valor: r.valor === '' || r.valor == null ? '' : num_(r.valor),
      negocio: normNegocio_(r.negocio), obs: r.obs, idOrigem: String(r.id), ativo: true }, quando, quem, quando, quem);
  });

  // Locação
  lerAntiga_(ctl, 'Locacao').forEach(function (r) {
    if (!r.placa) return;
    add('LocacaoMensal', { unidadeId: '', mes: mesTexto_(r.mes), tipo: r.tipo, placa: String(r.placa).toUpperCase(), fornecedor: r.fornecedor,
      valor: num_(r.valor), ativo: true });
  });

  // Listas e parâmetros
  [['negocio', ['RSS', 'Industrial']], ['natureza', ['custo', 'receita']],
   ['tipoCadastro', ['empresa', 'parceiro', 'destinador', 'transportador', 'fornecedor', 'cliente', 'reciclador']]]
    .forEach(function (l) { l[1].forEach(function (v, i) { add('Listas', { lista: l[0], valor: v, ordem: i + 1, ativo: true }); }); });
  const hoje = Utilities.formatDate(agora, tz_(), 'yyyy-MM-dd');
  add('Parametros', { chave: 'valorPernoite', valor: '200', vigenciaInicio: hoje, descricao: 'Valor do pernoite por pessoa e por noite (R$).' });
  add('Parametros', { chave: 'diasAvisoCnh', valor: '30', vigenciaInicio: hoje, descricao: 'Dias de antecedência para avisar o vencimento da CNH.' });

  // Grava tudo
  Object.keys(linhas).forEach(function (nome) { escreverLinhas_(aba_(nome), nome, 2, linhas[nome]); limparCache_(nome); });
  const props = {};
  Object.keys(cont).forEach(function (pre) { props['SEQ_' + pre] = String(cont[pre]); });
  PropertiesService.getScriptProperties().setProperties(props);

  // Log antigo → Histórico (com os códigos novos quando der para achar)
  const novoIdDe = {};
  Object.keys(cadPorIdAntigo).forEach(function (k) { novoIdDe[k] = cadPorIdAntigo[k]; novoIdDe['cd-' + k] = cadPorIdAntigo[k]; });
  linhas.Lancamentos.forEach(function (row) { const c = colunas_('Lancamentos'); novoIdDe[String(row[c.indexOf('idOrigem')])] = row[0]; });
  lerAntiga_(ctl, 'Log').forEach(function (r) {
    const acao = String(r.acao || '');
    const mod = acao.indexOf('mapa:') === 0 ? 'mapa' : (/usu|senha|entrou|código|portal/i.test(acao) ? 'portal' : 'destinacao');
    HIST_BUF_.push([r.quando instanceof Date ? r.quando : agora, '', String(r.por || ''), mod, '', novoIdDe[String(r.registro)] || String(r.registro || ''),
                    '', 'registro antigo', '', '', '', acao + (r.detalhe ? ' · ' + r.detalhe : '')]);
  });
  const resumo = {};
  Object.keys(linhas).forEach(function (n) { resumo[n] = linhas[n].length; });
  resumo.lancamentosSemDestinador = semDest;
  HIST_BUF_.push([agora, Session.getEffectiveUser().getEmail(), 'sistema', 'portal', '', '', '', 'migrou',
                  '', '', '', 'Migração para a planilha central: ' + JSON.stringify(resumo)]);
  return resumo;
}

/* ---------------- backup ---------------- */
function backupSemanal() {
  const p = PropertiesService.getScriptProperties();
  const pasta = DriveApp.getFolderById(p.getProperty('BACKUP_ID'));
  const nome = 'Portal GVC — Base — backup ' + Utilities.formatDate(new Date(), 'America/Bahia', 'yyyy-MM-dd HH.mm');
  DriveApp.getFileById(p.getProperty('BASE_ID')).makeCopy(nome, pasta);
  // guarda as 12 cópias mais recentes
  const arqs = []; const it = pasta.getFiles();
  while (it.hasNext()) arqs.push(it.next());
  arqs.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  arqs.slice(12).forEach(function (f) { f.setTrashed(true); });
  return nome;
}
function criarGatilhoBackup_() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'backupSemanal') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('backupSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
}
