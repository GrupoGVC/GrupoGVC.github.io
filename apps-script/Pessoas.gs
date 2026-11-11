/* =====================================================================
 * Pessoas — cadastro único de pessoas do grupo (motoristas, ajudantes, consultores, programadoras,
 * acompanhamento, faturamento, DP, gestão). Alimenta os outros módulos:
 *   Programação (motoristas e ajudantes, CNH, pernoite), DP (adiantamentos), Solicitações e
 *   Faturamento (consultores), Minhas solicitações (consultor ligado ao acesso) e Portal › Usuários.
 * Acesso ao portal é opcional: só o administrador do portal gera, a partir da ficha da pessoa
 * (Usuarios.pessoaId). Inativar a pessoa suspende o acesso junto.
 * Editor com unidade (programadora) só cadastra e altera pessoas da unidade dela.
 * CPF e foto: só DP, editor da Programação, editor de Pessoas e admin do portal (LGPD).
 * ===================================================================== */

const PES_FUNCOES = ['Motorista', 'Ajudante', 'Consultor', 'Programador(a)', 'Acompanhamento', 'Faturamento', 'DP', 'Gestão'];
const PES_FUNCOES_FIXAS = ['Motorista', 'Ajudante', 'Consultor']; // usadas pelos módulos: não saem da lista
const URL_PORTAL = 'https://grupogvc.github.io/';
// Níveis sugeridos ao gerar o acesso (o administrador ajusta antes de confirmar).
const PES_SUGESTAO_NIVEIS = {
  'Consultor': { minhas: 'leitor' },
  'Programador(a)': { programacao: 'editor', frota: 'editor', destinacao: 'editor', pessoas: 'editor', mapa: 'leitor' },
  'Acompanhamento': { mapa: 'editor', solicitacoes: 'editor', faturamento: 'leitor' },
  'Faturamento': { faturamento: 'editor', solicitacoes: 'leitor' },
  'DP': { dp: 'editor', pessoas: 'leitor' },
  'Ambiental': { ambiental: 'editor', destinacao: 'leitor', mapa: 'leitor' },
  'Gestão': { destinacao: 'leitor', mapa: 'leitor', frota: 'leitor', solicitacoes: 'leitor', faturamento: 'leitor', programacao: 'leitor', dp: 'leitor', pessoas: 'leitor', ambiental: 'leitor' },
};

/* ---------------- funções da pessoa ---------------- */
function funcoesDe_(p) { return separar_(p && p.funcoes); }
function temFuncao_(p, f) { return funcoesDe_(p).indexOf(f) >= 0; }
function ehEquipe_(p) { return temFuncao_(p, 'Motorista') || temFuncao_(p, 'Ajudante'); }
/** Como a Programação mostrava: Motorista | Ajudante | Motorista e ajudante. */
function funcaoEquipe_(p) {
  const m = temFuncao_(p, 'Motorista'), a = temFuncao_(p, 'Ajudante');
  return m && a ? 'Motorista e ajudante' : m ? 'Motorista' : a ? 'Ajudante' : '';
}
/** 'Motorista e ajudante' (formato antigo) → ['Motorista', 'Ajudante']. */
function funcoesDoTexto_(t) {
  t = String(t || '');
  if (/motorista e ajudante/i.test(t)) return ['Motorista', 'Ajudante'];
  return separar_(t);
}
/** Consultores para Solicitações, Faturamento e coletas recorrentes (inclui quem já foi consultor de alguma solicitação). */
function consultoresLista_() {
  const usados = {};
  ler_('Solicitacoes').forEach(function (s) { if (s.consultorId) usados[String(s.consultorId)] = 1; });
  ler_('Rotinas').forEach(function (s) { if (s.consultorId) usados[String(s.consultorId)] = 1; });
  return ler_('Pessoas').filter(function (p) { return temFuncao_(p, 'Consultor') || usados[p.id]; }).map(function (p) {
    const o = { id: p.id, nome: String(p.nome), email: String(p.email || ''), telefone: String(p.telefone || ''), ativo: p.ativo && temFuncao_(p, 'Consultor') };
    const a = auditoria_(p); Object.keys(a).forEach(function (k) { o[k] = a[k]; });
    return o;
  });
}

