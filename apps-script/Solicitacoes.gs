/* =====================================================================
 * Solicitações de clientes (responsável do acompanhamento), consultores, documentos
 * exigidos por cliente e importação da planilha "Acompanhamento de solicitação" (aba Coletas).
 *
 * Funil: Recebida → Documentação pendente → Liberada para programar → Programada → Realizada
 *        → BM enviado → NF emitida (fim).  Também: Cancelada e Frustrada (volta para a fila).
 * "BM enviado" e "NF emitida" só mudam pelo módulo Faturamento.
 * Programada/Realizada são manuais até a Programação (Fase 3) existir.
 * ===================================================================== */

const SOL_STATUS = ['Recebida', 'Documentação pendente', 'Liberada para programar', 'Programada', 'Realizada', 'BM enviado', 'NF emitida', 'Cancelada', 'Frustrada'];
const SOL_STATUS_FATURAMENTO = ['BM enviado', 'NF emitida'];
const SOL_LISTAS = {
  demanda: ['Spot', 'Recorrente'],
  perfil: ['Contrato', 'Proposta'],
  execucao: ['Própria', 'Terceirizada', 'Mista'],
  servico: ['Coleta e destinação'],
  situacaoDocumento: ['Pendente', 'Recebido', 'Dispensado'],
  modalidadePreco: ['Por kg', 'Transporte + kg', 'Valorização com transporte', 'Valorização sem transporte'],
  unidadeMedida: ['kg', 't', 'un', 'viagem', 'm³', 'diária', 'mês'],
};
// Sugestões iniciais; a lista é editável na aba Configurações das Solicitações.
const TIPOS_DOCUMENTO_INICIAIS = ['Pedido / ordem de compra', 'Integração de segurança', 'Documentação da equipe (ASO, NRs)', 'Autorização de acesso', 'Ficha / FISPQ do resíduo'];
const SOL_TABELAS = { Consultores: 1, TiposDocumento: 1 };

/* ---------------- migração da Fase 2 (roda uma vez, pelo garantirEsquema_) ---------------- */
function migrarFase2_() {
  const listas = ler_('Listas');
  Object.keys(SOL_LISTAS).forEach(function (l) {
    SOL_LISTAS[l].forEach(function (val, i) {
      if (!listas.some(function (x) { return x.lista === l && String(x.valor) === val; })) inserir_('Listas', { lista: l, valor: val, ordem: i + 1, ativo: true }, null, null);
    });
  });
  TIPOS_DOCUMENTO_INICIAIS.forEach(function (n) { if (!idPorNome_('TiposDocumento', n)) inserir_('TiposDocumento', { nome: n, ativo: true }, null, null); });
  ['Solicitacoes', 'Consultores', 'DocumentosPadrao', 'SolicitacaoDocumentos', 'PrecosCliente', 'Faturamentos', 'FaturamentoItens'].forEach(function (t) { aba_(t); });
  // acesso: administradores do portal recebem os dois módulos novos; os demais, o admin libera na tela Usuários
  ler_('Usuarios').forEach(function (us) {
    if (!simNao_(us.adminPortal)) return;
    const mods = onde_('UsuarioModulos', 'usuarioId', us.id);
    ['solicitacoes', 'faturamento'].forEach(function (m) {
      if (!mods.some(function (x) { return x.modulo === m; })) inserir_('UsuarioModulos', { usuarioId: us.id, modulo: m, nivel: 'admin' }, null, null);
    });
  });
  HIST_BUF_.push([new Date(), '', 'sistema', 'solicitacoes', '', '', '', 'migrou', '', '', '', 'Fase 2: tabelas de Solicitações, documentos, preço de venda e Faturamento criadas.']);
}

