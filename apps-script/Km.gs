/* =====================================================================
 * Portal GVC — cobrança do transporte por km rodado.
 * Preço de venda nas modalidades "Km rodado + kg" e "Km rodado + valorização": o valor do
 * transporte é R$ por km (coluna valorTransporte). Depois da destinação (ou da coleta realizada,
 * em serviço sem destinação) a solicitação volta ao solicitante, que escolhe o km cobrado:
 * o real (odômetro da viagem, dividido pela km prevista quando a viagem atende mais de uma coleta)
 * ou o previsto. Sem a escolha o Faturamento não monta o BM. Não há escolha automática.
 * ===================================================================== */

const MODALIDADES_KM = ['Km rodado + kg', 'Km rodado + valorização'];
const KM_ESCOLHAS = ['Real', 'Previsto'];
function modalidadeKm_(m) { return MODALIDADES_KM.indexOf(String(m || '')) >= 0; }
function modalidadeValorizacao_(m) { return /valoriza/i.test(String(m || '')); }
function modalidadeComTransporte_(m) { return m === 'Transporte + kg' || m === 'Valorização com transporte' || modalidadeKm_(m); }

/** Preço por km vigente do cliente (ou do cadastro principal dele) na data. */
function precoKmVigente_(clienteId, data) {
  const cli = porId_('Cadastros', clienteId); if (!cli) return null;
  const ids = [String(cli.id)]; if (cli.cadastroPrincipalId) ids.push(String(cli.cadastroPrincipalId));
  data = data || dataTexto_(new Date());
  const ps = ler_('PrecosCliente').filter(function (p) {
    if (!p.ativo || !modalidadeKm_(p.modalidade) || p.valorTransporte === '' || ids.indexOf(String(p.cadastroId)) < 0) return false;
    const ini = dataTexto_(p.vigenciaInicio), fim = dataTexto_(p.vigenciaFim);
    return (!ini || ini <= data) && (!fim || fim >= data);
  }).sort(function (a, b) {
    return ids.indexOf(String(a.cadastroId)) - ids.indexOf(String(b.cadastroId)) || String(dataTexto_(b.vigenciaInicio)).localeCompare(String(dataTexto_(a.vigenciaInicio)));
  });
  const p = ps[0];
  return p ? { id: p.id, modalidade: String(p.modalidade), valorKm: num_(p.valorTransporte), cadastroId: String(p.cadastroId) } : null;
}
function dataRefKm_(s) { return dataTexto_(s.dataColeta) || dataTexto_(s.dataPrevista) || dataTexto_(s.dataSolicitacao); }

/** Km real de cada solicitação pelas viagens (odômetro). {sid: {km|'' , motivo, viagens:[{id, placa, saida, kmViagem, parte}]}} */
function kmRealSolicitacoes_(ids) {
  const quer = {}; (ids || []).forEach(function (id) { quer[String(id)] = 1; });
  const viagens = {}; ler_('Viagens').forEach(function (v) { if (v.status !== 'Cancelada') viagens[v.id] = v; });
  const paradasV = {}, vDe = {};
  ler_('Paradas').forEach(function (p) {
    if (!viagens[p.viagemId] || p.resultado !== 'Realizada') return;
    (paradasV[p.viagemId] = paradasV[p.viagemId] || []).push(p);
    if (quer[p.solicitacaoId]) { const l = vDe[p.solicitacaoId] = vDe[p.solicitacaoId] || []; if (l.indexOf(p.viagemId) < 0) l.push(p.viagemId); }
  });
  const kmPrev = {}; ler_('Solicitacoes').forEach(function (s) { kmPrev[s.id] = num_(s.kmPrevista); });
  const out = {};
  Object.keys(quer).forEach(function (sid) {
    const vids = vDe[sid] || [];
    const r = { km: '', motivo: '', viagens: [] };
    if (!vids.length) { r.motivo = 'Coleta sem viagem realizada na Programação.'; out[sid] = r; return; }
    let km = 0, ok = true;
    vids.forEach(function (vid) {
      const v = viagens[vid], ps = paradasV[vid] || [];
      const tot = ps.reduce(function (t, p) { return t + (p.solicitacaoId ? kmPrev[p.solicitacaoId] || 0 : 0); }, 0);
      const parte = tot > 0 ? (kmPrev[sid] || 0) / tot : 1 / Math.max(1, ps.length);
      const ki = numOuVazio_(v.kmInicial), kf = numOuVazio_(v.kmFinal);
      const kmV = ki !== '' && kf !== '' && kf >= ki ? kf - ki : '';
      r.viagens.push({ id: v.id, placa: String(v.placa || ''), saida: dataTexto_(v.dataSaida), execucao: String(v.execucao || ''), kmViagem: kmV, parte: Math.round(parte * 1000) / 1000, paradas: ps.length });
      if (v.execucao === 'Terceirizada') { ok = false; r.motivo = r.motivo || 'Viagem terceirizada (sem odômetro).'; return; }
      if (kmV === '') { ok = false; r.motivo = r.motivo || 'A viagem ' + (v.placa || v.id) + ' não tem a km inicial e a km na volta registradas.'; return; }
      km += kmV * parte;
    });
    if (ok) r.km = Math.round(km);
    out[sid] = r;
  });
  return out;
}