/* ---------------- migração (ESQUEMA 8) ---------------- */
function migrarPessoas_() {
  aba_('Pessoas');
  migrarCabecalho_('Usuarios'); // coluna pessoaId
  const listas = ler_('Listas');
  PES_FUNCOES.forEach(function (val, i) {
    if (!listas.some(function (x) { return x.lista === 'funcaoPessoa' && String(x.valor) === val; })) inserir_('Listas', { lista: 'funcaoPessoa', valor: val, ordem: i + 1, ativo: true }, null, null);
  });
  // equipe (COL-) e consultores (CON-) passam para Pessoas com o mesmo código e a mesma auditoria
  const ja = {}; ler_('Pessoas').forEach(function (p) { ja[p.id] = 1; });
  const aud = function (o) { return { criadoEm: o.criadoEm, criadoPor: o.criadoPor, atualizadoEm: o.atualizadoEm, atualizadoPor: o.atualizadoPor }; };
  const linhas = [];
  if (base_().getSheetByName('Colaboradores')) ler_('Colaboradores').forEach(function (c) {
    if (ja[c.id]) return;
    linhas.push(Object.assign({ id: c.id, nome: c.nome, apelido: c.apelido, funcoes: funcoesDoTexto_(c.funcao).join('; '), unidadeId: c.unidadeId, vinculo: c.vinculo,
      cpf: c.cpf, email: '', telefone: c.telefone, cnhCategoria: c.cnhCategoria, cnhValidade: c.cnhValidade, fotoId: c.fotoId, obs: c.obs, ativo: c.ativo }, aud(c)));
  });
  if (base_().getSheetByName('Consultores')) ler_('Consultores').forEach(function (c) {
    if (ja[c.id]) return;
    linhas.push(Object.assign({ id: c.id, nome: c.nome, apelido: apelidoDe_(c.nome), funcoes: 'Consultor', unidadeId: '', vinculo: '', cpf: '', email: normEmail_(c.email),
      telefone: c.telefone, cnhCategoria: '', cnhValidade: '', fotoId: '', obs: '', ativo: c.ativo }, aud(c)));
  });
  if (linhas.length) { const sh = aba_('Pessoas'); escreverLinhas_(sh, 'Pessoas', sh.getLastRow() + 1, linhas.map(function (o) { return linhaDe_('Pessoas', o); })); limparCache_('Pessoas'); }
  // cada acesso do portal fica ligado a uma pessoa: pelo e-mail, depois pelo nome (único); senão cria a pessoa
  const ligadas = {}; ler_('Usuarios').forEach(function (us) { if (us.pessoaId) ligadas[String(us.pessoaId)] = 1; });
  let criadas = 0;
  ler_('Usuarios').forEach(function (us) {
    if (String(us.pessoaId || '')) return;
    const email = normEmail_(us.email), pessoas = ler_('Pessoas');
    let p = pessoas.filter(function (x) { return x.email && normEmail_(x.email) === email && !ligadas[x.id]; })[0];
    if (!p) {
      const mesmos = pessoas.filter(function (x) { return semAcento_(x.nome) === semAcento_(us.nome) && !x.email && !ligadas[x.id]; });
      if (mesmos.length === 1) p = mesmos[0];
    }
    if (!p) {
      const unis = separar_(us.unidades);
      p = inserir_('Pessoas', { nome: String(us.nome || email.split('@')[0]), apelido: String(us.nome || '').split(' ')[0], funcoes: '', unidadeId: unis.length === 1 ? unis[0] : '',
        email: email, ativo: true, obs: 'Criada a partir do acesso ao portal. Complete as funções.' }, null, null);
      criadas++;
    } else if (!p.email) atualizar_('Pessoas', p.id, { email: email }, null, null);
    atualizar_('Usuarios', us.id, { pessoaId: p.id }, null, null);
    ligadas[p.id] = 1;
  });
  // acesso ao módulo: admin do portal = admin; quem edita a Programação (programadora) = editor
  ler_('Usuarios').forEach(function (us) {
    const mods = onde_('UsuarioModulos', 'usuarioId', us.id);
    if (mods.some(function (m) { return m.modulo === 'pessoas'; })) return;
    const prog = mods.filter(function (m) { return m.modulo === 'programacao'; })[0];
    const nivel = simNao_(us.adminPortal) ? 'admin' : (prog && (prog.nivel === 'editor' || prog.nivel === 'admin') ? 'editor' : '');
    if (nivel) inserir_('UsuarioModulos', { usuarioId: us.id, modulo: 'pessoas', nivel: nivel }, null, null);
  });
  HIST_BUF_.push([new Date(), '', 'sistema', 'pessoas', 'Pessoas', '', '', 'migrou', '', '', '',
    'Cadastro único de Pessoas: ' + linhas.length + ' pessoa(s) da equipe e dos consultores (mesmos códigos); ' + criadas + ' criada(s) a partir dos acessos do portal.']);
}