/* ---------------- leitura ---------------- */
function clientesLista_() {
  return ler_('Cadastros').map(function (c) {
    return { id: c.id, nome: String(c.nome || c.razaoSocial || c.id), codigoUplog: String(c.codigoUplog || ''), tipos: separar_(c.tipos),
             cnpj: String(c.cnpj || ''), principalId: String(c.cadastroPrincipalId || ''), ativo: c.ativo };
  }).sort(function (a, b) { return a.nome.localeCompare(b.nome, 'pt-BR'); });
}
function solPublica_(r) {
  const o = publico_('Solicitacoes', r);
  ['dataSolicitacaoConsultor', 'dataSolicitacao', 'dataPrevista', 'dataColeta'].forEach(function (c) { o[c] = dataTexto_(r[c]); });
  o.valorPrevisto = r.valorPrevisto === '' ? '' : num_(r.valorPrevisto);
  o.residuoIds = separar_(r.residuoIds);
  return o;
}
/** Situação de faturamento de cada solicitação (BM/NF ativos). */
function faturamentoPorSolicitacao_() {
  const fats = {}; ler_('Faturamentos').forEach(function (f) { if (f.status !== 'Cancelado') fats[f.id] = f; });
  const out = {};
  ler_('FaturamentoItens').forEach(function (it) {
    const f = fats[it.faturamentoId]; if (!f || !it.solicitacaoId) return;
    out[it.solicitacaoId] = { id: f.id, status: String(f.status), bmNumero: String(f.bmNumero || ''), bmData: dataTexto_(f.bmData),
                              nfNumero: String(f.nfNumero || ''), nfData: dataTexto_(f.nfData), nfValor: f.nfValor === '' ? '' : num_(f.nfValor),
                              bmValor: num_(f.bmValor) };
  });
  return out;
}
function solDados_(u) {
  try { gerarRecorrentes_(u, false); } catch (e) {}
  const fat = faturamentoPorSolicitacao_();
  // última parada (viagem não cancelada) de cada solicitação
  const vs = {}; ler_('Viagens').forEach(function (v) { if (v.status !== 'Cancelada') vs[v.id] = v; });
  const prog = {};
  ler_('Paradas').forEach(function (p) {
    const v = vs[p.viagemId]; if (!v || !p.solicitacaoId) return;
    const x = { viagemId: v.id, data: dataTexto_(p.data) || dataTexto_(v.dataSaida), placa: String(v.placa || ''), resultado: String(p.resultado || ''), execucao: String(v.execucao) };
    if (!prog[p.solicitacaoId] || prog[p.solicitacaoId].data <= x.data) prog[p.solicitacaoId] = x;
  });
  const sols = ler_('Solicitacoes').filter(function (r) { return veUnidade_(u, r.unidadeId); }).map(function (r) {
    const o = solPublica_(r); o.faturamento = fat[r.id] || null; o.programacao = prog[r.id] || null; return o;
  });
  const visiveis = {}; sols.forEach(function (s) { visiveis[s.id] = 1; });
  return { ok: true,
    unidades: unidadesDoUsuario_(u), todasUnidades: unidadesLista_(),
    solicitacoes: sols,
    documentos: ler_('SolicitacaoDocumentos').filter(function (d) { return visiveis[d.solicitacaoId]; }).map(function (d) { return publico_('SolicitacaoDocumentos', d); }),
    clientes: clientesLista_(),
    consultores: ler_('Consultores').map(function (r) { return publico_('Consultores', r); }),
    tiposDocumento: ler_('TiposDocumento').map(function (r) { return publico_('TiposDocumento', r); }),
    documentosPadrao: ler_('DocumentosPadrao').map(function (r) { return publico_('DocumentosPadrao', r); }),
    residuos: ler_('Residuos').map(function (r) { return { id: r.id, nome: String(r.nome), ativo: r.ativo }; }),
    status: SOL_STATUS,
    listas: { demanda: listaValores_('demanda'), perfil: listaValores_('perfil'), execucao: listaValores_('execucao'),
              servico: listaValores_('servico'), situacaoDocumento: listaValores_('situacaoDocumento') },
    rotinas: ler_('Rotinas').filter(function (r) { return veUnidade_(u, r.unidadeId); }).map(rotPublica_),
    frequencias: listaValores_('frequenciaRotina'), semanasRecorrentes: num_(parametro_('semanasRecorrentes')) || 4,
    podeImportar: !!u.adminPortal };
}

