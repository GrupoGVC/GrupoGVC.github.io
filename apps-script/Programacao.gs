/* =====================================================================
 * Programação (programadora de cada unidade): equipe, viagens com paradas, pernoites,
 * viagens terceirizadas e movimentação de caixas. Importação da planilha de programação
 * (abas por mês) e da planilha de equipe.
 *
 * Viagem: Programada → Concluída (ou Cancelada). Parada: Pendente → Realizada | Frustrada | No-show.
 * A parada ligada a uma solicitação muda o status dela (Programada / Realizada / Frustrada).
 * Pernoite: valor por pessoa por noite (parâmetro valorPernoite, congelado na viagem); terceirizado não recebe.
 * CPF e foto: só quem edita a Programação ou é admin do portal.
 * ===================================================================== */

const PROG_LISTAS = {
  funcaoColaborador: ['Motorista', 'Ajudante', 'Motorista e ajudante'],
  vinculoColaborador: ['Próprio', 'Terceirizado'],
  categoriaCnhPessoa: ['A', 'B', 'AB', 'C', 'AC', 'D', 'AD', 'E', 'AE'],
  resultadoParada: ['Pendente', 'Realizada', 'Frustrada', 'No-show'],
  execucaoViagem: ['Própria', 'Terceirizada'],
};
const VIAGEM_STATUS = ['Programada', 'Concluída', 'Cancelada'];

/* ---------------- migração da Fase 3 ---------------- */
function migrarFase3_() {
  const listas = ler_('Listas');
  Object.keys(PROG_LISTAS).forEach(function (l) {
    PROG_LISTAS[l].forEach(function (val, i) {
      if (!listas.some(function (x) { return x.lista === l && String(x.valor) === val; })) inserir_('Listas', { lista: l, valor: val, ordem: i + 1, ativo: true }, null, null);
    });
  });
  ['Colaboradores', 'Viagens', 'ViagemEquipe', 'Paradas'].forEach(function (t) { aba_(t); });
  // acesso: mesmo nível que a pessoa tem na Frota (a programadora); admin do portal = admin
  ler_('Usuarios').forEach(function (us) {
    const mods = onde_('UsuarioModulos', 'usuarioId', us.id);
    if (mods.some(function (m) { return m.modulo === 'programacao'; })) return;
    const fr = mods.filter(function (m) { return m.modulo === 'frota'; })[0];
    const nivel = simNao_(us.adminPortal) ? 'admin' : (fr ? fr.nivel : '');
    if (nivel) inserir_('UsuarioModulos', { usuarioId: us.id, modulo: 'programacao', nivel: nivel }, null, null);
  });
  HIST_BUF_.push([new Date(), '', 'sistema', 'programacao', '', '', '', 'migrou', '', '', '', 'Fase 3: tabelas de Programação (equipe, viagens, paradas) criadas.']);
}