/* ---------------- permissões ---------------- */
function restritoUnidade_(u) { return !u.adminPortal && u.unidades && u.unidades.length > 0; }
function podeEditarPessoa_(u, p) {
  if (u.adminPortal) return true;
  if (!podeEditar_(u, 'pessoas')) return false;
  if (!restritoUnidade_(u)) return true;
  return !!(p && p.unidadeId && u.unidades.indexOf(String(p.unidadeId)) >= 0);
}

/* ---------------- leitura ---------------- */
function acessoDaPessoa_(id) {
  return ler_('Usuarios').filter(function (x) { return String(x.pessoaId) === String(id); })[0] || null;
}
function pesPublica_(p, u, veCpf) {
  const o = publico_('Pessoas', p);
  o.funcoes = funcoesDe_(p);
  o.cnhValidade = dataTexto_(p.cnhValidade);
  o.temFoto = !!String(p.fotoId || '');
  delete o.fotoId;
  const cpf = cpfDigitos_(p.cpf);
  o.cpfValido = !cpf || cpfValido_(cpf);
  o.cpf = veCpf ? cpfFormatado_(cpf) : cpfMascarado_(cpf);
  o.podeEditar = podeEditarPessoa_(u, p);
  o.emailsDesligados = separar_(p.emailsDesligados);
  const us = acessoDaPessoa_(p.id);
  o.acesso = null;
  if (us) {
    o.acesso = { email: String(us.email), ativo: us.ativo, temSenha: !!String(us.senhaHash || ''),
                 ultimoAcesso: us.ultimoAcesso instanceof Date ? Utilities.formatDate(us.ultimoAcesso, tz_(), 'dd/MM/yyyy HH:mm') : '' };
    if (u.adminPortal) {
      const a = acharUsuario_(us.email);
      o.acesso.modulos = a.modulos; o.acesso.unidades = a.unidades; o.acesso.adminPortal = a.adminPortal; o.acesso.decideCobranca = a.decideCobranca; o.acesso.veContratos = a.veContratos; o.acesso.alertaContratos = a.alertaContratos;
    }
  }
  return o;
}
function pesDados_(u) {
  const veCpf = vePessoal_(u);
  const pessoas = ler_('Pessoas').filter(function (p) { return veUnidade_(u, p.unidadeId); });
  // possíveis duplicados: mesmo nome (sem acento) ou mesmo e-mail
  const grupos = {};
  pessoas.forEach(function (p) {
    [semAcento_(p.nome), p.email ? 'E:' + normEmail_(p.email) : ''].filter(String).forEach(function (k) { (grupos[k] = grupos[k] || []).push(p.id); });
  });
  const duplicados = Object.keys(grupos).filter(function (k) { return grupos[k].length > 1; }).map(function (k) { return grupos[k]; });
  return { ok: true,
    pessoas: pessoas.map(function (p) { return pesPublica_(p, u, veCpf); }),
    unidades: unidadesDoUsuario_(u), todasUnidades: unidadesLista_(),
    vePessoal: veCpf,
    podeCriar: u.adminPortal || podeEditar_(u, 'pessoas'),
    restrito: restritoUnidade_(u),
    podeGerarAcesso: !!u.adminPortal,
    podeEditarFuncoes: !!u.adminPortal || u.modulos.pessoas === 'admin',
    listas: { funcoes: listaValores_('funcaoPessoa'), vinculo: listaValores_('vinculoColaborador'), categoriaCnh: listaValores_('categoriaCnhPessoa') },
    funcoesFixas: PES_FUNCOES_FIXAS,
    tiposEmail: TIPOS_EMAIL,
    parametros: { diasAvisoCnh: num_(parametro_('diasAvisoCnh')) || 30 },
    modulos: u.adminPortal ? MODULOS : null,
    sugestoes: u.adminPortal ? PES_SUGESTAO_NIVEIS : null,
    duplicados: duplicados,
    usos: usosPorPessoa_() };
}
/** Quantas vezes cada pessoa aparece nos outros módulos (para a ficha mostrar onde é usada). */
function usosPorPessoa_() {
  const out = {};
  const soma = function (id, k) { id = String(id || ''); if (!id) return; (out[id] = out[id] || {})[k] = (out[id][k] || 0) + 1; };
  ler_('Viagens').forEach(function (v) { soma(v.motoristaId, 'viagens'); });
  ler_('ViagemEquipe').forEach(function (e) { soma(e.colaboradorId, 'viagens'); });
  ler_('Solicitacoes').forEach(function (s) { soma(s.consultorId, 'solicitacoes'); });
  ler_('Adiantamentos').forEach(function (a) { soma(a.colaboradorId, 'adiantamentos'); });
  return out;
}

