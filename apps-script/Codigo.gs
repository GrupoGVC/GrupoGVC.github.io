/**
 * Portal Grupo GVC — API (Apps Script publicado como App da Web)
 * ------------------------------------------------
 * Código-fonte: repositório GrupoGVC/GrupoGVC.github.io, pasta apps-script/ (publicado sozinho pelo GitHub Actions).
 * Arquivos:
 *   Codigo.gs     configuração e roteamento das ações (este arquivo)
 *   Base.gs       planilha central: tabelas, códigos, auditoria, histórico e trava de exclusão
 *   Auth.gs       login, sessões e usuários
 *   Mapa.gs       Mapa Operacional (cadastros, locais, resíduos, preços, equipamentos)
 *   Controle.gs   Controle de Destinação (lançamentos e locação)
 *   Frota.gs      Frota (tipos de veículo, veículos, caixas, locação mensal) e migração da Fase 1
 *   Solicitacoes.gs  Solicitações, consultores, documentos, importação da planilha Coletas e migração da Fase 2
 *   Faturamento.gs   BM/NF e preço de venda por cliente
 *   DP.gs            adiantamentos de pernoite, acertos e aviso por e-mail ao DP (Fase 4)
 *   Programacao.gs   equipe, viagens, paradas, pernoites, caixas e importação das planilhas de programação/equipe (Fase 3)
 *   Historico.gs  consulta do histórico
 *   Instalacao.gs criação da planilha central, migração e backup semanal
 *
 * Dados: planilha "Portal GVC — Base" (uma aba por tabela) e "Portal GVC — Histórico",
 * na pasta "Portal GVC" do Drive da conta comprasgrupogvc. Os IDs ficam nas propriedades do script
 * (BASE_ID, HIST_ID, PASTA_ID, BACKUP_ID), gravadas por instalarBase().
 */

/* ======================= AJUSTE AQUI ======================= */
const DOMINIOS_PERMITIDOS = []; // ex.: ['retec.com.br'] — [] aceita qualquer domínio (a tabela Usuarios continua valendo)
const DIAS_SESSAO = 30;
/* =========================================================== */

// Planilha antiga do Mapa (origem da migração; não é mais usada depois dela).
const MAPA_PLANILHA_ID = '176bQkfOlMFCuKuACKfaogA1liMAxaTIIg-W_wPbV_9E';
const MODULOS = { destinacao: 'Controle de Destinação', mapa: 'Mapa Operacional', frota: 'Frota', solicitacoes: 'Solicitações', faturamento: 'Faturamento', programacao: 'Programação', dp: 'DP' };
const NIVEIS = ['leitor', 'editor', 'admin'];
const MESES_JANELA = 6;

const ACOES_DESTINACAO_LEITURA = ['dados'];
const ACOES_DESTINACAO_ESCRITA = ['salvarLancamento', 'excluirLancamento', 'definirNegocioLote', 'salvarLocacao', 'salvarDestinador'];
const ACOES_MAPA_LEITURA = ['mapa.listar', 'mapa.lista', 'mapa.precosVenda'];
const ACOES_MAPA_ESCRITA = ['mapa.upsert', 'mapa.delete', 'mapa.inativar', 'mapa.reativar', 'mapa.listaAdd', 'mapa.listaDel', 'mapa.listaInativar', 'mapa.listaSet',
                            'mapa.salvarPrecoVenda', 'mapa.excluirPrecoVenda'];
const ACOES_SOL_LEITURA = ['sol.dados'];
const ACOES_SOL_ESCRITA = ['sol.salvar', 'sol.status', 'sol.documento', 'sol.excluir', 'sol.salvarCadastro', 'sol.excluirCadastro', 'sol.ativoCadastro',
                           'sol.docsPadrao', 'sol.salvarLista', 'sol.novoCliente'];