/** Situação do km de cobrança das solicitações (só as que cobram por km). {sid: info} */
function infoKm_(sols) {
  const fat = faturamentoPorSolicitacao_();
  const alvo = [], preco = {};
  sols.forEach(function (s) {
    if (['Realizada', 'Destinação', 'BM enviado', 'NF emitida'].indexOf(String(s.status)) < 0 && !s.kmCobranca) return;
    const p = precoKmVigente_(s.clienteId, dataRefKm_(s));
    if (!p && !s.kmCobranca) return;
    preco[s.id] = p; alvo.push(s.id);
  });
  const reais = kmRealSolicitacoes_(alvo);
  const out = {};
  sols.forEach(function (s) {
    if (alvo.indexOf(s.id) < 0) return;
    const p = preco[s.id], r = reais[s.id] || { km: '', motivo: '', viagens: [] };
    out[s.id] = { precoId: p ? p.id : '', modalidade: p ? p.modalidade : '', valorKm: p ? p.valorKm : '',
      kmPrevista: numOuVazio_(s.kmPrevista), kmReal: r.km, motivoReal: r.motivo, viagens: r.viagens,
      escolha: String(s.kmCobranca || ''), kmCobrado: numOuVazio_(s.kmCobrado), definidoPor: String(s.kmDefinidoPor || ''),
      definidoEm: dataTexto_(s.kmDefinidoEm), obs: String(s.kmObs || ''),
      noBm: !!fat[s.id], pendente: !!p && prontaParaBm_(s) && !s.kmCobranca && !fat[s.id] };
  });
  return out;
}

/** O solicitante escolhe o km cobrado: x = {id, escolha: 'Real'|'Previsto', obs}. */
function solDefinirKm_(x, u) {
  x = x || {};
  const s = porId_('Solicitacoes', x.id); if (!s) return erroDados_('Solicitação não encontrada. Atualize a página.');
  if (!veUnidade_(u, s.unidadeId)) return semPermissao_('Você não tem acesso a esta unidade.');
  const escolha = String(x.escolha || ''); if (KM_ESCOLHAS.indexOf(escolha) < 0) return erroDados_('Escolha o km real ou o km previsto.');
  const fat = faturamentoPorSolicitacao_()[s.id];
  if (fat) return erroDados_('A coleta já está no BM ' + (fat.bmNumero || 's/nº') + '. Para mudar o km, o Faturamento precisa cancelar o BM.');
  if (!prontaParaBm_(s)) return erroDados_(s.status === 'Realizada' ? 'O km é definido depois da confirmação da destinação no Controle de Destinação.' : 'Só dá para definir o km de coleta realizada que ainda não foi para o BM.');
  const info = infoKm_([s])[s.id];
  if (!info || !info.precoId) return erroDados_('O cliente não tem preço de transporte por km rodado vigente na data da coleta.');
  const km = escolha === 'Real' ? info.kmReal : info.kmPrevista;
  if (escolha === 'Real' && km === '') return erroDados_('Sem km real: ' + info.motivoReal);
  if (escolha === 'Previsto' && !(km > 0)) return erroDados_('A solicitação não tem km prevista.');
  atualizar_('Solicitacoes', s.id, { kmCobranca: escolha, kmCobrado: km, kmDefinidoPor: String(u.nome || u.email || ''), kmDefinidoEm: dataTexto_(new Date()),
    kmObs: String(x.obs || '').trim() }, u, 'solicitacoes', { registroNome: rotuloSol_(s) });
  return { ok: true, km: km };
}

/** Aviso ao solicitante (quem registrou) de que a coleta espera a escolha do km. */
function avisarDefinirKm_(s) {
  if (!s || s.kmCobranca || !precoKmVigente_(s.clienteId, dataRefKm_(s))) return;
  const email = String(s.criadoPor || '').indexOf('@') > 0 ? normEmail_(s.criadoPor) : '';
  if (!email || !aceitaEmail_(email, 'km')) return;
  const info = infoKm_([s])[s.id] || {};
  const cliente = nomeCad_(s.clienteId), d = function (x) { return dataTexto_(x).split('-').reverse().join('/'); };
  const linhas = ['Cliente: ' + cliente, 'Coleta: ' + (d(s.dataColeta) || '—'),
    'Km previsto: ' + (info.kmPrevista !== '' ? info.kmPrevista + ' km' : '—'),
    'Km real (odômetro): ' + (info.kmReal !== '' ? info.kmReal + ' km' : 'sem registro — ' + info.motivoReal)];
  try {
    MailApp.sendEmail({ to: email, subject: 'Definir o km da cobrança · ' + cliente + ' · ' + (d(s.dataColeta) || ''),
      body: 'Olá.\n\nA coleta de ' + cliente + ' foi destinada e o cliente paga o transporte por km rodado. Escolha no portal qual km vai para o BM (real ou previsto):\n\n' +
            linhas.join('\n') + '\n\nAbrir: ' + URL_PORTAL + 'solicitacoes/\n\n(Mensagem automática do Portal Grupo GVC. Para não receber, peça para desligar na sua ficha em Pessoas.)' });
  } catch (e) { /* sem cota de e-mail: a escolha continua pendente na fila */ }
}

/* ---------------- migração (ESQUEMA 11) ---------------- */
function migrarKm_() {
  migrarCabecalho_('Solicitacoes');
  const listas = ler_('Listas');
  [['modalidadePreco', MODALIDADES_KM], ['unidadeMedida', ['km']]].forEach(function (par) {
    const atuais = listas.filter(function (x) { return x.lista === par[0]; });
    par[1].forEach(function (val, i) {
      if (!atuais.some(function (x) { return String(x.valor) === val; })) inserir_('Listas', { lista: par[0], valor: val, ordem: atuais.length + i + 1, ativo: true }, null, null);
    });
  });
  HIST_BUF_.push([new Date(), '', 'sistema', 'solicitacoes', 'Solicitacoes', '', '', 'migrou', '', '', '', 'Cobrança por km rodado: modalidades de preço novas e escolha do km pelo solicitante.']);
}