/* ---------------- escrita ---------------- */
function pesSalvar_(reg, u) {
  reg = reg || {};
  const atual = reg.id ? porId_('Pessoas', reg.id) : null;
  if (reg.id && !atual) return erroDados_('Pessoa não encontrada. Atualize a página.');
  if (atual && !podeEditarPessoa_(u, atual)) return semPermissao_('Você só pode alterar pessoas da sua unidade.');
  const lista = listaValores_('funcaoPessoa');
  let funcoes = Array.isArray(reg.funcoes) ? reg.funcoes.map(String) : (reg.funcoes != null && reg.funcoes !== '' ? separar_(reg.funcoes) : funcoesDoTexto_(reg.funcao));
  funcoes = funcoes.map(function (f) { return f.trim(); }).filter(function (f, i, l) { return f && l.indexOf(f) === i; });
  const antes = atual ? funcoesDe_(atual) : [];
  const invalida = funcoes.filter(function (f) { return lista.indexOf(f) < 0 && antes.indexOf(f) < 0; })[0];
  if (invalida) return erroDados_('Função "' + invalida + '" não está na lista.');
  if (!funcoes.length) return erroDados_('Marque pelo menos uma função.');
  const r = { nome: String(reg.nome || '').trim().replace(/\s+/g, ' '), apelido: String(reg.apelido || '').trim(), funcoes: funcoes.join('; '),
              unidadeId: String(reg.unidadeId || ''), vinculo: String(reg.vinculo || ''), email: normEmail_(reg.email), telefone: String(reg.telefone || '').trim(),
              cnhCategoria: String(reg.cnhCategoria || '').toUpperCase(), cnhValidade: dataTexto_(reg.cnhValidade), obs: String(reg.obs || '').trim() };
  if (!r.nome) return erroDados_('Informe o nome.');
  const equipe = funcoes.indexOf('Motorista') >= 0 || funcoes.indexOf('Ajudante') >= 0;
  if (r.unidadeId && !porId_('Unidades', r.unidadeId)) return erroDados_('Unidade inválida.');
  if (equipe && !r.unidadeId) return erroDados_('Motorista e ajudante precisam da unidade (é a equipe da programadora).');
  if (restritoUnidade_(u) && (!r.unidadeId || u.unidades.indexOf(r.unidadeId) < 0)) return erroDados_('Escolha a sua unidade: você só cadastra pessoas da sua unidade.');
  if (!veUnidade_(u, r.unidadeId)) return erroDados_('Você não tem acesso a esta unidade.');
  if (r.vinculo && listaValores_('vinculoColaborador').indexOf(r.vinculo) < 0) return erroDados_('Vínculo inválido.');
  if (equipe && !r.vinculo) return erroDados_('Escolha o vínculo (próprio ou terceirizado): terceirizado não recebe pernoite.');
  if (r.cnhCategoria && listaValores_('categoriaCnhPessoa').indexOf(r.cnhCategoria) < 0) return erroDados_('Categoria de CNH inválida.');
  if (funcoes.indexOf('Motorista') >= 0 && r.vinculo === 'Próprio' && (!r.cnhCategoria || !r.cnhValidade)) return erroDados_('Para motorista, informe a categoria e a validade da CNH.');
  if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) return erroDados_('E-mail inválido.');
  const outra = r.email && ler_('Pessoas').filter(function (x) { return x.id !== reg.id && x.email && normEmail_(x.email) === r.email; })[0];
  if (outra) return erroDados_('O e-mail ' + r.email + ' já é de ' + outra.nome + '.');
  const us = atual ? acessoDaPessoa_(atual.id) : null;
  if (us && normEmail_(us.email) !== r.email) {
    if (!r.email) return erroDados_('Esta pessoa tem acesso ao portal e o e-mail é o login dela. Para tirar o e-mail, suspenda o acesso antes (administrador do portal).');
    if (!u.adminPortal) return semPermissao_('O e-mail é o login desta pessoa no portal: só o administrador do portal pode trocar.');
    if (acharUsuario_(r.email)) return erroDados_('Já existe um acesso ao portal com o e-mail ' + r.email + '.');
  }
  if ('cpf' in reg && vePessoal_(u)) {
    const c = cpfDigitos_(reg.cpf);
    if (c && !cpfValido_(c)) return erroDados_('CPF inválido. Confira os números.');
    if (c && ler_('Pessoas').some(function (x) { return cpfDigitos_(x.cpf) === c && x.id !== reg.id; })) return erroDados_('Já existe uma pessoa com este CPF.');
    r.cpf = c;
  }
  if (Array.isArray(reg.emailsDesligados)) r.emailsDesligados = reg.emailsDesligados.map(String).filter(function (t, i, l) { return TIPOS_EMAIL[t] && l.indexOf(t) === i; }).join('; ');
  if (r.nome === r.nome.toLowerCase() || r.nome === r.nome.toUpperCase()) r.nome = nomeProprio_(r.nome);
  if (!r.apelido) r.apelido = apelidoDe_(r.nome);
  let id;
  if (atual) { id = atual.id; atualizar_('Pessoas', id, r, u, 'pessoas', { registroNome: r.nome }); }
  else { r.ativo = true; id = inserir_('Pessoas', r, u, 'pessoas', r.nome).id; }
  // o acesso acompanha o nome e o e-mail do cadastro
  if (us && (String(us.nome) !== r.nome || normEmail_(us.email) !== r.email)) {
    atualizar_('Usuarios', us.id, { nome: r.nome, email: r.email }, u, 'portal', { registroNome: r.nome });
  }
  return { ok: true, id: id };
}
function pesAtivo_(id, ativo, u) {
  const p = porId_('Pessoas', id); if (!p) return erroDados_('Pessoa não encontrada.');
  if (!podeEditarPessoa_(u, p)) return semPermissao_('Você só pode alterar pessoas da sua unidade.');
  const us = acessoDaPessoa_(id);
  if (!ativo && us && normEmail_(us.email) === u.email) return erroDados_('Você não pode inativar o seu próprio cadastro.');
  atualizar_('Pessoas', id, { ativo: !!ativo }, u, 'pessoas', { registroNome: String(p.nome) });
  let acessoSuspenso = false;
  if (!ativo && us && us.ativo) { atualizar_('Usuarios', us.id, { ativo: false }, u, 'portal', { registroNome: String(p.nome) }); acessoSuspenso = true; }
  return { ok: true, acessoSuspenso: acessoSuspenso };
}
function pesExcluir_(id, u) {
  const p = porId_('Pessoas', id); if (!p) return { ok: true };
  if (!podeEditarPessoa_(u, p)) return semPermissao_('Você só pode alterar pessoas da sua unidade.');
  const r = excluir_('Pessoas', id, u, 'pessoas');
  if (r.ok && p.fotoId) { try { DriveApp.getFileById(String(p.fotoId)).setTrashed(true); } catch (e) {} }
  return r;
}
/** Lista de funções (editável pelo admin do módulo). Motorista, Ajudante e Consultor não saem. */
function pesSalvarFuncoes_(valores, u) {
  if (!u.adminPortal && u.modulos.pessoas !== 'admin') return semPermissao_('Só o administrador do módulo Pessoas muda a lista de funções.');
  const novos = (valores || []).map(function (v) { return String(v).trim(); }).filter(function (v, i, l) { return v && l.indexOf(v) === i; });
  PES_FUNCOES_FIXAS.forEach(function (f) { if (novos.indexOf(f) < 0) novos.push(f); });
  const atuais = ler_('Listas').filter(function (x) { return x.lista === 'funcaoPessoa'; });
  atuais.forEach(function (x) {
    const i = novos.indexOf(String(x.valor));
    atualizar_('Listas', x.id, { ativo: i >= 0, ordem: i >= 0 ? i + 1 : x.ordem }, u, 'pessoas', { registroNome: 'Função: ' + x.valor });
  });
  novos.forEach(function (v, i) { if (!atuais.some(function (x) { return String(x.valor) === v; })) inserir_('Listas', { lista: 'funcaoPessoa', valor: v, ordem: i + 1, ativo: true }, u, 'pessoas', 'Função: ' + v); });
  return { ok: true };
}