const ACOES_PROG_LEITURA = ['prog.dados', 'prog.verFoto'];
const ACOES_PROG_ESCRITA = ['prog.salvarColaborador', 'prog.ativoColaborador', 'prog.excluirColaborador', 'prog.foto', 'prog.salvarViagem', 'prog.viagemAcao'];
const ACOES_DP_LEITURA = ['dp.dados'];
const ACOES_DP_ESCRITA = ['dp.acao'];
const ACOES_FAT_LEITURA = ['fat.dados'];
const ACOES_FAT_ESCRITA = ['fat.salvar', 'fat.acao'];
const ACOES_FROTA_LEITURA = ['frota.dados'];
const ACOES_FROTA_ESCRITA = ['frota.salvar', 'frota.excluir', 'frota.ativo', 'frota.salvarLocacao'];
const ACOES_ADMIN = ['listarUsuarios', 'salvarUsuario', 'resetarSenha', 'historico.geral', 'sol.importar', 'prog.importarEquipe', 'prog.importarProgramacao'];

function podeLer_(u, modulo) { return NIVEIS.indexOf(u.modulos[modulo]) >= 0; }
function podeEditar_(u, modulo) { return u.modulos[modulo] === 'editor' || u.modulos[modulo] === 'admin'; }
function semPermissao_(msg) { return { ok: false, erro: 'sem_permissao', mensagem: msg }; }
function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
const MANUTENCAO = { ok: false, erro: 'manutencao', mensagem: 'O portal está sendo atualizado. Tente de novo em alguns minutos.' };

// O app só usa POST. Um GET quase sempre é um POST que o Google redirecionou e perdeu o corpo no caminho.
function doGet(e) {
  return json_({ ok: false, erro: 'sem_corpo', mensagem: 'A requisição chegou vazia ao servidor. Tente de novo.' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, erro: 'sem_corpo', mensagem: 'A requisição chegou vazia ao servidor. Tente de novo.' }); }
  try {
    const r = rotear_(body);
    gravarHistorico_();
    return json_(r);
  } catch (err) {
    try { gravarHistorico_(); } catch (e2) {}
    return json_({ ok: false, erro: 'interno', mensagem: 'Erro na planilha: ' + String(err && err.message || err) });
  }
}