/* ---------------- escrita ---------------- */
function rotuloSol_(r) {
  const c = porId_('Cadastros', r.clienteId);
  return (c ? String(c.nome) : 'Solicitação') + ' · ' + (dataTexto_(r.dataSolicitacao) || '').split('-').reverse().join('/');
}
function docsPendentes_(solId) {
  return onde_('SolicitacaoDocumentos', 'solicitacaoId', solId).filter(function (d) { return d.situacao === 'Pendente'; });
}
// Recebida ↔ Documentação pendente acompanham o checklist sozinhos.
function statusPelosDocumentos_(status, solId) {
  if (status !== 'Recebida' && status !== 'Documentação pendente') return status;
  return docsPendentes_(solId).length ? 'Documentação pendente' : 'Recebida';
}
function validarSol_(r, atual, u) {
  if (!porId_('Unidades', r.unidadeId)) return 'Escolha a unidade.';
  if (!veUnidade_(u, r.unidadeId)) return 'Você não tem acesso a esta unidade.';
  if (!porId_('Cadastros', r.clienteId)) return 'Escolha o cliente (cadastro do Mapa Operacional).';
  if (r.consultorId && !porId_('Consultores', r.consultorId)) return 'Consultor não encontrado.';
  ['demanda', 'perfil', 'execucao', 'servico'].forEach(function (l) { if (r[l] && listaValores_(l).indexOf(r[l]) < 0 && !(atual && atual[l] === r[l])) r[l] = ''; });
  if (!r.dataSolicitacao) return 'Informe a data da solicitação.';
  r.residuoIds = (Array.isArray(r.residuoIds) ? r.residuoIds : separar_(r.residuoIds)).filter(function (id) { return porId_('Residuos', id); }).join('; ');
  r.valorPrevisto = r.valorPrevisto === '' || r.valorPrevisto == null ? '' : num_(r.valorPrevisto);
  return '';
}
/** Cria ou altera uma solicitação. O status muda por solStatus_ (botões), não por aqui. */
function solSalvar_(reg, u) {
  reg = reg || {};
  const id = reg.id ? String(reg.id) : '';
  const atual = id ? porId_('Solicitacoes', id) : null;
  if (id && !atual) return erroDados_('Solicitação não encontrada. Atualize a página.');
  if (atual && !veUnidade_(u, atual.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  const campos = ['unidadeId', 'clienteId', 'consultorId', 'servico', 'demanda', 'perfil', 'execucao', 'residuoIds', 'descricao',
                  'dataSolicitacaoConsultor', 'dataSolicitacao', 'dataPrevista', 'dataColeta', 'valorPrevisto', 'obs'];
  const r = {};
  campos.forEach(function (c) { r[c] = c in reg ? reg[c] : (atual ? atual[c] : ''); });
  ['dataSolicitacaoConsultor', 'dataSolicitacao', 'dataPrevista', 'dataColeta'].forEach(function (c) { r[c] = dataTexto_(r[c]); });
  const erro = validarSol_(r, atual, u); if (erro) return erroDados_(erro);
  if (atual) {
    if (atual.status === 'Realizada' && !r.dataColeta) return erroDados_('Solicitação realizada precisa da data da coleta.');
    if (r.clienteId !== String(atual.clienteId) && faturamentoPorSolicitacao_()[id]) return erroDados_('Esta solicitação já está num BM. Para trocar o cliente, cancele o BM no Faturamento.');
    atualizar_('Solicitacoes', id, r, u, 'solicitacoes', { registroNome: rotuloSol_(r) });
    return { ok: true, id: id };
  }
  r.status = 'Recebida'; r.origem = 'portal'; r.ativo = true;
  const nova = inserir_('Solicitacoes', r, u, 'solicitacoes', rotuloSol_(r));
  // documentos padrão do cliente (e do cadastro principal), para o serviço escolhido ou para todos
  const cli = porId_('Cadastros', r.clienteId);
  const donos = [r.clienteId].concat(cli && cli.cadastroPrincipalId ? [String(cli.cadastroPrincipalId)] : []);
  const ja = {};
  ler_('DocumentosPadrao').filter(function (d) { return donos.indexOf(String(d.cadastroId)) >= 0 && (!d.servico || d.servico === r.servico); })
    .forEach(function (d) {
      if (ja[d.tipoDocumentoId]) return; ja[d.tipoDocumentoId] = 1;
      const t = porId_('TiposDocumento', d.tipoDocumentoId); if (!t || !t.ativo) return;
      inserir_('SolicitacaoDocumentos', { solicitacaoId: nova.id, tipoDocumentoId: d.tipoDocumentoId, situacao: 'Pendente' }, u, null);
    });
  const st = statusPelosDocumentos_('Recebida', nova.id);
  if (st !== 'Recebida') atualizar_('Solicitacoes', nova.id, { status: st }, u, null);
  if (Object.keys(ja).length) hist_(u, 'solicitacoes', 'Solicitacoes', nova.id, rotuloSol_(r), 'alterou', 'Documentos exigidos', '',
    Object.keys(ja).map(function (t) { return (porId_('TiposDocumento', t) || {}).nome; }).join('; '), 'Copiados do cadastro do cliente.');
  return { ok: true, id: nova.id };
}
/** Muda o status pelos botões do funil. */
function solStatus_(id, status, dados, u) {
  dados = dados || {};
  const s = porId_('Solicitacoes', id); if (!s) return erroDados_('Solicitação não encontrada.');
  if (!veUnidade_(u, s.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  if (SOL_STATUS.indexOf(status) < 0) return erroDados_('Status inválido.');
  if (SOL_STATUS_FATURAMENTO.indexOf(status) >= 0) return erroDados_('BM enviado e NF emitida são registrados no módulo Faturamento.');
  if (faturamentoPorSolicitacao_()[id]) return erroDados_('Esta solicitação já está num BM do Faturamento. Para mudar o status, cancele o BM primeiro.');
  const naProg = paradasAtivasDaSolicitacao_(id);
  if (naProg.length) return erroDados_('Esta solicitação está na Programação (' + rotuloViagem_(naProg[0].v) + '). O status muda pelas paradas da viagem.');
  const campos = { status: status };
  if (status === 'Liberada para programar') {
    const pend = docsPendentes_(id);
    if (pend.length) return erroDados_('Ainda faltam documentos: ' + pend.map(function (d) { return (porId_('TiposDocumento', d.tipoDocumentoId) || {}).nome; }).join(', ') + '. Marque como recebido ou dispensado.');
  }
  if (status === 'Realizada') {
    const dc = dataTexto_(dados.dataColeta || s.dataColeta);
    if (!dc) return erroDados_('Informe a data da coleta.');
    campos.dataColeta = dc;
  }
  if (status === 'Cancelada' || status === 'Frustrada') {
    const m = String(dados.motivo || '').trim(); if (!m) return erroDados_('Informe o motivo.');
    campos.motivo = m;
  }
  if (status === 'Recebida' || status === 'Documentação pendente') campos.status = statusPelosDocumentos_(status, id);
  atualizar_('Solicitacoes', id, campos, u, 'solicitacoes', { registroNome: rotuloSol_(s) });
  return { ok: true };
}
/** Documento da solicitação: acao = 'situacao' | 'incluir' | 'remover'. */
function solDocumento_(x, u) {
  x = x || {};
  const s = porId_('Solicitacoes', x.solicitacaoId); if (!s) return erroDados_('Solicitação não encontrada.');
  if (!veUnidade_(u, s.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  const rot = rotuloSol_(s);
  if (x.acao === 'incluir') {
    const t = porId_('TiposDocumento', x.tipoDocumentoId); if (!t) return erroDados_('Documento inválido.');
    if (onde_('SolicitacaoDocumentos', 'solicitacaoId', s.id).some(function (d) { return d.tipoDocumentoId === t.id; })) return erroDados_('Este documento já está na lista.');
    inserir_('SolicitacaoDocumentos', { solicitacaoId: s.id, tipoDocumentoId: t.id, situacao: 'Pendente' }, u, null);
    hist_(u, 'solicitacoes', 'Solicitacoes', s.id, rot, 'alterou', 'Documento incluído', '', String(t.nome), '');
  } else {
    const d = porId_('SolicitacaoDocumentos', x.id); if (!d || d.solicitacaoId !== s.id) return erroDados_('Documento não encontrado.');
    const nomeDoc = (porId_('TiposDocumento', d.tipoDocumentoId) || {}).nome || '';
    if (x.acao === 'remover') {
      aba_('SolicitacaoDocumentos').deleteRow(d._linha); limparCache_('SolicitacaoDocumentos');
      hist_(u, 'solicitacoes', 'Solicitacoes', s.id, rot, 'alterou', 'Documento removido', nomeDoc + ' (' + d.situacao + ')', '', '');
    } else {
      if (listaValores_('situacaoDocumento').indexOf(x.situacao) < 0) return erroDados_('Situação inválida.');
      atualizar_('SolicitacaoDocumentos', d.id, { situacao: x.situacao, link: String(x.link || '').trim(), obs: String(x.obs || '').trim() }, u, 'solicitacoes',
        { tabela: 'Solicitacoes', registroId: s.id, registroNome: rot, prefixoCampo: nomeDoc + ' · ' });
    }
  }
  const st = statusPelosDocumentos_(String(s.status), s.id);
  if (st !== s.status) atualizar_('Solicitacoes', s.id, { status: st }, u, 'solicitacoes', { registroNome: rot });
  return { ok: true };
}
function solExcluir_(id, u) {
  const s = porId_('Solicitacoes', id); if (!s) return { ok: true };
  if (!veUnidade_(u, s.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  const r = excluir_('Solicitacoes', id, u, 'solicitacoes');
  if (r.erro === 'em_uso') r.mensagem = 'Esta solicitação já está num BM/NF do Faturamento e não pode ser excluída. Você pode cancelá-la (se o BM for cancelado antes).';
  return r;
}

/* ---- cadastros auxiliares: consultores e tipos de documento ---- */
function solSalvarCadastro_(tabela, reg, u) {
  if (!SOL_TABELAS[tabela]) return erroDados_('Tabela inválida.');
  reg = reg || {};
  const r = { nome: String(reg.nome || '').trim() };
  if (!r.nome) return erroDados_('Informe o nome.');
  if (tabela === 'Consultores') { r.email = normEmail_(reg.email); r.telefone = String(reg.telefone || '').trim();
    if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) return erroDados_('E-mail inválido.'); }
  const dup = idPorNome_(tabela, r.nome); if (dup && dup !== reg.id) return erroDados_('Já existe "' + r.nome + '".');
  if (reg.id) {
    if (!porId_(tabela, reg.id)) return erroDados_('Registro não encontrado.');
    atualizar_(tabela, reg.id, r, u, 'solicitacoes', { registroNome: r.nome }); return { ok: true, id: reg.id };
  }
  r.ativo = true;
  return { ok: true, id: inserir_(tabela, r, u, 'solicitacoes', r.nome).id };
}
function solExcluirCadastro_(tabela, id, u) {
  if (!SOL_TABELAS[tabela]) return erroDados_('Tabela inválida.');
  return excluir_(tabela, id, u, 'solicitacoes');
}
function solAtivoCadastro_(tabela, id, ativo, u) {
  if (!SOL_TABELAS[tabela]) return erroDados_('Tabela inválida.');
  const r = porId_(tabela, id); if (!r) return erroDados_('Registro não encontrado.');
  atualizar_(tabela, id, { ativo: !!ativo }, u, 'solicitacoes', { registroNome: String(r.nome) });
  return { ok: true };
}
/** Documentos padrão de um cliente: itens = [{tipoDocumentoId, servico}] (substitui a lista). */
function solDocsPadrao_(cadastroId, itens, u) {
  const c = porId_('Cadastros', cadastroId); if (!c) return erroDados_('Cliente não encontrado.');
  const chave = function (d) { return d.tipoDocumentoId + '|' + (d.servico || ''); };
  const nomeDoc = function (d) { return ((porId_('TiposDocumento', d.tipoDocumentoId) || {}).nome || '') + (d.servico ? ' (' + d.servico + ')' : ''); };
  const atuais = onde_('DocumentosPadrao', 'cadastroId', cadastroId);
  const antes = atuais.map(nomeDoc).sort().join('; ');
  const desejados = {};
  (itens || []).forEach(function (d) { if (porId_('TiposDocumento', d.tipoDocumentoId)) desejados[chave(d)] = { tipoDocumentoId: d.tipoDocumentoId, servico: String(d.servico || '') }; });
  atuais.slice().sort(function (a, b) { return b._linha - a._linha; }).forEach(function (a) {
    if (desejados[chave(a)]) { delete desejados[chave(a)]; return; }
    aba_('DocumentosPadrao').deleteRow(a._linha);
  });
  limparCache_('DocumentosPadrao');
  Object.keys(desejados).forEach(function (k) { inserir_('DocumentosPadrao', Object.assign({ cadastroId: cadastroId }, desejados[k]), u, null); });
  const depois = onde_('DocumentosPadrao', 'cadastroId', cadastroId).map(nomeDoc).sort().join('; ');
  if (antes !== depois) hist_(u, 'mapa', 'Cadastros', cadastroId, String(c.nome), 'alterou', 'Documentos exigidos nas solicitações', antes, depois, '');
  return { ok: true };
}
/** Valores de uma lista editável (ex.: serviços). */
function solSalvarLista_(lista, valores, u) {
  if (['servico'].indexOf(lista) < 0) return erroDados_('Lista não editável.');
  const novos = (valores || []).map(function (v) { return String(v).trim(); }).filter(String);
  if (!novos.length) return erroDados_('A lista precisa de pelo menos um valor.');
  const atuais = ler_('Listas').filter(function (x) { return x.lista === lista; });
  atuais.forEach(function (x) {
    const i = novos.indexOf(String(x.valor));
    atualizar_('Listas', x.id, { ativo: i >= 0, ordem: i >= 0 ? i + 1 : x.ordem }, u, 'solicitacoes', { registroNome: 'Lista ' + lista + ': ' + x.valor });
  });
  novos.forEach(function (v, i) { if (!atuais.some(function (x) { return String(x.valor) === v; })) inserir_('Listas', { lista: lista, valor: v, ordem: i + 1, ativo: true }, u, 'solicitacoes', 'Lista ' + lista + ': ' + v); });
  return { ok: true };
}
/** Cliente novo direto da solicitação (vai para o Mapa sem localização; o endereço é completado lá). */
function solNovoCliente_(x, u) {
  x = x || {};
  const nome = String(x.nome || '').trim(); if (!nome) return erroDados_('Informe o nome do cliente.');
  const cod = String(x.codigoUplog || '').trim();
  if (cod) {
    const ja = ler_('Cadastros').filter(function (c) { return String(c.codigoUplog).trim() === cod; })[0];
    if (ja) return erroDados_('O código UPLOG ' + cod + ' já é do cadastro "' + ja.nome + '".');
  }
  const c = inserir_('Cadastros', { tipos: 'cliente', nome: nome, codigoUplog: cod, cnpj: String(x.cnpj || '').replace(/\D/g, ''), ativo: true,
    obs: 'Criado pelas Solicitações. Complete o endereço no Mapa Operacional.' }, u, 'mapa', nome);
  return { ok: true, id: c.id, cliente: { id: c.id, nome: nome, codigoUplog: cod, tipos: ['cliente'], cnpj: c.cnpj, principalId: '', ativo: true } };
}

/* ---------------- importação da planilha Coletas ---------------- */
// linhas = [{Solicitante, Unidade, Programador, Consultor, Cod, Cliente, Demanda, Perfil, Execução, Data Sol. Consultor,
//            Data de Solicitação, Data de Coleta, Faturamento, Status, Data de Emissão NF}] (datas em aaaa-mm-dd)
const SOL_STATUS_PLANILHA = { 'SOLICITACAO ENVIADA': 'Liberada para programar', 'AGUARDANDO COLETA': 'Programada', 'REALIZADO': 'Realizada',
                              'BM ENVIADO': 'BM enviado', 'NF EMITIDA': 'NF emitida', 'PAGO': 'NF emitida', 'CANCELADO': 'Cancelada' };
// datas da planilha: célula só com hora vira 30/12/1899 — ignora
function dtPlan_(v) { const x = dataTexto_(v); return x && x >= '2000-01-01' ? x : ''; }
function chaveColeta_(l) {
  return ['COL', String(l['Cod'] || '').trim(), semAcento_(l['Cliente']), dtPlan_(l['Data de Solicitação']), dtPlan_(l['Data de Coleta']),
          num_(l['Faturamento']).toFixed(2), semAcento_(l['Consultor'])].join('|').slice(0, 240);
}
function solImportar_(linhas, simular, u) {
  if (!Array.isArray(linhas)) return erroDados_('Nada para importar.');
  const res = { lidas: linhas.length, novas: 0, jaImportadas: 0, ignoradas: 0, clientesNovos: 0, consultoresNovos: 0, faturamentos: 0, avisos: [], status: {} };
  const ja = {}, vistas = {}; ler_('Solicitacoes').forEach(function (s) { if (s.idOrigem) ja[String(s.idOrigem)] = 1; });
  const uni = unidadesLista_();
  const uniDe = function (t) { const oeste = /OESTE/.test(semAcento_(t)); const x = uni.filter(function (y) { return /OESTE/.test(semAcento_(y.nome)) === oeste; })[0]; return x ? x.id : ''; };
  // clientes: pelo código UPLOG, depois pelo nome
  const porCod = {}, porNome = {};
  ler_('Cadastros').forEach(function (c) { if (String(c.codigoUplog).trim()) porCod[String(c.codigoUplog).trim()] = c.id; porNome[semAcento_(c.nome)] = c.id; });
  const novosClientes = {}; // cod/nome → dados
  const consultores = {}; ler_('Consultores').forEach(function (c) { consultores[semAcento_(c.nome)] = c.id; });
  const novosConsultores = {};
  const execMap = { PROPRIA: 'Própria', TERCEIRIZADA: 'Terceirizada', MISTA: 'Mista' };
  const sols = [], fats = [];
  linhas.forEach(function (l, i) {
    const nomeCli = String(l['Cliente'] || '').trim();
    if (!nomeCli) { res.ignoradas++; return; }
    // linhas iguais na planilha (mesmo cliente, datas e valor) contam como coletas diferentes: 1ª, 2ª…
    const base = chaveColeta_(l); vistas[base] = (vistas[base] || 0) + 1;
    const chave = base + '#' + vistas[base];
    if (ja[chave]) { res.jaImportadas++; return; }
    ja[chave] = 1;
    let cod = String(l['Cod'] == null ? '' : l['Cod']).trim().replace(/\.0+$/, ''); if (!/\d/.test(cod)) cod = '';
    let cli = (cod && porCod[cod]) || porNome[semAcento_(nomeCli)] || '';
    if (!cli) {
      const k = cod || ('N:' + semAcento_(nomeCli));
      if (!novosClientes[k]) novosClientes[k] = { codigoUplog: cod, nome: nomeCli, nomes: {} };
      novosClientes[k].nomes[nomeCli] = (novosClientes[k].nomes[nomeCli] || 0) + 1;
      cli = '@' + k;
    }
    let consId = '';
    const cons = String(l['Consultor'] || '').trim();
    if (cons && !/^RETEC( SA| S\/A| S\.A\.?)?$/.test(semAcento_(cons))) { // "Retec" / "Retec Sa" = sem consultor
      consId = consultores[semAcento_(cons)] || '';
      if (!consId) { novosConsultores[semAcento_(cons)] = cons; consId = '#' + semAcento_(cons); }
    }
    const stPlan = semAcento_(l['Status']);
    let status = SOL_STATUS_PLANILHA[stPlan] || 'Recebida';
    const dataSol = dtPlan_(l['Data de Solicitação']) || dtPlan_(l['Data Sol. Consultor']) || dtPlan_(l['Data de Coleta']);
    const dataCol = dtPlan_(l['Data de Coleta']);
    const valor = num_(l['Faturamento']);
    if (!dataSol) res.avisos.push('Linha ' + (l._linha || i + 1) + ' (' + nomeCli + '): sem data de solicitação.');
    res.status[status] = (res.status[status] || 0) + 1;
    const s = { unidadeId: uniDe(l['Unidade']), clienteId: cli, consultorId: consId, servico: '', demanda: SOL_LISTAS.demanda.indexOf(String(l['Demanda'] || '').trim()) >= 0 ? String(l['Demanda']).trim() : '',
      perfil: SOL_LISTAS.perfil.indexOf(String(l['Perfil'] || '').trim()) >= 0 ? String(l['Perfil']).trim() : '', execucao: execMap[semAcento_(l['Execução'])] || '',
      residuoIds: '', descricao: '', dataSolicitacaoConsultor: dtPlan_(l['Data Sol. Consultor']), dataSolicitacao: dataSol, dataPrevista: '',
      dataColeta: dataCol, valorPrevisto: valor || '', status: status, motivo: '', obs: '', solicitanteNome: String(l['Solicitante'] || '').trim(),
      programadorNome: String(l['Programador'] || '').trim(), origem: 'planilha', idOrigem: chave, ativo: true };
    sols.push(s);
    if (status === 'BM enviado' || status === 'NF emitida') {
      fats.push({ sol: s, f: { unidadeId: s.unidadeId, clienteId: cli, bmNumero: '', bmData: '', bmValor: valor, aprovacaoData: '',
        nfNumero: '', nfData: status === 'NF emitida' ? dtPlan_(l['Data de Emissão NF']) : '', nfValor: status === 'NF emitida' ? valor : '',
        status: status === 'NF emitida' ? 'NF emitida' : 'BM enviado', motivo: '', obs: 'Importado da planilha de acompanhamento (sem nº de BM/NF).',
        origem: 'planilha', idOrigem: chave, ativo: true },
        item: { descricao: 'Coleta' + (dataCol ? ' de ' + dataCol.split('-').reverse().join('/') : ''), quantidade: 1, unidadeMedida: 'viagem', valorUnitario: valor, sentido: 'Cobrança', valor: valor } });
    }
  });
  res.novas = sols.length; res.clientesNovos = Object.keys(novosClientes).length; res.consultoresNovos = Object.keys(novosConsultores).length; res.faturamentos = fats.length;
  res.clientesNovosLista = Object.keys(novosClientes).map(function (k) { const c = novosClientes[k]; return (c.codigoUplog ? c.codigoUplog + ' · ' : '') + c.nome; }).slice(0, 300);
  res.consultoresNovosLista = Object.keys(novosConsultores).map(function (k) { return novosConsultores[k]; });
  if (simular) return Object.assign({ ok: true, simulacao: true }, res);
  // grava: clientes, consultores, solicitações, faturamentos e itens (em blocos)
  const idCli = {};
  const cliCriados = inserirLote_('Cadastros', Object.keys(novosClientes).map(function (k) {
    const c = novosClientes[k]; const nome = Object.keys(c.nomes).sort(function (a, b) { return c.nomes[b] - c.nomes[a]; })[0];
    const outros = Object.keys(c.nomes).filter(function (n) { return n !== nome; });
    return { tipos: 'cliente', nome: nome, codigoUplog: c.codigoUplog, ativo: true, _k: k,
             obs: 'Criado pela importação da planilha de acompanhamento. Complete os dados e a localização.' + (outros.length ? ' Também aparece como: ' + outros.join('; ') + '.' : '') };
  }), u);
  Object.keys(novosClientes).forEach(function (k, i) { idCli['@' + k] = cliCriados[i].id; });
  const idCons = {};
  const consCriados = inserirLote_('Consultores', Object.keys(novosConsultores).map(function (k) { return { nome: novosConsultores[k], ativo: true }; }), u);
  Object.keys(novosConsultores).forEach(function (k, i) { idCons['#' + k] = consCriados[i].id; });
  sols.forEach(function (s) { if (idCli[s.clienteId]) s.clienteId = idCli[s.clienteId]; if (idCons[s.consultorId]) s.consultorId = idCons[s.consultorId]; });
  // cadastros que já existiam no Mapa: passam a ser também "cliente" e ganham o código UPLOG que faltava
  const codDe = {}; linhas.forEach(function (l) { const c = String(l['Cod'] == null ? '' : l['Cod']).trim().replace(/\.0+$/, ''); if (c) codDe[semAcento_(l['Cliente'])] = c; });
  const vistosCad = {};
  sols.forEach(function (s) {
    if (vistosCad[s.clienteId] || /^@/.test(s.clienteId)) return; vistosCad[s.clienteId] = 1;
    const c = porId_('Cadastros', s.clienteId); if (!c) return;
    const campos = {};
    if (separar_(c.tipos).indexOf('cliente') < 0) campos.tipos = separar_(c.tipos).concat('cliente').join(', ');
    const cod = codDe[semAcento_(c.nome)];
    if (!String(c.codigoUplog).trim() && cod && !porCod[cod]) { campos.codigoUplog = cod; porCod[cod] = c.id; }
    if (Object.keys(campos).length) atualizar_('Cadastros', c.id, campos, u, 'mapa', { registroNome: String(c.nome) });
  });
  const solCriadas = inserirLote_('Solicitacoes', sols, u);
  const solPorChave = {}; solCriadas.forEach(function (s) { solPorChave[s.idOrigem] = s.id; });
  fats.forEach(function (x) { if (idCli[x.f.clienteId]) x.f.clienteId = idCli[x.f.clienteId]; });
  const fatCriados = inserirLote_('Faturamentos', fats.map(function (x) { return x.f; }), u);
  inserirLote_('FaturamentoItens', fats.map(function (x, i) {
    return Object.assign({ faturamentoId: fatCriados[i].id, solicitacaoId: solPorChave[x.f.idOrigem], precoClienteId: '' }, x.item);
  }), u);
  hist_(u, 'solicitacoes', 'Solicitacoes', '', '', 'importou', '', '', '', 'Planilha de acompanhamento: ' + JSON.stringify({
    solicitacoes: res.novas, jaImportadas: res.jaImportadas, clientesNovos: res.clientesNovos, consultoresNovos: res.consultoresNovos, faturamentos: res.faturamentos, status: res.status }));
  return Object.assign({ ok: true }, res);
}
