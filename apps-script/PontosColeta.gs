/* =====================================================================
 * Portal GVC — pontos de coleta (etapa 6, "caso A": um CNPJ com vários pontos).
 * Cada ponto é um Local do cadastro além do principal (o local principal continua sendo
 * o endereço do cadastro, editado no formulário do Mapa). Cada ponto ativo com coordenadas
 * vira um pino no Mapa. A solicitação pode dizer em qual ponto é a coleta (Solicitacoes.localId);
 * a Programação mostra o ponto e a km pela rota usa as coordenadas dele.
 * ===================================================================== */

/** Local principal de cada cadastro (o primeiro ativo, senão o primeiro). {cadastroId: localId} */
function principaisLocais_() {
  const out = {}, ativo = {};
  ler_('Locais').forEach(function (l) {
    const c = String(l.cadastroId || ''); if (!c) return;
    if (!out[c] || (!ativo[c] && l.ativo)) { out[c] = l.id; ativo[c] = !!l.ativo; }
  });
  return out;
}
function pontoColetaPublico_(l) {
  const o = { id: l.id, cadastroId: String(l.cadastroId), nome: String(l.nome || ''), ativo: l.ativo !== false };
  CAMPOS_LOCAL.forEach(function (k) { o[k] = l[k] === undefined || l[k] === null ? '' : (k === 'lat' || k === 'lng' ? (l[k] === '' ? '' : Number(l[k])) : String(l[k])); });
  return o;
}
/** Todos os pontos de coleta (locais que não são o principal). */
function pontosColetaLista_() {
  const pr = principaisLocais_();
  return ler_('Locais').filter(function (l) { return l.cadastroId && pr[String(l.cadastroId)] !== l.id; }).map(pontoColetaPublico_)
    .sort(function (a, b) { return a.cadastroId.localeCompare(b.cadastroId) || a.nome.localeCompare(b.nome, 'pt-BR'); });
}
function rotuloPontoColeta_(l) {
  return String(l.nome || '') + (l.cidade ? ' · ' + l.cidade + (l.uf ? '/' + l.uf : '') : '');
}

/** reg = {id?, cadastroId, nome, logradouro, numero, bairro, cidade, uf, cep, lat, lng} */
function salvarPontoColeta_(reg, u) {
  reg = reg || {};
  const atual = reg.id ? porId_('Locais', reg.id) : null;
  if (reg.id && !atual) return erroDados_('Ponto de coleta não encontrado. Atualize.');
  const cad = porId_('Cadastros', atual ? atual.cadastroId : String(reg.cadastroId || '')); if (!cad) return erroDados_('Cadastro não encontrado.');
  if (atual && principaisLocais_()[cad.id] === atual.id) return erroDados_('Este é o endereço principal do cadastro: altere no formulário do cadastro.');
  const r = { nome: String(reg.nome || '').trim() };
  CAMPOS_LOCAL.forEach(function (k) { r[k] = reg[k] === undefined || reg[k] === null ? '' : String(reg[k]).trim(); });
  if (!r.nome) return erroDados_('Dê um nome ao ponto de coleta (ex.: Filial Centro, Galpão 2).');
  if (onde_('Locais', 'cadastroId', cad.id).some(function (l) { return l.id !== (atual && atual.id) && l.ativo && semAcento_(l.nome) === semAcento_(r.nome); }))
    return erroDados_('Já existe um ponto de coleta "' + r.nome + '" neste cadastro.');
  if ((r.lat === '') !== (r.lng === '')) return erroDados_('Informe a latitude e a longitude (ou nenhuma das duas).');
  if (r.lat !== '') {
    const la = num_(r.lat), lo = num_(r.lng);
    if (!isFinite(la) || !isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180 || (!la && !lo)) return erroDados_('Coordenadas inválidas.');
    r.lat = la; r.lng = lo;
  }
  if (!r.lat && !r.logradouro && !r.cidade) return erroDados_('Informe o endereço ou as coordenadas do ponto.');
  r.uf = r.uf.toUpperCase().slice(0, 2);
  const opc = { tabela: 'Cadastros', registroId: cad.id, registroNome: String(cad.nome), prefixoCampo: 'Ponto de coleta ' + r.nome + ' · ' };
  if (atual) { atualizar_('Locais', atual.id, r, u, 'mapa', opc); return { ok: true, id: atual.id, pontosColeta: pontosColetaLista_() }; }
  r.cadastroId = cad.id; r.ativo = true;
  const novo = inserir_('Locais', r, u, null);
  inserir_('CadastroLocais', { cadastroId: cad.id, localId: novo.id, situacao: 'ativo' }, u, null);
  hist_(u, 'mapa', 'Cadastros', cad.id, String(cad.nome), 'alterou', 'Ponto de coleta incluído', '', rotuloPontoColeta_(r), '');
  return { ok: true, id: novo.id, pontosColeta: pontosColetaLista_() };
}
function ativoPontoColeta_(id, ativo, u) {
  const l = porId_('Locais', id); if (!l) return erroDados_('Ponto de coleta não encontrado.');
  const cad = porId_('Cadastros', l.cadastroId) || {};
  if (principaisLocais_()[String(l.cadastroId)] === l.id) return erroDados_('O endereço principal não é inativado por aqui.');
  atualizar_('Locais', l.id, { ativo: !!ativo }, u, 'mapa', { tabela: 'Cadastros', registroId: cad.id, registroNome: String(cad.nome || ''), prefixoCampo: 'Ponto de coleta ' + l.nome + ' · ' });
  onde_('CadastroLocais', 'localId', l.id).forEach(function (cl) { atualizar_('CadastroLocais', cl.id, { situacao: ativo ? 'ativo' : 'inativo' }, u, null); });
  return { ok: true, pontosColeta: pontosColetaLista_() };
}

/* ---------------- migração (ESQUEMA 17) ---------------- */
function migrarPontosColeta_() {
  migrarCabecalho_('Solicitacoes');
  HIST_BUF_.push([new Date(), '', 'sistema', 'mapa', 'Locais', '', '', 'migrou', '', '', '',
    'Pontos de coleta: vários locais por cadastro (um pino por ponto no Mapa) e o ponto da coleta na solicitação.']);
}