function rotear_(body) {
  const acao = body.acao;
  if (acao === 'sair') { if (body.token) PropertiesService.getScriptProperties().deleteProperty('S_' + body.token); return { ok: true }; }
  if (!baseInstalada_()) return MANUTENCAO;
  garantirEsquema_();
  switch (acao) {
    case 'login': return login_(body.email, body.senha);
    case 'enviarCodigo': return enviarCodigo_(body.email);
    case 'definirSenha': return definirSenha_(body.email, body.codigo, body.senha);
  }
  const u = sessao_(body.token);
  if (!u) return { ok: false, erro: 'nao_autenticado' };
  if (acao === 'eu') return { ok: true, usuario: usuarioPublico_(u) };

  // leituras (sem trava)
  if (acao === 'dados') {
    if (!podeLer_(u, 'destinacao')) return semPermissao_('Você não tem acesso ao Controle de Destinação.');
    return dados_(body.mes, u);
  }
  if (ACOES_MAPA_LEITURA.indexOf(acao) >= 0) {
    if (!podeLer_(u, 'mapa')) return semPermissao_('Você não tem acesso ao Mapa Operacional.');
    if (acao === 'mapa.precosVenda') return precosVenda_(String(body.cadastroId || ''));
    return acao === 'mapa.listar' ? MAPA.listar() : MAPA.lista(body.nome);
  }
  if (ACOES_SOL_LEITURA.indexOf(acao) >= 0) {
    if (!podeLer_(u, 'solicitacoes')) return semPermissao_('Você não tem acesso às Solicitações.');
    return solDados_(u);
  }
  if (ACOES_PROG_LEITURA.indexOf(acao) >= 0) {
    if (!podeLer_(u, 'programacao')) return semPermissao_('Você não tem acesso à Programação.');
    return acao === 'prog.verFoto' ? progVerFoto_(String(body.id), u) : progDados_(u);
  }
  if (ACOES_DP_LEITURA.indexOf(acao) >= 0) {
    if (!podeLer_(u, 'dp')) return semPermissao_('Você não tem acesso ao DP.');
    return dpDados_(u);
  }
  if (ACOES_FAT_LEITURA.indexOf(acao) >= 0) {
    if (!podeLer_(u, 'faturamento')) return semPermissao_('Você não tem acesso ao Faturamento.');
    return fatDados_(u);
  }
  if (ACOES_FROTA_LEITURA.indexOf(acao) >= 0) {
    if (!podeLer_(u, 'frota')) return semPermissao_('Você não tem acesso à Frota.');
    return frotaDados_(u);
  }
  if (acao === 'historico.registro') return historicoRegistro_(String(body.tabela || ''), String(body.id || ''), u);

  // escritas e administração (com trava)
  if (ACOES_ADMIN.indexOf(acao) >= 0) {
    if (!u.adminPortal) return semPermissao_('Só administradores do portal podem fazer isso.');
  } else if (ACOES_DESTINACAO_ESCRITA.indexOf(acao) >= 0) {
    if (!podeEditar_(u, 'destinacao')) return semPermissao_(podeLer_(u, 'destinacao') ? 'Seu acesso ao Controle de Destinação é só de leitura.' : 'Você não tem acesso ao Controle de Destinação.');
  } else if (ACOES_MAPA_ESCRITA.indexOf(acao) >= 0) {
    if (!podeEditar_(u, 'mapa')) return semPermissao_(podeLer_(u, 'mapa') ? 'Seu acesso ao Mapa Operacional é só de leitura.' : 'Você não tem acesso ao Mapa Operacional.');
  } else if (ACOES_FROTA_ESCRITA.indexOf(acao) >= 0) {
    if (!podeEditar_(u, 'frota')) return semPermissao_(podeLer_(u, 'frota') ? 'Seu acesso à Frota é só de leitura.' : 'Você não tem acesso à Frota.');
  } else if (ACOES_SOL_ESCRITA.indexOf(acao) >= 0) {
    if (!podeEditar_(u, 'solicitacoes')) return semPermissao_(podeLer_(u, 'solicitacoes') ? 'Seu acesso às Solicitações é só de leitura.' : 'Você não tem acesso às Solicitações.');
  } else if (ACOES_PROG_ESCRITA.indexOf(acao) >= 0) {
    if (!podeEditar_(u, 'programacao')) return semPermissao_(podeLer_(u, 'programacao') ? 'Seu acesso à Programação é só de leitura.' : 'Você não tem acesso à Programação.');
  } else if (ACOES_DP_ESCRITA.indexOf(acao) >= 0) {
    if (!podeEditar_(u, 'dp')) return semPermissao_(podeLer_(u, 'dp') ? 'Seu acesso ao DP é só de leitura.' : 'Você não tem acesso ao DP.');
  } else if (ACOES_FAT_ESCRITA.indexOf(acao) >= 0) {
    if (!podeEditar_(u, 'faturamento')) return semPermissao_(podeLer_(u, 'faturamento') ? 'Seu acesso ao Faturamento é só de leitura.' : 'Você não tem acesso ao Faturamento.');
  } else {
    return { ok: false, erro: 'acao_desconhecida' };
  }
  if (acao === 'historico.geral') return historicoGeral_(body.filtros);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, erro: 'ocupado', mensagem: 'Planilha ocupada. Tente de novo em alguns segundos.' };
  try {
    switch (acao) {
      case 'salvarLancamento': return salvarLancamento_(body.lanc, u);
      case 'excluirLancamento': return excluirLancamento_(body.id, u);
      case 'definirNegocioLote': return definirNegocioLote_(body.ids, body.negocio, u);
      case 'salvarLocacao': return salvarLocacao_(body.mes, body.veiculos || [], u);
      case 'salvarDestinador': return salvarDestinador_();
      case 'listarUsuarios': return listarUsuarios_();
      case 'salvarUsuario': return salvarUsuario_(body.usuario, u);
      case 'resetarSenha': return resetarSenha_(body.email, u);
      case 'mapa.upsert': return MAPA.upsert(body.point, u);
      case 'mapa.delete': return MAPA.apagar(body.id, u);
      case 'mapa.inativar': return MAPA.inativar(body.id, u);
      case 'mapa.reativar': return MAPA.reativar(body.id, u);
      case 'mapa.listaAdd': return MAPA.listaAdd(body.nome, body.valor, u);
      case 'mapa.listaDel': return MAPA.listaDel(body.nome, body.valor, u);
      case 'mapa.listaInativar': return MAPA.listaInativar(body.nome, body.valor, u);
      case 'mapa.listaSet': return MAPA.listaSet(body.nome, body.list, u);
      case 'frota.salvar': return frotaSalvar_(String(body.tabela), body.registro, u);
      case 'frota.excluir': return frotaExcluir_(String(body.tabela), String(body.id), u);
      case 'frota.ativo': return frotaAtivo_(String(body.tabela), String(body.id), body.ativo, u);
      case 'frota.salvarLocacao': return frotaSalvarLocacao_(body.mes, body.itens, u);
      case 'mapa.salvarPrecoVenda': return salvarPrecoVenda_(body.registro, u);
      case 'mapa.excluirPrecoVenda': return excluirPrecoVenda_(String(body.id), u);
      case 'sol.salvar': return solSalvar_(body.registro, u);
      case 'sol.status': return solStatus_(String(body.id), String(body.status), body.dados, u);
      case 'sol.documento': return solDocumento_(body.doc, u);
      case 'sol.excluir': return solExcluir_(String(body.id), u);
      case 'sol.salvarCadastro': return solSalvarCadastro_(String(body.tabela), body.registro, u);
      case 'sol.excluirCadastro': return solExcluirCadastro_(String(body.tabela), String(body.id), u);
      case 'sol.ativoCadastro': return solAtivoCadastro_(String(body.tabela), String(body.id), body.ativo, u);
      case 'sol.docsPadrao': return solDocsPadrao_(String(body.cadastroId), body.itens, u);
      case 'sol.salvarLista': return solSalvarLista_(String(body.lista), body.valores, u);
      case 'sol.novoCliente': return solNovoCliente_(body.cliente, u);
      case 'sol.importar': return solImportar_(body.linhas, body.simular === true, u);
      case 'prog.salvarColaborador': return progSalvarColaborador_(body.registro, u);
      case 'prog.ativoColaborador': return progAtivoColaborador_(String(body.id), body.ativo, u);
      case 'prog.excluirColaborador': return progExcluirColaborador_(String(body.id), u);
      case 'prog.foto': return progFoto_(String(body.id), body.dataUrl, u);
      case 'prog.salvarViagem': return progSalvarViagem_(body.registro, body.confirmar === true, u);
      case 'prog.viagemAcao': return progViagemAcao_(String(body.id), String(body.tipo), body.dados, u);
      case 'prog.importarEquipe': return progImportarEquipe_(String(body.unidadeId), body.linhas, body.simular === true, u);
      case 'prog.importarProgramacao': return progImportarProgramacao_(String(body.unidadeId), body.linhas, body.simular === true, u);
      case 'dp.acao': return dpAcao_(String(body.tipo), body.dados, u);
      case 'fat.salvar': return fatSalvar_(body.registro, u);
      case 'fat.acao': return fatAcao_(String(body.id), String(body.tipo), body.dados, u);
    }
    return { ok: false, erro: 'acao_desconhecida' };
  } finally { gravarHistorico_(); lock.releaseLock(); }
}