/* ---------------- foto (pasta restrita do Drive) ---------------- */
function pastaFotos_() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty('FOTOS_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const pai = DriveApp.getFolderById(p.getProperty('PASTA_ID'));
  const f = pai.createFolder('Fotos da equipe (restrito)');
  p.setProperty('FOTOS_ID', f.getId());
  return f;
}
/** Foto da pessoa: dataUrl JPEG já reduzido no navegador. */
function pesFoto_(id, dataUrl, u) {
  if (!vePessoal_(u)) return semPermissao_('Sem acesso às fotos.');
  const c = porId_('Pessoas', id); if (!c) return erroDados_('Pessoa não encontrada.');
  if (!podeEditarPessoa_(u, c)) return semPermissao_('Você só pode alterar pessoas da sua unidade.');
  const m = String(dataUrl || '').match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/);
  if (!m) return erroDados_('Imagem inválida.');
  if (m[3].length > 700000) return erroDados_('Foto grande demais. Use uma imagem menor.');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[3]), m[1], c.id + '.' + (m[2] === 'jpeg' ? 'jpg' : m[2]));
  const arq = pastaFotos_().createFile(blob);
  if (c.fotoId) { try { DriveApp.getFileById(String(c.fotoId)).setTrashed(true); } catch (e) {} }
  atualizar_('Pessoas', id, { fotoId: arq.getId() }, u, null);
  hist_(u, 'pessoas', 'Pessoas', id, String(c.nome), 'alterou', 'Foto', c.fotoId ? 'foto anterior' : '', 'foto nova', '');
  return { ok: true };
}
function pesVerFoto_(id, u) {
  if (!vePessoal_(u)) return semPermissao_('Sem acesso às fotos.');
  const c = porId_('Pessoas', id); if (!c || !c.fotoId) return { ok: true, dataUrl: '' };
  if (!veUnidade_(u, c.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  try { const b = DriveApp.getFileById(String(c.fotoId)).getBlob(); return { ok: true, dataUrl: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) }; }
  catch (e) { return { ok: true, dataUrl: '' }; }
}

/* ---------------- acesso ao portal (só admin do portal) ---------------- */
/** x = {id, email, modulos, unidades, adminPortal, convite} */
function pesGerarAcesso_(x, quem) {
  x = x || {};
  const p = porId_('Pessoas', x.id); if (!p) return erroDados_('Pessoa não encontrada.');
  if (!p.ativo) return erroDados_('A pessoa está inativa. Reative antes de gerar o acesso.');
  const email = normEmail_(x.email || p.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return erroDados_('Informe o e-mail da pessoa: ele é o login do portal.');
  const outra = ler_('Pessoas').filter(function (y) { return y.id !== p.id && y.email && normEmail_(y.email) === email; })[0];
  if (outra) return erroDados_('O e-mail ' + email + ' já é de ' + outra.nome + '.');
  const ja = acessoDaPessoa_(p.id);
  if (ja && normEmail_(ja.email) !== email) return erroDados_('Esta pessoa já tem acesso com o e-mail ' + ja.email + '.');
  const us = acharUsuario_(email);
  if (us && us.pessoaId && us.pessoaId !== p.id) return erroDados_('Este e-mail já é o acesso de outra pessoa do cadastro.');
  if (normEmail_(p.email) !== email) atualizar_('Pessoas', p.id, { email: email }, quem, 'pessoas', { registroNome: String(p.nome) });
  const reqU = { email: email, nome: String(p.nome), modulos: x.modulos || {}, unidades: x.unidades || [], adminPortal: x.adminPortal === true, ativo: true, pessoaId: p.id };
  ['decideCobranca', 'veContratos', 'alertaContratos'].forEach(function (k) { if (k in x) reqU[k] = x[k] === true; });
  const r = salvarUsuario_(reqU, quem);
  if (!r.ok) return r;
  let convite = false;
  if (x.convite !== false) convite = enviarConvite_(email, String(p.nome), quem);
  return { ok: true, convite: convite, novo: r.novo };
}
function enviarConvite_(email, nome, quem) {
  try {
    MailApp.sendEmail({ to: email, subject: 'Seu acesso ao Portal Grupo GVC',
      body: 'Olá, ' + String(nome).split(' ')[0] + '.\n\nVocê recebeu acesso ao Portal Grupo GVC.\n\n' +
            'Para entrar pela primeira vez:\n1. Abra ' + URL_PORTAL + '\n2. Clique em "Primeiro acesso ou esqueci a senha".\n' +
            '3. Informe este e-mail (' + email + '), receba o código e crie a sua senha.\n\n' +
            '(Mensagem automática do Portal Grupo GVC.)' });
  } catch (e) { return false; }
  const us = acharUsuario_(email);
  if (us) hist_(quem, 'portal', 'Usuarios', us.id, us.nome, 'enviou convite', '', '', '', 'E-mail com as instruções de primeiro acesso.');
  return true;
}
/** tipo: 'suspender' | 'reativar' | 'apagarSenha' | 'convite' */
function pesAcesso_(id, tipo, quem) {
  const p = porId_('Pessoas', id); if (!p) return erroDados_('Pessoa não encontrada.');
  const us = acessoDaPessoa_(id); if (!us) return erroDados_('Esta pessoa não tem acesso ao portal.');
  const email = normEmail_(us.email);
  if (tipo === 'suspender') {
    if (email === quem.email) return erroDados_('Você não pode suspender o seu próprio acesso.');
    atualizar_('Usuarios', us.id, { ativo: false }, quem, 'portal', { registroNome: String(p.nome) });
    return { ok: true };
  }
  if (tipo === 'reativar') {
    if (!p.ativo) return erroDados_('A pessoa está inativa. Reative a pessoa antes.');
    atualizar_('Usuarios', us.id, { ativo: true }, quem, 'portal', { registroNome: String(p.nome) });
    return { ok: true };
  }
  if (tipo === 'apagarSenha') return resetarSenha_(email, quem);
  if (tipo === 'convite') {
    if (!us.ativo) return erroDados_('O acesso está suspenso. Reative antes de enviar o convite.');
    return enviarConvite_(email, String(p.nome), quem) ? { ok: true } : erroDados_('Não consegui enviar o e-mail agora (cota diária). Tente mais tarde.');
  }
  return erroDados_('Ação desconhecida.');
}