/* ---------------- utilidades ---------------- */
function parametro_(chave, dataIso) {
  dataIso = dataIso || dataTexto_(new Date());
  const l = ler_('Parametros').filter(function (p) { return p.chave === chave && (!dataTexto_(p.vigenciaInicio) || dataTexto_(p.vigenciaInicio) <= dataIso); })
    .sort(function (a, b) { return dataTexto_(b.vigenciaInicio).localeCompare(dataTexto_(a.vigenciaInicio)); });
  return l.length ? String(l[0].valor) : '';
}
function cpfDigitos_(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }
function cpfValido_(c) {
  c = cpfDigitos_(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  for (let t = 9; t < 11; t++) { let s = 0; for (let i = 0; i < t; i++) s += Number(c[i]) * (t + 1 - i); if (((s * 10) % 11) % 10 !== Number(c[t])) return false; }
  return true;
}
function cpfFormatado_(c) { c = cpfDigitos_(c); return c.length === 11 ? c.slice(0, 3) + '.' + c.slice(3, 6) + '.' + c.slice(6, 9) + '-' + c.slice(9) : c; }
function cpfMascarado_(c) { c = cpfDigitos_(c); return c.length === 11 ? '***.***.' + c.slice(6, 9).replace(/^./, '*') + '-' + c.slice(9) : (c ? '***' : ''); }
function vePessoal_(u) { return u.adminPortal || podeEditar_(u, 'programacao') || podeLer_(u, 'dp'); }
// A categoria da pessoa cobre a exigida? (B < C < D < E; A é separada)
function cnhCobre_(daPessoa, exigida) {
  daPessoa = String(daPessoa || '').toUpperCase(); exigida = String(exigida || '').toUpperCase();
  if (!exigida) return true;
  if (!daPessoa) return false;
  if (exigida.indexOf('A') >= 0 && daPessoa.indexOf('A') < 0) return false;
  const ordem = 'BCDE';
  const req = exigida.replace('A', ''); if (!req) return true;
  const tem = daPessoa.replace('A', '');
  if (!tem) return false;
  return ordem.indexOf(tem[tem.length - 1]) >= ordem.indexOf(req[req.length - 1]);
}
function diasEntre_(a, b) { if (!a || !b) return 0; return Math.round((paraData_(b) - paraData_(a)) / 864e5); }

/* ---------------- leitura ---------------- */
function colabPublico_(r, u) {
  const o = publico_('Colaboradores', r);
  o.cnhValidade = dataTexto_(r.cnhValidade);
  o.temFoto = !!String(r.fotoId || '');
  delete o.fotoId;
  const cpf = cpfDigitos_(r.cpf);
  o.cpfValido = !cpf || cpfValido_(cpf);
  o.cpf = vePessoal_(u) ? cpfFormatado_(cpf) : cpfMascarado_(cpf);
  return o;
}
function viagemPublica_(v) {
  const o = publico_('Viagens', v);
  ['dataSaida', 'dataRetornoPrevisto', 'dataRetorno'].forEach(function (c) { o[c] = dataTexto_(v[c]); });
  ['custoTerceiro', 'valorNoite'].forEach(function (c) { o[c] = v[c] === '' ? '' : num_(v[c]); });
  ['pernoitesPrevistos', 'pernoitesRealizados'].forEach(function (c) { o[c] = v[c] === '' ? '' : num_(v[c]); });
  return o;
}
function paradaPublica_(p) {
  const o = publico_('Paradas', p); o.data = dataTexto_(p.data); o.ordem = num_(p.ordem); o.peso = p.peso === '' ? '' : num_(p.peso); return o;
}
function progDados_(u) {
  try { gerarRecorrentes_(u, false); } catch (e) {}
  const viagens = ler_('Viagens').filter(function (v) { return veUnidade_(u, v.unidadeId); });
  const vis = {}; viagens.forEach(function (v) { vis[v.id] = 1; });
  const paradas = ler_('Paradas').filter(function (p) { return vis[p.viagemId]; });
  const solLigadas = {}; paradas.forEach(function (p) { if (p.solicitacaoId) solLigadas[p.solicitacaoId] = 1; });
  const sols = ler_('Solicitacoes').filter(function (s) {
    return veUnidade_(u, s.unidadeId) && (solLigadas[s.id] || s.status === 'Liberada para programar' || s.status === 'Frustrada');
  }).map(function (s) { const o = solPublica_(s); o.pendentes = docsPendentes_(s.id).length; return o; });
  const tipos = {}; ler_('TiposVeiculo').forEach(function (t) { tipos[t.id] = { nome: String(t.nome), categoriaCnh: String(t.categoriaCnh || '') }; });
  return { ok: true,
    unidades: unidadesDoUsuario_(u), todasUnidades: unidadesLista_(),
    vePessoal: vePessoal_(u),
    colaboradores: ler_('Colaboradores').filter(function (c) { return veUnidade_(u, c.unidadeId); }).map(function (c) { return colabPublico_(c, u); }),
    viagens: viagens.map(viagemPublica_),
    equipe: ler_('ViagemEquipe').filter(function (e) { return vis[e.viagemId]; }).map(function (e) { return publico_('ViagemEquipe', e); }),
    paradas: paradas.map(paradaPublica_),
    solicitacoes: sols,
    veiculos: ler_('Veiculos').filter(function (v) { return veUnidade_(u, v.unidadeId); }).map(function (v) {
      const t = tipos[v.tipoVeiculoId] || {}; return { id: v.id, placa: String(v.placa), unidadeId: String(v.unidadeId || ''), tipo: t.nome || '', categoriaCnh: t.categoriaCnh || '',
        propriedade: String(v.propriedade), situacao: String(v.situacao), ativo: v.ativo }; }),
    caixas: ler_('Caixas').filter(function (c) { return veUnidade_(u, c.unidadeId); }).map(function (c) {
      return { id: c.id, numero: String(c.numero), capacidade: num_(c.capacidade), situacao: String(c.situacao), cadastroAtualId: String(c.cadastroAtualId || ''), ativo: c.ativo }; }),
    clientes: clientesLista_(),
    parametros: { valorPernoite: num_(parametro_('valorPernoite')), diasAvisoCnh: num_(parametro_('diasAvisoCnh')) || 30 },
    listas: { funcao: listaValores_('funcaoColaborador'), vinculo: listaValores_('vinculoColaborador'), categoriaCnh: listaValores_('categoriaCnhPessoa'),
              resultado: listaValores_('resultadoParada'), execucao: listaValores_('execucaoViagem') },
    adiantamentos: ler_('Adiantamentos').filter(function (a) { return vis[a.viagemId]; }).map(adiPublico_),
    lancamentos: ler_('Lancamentos').filter(function (l) { return l.ativo && vis[l.viagemId]; }).map(lancParadaPublico_),
    destinadores: destinadoresProgramacao_(),
    residuos: ler_('Residuos').map(function (r) { return { id: r.id, nome: String(r.nome), ativo: r.ativo }; }),
    podeImportar: !!u.adminPortal };
}

/* ---------------- equipe ---------------- */
function rotuloColab_(c) { return String(c.apelido || c.nome); }
function progSalvarColaborador_(reg, u) {
  reg = reg || {};
  const atual = reg.id ? porId_('Colaboradores', reg.id) : null;
  if (reg.id && !atual) return erroDados_('Pessoa não encontrada. Atualize a página.');
  if (atual && !veUnidade_(u, atual.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  const r = { unidadeId: String(reg.unidadeId || ''), nome: String(reg.nome || '').trim().replace(/\s+/g, ' '), apelido: String(reg.apelido || '').trim(),
              funcao: String(reg.funcao || ''), vinculo: String(reg.vinculo || ''), cnhCategoria: String(reg.cnhCategoria || '').toUpperCase(),
              cnhValidade: dataTexto_(reg.cnhValidade), telefone: String(reg.telefone || '').trim(), obs: String(reg.obs || '').trim() };
  if (!r.nome) return erroDados_('Informe o nome.');
  if (!porId_('Unidades', r.unidadeId)) return erroDados_('Escolha a unidade.');
  if (!veUnidade_(u, r.unidadeId)) return erroDados_('Você não tem acesso a esta unidade.');
  if (listaValores_('funcaoColaborador').indexOf(r.funcao) < 0) return erroDados_('Escolha a função.');
  if (listaValores_('vinculoColaborador').indexOf(r.vinculo) < 0) return erroDados_('Escolha o vínculo (próprio ou terceirizado).');
  if (r.cnhCategoria && listaValores_('categoriaCnhPessoa').indexOf(r.cnhCategoria) < 0) return erroDados_('Categoria de CNH inválida.');
  if (/Motorista/.test(r.funcao) && r.vinculo === 'Próprio' && (!r.cnhCategoria || !r.cnhValidade)) return erroDados_('Para motorista, informe a categoria e a validade da CNH.');
  if ('cpf' in reg && vePessoal_(u)) {
    const c = cpfDigitos_(reg.cpf);
    if (c && !cpfValido_(c)) return erroDados_('CPF inválido. Confira os números.');
    if (c && ler_('Colaboradores').some(function (x) { return cpfDigitos_(x.cpf) === c && x.id !== reg.id; })) return erroDados_('Já existe uma pessoa com este CPF.');
    r.cpf = c;
  }
  if (r.nome === r.nome.toLowerCase() || r.nome === r.nome.toUpperCase()) r.nome = nomeProprio_(r.nome);
  if (!r.apelido) r.apelido = apelidoDe_(r.nome);
  if (atual) { atualizar_('Colaboradores', atual.id, r, u, 'programacao', { registroNome: r.nome }); return { ok: true, id: atual.id }; }
  r.ativo = true;
  return { ok: true, id: inserir_('Colaboradores', r, u, 'programacao', r.nome).id };
}
function progAtivoColaborador_(id, ativo, u) {
  const c = porId_('Colaboradores', id); if (!c) return erroDados_('Pessoa não encontrada.');
  if (!veUnidade_(u, c.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  atualizar_('Colaboradores', id, { ativo: !!ativo }, u, 'programacao', { registroNome: String(c.nome) });
  return { ok: true };
}
function progExcluirColaborador_(id, u) {
  const c = porId_('Colaboradores', id); if (!c) return { ok: true };
  if (!veUnidade_(u, c.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  const r = excluir_('Colaboradores', id, u, 'programacao');
  if (r.ok && c.fotoId) { try { DriveApp.getFileById(String(c.fotoId)).setTrashed(true); } catch (e) {} }
  return r;
}
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
function progFoto_(id, dataUrl, u) {
  if (!vePessoal_(u)) return semPermissao_('Só quem edita a Programação cuida das fotos.');
  const c = porId_('Colaboradores', id); if (!c) return erroDados_('Pessoa não encontrada.');
  if (!veUnidade_(u, c.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  const m = String(dataUrl || '').match(/^data:(image\/(jpeg|png|webp));base64,(.+)$/);
  if (!m) return erroDados_('Imagem inválida.');
  if (m[3].length > 700000) return erroDados_('Foto grande demais. Use uma imagem menor.');
  const blob = Utilities.newBlob(Utilities.base64Decode(m[3]), m[1], c.id + '.' + (m[2] === 'jpeg' ? 'jpg' : m[2]));
  const arq = pastaFotos_().createFile(blob);
  if (c.fotoId) { try { DriveApp.getFileById(String(c.fotoId)).setTrashed(true); } catch (e) {} }
  atualizar_('Colaboradores', id, { fotoId: arq.getId() }, u, null);
  hist_(u, 'programacao', 'Colaboradores', id, String(c.nome), c.fotoId ? 'alterou' : 'alterou', 'Foto', c.fotoId ? 'foto anterior' : '', 'foto nova', '');
  return { ok: true };
}
function progVerFoto_(id, u) {
  if (!vePessoal_(u)) return semPermissao_('Sem acesso às fotos.');
  const c = porId_('Colaboradores', id); if (!c || !c.fotoId) return { ok: true, dataUrl: '' };
  if (!veUnidade_(u, c.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  try { const b = DriveApp.getFileById(String(c.fotoId)).getBlob(); return { ok: true, dataUrl: 'data:' + b.getContentType() + ';base64,' + Utilities.base64Encode(b.getBytes()) }; }
  catch (e) { return { ok: true, dataUrl: '' }; }
}

/* ---------------- viagens ---------------- */
function rotuloViagem_(v) {
  const ve = v.veiculoId ? porId_('Veiculos', v.veiculoId) : null;
  const tr = v.transportadorId ? porId_('Cadastros', v.transportadorId) : null;
  return 'Viagem ' + String(dataTexto_(v.dataSaida)).split('-').reverse().join('/') + ' · ' + (ve ? ve.placa : tr ? tr.nome : (v.placa || 'sem veículo'));
}
function paradasAtivasDaSolicitacao_(solId) {
  const vs = {}; ler_('Viagens').forEach(function (v) { if (v.status !== 'Cancelada') vs[v.id] = v; });
  return ler_('Paradas').filter(function (p) { return String(p.solicitacaoId) === String(solId) && vs[p.viagemId]; })
    .map(function (p) { return { p: p, v: vs[p.viagemId] }; });
}
/** O status da solicitação acompanha as paradas dela (só nas etapas da programação). */
function sincronizarSolicitacao_(solId, u) {
  const s = porId_('Solicitacoes', solId); if (!s) return;
  if (['Liberada para programar', 'Programada', 'Realizada', 'Frustrada'].indexOf(String(s.status)) < 0) return;
  if (faturamentoPorSolicitacao_()[solId]) return;
  const ps = paradasAtivasDaSolicitacao_(solId);
  const campos = {};
  const real = ps.filter(function (x) { return x.p.resultado === 'Realizada'; });
  if (real.length) {
    campos.status = 'Realizada';
    campos.dataColeta = real.map(function (x) { return dataTexto_(x.p.data) || dataTexto_(x.v.dataSaida); }).sort().pop();
  } else if (ps.some(function (x) { return x.p.resultado === 'Pendente' || !x.p.resultado; })) {
    campos.status = 'Programada';
  } else if (ps.length) {
    const ult = ps.sort(function (a, b) { return String(dataTexto_(a.p.data)).localeCompare(String(dataTexto_(b.p.data))); }).pop().p;
    campos.status = 'Frustrada'; campos.motivo = (ult.resultado === 'No-show' ? 'No-show' : 'Frustrada') + (ult.motivo ? ': ' + ult.motivo : '');
  } else {
    campos.status = s.status === 'Frustrada' ? 'Frustrada' : 'Liberada para programar';
  }
  atualizar_('Solicitacoes', solId, campos, u, 'programacao', { registroNome: rotuloSol_(s) });
}
/** Conferências da viagem: devolve {erros, avisos}. Erros bloqueiam; avisos pedem confirmação. */
function conferirViagem_(v, equipeIds, id) {
  const erros = [], avisos = [];
  const fim = v.dataRetornoPrevisto || v.dataSaida;
  if (v.execucao === 'Própria') {
    const ve = porId_('Veiculos', v.veiculoId);
    if (!ve) erros.push('Escolha o veículo.');
    const mot = porId_('Colaboradores', v.motoristaId);
    if (!mot) erros.push('Escolha o motorista.');
    if (ve && ['Em manutenção', 'Parado', 'Devolvido'].indexOf(String(ve.situacao)) >= 0) avisos.push('O veículo ' + ve.placa + ' está "' + ve.situacao + '" na Frota.');
    if (mot) {
      if (!/Motorista/.test(String(mot.funcao))) erros.push(mot.nome + ' não está cadastrado como motorista.');
      if (!mot.ativo) avisos.push(mot.nome + ' está inativo na equipe.');
      const val = dataTexto_(mot.cnhValidade);
      if (!val) avisos.push('CNH de ' + rotuloColab_(mot) + ' sem validade cadastrada.');
      else if (val < v.dataSaida) erros.push('CNH de ' + rotuloColab_(mot) + ' vencida em ' + val.split('-').reverse().join('/') + '.');
      else if (val < fim) erros.push('CNH de ' + rotuloColab_(mot) + ' vence durante a viagem (' + val.split('-').reverse().join('/') + ').');
      if (ve) {
        const tipo = porId_('TiposVeiculo', ve.tipoVeiculoId) || {};
        const exig = String(tipo.categoriaCnh || '');
        if (!mot.cnhCategoria) avisos.push('Categoria da CNH de ' + rotuloColab_(mot) + ' não cadastrada.');
        else if (exig && !cnhCobre_(mot.cnhCategoria, exig)) erros.push('CNH ' + mot.cnhCategoria + ' de ' + rotuloColab_(mot) + ' não serve para ' + ve.placa + ' (' + tipo.nome + ' exige ' + exig + ').');
      }
    }
    // conflitos de datas (mesmo veículo ou mesma pessoa em outra viagem)
    const pessoas = [v.motoristaId].concat(equipeIds).filter(String);
    const outras = ler_('Viagens').filter(function (o) { return o.id !== id && o.status !== 'Cancelada' && o.execucao !== 'Terceirizada'; });
    const eqPor = {}; ler_('ViagemEquipe').forEach(function (e) { (eqPor[e.viagemId] = eqPor[e.viagemId] || []).push(String(e.colaboradorId)); });
    outras.forEach(function (o) {
      const ini = dataTexto_(o.dataSaida), ofim = dataTexto_(o.dataRetorno) || dataTexto_(o.dataRetornoPrevisto) || ini;
      if (!(ini <= fim && v.dataSaida <= ofim)) return;
      const quando = ' (' + rotuloViagem_(o) + ')';
      if (v.veiculoId && String(o.veiculoId) === String(v.veiculoId)) avisos.push('O veículo já está em outra viagem nessas datas' + quando + '.');
      const delas = [String(o.motoristaId)].concat(eqPor[o.id] || []);
      pessoas.forEach(function (pid) { if (delas.indexOf(String(pid)) >= 0) { const c = porId_('Colaboradores', pid); avisos.push((c ? rotuloColab_(c) : pid) + ' já está em outra viagem nessas datas' + quando + '.'); } });
    });
    equipeIds.forEach(function (pid) { const c = porId_('Colaboradores', pid); if (!c) erros.push('Pessoa da equipe não encontrada.'); });
  } else {
    if (!porId_('Cadastros', v.transportadorId)) erros.push('Escolha a transportadora terceirizada (cadastro do Mapa).');
  }
  return { erros: erros, avisos: avisos };
}
/** Salva a viagem inteira (dados, equipe e paradas). reg.paradas = [{id?, ordem, solicitacaoId, clienteId, data, resultado, motivo, caixaEntregueId, caixaRetiradaId, peso, destinacao, obs}] */
function progSalvarViagem_(reg, confirmar, u) {
  reg = reg || {};
  const atual = reg.id ? porId_('Viagens', reg.id) : null;
  if (reg.id && !atual) return erroDados_('Viagem não encontrada. Atualize a página.');
  if (atual && !veUnidade_(u, atual.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  if (atual && atual.status === 'Cancelada') return erroDados_('Viagem cancelada não pode ser alterada.');
  const v = { unidadeId: String(reg.unidadeId || ''), execucao: String(reg.execucao || 'Própria'), dataSaida: dataTexto_(reg.dataSaida),
              dataRetornoPrevisto: dataTexto_(reg.dataRetornoPrevisto), veiculoId: String(reg.veiculoId || ''), motoristaId: String(reg.motoristaId || ''),
              transportadorId: String(reg.transportadorId || ''), custoTerceiro: reg.custoTerceiro === '' || reg.custoTerceiro == null ? '' : num_(reg.custoTerceiro),
              pernoitesPrevistos: reg.pernoitesPrevistos === '' || reg.pernoitesPrevistos == null ? '' : Math.max(0, Math.round(num_(reg.pernoitesPrevistos))),
              obs: String(reg.obs || '').trim() };
  if (!porId_('Unidades', v.unidadeId)) return erroDados_('Escolha a unidade.');
  if (!veUnidade_(u, v.unidadeId)) return erroDados_('Você não tem acesso a esta unidade.');
  if (listaValores_('execucaoViagem').indexOf(v.execucao) < 0) return erroDados_('Escolha se a viagem é própria ou terceirizada.');
  if (!v.dataSaida) return erroDados_('Informe a data de saída.');
  if (v.dataRetornoPrevisto && v.dataRetornoPrevisto < v.dataSaida) return erroDados_('O retorno previsto é antes da saída.');
  let equipeIds = (reg.equipe || []).map(String).filter(String).filter(function (x, i, a) { return a.indexOf(x) === i && x !== v.motoristaId; });
  if (v.execucao === 'Terceirizada') { v.veiculoId = ''; v.motoristaId = ''; equipeIds = []; v.pernoitesPrevistos = 0; }
  else { v.transportadorId = ''; v.custoTerceiro = ''; if (v.pernoitesPrevistos === '') v.pernoitesPrevistos = diasEntre_(v.dataSaida, v.dataRetornoPrevisto || v.dataSaida); }
  const ve = porId_('Veiculos', v.veiculoId); v.placa = ve ? String(ve.placa) : '';
  const conf = conferirViagem_(v, equipeIds, atual ? atual.id : '');
  // paradas
  const paradas = [];
  let erroP = '';
  (reg.paradas || []).forEach(function (p, i) {
    if (erroP) return;
    const x = { id: String(p.id || ''), ordem: i + 1, solicitacaoId: String(p.solicitacaoId || ''), clienteId: String(p.clienteId || ''), data: dataTexto_(p.data) || v.dataSaida,
                resultado: listaValores_('resultadoParada').indexOf(p.resultado) >= 0 ? p.resultado : 'Pendente', motivo: String(p.motivo || '').trim(),
                caixaEntregueId: String(p.caixaEntregueId || ''), caixaRetiradaId: String(p.caixaRetiradaId || ''),
                peso: p.peso === '' || p.peso == null ? '' : num_(p.peso), destinacao: String(p.destinacao || '').trim(), obs: String(p.obs || '').trim() };
    const lancs = Array.isArray(p.lancamentos) ? p.lancamentos : null; // null = não mexe (tela antiga)
    if (x.solicitacaoId) {
      const s = porId_('Solicitacoes', x.solicitacaoId);
      if (!s) { erroP = 'Parada ' + (i + 1) + ': solicitação não encontrada.'; return; }
      x.clienteId = x.clienteId || String(s.clienteId);
      const outra = paradasAtivasDaSolicitacao_(s.id).filter(function (y) { return y.p.viagemId !== (atual && atual.id) && y.p.resultado === 'Pendente'; })[0];
      if (outra) { erroP = 'A solicitação de ' + rotuloSol_(s) + ' já está pendente em outra viagem (' + rotuloViagem_(outra.v) + ').'; return; }
    }
    if (!porId_('Cadastros', x.clienteId)) { erroP = 'Parada ' + (i + 1) + ': escolha o cliente.'; return; }
    if ((x.resultado === 'Frustrada' || x.resultado === 'No-show') && !x.motivo) { erroP = 'Parada ' + (i + 1) + ': informe o motivo (' + x.resultado + ').'; return; }
    [x.caixaEntregueId, x.caixaRetiradaId].forEach(function (c) { if (c && !porId_('Caixas', c)) erroP = 'Parada ' + (i + 1) + ': caixa não encontrada.'; });
    if (lancs) {
      if (lancs.length && x.resultado !== 'Realizada') { erroP = 'Parada ' + (i + 1) + ': a destinação só é lançada quando a parada é realizada.'; return; }
      const e = validarLancamentosParada_(lancs, i + 1); if (e) { erroP = e; return; }
      x._lancs = lancs;
      if (lancs.length && x.peso === '') x.peso = lancs.reduce(function (t, l) { return t + num_(l.kg); }, 0);
    }
    paradas.push(x);
  });
  if (erroP) conf.erros.push(erroP);
  if (!paradas.length) conf.erros.push('Inclua pelo menos uma parada (cliente).');
  if (conf.erros.length) return { ok: false, erro: 'dados_invalidos', mensagem: conf.erros.join(' '), erros: conf.erros, avisos: conf.avisos };
  if (conf.avisos.length && !confirmar) return { ok: false, erro: 'avisos', avisos: conf.avisos, mensagem: 'Confira antes de salvar: ' + conf.avisos.join(' ') };
  // grava viagem
  let id;
  const nomeV = rotuloViagem_(v);
  if (atual) { id = atual.id; atualizar_('Viagens', id, v, u, 'programacao', { registroNome: nomeV }); }
  else {
    v.valorNoite = num_(parametro_('valorPernoite', v.dataSaida)); v.status = 'Programada'; v.origem = 'portal'; v.ativo = true;
    id = inserir_('Viagens', v, u, 'programacao', nomeV).id;
  }
  // equipe (ajudantes)
  const nomeP = function (pid) { const c = porId_('Colaboradores', pid); return c ? rotuloColab_(c) : pid; };
  const eqAtual = onde_('ViagemEquipe', 'viagemId', id);
  const antesEq = eqAtual.map(function (e) { return nomeP(e.colaboradorId); }).sort().join(', ');
  eqAtual.slice().sort(function (a, b) { return b._linha - a._linha; }).forEach(function (e) { if (equipeIds.indexOf(String(e.colaboradorId)) < 0) aba_('ViagemEquipe').deleteRow(e._linha); });
  limparCache_('ViagemEquipe');
  equipeIds.forEach(function (pid) { if (!eqAtual.some(function (e) { return String(e.colaboradorId) === pid; })) inserir_('ViagemEquipe', { viagemId: id, colaboradorId: pid, funcao: 'Ajudante' }, u, null); });
  const depoisEq = onde_('ViagemEquipe', 'viagemId', id).map(function (e) { return nomeP(e.colaboradorId); }).sort().join(', ');
  if (antesEq !== depoisEq) hist_(u, 'programacao', 'Viagens', id, nomeV, 'alterou', 'Ajudantes', antesEq, depoisEq, '');
  // paradas: atualiza, cria e remove
  const solAfetadas = {};
  const pAtuais = onde_('Paradas', 'viagemId', id);
  const nomeCli = function (cid) { const c = porId_('Cadastros', cid); return c ? String(c.nome) : cid; };
  const realizouAgora = [];
  paradas.forEach(function (x) {
    const a = x.id ? pAtuais.filter(function (y) { return y.id === x.id; })[0] : null;
    const dados = Object.assign({}, x); delete dados.id; delete dados._lancs;
    if (a) {
      x._id = a.id;
      if (a.solicitacaoId) solAfetadas[a.solicitacaoId] = 1;
      if (x.resultado === 'Realizada' && a.resultado !== 'Realizada') realizouAgora.push(x);
      atualizar_('Paradas', a.id, dados, u, 'programacao', { tabela: 'Viagens', registroId: id, registroNome: nomeV, prefixoCampo: 'Parada ' + x.ordem + ' (' + nomeCli(x.clienteId) + ') · ' });
    } else {
      dados.viagemId = id;
      x._id = inserir_('Paradas', dados, u, null).id;
      hist_(u, 'programacao', 'Viagens', id, nomeV, 'alterou', 'Parada incluída', '', x.ordem + '. ' + nomeCli(x.clienteId) + (x.solicitacaoId ? ' (solicitação)' : ''), '');
      if (x.resultado === 'Realizada') realizouAgora.push(x);
    }
    if (x.solicitacaoId) solAfetadas[x.solicitacaoId] = 1;
  });
  pAtuais.filter(function (a) { return !paradas.some(function (x) { return x.id === a.id; }); })
    .sort(function (a, b) { return b._linha - a._linha; }).forEach(function (a) {
      if (a.solicitacaoId) solAfetadas[a.solicitacaoId] = 1;
      inativarLancamentosParada_(a.id, u, 'Parada removida da viagem.');
      aba_('Paradas').deleteRow(porId_('Paradas', a.id)._linha); limparCache_('Paradas');
      hist_(u, 'programacao', 'Viagens', id, nomeV, 'alterou', 'Parada removida', nomeCli(a.clienteId) + ' (' + a.resultado + ')', '', '');
    });
  limparCache_('Paradas');
  realizouAgora.forEach(function (x) { moverCaixas_(x, u); });
  const vGravada = porId_('Viagens', id);
  paradas.forEach(function (x) {
    if (x._lancs) sincronizarLancamentosParada_(vGravada, Object.assign({}, x, { id: x._id }), x._lancs, u);
    else if (x.resultado !== 'Realizada') inativarLancamentosParada_(x._id, u, 'A parada deixou de estar realizada.');
  });
  Object.keys(solAfetadas).forEach(function (sid) { sincronizarSolicitacao_(sid, u); });
  sincronizarAdiantamentos_(id, u);
  return { ok: true, id: id, avisos: conf.avisos };
}
/** Parada realizada: a caixa entregue fica no cliente; a retirada volta para a base. */
function moverCaixas_(x, u) {
  const cli = porId_('Cadastros', x.clienteId);
  if (x.caixaEntregueId) { const c = porId_('Caixas', x.caixaEntregueId); if (c) atualizar_('Caixas', c.id, { situacao: 'Em cliente', cadastroAtualId: x.clienteId }, u, 'programacao',
    { registroNome: nomeCaixa_(c.numero), prefixoCampo: 'Entregue em ' + (cli ? cli.nome : '') + ' · ' }); }
  if (x.caixaRetiradaId) { const c = porId_('Caixas', x.caixaRetiradaId); if (c) atualizar_('Caixas', c.id, { situacao: 'Na base', cadastroAtualId: '' }, u, 'programacao',
    { registroNome: nomeCaixa_(c.numero), prefixoCampo: 'Retirada de ' + (cli ? cli.nome : '') + ' · ' }); }
}
/** Concluir (retorno e pernoites realizados) ou cancelar a viagem. */
function progViagemAcao_(id, tipo, x, u) {
  x = x || {};
  const v = porId_('Viagens', id); if (!v) return erroDados_('Viagem não encontrada.');
  if (!veUnidade_(u, v.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  const nomeV = rotuloViagem_(v);
  const ps = onde_('Paradas', 'viagemId', id);
  if (tipo === 'concluir') {
    if (v.status !== 'Programada') return erroDados_('Só viagem programada pode ser concluída.');
    if (ps.some(function (p) { return p.resultado === 'Pendente' || !p.resultado; })) return erroDados_('Registre o resultado de todas as paradas antes de concluir.');
    const ret = dataTexto_(x.dataRetorno); if (!ret) return erroDados_('Informe a data de retorno à base.');
    if (ret < dataTexto_(v.dataSaida)) return erroDados_('O retorno é antes da saída.');
    const campos = { dataRetorno: ret, status: 'Concluída' };
    if (v.execucao !== 'Terceirizada') campos.pernoitesRealizados = x.pernoitesRealizados === '' || x.pernoitesRealizados == null ? diasEntre_(dataTexto_(v.dataSaida), ret) : Math.max(0, Math.round(num_(x.pernoitesRealizados)));
    if (v.execucao === 'Terceirizada' && x.custoTerceiro !== undefined && x.custoTerceiro !== '') campos.custoTerceiro = num_(x.custoTerceiro);
    atualizar_('Viagens', id, campos, u, 'programacao', { registroNome: nomeV });
    sincronizarAdiantamentos_(id, u);
    return { ok: true };
  }
  if (tipo === 'reabrir') {
    if (v.status !== 'Concluída') return erroDados_('Só viagem concluída pode ser reaberta.');
    atualizar_('Viagens', id, { status: 'Programada' }, u, 'programacao', { registroNome: nomeV });
    sincronizarAdiantamentos_(id, u);
    return { ok: true };
  }
  if (tipo === 'cancelar') {
    if (v.status === 'Cancelada') return { ok: true };
    if (ps.some(function (p) { return p.resultado === 'Realizada'; })) return erroDados_('A viagem tem parada realizada e não pode ser cancelada. Ajuste as paradas.');
    const m = String(x.motivo || '').trim(); if (!m) return erroDados_('Informe o motivo do cancelamento.');
    atualizar_('Viagens', id, { status: 'Cancelada', motivo: m }, u, 'programacao', { registroNome: nomeV });
    sincronizarAdiantamentos_(id, u);
    ps.forEach(function (p) { if (p.solicitacaoId) sincronizarSolicitacao_(String(p.solicitacaoId), u); });
    return { ok: true };
  }
  return erroDados_('Ação inválida.');
}

/* ---------------- importação: equipe ---------------- */
function apelidoDe_(nome) {
  const t = semAcento_(nome).split(' ');
  const cap = function (s) { return s.charAt(0) + s.slice(1).toLowerCase(); };
  const orig = String(nome).trim().split(/\s+/);
  return cap(orig[0]) + (t.indexOf('JUNIOR') >= 0 || t.indexOf('JR') >= 0 ? ' Jr' : '');
}
function nomeProprio_(nome) {
  const peq = { DA: 1, DE: 1, DO: 1, DAS: 1, DOS: 1, E: 1 };
  return String(nome).trim().replace(/\s+/g, ' ').toLowerCase().split(' ').map(function (p, i) { return i && peq[p.toUpperCase()] ? p : p.charAt(0).toUpperCase() + p.slice(1); }).join(' ');
}
/** linhas = [{funcao: 'Motorista'|'Ajudante', nome, cpf}] */
function progImportarEquipe_(unidadeId, linhas, simular, u) {
  if (!porId_('Unidades', unidadeId)) return erroDados_('Escolha a unidade da equipe.');
  const res = { lidas: (linhas || []).length, novas: 0, jaExistiam: 0, cpfAConferir: [], nomes: [] };
  const existentes = ler_('Colaboradores');
  const novos = [];
  (linhas || []).forEach(function (l) {
    const nome = String(l.nome || '').trim(); if (!nome) return;
    const cpf = cpfDigitos_(l.cpf);
    const cpf11 = cpf && cpf.length < 11 ? ('00000000000' + cpf).slice(-11) : cpf; // zeros à esquerda perdidos na planilha
    const ja = existentes.concat(novos).some(function (c) { return (cpf11 && cpfDigitos_(c.cpf) === cpf11) || semAcento_(c.nome) === semAcento_(nome); });
    if (ja) { res.jaExistiam++; return; }
    const ok = !cpf11 || cpfValido_(cpf11);
    if (!ok || !cpf11) res.cpfAConferir.push(nomeProprio_(nome) + (cpf11 ? ' (CPF inválido)' : ' (sem CPF)'));
    novos.push({ unidadeId: unidadeId, nome: nomeProprio_(nome), apelido: apelidoDe_(nome), funcao: l.funcao === 'Motorista' ? 'Motorista' : 'Ajudante', vinculo: 'Próprio',
      cpf: ok ? cpf11 : '', cnhCategoria: '', cnhValidade: '', telefone: '', fotoId: '',
      obs: 'Importado da planilha de equipe.' + (!ok && cpf ? ' CPF da planilha não confere (' + String(l.cpf) + '): corrija.' : '') + (l.funcao === 'Motorista' ? ' Complete a CNH.' : ''), ativo: true });
  });
  res.novas = novos.length; res.nomes = novos.map(function (n) { return n.nome + ' (' + n.funcao + ')'; });
  if (simular) return Object.assign({ ok: true, simulacao: true }, res);
  inserirLote_('Colaboradores', novos, u);
  hist_(u, 'programacao', 'Colaboradores', '', '', 'importou', '', '', '', 'Planilha de equipe: ' + novos.length + ' pessoa(s).');
  return Object.assign({ ok: true }, res);
}

/* ---------------- importação: planilha de programação (abas por mês) ---------------- */
// linhas = [{_aba, _linha, 'DATA SAÍDA', PLACA, MOTORISTA, AJUDANTE, 'CÓDIGO', DESTINO, ROTA, 'DESTINAÇÃO', PESO, VALOR, 'DATA DA COLETA', 'RETORNO BASE', 'MTR LANÇADO?', ...}]
function progImportarProgramacao_(unidadeId, linhas, simular, u) {
  if (!porId_('Unidades', unidadeId)) return erroDados_('Escolha a unidade da programação.');
  const res = { lidas: (linhas || []).length, viagens: 0, paradas: 0, jaImportadas: 0, semData: 0, pessoasNovas: [], clientesNovos: [], placasSemVeiculo: [], ligadasSolicitacao: 0, resultados: {} };
  const g = function (l, k) { const v = l[k]; return v == null ? '' : String(v).trim(); };
  const pega = function (l, nomes) { for (let i = 0; i < nomes.length; i++) { const k = Object.keys(l).filter(function (x) { return semAcento_(x) === semAcento_(nomes[i]); })[0]; if (k && l[k] !== '' && l[k] != null) return l[k]; } return ''; };
  // pessoas da unidade
  const pessoas = ler_('Colaboradores').filter(function (c) { return String(c.unidadeId) === unidadeId; }).map(function (c) { return { id: c.id, nome: String(c.nome), apelido: String(c.apelido || ''), funcao: String(c.funcao) }; });
  const novasPessoas = {};
  const acharPessoa = function (txt, funcao) {
    const t = semAcento_(String(txt || '').replace(/\(.*?\)/g, '')).replace(/\./g, '').trim(); if (!t || /AGUARD|TERCEIRIZ|^-+$|^X$|^\d+$/.test(t)) return '';
    const jr = /\bJR\b|JUNIOR/.test(t); const primeiro = t.split(' ')[0];
    const cands = pessoas.filter(function (p) {
      const n = semAcento_(p.nome), a = semAcento_(p.apelido);
      if (a === t || n === t) return true;
      if (n.split(' ')[0] !== primeiro) return false;
      return jr === /\bJR\b|JUNIOR/.test(n + ' ' + a);
    });
    const melhor = cands.filter(function (p) { return p.funcao.indexOf(funcao) >= 0; })[0] || cands[0];
    if (melhor) return melhor.id;
    const k = '@' + t; if (!novasPessoas[k]) novasPessoas[k] = { nome: nomeProprio_(t), funcao: funcao };
    return k;
  };
  // clientes pelo código UPLOG (código com _01 = unidade do mesmo cliente)
  const porCod = {}, porNome = {};
  ler_('Cadastros').forEach(function (c) { if (String(c.codigoUplog).trim()) porCod[String(c.codigoUplog).trim()] = c.id; porNome[semAcento_(c.nome)] = c.id; });
  const novosClientes = {};
  const acharCliente = function (cod, nome) {
    cod = String(cod || '').trim().replace(/\.0+$/, ''); if (!/\d/.test(cod)) cod = ''; // "-" ou vazio = sem código
    const base = cod.split('_')[0];
    const id = (cod && porCod[cod]) || (base && porCod[base]) || porNome[semAcento_(nome)];
    if (id) return id;
    const k = '@' + (cod || semAcento_(nome)); if (!novosClientes[k]) novosClientes[k] = { codigoUplog: cod, nome: nome || ('Cliente ' + cod) };
    return k;
  };
  const veicPorPlaca = {}; ler_('Veiculos').forEach(function (v) { veicPorPlaca[String(v.placa).toUpperCase()] = v.id; });
  const ja = {}; ler_('Viagens').forEach(function (v) { if (v.idOrigem) ja[String(v.idOrigem)] = 1; });
  // agrupa em viagens: mesma saída, placa e motorista
  const grupos = {}, ordemG = [];
  (linhas || []).forEach(function (l) {
    const saida = dtPlan_(pega(l, ['DATA SAÍDA', 'DATA SAIDA']));
    const destino = g(l, 'DESTINO') || g(l, 'CLIENTE');
    if (!saida) { if (destino) res.semData++; return; }
    let placa = String(pega(l, ['PLACA'])).replace(/[\s-]/g, '').toUpperCase(); if (!/[A-Z]/.test(placa)) placa = '';
    const mot = semAcento_(pega(l, ['MOTORISTA']));
    const k = 'PRG|' + saida + '|' + placa + '|' + mot;
    if (!grupos[k]) { grupos[k] = { saida: saida, placa: placa, motorista: String(pega(l, ['MOTORISTA'])), linhas: [] }; ordemG.push(k); }
    grupos[k].linhas.push(l);
  });
  const viagens = [];
  ordemG.forEach(function (k) {
    if (ja[k]) { res.jaImportadas++; return; }
    const gr = grupos[k];
    const motId = acharPessoa(gr.motorista, 'Motorista');
    const ajud = {};
    gr.linhas.forEach(function (l) {
      String(pega(l, ['AJUDANTE'])).split(/\s+E\s+|,|\/|\+|\s+-\s+/i).forEach(function (n) { const id = acharPessoa(n, 'Ajudante'); if (id && id !== motId) ajud[id] = 1; });
    });
    let retorno = '';
    const paradas = gr.linhas.map(function (l, i) {
      const textos = semAcento_([g(l, 'DESTINO'), pega(l, ['ROTA']), pega(l, ['DESTINAÇÃO', 'DESTINACAO']), pega(l, ['AJUDANTE']), pega(l, ['MTR LANÇADO?', 'MTR LANCADO?']), pega(l, ['Coluna1', 'OBS', 'OBSERVAÇÃO'])].join(' | '));
      const dataCol = dtPlan_(pega(l, ['DATA DA COLETA']));
      const ret = dtPlan_(pega(l, ['RETORNO BASE'])); if (ret > retorno) retorno = ret;
      let resultado = dataCol ? 'Realizada' : 'Pendente', motivo = '';
      if (/FRUSTRAD/.test(textos)) { resultado = 'Frustrada'; motivo = 'Planilha: ' + textos.replace(/\s*\|\s*/g, ' · ').slice(0, 200); }
      else if (/NO[ -]?SHOW/.test(textos)) { resultado = 'No-show'; motivo = 'Planilha: ' + textos.replace(/\s*\|\s*/g, ' · ').slice(0, 200); }
      res.resultados[resultado] = (res.resultados[resultado] || 0) + 1;
      const rota = Number(pega(l, ['ROTA']));
      const extras = [];
      const valor = pega(l, ['VALOR']); if (valor !== '') extras.push('Valor na planilha: ' + valor);
      const mtr = pega(l, ['MTR LANÇADO?', 'MTR LANCADO?']); if (mtr !== '') extras.push('MTR: ' + mtr);
      const c1 = pega(l, ['Coluna1', 'OBS']); if (c1 !== '') extras.push(String(c1));
      return { ordem: rota > 0 && rota < 50 ? rota : i + 1, clienteId: acharCliente(pega(l, ['CÓDIGO', 'CODIGO']), g(l, 'DESTINO')), destinoTexto: g(l, 'DESTINO'),
               data: dataCol || gr.saida, resultado: resultado, motivo: motivo, peso: pega(l, ['PESO']) === '' || isNaN(num_(pega(l, ['PESO']))) ? '' : num_(pega(l, ['PESO'])),
               destinacao: String(pega(l, ['DESTINAÇÃO', 'DESTINACAO'])), obs: ['Planilha ' + (l._aba || '') + ' linha ' + (l._linha || '') + ': ' + g(l, 'DESTINO')].concat(extras).join(' · '),
               caixaEntregueId: '', caixaRetiradaId: '', solicitacaoId: '' };
    }).sort(function (a, b) { return a.ordem - b.ordem; });
    paradas.forEach(function (p, i) { p.ordem = i + 1; });
    const veiculoId = veicPorPlaca[gr.placa] || '';
    if (gr.placa && !veiculoId && res.placasSemVeiculo.indexOf(gr.placa) < 0) res.placasSemVeiculo.push(gr.placa);
    const pend = paradas.some(function (p) { return p.resultado === 'Pendente'; });
    const noites = retorno ? Math.max(0, diasEntre_(gr.saida, retorno)) : 0;
    const terc = /TERCEIRIZ/.test(semAcento_(gr.motorista));
    viagens.push({ k: k, ajudantes: Object.keys(ajud), paradas: paradas, v: { unidadeId: unidadeId, execucao: terc ? 'Terceirizada' : 'Própria', dataSaida: gr.saida, dataRetornoPrevisto: retorno || gr.saida,
      dataRetorno: pend ? '' : (retorno || gr.saida), veiculoId: veiculoId, placa: gr.placa, motoristaId: motId, transportadorId: '', custoTerceiro: '',
      pernoitesPrevistos: terc ? 0 : noites, pernoitesRealizados: pend ? '' : (terc ? 0 : noites), valorNoite: num_(parametro_('valorPernoite', gr.saida)),
      status: pend ? 'Programada' : 'Concluída', motivo: '', obs: 'Importada da planilha de programação.' + (gr.placa && !veiculoId ? ' Placa ' + gr.placa + ' não está na Frota.' : ''),
      origem: 'planilha', idOrigem: k, ativo: true } });
  });
  res.viagens = viagens.length; res.paradas = viagens.reduce(function (t, x) { return t + x.paradas.length; }, 0);
  res.pessoasNovas = Object.keys(novasPessoas).map(function (k) { return novasPessoas[k].nome + ' (' + novasPessoas[k].funcao + ')'; });
  res.clientesNovos = Object.keys(novosClientes).map(function (k) { const c = novosClientes[k]; return (c.codigoUplog ? c.codigoUplog + ' · ' : '') + c.nome; });
  // ligação com solicitações: mesmo cliente e mesma data da coleta (ou prevista), ainda sem parada
  const usadas = {}; ler_('Paradas').forEach(function (p) { if (p.solicitacaoId) usadas[p.solicitacaoId] = 1; });
  const solsPorCli = {}; ler_('Solicitacoes').forEach(function (s) { (solsPorCli[s.clienteId] = solsPorCli[s.clienteId] || []).push(s); });
  viagens.forEach(function (x) { x.paradas.forEach(function (p) {
    if (/^@/.test(p.clienteId)) return;
    const s = (solsPorCli[p.clienteId] || []).filter(function (s) { return !usadas[s.id] && (dataTexto_(s.dataColeta) === p.data || dataTexto_(s.dataPrevista) === p.data); })[0];
    if (s) { p.solicitacaoId = s.id; usadas[s.id] = 1; res.ligadasSolicitacao++; }
  }); });
  if (simular) return Object.assign({ ok: true, simulacao: true }, res);
  // grava: pessoas, clientes, viagens, equipe e paradas
  const idPessoa = {};
  const pCriadas = inserirLote_('Colaboradores', Object.keys(novasPessoas).map(function (k) { const n = novasPessoas[k];
    return { unidadeId: unidadeId, nome: n.nome, apelido: n.nome.split(' ')[0], funcao: n.funcao, vinculo: 'Próprio', cpf: '', cnhCategoria: '', cnhValidade: '', telefone: '', fotoId: '',
             obs: 'Criada pela importação da programação (só o nome usado na planilha). Complete o cadastro ou inative.', ativo: true }; }), u);
  Object.keys(novasPessoas).forEach(function (k, i) { idPessoa[k] = pCriadas[i].id; });
  const idCli = {};
  const cCriados = inserirLote_('Cadastros', Object.keys(novosClientes).map(function (k) { const c = novosClientes[k];
    return { tipos: 'cliente', nome: c.nome, codigoUplog: c.codigoUplog, ativo: true, obs: 'Criado pela importação da planilha de programação. Complete os dados e a localização.' }; }), u);
  Object.keys(novosClientes).forEach(function (k, i) { idCli[k] = cCriados[i].id; });
  const pid = function (x) { return idPessoa[x] || x; };
  const vCriadas = inserirLote_('Viagens', viagens.map(function (x) { x.v.motoristaId = pid(x.v.motoristaId); return x.v; }), u);
  const eq = [], ps = [];
  viagens.forEach(function (x, i) {
    const vid = vCriadas[i].id;
    x.ajudantes.forEach(function (a) { eq.push({ viagemId: vid, colaboradorId: pid(a), funcao: 'Ajudante' }); });
    x.paradas.forEach(function (p) { const d = Object.assign({}, p); delete d.destinoTexto; d.viagemId = vid; d.clienteId = idCli[d.clienteId] || d.clienteId; ps.push(d); });
  });
  inserirLote_('ViagemEquipe', eq, u);
  inserirLote_('Paradas', ps, u);
  hist_(u, 'programacao', 'Viagens', '', '', 'importou', '', '', '', 'Planilha de programação: ' + JSON.stringify({ viagens: res.viagens, paradas: res.paradas,
    pessoasNovas: res.pessoasNovas.length, clientesNovos: res.clientesNovos.length, ligadasSolicitacao: res.ligadasSolicitacao, resultados: res.resultados }));
  return Object.assign({ ok: true }, res);
}
