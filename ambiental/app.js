/* Portal GVC — módulo Ambiental: MTRs (coleta de cliente e operação interna) e registro do CDF. */
(function () {
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const D = iso => iso ? iso.split('-').reverse().join('/') : '';
const N = v => v === '' || v == null ? '' : (+v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const isoDe = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const hojeISO = () => isoDe(new Date());
const addMes = (m, n) => { let y = +m.slice(0, 4), mm = +m.slice(5, 7) + n; while (mm < 1) { mm += 12; y--; } while (mm > 12) { mm -= 12; y++; } return y + '-' + String(mm).padStart(2, '0'); };
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesCurto = m => MESES[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4);
const diasEntre = (a, b) => a && b ? Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5) : '';
const NIVEL_LBL = { leitor: 'Leitor', editor: 'Editor', admin: 'Administrador' };
const TABS = ['mtrs', 'cdfs', 'dest'];
const S = { tab: 'mtrs', d: null, ro: true, uni: '', sel: {}, ind: '', de: addMes(hojeISO().slice(0, 7), -2), ate: hojeISO().slice(0, 7), busca: '' };

function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => t.hidden = true, 3800); }
window.toast = toast;
function setSync(ok, txt) { const s = $('#sync'); s.classList.toggle('on', ok); s.querySelector('span').textContent = txt; }
function falha(e) { toast((e && e.mensagem) || 'Não foi possível salvar. Verifique a internet e tente de novo.'); }
const opts = (lista, sel, vazio) => (vazio !== undefined ? `<option value="">${esc(vazio)}</option>` : '') + lista.map(v => { const [val, lbl] = Array.isArray(v) ? v : [v, v]; return `<option value="${esc(val)}" ${String(val) === String(sel ?? '') ? 'selected' : ''}>${esc(lbl)}</option>`; }).join('');
/** Janela simples: campos + html livre. Devolve os valores ou null. */
function janela(titulo, campos, okTxt, html, ligar) {
  return new Promise(res => {
    const ov = document.createElement('div'); ov.className = 'dlg-ov';
    ov.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-label="${esc(titulo)}"><h3>${esc(titulo)}</h3>${html || ''}
      ${campos.map((c, i) => `<div class="fld"><label for="dlg-${i}">${esc(c.rotulo)}</label>${c.tipo === 'area' ? `<textarea id="dlg-${i}" rows="2">${esc(c.valor || '')}</textarea>` : `<input id="dlg-${i}" type="${c.tipo || 'text'}" value="${esc(c.valor ?? '')}" ${c.max ? `max="${c.max}"` : ''}>`}</div>`).join('')}
      <div class="row" style="justify-content:flex-end;margin-top:12px;gap:8px">${okTxt ? '<button class="btn" data-x>Voltar</button><button class="btn pri" data-ok>' + esc(okTxt) + '</button>' : '<button class="btn" data-x>Fechar</button>'}</div></div>`;
    document.body.appendChild(ov);
    const fim = v => { ov.remove(); res(v); };
    ov.querySelector('[data-x]').onclick = () => fim(null);
    ov.onclick = e => { if (e.target === ov) fim(null); };
    ov.addEventListener('keydown', e => { if (e.key === 'Escape') fim(null); });
    const ok = ov.querySelector('[data-ok]');
    if (ok) ok.onclick = () => fim({ campos: campos.map((c, i) => ov.querySelector('#dlg-' + i).value.trim()), ov });
    if (ligar) ligar(ov, fim);
    setTimeout(() => { const f = ov.querySelector('input,textarea') || ov.querySelector('[data-x]'); if (f) f.focus(); }, 30);
  });
}

/* ---------- dados ---------- */
const nome = id => (S.d.nomes || {})[id] || id || '';
const resNome = id => ((S.d.residuos || []).find(r => r.id === id) || {}).nome || '';
const uniNome = id => (S.d.todasUnidades.find(u => u.id === id) || {}).nome || '';
const cdfDe = id => (S.d.cdfs || []).find(c => c.id === id) || null;
const passaUni = m => !S.uni || m.unidadeId === S.uni;
const dataRef = m => m.dataDestinacao || m.dataColeta || '';
const noPeriodo = m => { const r = dataRef(m).slice(0, 7); return !r || ((!S.de || r >= S.de) && (!S.ate || r <= S.ate)); };
function enriquecer() {
  const hoje = S.d.hoje || hojeISO(), prazo = S.d.prazoCdf || 30;
  S.d.mtrs.forEach(m => {
    m.semCdf = m.situacao === 'Destinado' && !m.cdfId;
    m.diasSemCdf = m.semCdf && m.dataDestinacao ? diasEntre(m.dataDestinacao, hoje) : '';
    m.atrasado = m.semCdf && m.diasSemCdf !== '' && m.diasSemCdf > prazo;
    m.residuos = m.residuoIds.map(resNome).filter(Boolean).join(', ');
  });
}
async function carregar(silencioso) {
  if (!silencioso) setSync(false, 'Carregando…');
  try {
    S.d = await Portal.api('amb.dados', {});
    S.ro = !Portal.podeEditar('ambiental');
    enriquecer();
    setSync(true, (S.ro ? 'Somente leitura · ' : '') + 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
    montarUnidades(); render();
  } catch (e) {
    setSync(false, 'Sem conexão');
    if (!S.d) $('#main').innerHTML = `<section class="panel"><h2>Não consegui carregar os MTRs</h2><p class="sub">${esc((e && e.mensagem) || 'Verifique a internet.')}</p><div class="row" style="margin-top:10px"><button class="btn pri" id="tentar">Tentar de novo</button></div></section>`;
    const t = $('#tentar'); if (t) t.onclick = () => carregar();
  }
}
function montarUnidades() {
  const us = S.d.unidades; const box = $('#uni-box'), sel = $('#uni-sel');
  if (us.length <= 1) { box.hidden = true; S.uni = ''; return; }
  box.hidden = false; sel.innerHTML = opts([['', 'Todas'], ...us.map(u => [u.id, u.nome])], S.uni);
  sel.onchange = () => { S.uni = sel.value; S.sel = {}; render(); };
}
function setTab(t) {
  if (!TABS.includes(t)) t = 'mtrs';
  S.tab = t;
  $$('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  if (location.hash !== '#' + t) history.replaceState(null, '', '#' + t);
  render(); scrollTo({ top: 0 });
}
$$('nav.tabs button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
function render() {
  if (!S.d) return;
  const sem = S.d.mtrs.filter(m => m.semCdf && passaUni(m)).length;
  const ct = $('#ct-sem'); ct.textContent = sem; ct.classList.toggle('alert', S.d.mtrs.some(m => m.atrasado && passaUni(m)));
  ({ mtrs: renderMtrs, cdfs: renderCdfs, dest: renderDest })[S.tab]();
}
function periodoHTML() {
  const meses = [...new Set(S.d.mtrs.map(m => dataRef(m).slice(0, 7)).filter(Boolean).concat([hojeISO().slice(0, 7)]))].sort().reverse();
  return `<span class="periodo"><span class="sub" style="margin:0">De</span><select id="p-de" aria-label="De">${opts(meses.map(m => [m, mesCurto(m)]), S.de, 'início')}</select>
    <span class="sub" style="margin:0">até</span><select id="p-ate" aria-label="Até">${opts(meses.map(m => [m, mesCurto(m)]), S.ate, 'hoje')}</select></span>`;
}
function ligarPeriodo() {
  const de = $('#p-de'), ate = $('#p-ate');
  if (de) de.onchange = () => { S.de = de.value; S.sel = {}; render(); };
  if (ate) ate.onchange = () => { S.ate = ate.value; S.sel = {}; render(); };
}

/* ---------- MTRs ---------- */
const SIT = m => m.situacao === 'Pendente' ? 'A destinar' : m.cdfId ? 'Com CDF' : m.atrasado ? 'Sem CDF (atrasado)' : 'Sem CDF';
const SIT_CLS = { 'A destinar': 'warn', 'Com CDF': 'ok', 'Sem CDF (atrasado)': 'crit', 'Sem CDF': '' };
const COLS_MTR = [
  { k: 'mtr', label: 'MTR', v: m => m.mtr },
  { k: 'dst', label: 'Destinação', v: m => D(m.dataDestinacao), ord: m => m.dataDestinacao || '', vazio: '(a destinar)' },
  { k: 'dest', label: 'Destinador', v: m => nome(m.destinadorId) },
  { k: 'ger', label: 'Gerador', v: m => m.gerador },
  { k: 'sit', label: 'Situação', v: SIT },
  { k: 'cdf', label: 'CDF', v: m => m.cdfId ? (cdfDe(m.cdfId) || {}).numero || '' : '', vazio: '(sem CDF)' },
  { k: 'dias', label: 'Dias sem CDF', v: m => m.diasSemCdf === '' ? '' : String(m.diasSemCdf), ord: m => m.diasSemCdf === '' ? -1 : m.diasSemCdf, num: true },
  { k: 'kg', label: 'kg ticket', v: m => N(m.kg), ord: m => +m.kg || 0, num: true, x: m => m.kg === '' ? '' : +m.kg, fmt: '#,##0.##' },
  { k: 'kgm', label: 'kg MTR', v: m => N(m.kgMtr || ''), ord: m => +m.kgMtr || 0, num: true, x: m => m.kgMtr === '' ? '' : +m.kgMtr || '', fmt: '#,##0.##' },
  { k: 'res', label: 'Resíduos', v: m => m.residuos },
  { k: 'col', label: 'Coleta', v: m => D(m.dataColeta), ord: m => m.dataColeta || '' },
  { k: 'fon', label: 'Descarte', v: m => m.fonte === 'Coleta de cliente' ? 'Coleta' : 'Interno' },
];
const EXTRAS_MTR = [{ label: 'Unidade', x: m => uniNome(m.unidadeId) }, { label: 'Data do CDF', x: m => m.cdfId ? D((cdfDe(m.cdfId) || {}).data) : '' },
  { label: 'Tickets', x: m => m.tickets.join(', ') }, { label: 'Placa', x: m => m.placa }, { label: 'Negócio', x: m => m.negocio }, { label: 'Divergência', x: m => m.divergencia }];
const INDS = [
  ['', 'MTRs no período', () => true, ''],
  ['adest', 'A destinar', m => m.situacao === 'Pendente', 'warn'],
  ['semcdf', 'Destinados sem CDF', m => m.semCdf, ''],
  ['atraso', 'CDF atrasado', m => m.atrasado, 'crit'],
  ['comcdf', 'Com CDF', m => !!m.cdfId, 'ok'],
];
const tbMtr = () => Portal.tabela('amb-mtrs', COLS_MTR, { titulo: 'MTRs', arquivo: 'ambiental-mtrs', unidade: 'MTRs', aoMudar: render, extrasExport: EXTRAS_MTR,
  subtitulo: () => [S.uni ? 'Unidade: ' + uniNome(S.uni) : '', 'Período: ' + (S.de ? mesCurto(S.de) : 'início') + ' a ' + (S.ate ? mesCurto(S.ate) : 'hoje')].filter(Boolean).join(' · '),
  filtrosExtras: () => [S.ind && 'Indicador: ' + INDS.find(i => i[0] === S.ind)[1], S.busca && 'Busca: "' + S.busca + '"'].filter(Boolean),
  totais: l => ({ 'kg MTR': l.reduce((t, m) => t + (+m.kgMtr || 0), 0), 'kg ticket': l.reduce((t, m) => t + (+m.kg || 0), 0) }) });
function renderMtrs() {
  const base = S.d.mtrs.filter(m => passaUni(m) && (noPeriodo(m) || m.situacao === 'Pendente'));
  const prazo = S.d.prazoCdf || 30;
  const q = S.busca.trim().toLowerCase();
  const listaTela = base.filter(m => (!S.ind || INDS.find(i => i[0] === S.ind)[2](m)) &&
    (!q || [m.mtr, m.gerador, nome(m.destinadorId), m.residuos, m.tickets.join(' '), (cdfDe(m.cdfId) || {}).numero].join(' ').toLowerCase().includes(q)))
    .sort((a, b) => (b.atrasado - a.atrasado) || String(dataRef(b)).localeCompare(String(dataRef(a))));
  const T = tbMtr(); const lista = T.aplicar(listaTela);
  const destinados = base.filter(m => m.situacao === 'Destinado').length, comCdf = base.filter(m => m.cdfId).length;
  const podeSel = m => !S.ro && m.semCdf;
  Object.keys(S.sel).forEach(k => { if (!lista.some(m => m.chave === k && podeSel(m))) delete S.sel[k]; });
  $('#main').innerHTML = `<section class="panel">
    <div class="panel-h"><div><h2>MTRs</h2><p class="sub">Todos os MTRs: coletas de clientes (vêm da Programação) e operação interna (lançados no Controle). Depois da destinação confirmada, registre o CDF emitido pelo destinador. Prazo para cobrar o CDF: ${prazo} dias depois da destinação.</p></div></div>
    <div class="inds">${INDS.map(([k, l, f, cls]) => { const n = base.filter(f).length;
      return `<button type="button" class="ind ${n ? cls : 'zero'}" data-ind="${k}" aria-pressed="${S.ind === k}"><span class="k">${esc(l)}</span><span class="v">${n}</span>${k === 'comcdf' && destinados ? `<span class="d">${Math.round(comCdf / destinados * 100)}% dos destinados</span>` : k === '' ? '<span class="d">a destinar entram sempre</span>' : ''}</button>`; }).join('')}</div>
    ${S.d.semMtr ? `<div class="al" style="margin-bottom:10px"><span class="pill warn">${S.d.semMtr}</span><b>lançamento(s) no Controle sem nº de MTR não aparecem aqui. Confira na aba Conferência do Controle de Destinação.</b></div>` : ''}
    <div class="toolbar">${periodoHTML()}<input type="search" id="busca" placeholder="Buscar MTR, gerador, destinador, ticket, CDF…" value="${esc(S.busca)}" aria-label="Buscar" style="max-width:340px">
      <span style="margin-left:auto">${T.botao()}</span></div>
    <div class="sel-bar" id="sel-bar" hidden></div>
    ${T.info(lista.length, listaTela.length)}
    ${listaTela.length ? `<div class="tbl-wrap rtw"><table class="rt"><thead>${T.cab('', S.ro ? '' : `<th class="sel"><input type="checkbox" id="sel-all" aria-label="Marcar os sem CDF da lista" title="Marcar os sem CDF da lista"></th>`)}</thead><tbody>
      ${lista.slice(0, 600).map(m => { const c = cdfDe(m.cdfId); const sit = SIT(m);
        return `<tr>${S.ro ? '' : `<td class="sel" data-label="">${podeSel(m) ? `<input type="checkbox" data-sel="${esc(m.chave)}" ${S.sel[m.chave] ? 'checked' : ''} aria-label="Marcar MTR ${esc(m.mtr)}">` : ''}</td>`}
        <td data-label="MTR" class="mono full"><b>${esc(m.mtr)}</b>${m.divergencia ? ` <span class="pill warn" title="${esc(m.divergencia)}">divergência</span>` : ''}</td>
        <td data-label="Destinação" class="mono">${esc(D(m.dataDestinacao) || '—')}</td>
        <td data-label="Destinador">${esc(nome(m.destinadorId))}</td>
        <td data-label="Gerador">${esc(m.gerador)}</td>
        <td data-label="Situação"><span class="pill st ${SIT_CLS[sit]}">${esc(sit)}</span></td>
        <td data-label="CDF">${c ? `<button type="button" class="cdf-link" data-cdf="${esc(c.id)}">${esc(c.numero)}</button> <span class="sub">${esc(D(c.data))}</span>` : '—'}${m.cdfParcial ? ' <span class="pill warn" title="Nem todos os lançamentos deste MTR estão no CDF">parcial</span>' : ''}</td>
        <td data-label="Dias sem CDF" class="num ${m.atrasado ? 'atraso' : ''}">${m.diasSemCdf === '' ? '' : m.diasSemCdf}</td>
        <td data-label="kg ticket" class="num">${N(m.kg) || '—'}</td>
        <td data-label="kg MTR" class="num">${N(m.kgMtr || '') || '—'}</td>
        <td data-label="Resíduos" class="wrap">${esc(m.residuos)}</td>
        <td data-label="Coleta" class="mono">${esc(D(m.dataColeta))}</td>
        <td data-label="Descarte">${m.fonte === 'Coleta de cliente' ? '<span class="pill">Coleta</span>' : '<span class="pill int">Interno</span>'}</td></tr>`; }).join('') || `<tr><td colspan="13" class="empty">Nenhum MTR com os filtros das colunas.</td></tr>`}
      </tbody></table></div>${lista.length > 600 ? `<p class="hint">Mostrando os 600 primeiros de ${lista.length}. Use o período, a busca ou os filtros (a exportação leva todos).</p>` : ''}`
      : `<div class="empty">${base.length ? 'Nenhum MTR com estes filtros.' : 'Nenhum MTR no período.'}</div>`}
  </section>`;
  T.ligar(); ligarPeriodo();
  const b = $('#busca'); b.oninput = () => { S.busca = b.value; const pos = b.selectionStart; render(); const nb = $('#busca'); nb.focus(); nb.setSelectionRange(pos, pos); };
  $$('[data-ind]').forEach(x => x.onclick = () => { S.ind = S.ind === x.dataset.ind ? '' : x.dataset.ind; S.sel = {}; render(); });
  $$('[data-cdf]').forEach(x => x.onclick = () => abrirCdf(x.dataset.cdf));
  $$('[data-sel]').forEach(c => c.onchange = () => { S.sel[c.dataset.sel] = c.checked; barraSel(); });
  const all = $('#sel-all'); if (all) all.onchange = () => { lista.filter(podeSel).forEach(m => { S.sel[m.chave] = all.checked; }); $$('[data-sel]').forEach(c => { c.checked = all.checked; }); barraSel(); };
  barraSel();
}
function barraSel() {
  const bar = $('#sel-bar'); if (!bar) return;
  const ms = S.d.mtrs.filter(m => S.sel[m.chave]);
  if (!ms.length) { bar.hidden = true; return; }
  const dests = [...new Set(ms.map(m => m.destinadorId))];
  const kg = ms.reduce((t, m) => t + (+m.kg || 0), 0);
  bar.hidden = false;
  bar.innerHTML = `<b>${ms.length} MTR(s) marcado(s)</b><span>${esc(dests.map(nome).join(', '))} · ${N(kg)} kg</span>
    ${dests.length > 1 ? '<span class="warn">Um CDF é de um destinador só: marque MTRs do mesmo destinador.</span>' : `<button type="button" class="btn sm pri" id="reg-cdf">Registrar CDF</button>`}
    <button type="button" class="btn sm" id="sel-limpar">Desmarcar</button>`;
  $('#sel-limpar').onclick = () => { S.sel = {}; render(); };
  const r = $('#reg-cdf'); if (r) r.onclick = () => registrarCdf(ms);
}
async function registrarCdf(ms) {
  const dest = ms[0].destinadorId;
  const html = `<p class="sub">${esc(nome(dest))} · ${ms.length} MTR(s): ${esc(ms.slice(0, 8).map(m => m.mtr).join(', '))}${ms.length > 8 ? '…' : ''}</p>
    <p class="hint">Se o CDF já foi registrado com este nº e data para o mesmo destinador, os MTRs entram nele.</p>`;
  const v = await janela('Registrar CDF', [{ rotulo: 'Nº do CDF' }, { rotulo: 'Data de emissão', tipo: 'date', valor: hojeISO(), max: hojeISO() }, { rotulo: 'Observação (opcional)', tipo: 'area' }], 'Registrar', html);
  if (!v) return;
  try {
    const r = await Portal.api('amb.cdf', { tipo: 'registrar', cdf: { numero: v.campos[0], data: v.campos[1], obs: v.campos[2], chaves: ms.map(m => m.chave) } });
    toast(r.novo ? 'CDF registrado em ' + ms.length + ' MTR(s)' : 'MTR(s) incluído(s) no CDF já registrado'); S.sel = {}; await carregar(true);
  } catch (e) { falha(e); }
}
async function abrirCdf(id) {
  const c = cdfDe(id); if (!c) return;
  const ms = S.d.mtrs.filter(m => m.cdfId === id);
  const kg = ms.reduce((t, m) => t + (+m.kg || 0), 0);
  const lista = `<p class="sub">${esc(nome(c.destinadorId))} · emitido em ${esc(D(c.data))} · ${ms.length} MTR(s) · ${N(kg)} kg${c.obs ? '<br>' + esc(c.obs) : ''}</p>
    <div class="mtr-lista">${ms.map(m => `<label>${S.ro ? '' : `<input type="checkbox" data-tira="${esc(m.chave)}" aria-label="Tirar do CDF">`}<span class="mono">${esc(m.mtr)}</span><span class="sub" style="margin:0">${esc(m.gerador)} · ${esc(D(m.dataDestinacao))} · ${N(m.kg)} kg</span></label>`).join('')}</div>
    ${S.ro ? '' : '<p class="hint">Marque os MTRs que não são deste CDF para tirá-los. Para desfazer tudo, use "Desfazer CDF".</p>'}
    <div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn sm" data-hist>Histórico</button>${S.ro ? '' : '<button type="button" class="btn sm danger" data-desf>Desfazer CDF</button>'}</div>`;
  const campos = S.ro ? [] : [{ rotulo: 'Nº do CDF', valor: c.numero }, { rotulo: 'Data de emissão', tipo: 'date', valor: c.data, max: hojeISO() }, { rotulo: 'Observação', tipo: 'area', valor: c.obs }];
  let desfazer = false;
  const v = await janela('CDF ' + c.numero, campos, S.ro ? '' : 'Salvar', lista, (ov, fim) => {
    ov.querySelector('[data-hist]').onclick = () => Portal.mostrarHistorico('Cdfs', c.id, 'CDF ' + c.numero + ' · ' + nome(c.destinadorId));
    const d = ov.querySelector('[data-desf]'); if (d) d.onclick = () => { if (confirm('Desfazer o CDF ' + c.numero + '? Os ' + ms.length + ' MTR(s) voltam para "sem CDF".')) { desfazer = true; fim({ desfazer: true }); } };
  });
  if (!v) return;
  try {
    if (desfazer) { await Portal.api('amb.cdf', { tipo: 'desfazer', cdf: { id: c.id } }); toast('CDF desfeito'); }
    else {
      const tirar = Array.from(v.ov.querySelectorAll('[data-tira]')).filter(x => x.checked).map(x => x.dataset.tira);
      await Portal.api('amb.cdf', { tipo: 'editar', cdf: { id: c.id, numero: v.campos[0], data: v.campos[1], obs: v.campos[2], remover: tirar } }); toast('CDF salvo');
    }
    await carregar(true);
  } catch (e) { falha(e); }
}

/* ---------- CDFs ---------- */
function renderCdfs() {
  const kgDe = id => S.d.mtrs.filter(m => m.cdfId === id).reduce((t, m) => t + (+m.kg || 0), 0);
  const listaTela = S.d.cdfs.filter(c => (!S.de || c.data.slice(0, 7) >= S.de) && (!S.ate || c.data.slice(0, 7) <= S.ate) && (!S.uni || S.d.mtrs.some(m => m.cdfId === c.id && passaUni(m))))
    .sort((a, b) => String(b.data).localeCompare(String(a.data)));
  const T = Portal.tabela('amb-cdfs', [
    { k: 'num', label: 'Nº do CDF', v: c => c.numero },
    { k: 'data', label: 'Emissão', v: c => D(c.data), ord: c => c.data },
    { k: 'dest', label: 'Destinador', v: c => nome(c.destinadorId) },
    { k: 'n', label: 'MTRs', v: c => String(c.mtrs), ord: c => c.mtrs, num: true },
    { k: 'kg', label: 'kg', v: c => N(kgDe(c.id)), ord: c => kgDe(c.id), num: true, x: c => kgDe(c.id), fmt: '#,##0.##' },
    { k: 'por', label: 'Registrado por', v: c => String(c.criadoPor || '') },
  ], { titulo: 'CDFs registrados', arquivo: 'ambiental-cdfs', unidade: 'CDFs', aoMudar: render, extrasExport: [{ label: 'Observação', x: c => c.obs }, { label: 'MTRs (nº)', x: c => S.d.mtrs.filter(m => m.cdfId === c.id).map(m => m.mtr).join(', ') }],
    subtitulo: () => 'Emissão: ' + (S.de ? mesCurto(S.de) : 'início') + ' a ' + (S.ate ? mesCurto(S.ate) : 'hoje'), totais: l => ({ 'MTRs': l.reduce((t, c) => t + c.mtrs, 0), 'kg': l.reduce((t, c) => t + kgDe(c.id), 0) }) });
  const lista = T.aplicar(listaTela);
  $('#main').innerHTML = `<section class="panel"><div class="panel-h"><div><h2>CDFs registrados</h2><p class="sub">Certificados de destinação final já recebidos dos destinadores. Para registrar um novo, marque os MTRs na aba MTRs.</p></div></div>
    <div class="toolbar">${periodoHTML()}<span style="margin-left:auto">${T.botao()}</span></div>
    ${T.info(lista.length, listaTela.length)}
    ${listaTela.length ? `<div class="tbl-wrap rtw"><table class="rt"><thead>${T.cab('<th></th>')}</thead><tbody>${lista.map(c => `<tr>
      <td data-label="Nº do CDF" class="full"><b>${esc(c.numero)}</b>${c.obs ? `<div class="sub">${esc(c.obs)}</div>` : ''}</td><td data-label="Emissão" class="mono">${esc(D(c.data))}</td>
      <td data-label="Destinador">${esc(nome(c.destinadorId))}</td><td data-label="MTRs" class="num">${c.mtrs}</td><td data-label="kg" class="num">${N(kgDe(c.id))}</td>
      <td data-label="Registrado por">${esc(c.criadoPor || '')}</td><td><button class="btn sm" data-cdf="${esc(c.id)}">${S.ro ? 'Ver' : 'Ver / editar'}</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nenhum CDF com os filtros das colunas.</td></tr>'}</tbody></table></div>`
      : '<div class="empty">Nenhum CDF registrado no período.</div>'}</section>`;
  T.ligar(); ligarPeriodo();
  $$('[data-cdf]').forEach(x => x.onclick = () => abrirCdf(x.dataset.cdf));
}

/* ---------- Por destinador ---------- */
function renderDest() {
  const base = S.d.mtrs.filter(m => passaUni(m) && m.situacao === 'Destinado' && noPeriodo(m));
  const por = {};
  base.forEach(m => { const x = por[m.destinadorId] || (por[m.destinadorId] = { id: m.destinadorId, n: 0, com: 0, sem: 0, atraso: 0, kg: 0, antigo: '' });
    x.n++; x.kg += +m.kg || 0; if (m.cdfId) x.com++; else { x.sem++; if (m.atrasado) x.atraso++; if (!x.antigo || m.dataDestinacao < x.antigo) x.antigo = m.dataDestinacao; } });
  const listaTela = Object.values(por).sort((a, b) => b.atraso - a.atraso || b.sem - a.sem);
  const T = Portal.tabela('amb-dest', [
    { k: 'dest', label: 'Destinador', v: x => nome(x.id) },
    { k: 'n', label: 'MTRs destinados', v: x => String(x.n), ord: x => x.n, num: true },
    { k: 'com', label: 'Com CDF', v: x => String(x.com), ord: x => x.com, num: true },
    { k: 'sem', label: 'Sem CDF', v: x => String(x.sem), ord: x => x.sem, num: true },
    { k: 'atr', label: 'Atrasados', v: x => String(x.atraso), ord: x => x.atraso, num: true },
    { k: 'ant', label: 'Mais antigo sem CDF', v: x => D(x.antigo), ord: x => x.antigo || '9' },
    { k: 'kg', label: 'kg destinados', v: x => N(x.kg), ord: x => x.kg, num: true, x: x => x.kg, fmt: '#,##0.##' },
  ], { titulo: 'CDF por destinador', arquivo: 'ambiental-por-destinador', unidade: 'destinadores', aoMudar: render,
    subtitulo: () => 'Destinação: ' + (S.de ? mesCurto(S.de) : 'início') + ' a ' + (S.ate ? mesCurto(S.ate) : 'hoje'),
    totais: l => ({ 'MTRs destinados': l.reduce((t, x) => t + x.n, 0), 'Com CDF': l.reduce((t, x) => t + x.com, 0), 'Sem CDF': l.reduce((t, x) => t + x.sem, 0), 'Atrasados': l.reduce((t, x) => t + x.atraso, 0), 'kg destinados': l.reduce((t, x) => t + x.kg, 0) }) });
  const lista = T.aplicar(listaTela);
  $('#main').innerHTML = `<section class="panel"><div class="panel-h"><div><h2>Por destinador</h2><p class="sub">Quem está devendo CDF. Clique numa linha para ver os MTRs sem CDF desse destinador.</p></div></div>
    <div class="toolbar">${periodoHTML()}<span style="margin-left:auto">${T.botao()}</span></div>
    ${T.info(lista.length, listaTela.length)}
    ${listaTela.length ? `<div class="tbl-wrap rtw"><table class="rt"><thead>${T.cab()}</thead><tbody>${lista.map(x => `<tr class="click" data-dest="${esc(x.id)}" tabindex="0">
      <td data-label="Destinador" class="full"><b>${esc(nome(x.id))}</b></td><td data-label="MTRs destinados" class="num">${x.n}</td><td data-label="Com CDF" class="num">${x.com}</td>
      <td data-label="Sem CDF" class="num">${x.sem}</td><td data-label="Atrasados" class="num ${x.atraso ? 'atraso' : ''}">${x.atraso}</td><td data-label="Mais antigo sem CDF" class="mono">${esc(D(x.antigo))}</td>
      <td data-label="kg destinados" class="num">${N(x.kg)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Nada com os filtros das colunas.</td></tr>'}</tbody></table></div>`
      : '<div class="empty">Nenhum MTR destinado no período.</div>'}</section>`;
  T.ligar(); ligarPeriodo();
  $$('[data-dest]').forEach(tr => { const ir = () => { const t = tbMtr(); t.filtros = { dest: new Set([nome(tr.dataset.dest)]) }; S.ind = 'semcdf'; setTab('mtrs'); };
    tr.onclick = ir; tr.onkeydown = e => { if (e.key === 'Enter') ir(); }; });
}

$('#btn-sair').onclick = () => Portal.sair();
$('#btn-atualizar').onclick = () => carregar();
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (TABS.includes(t) && t !== S.tab) setTab(t); });
(async function start() {
  let u;
  try { u = await Portal.exigir('ambiental'); }
  catch (e) { $('#main').innerHTML = `<section class="panel"><h2>Não consegui falar com o portal</h2><p class="sub">${esc((e && e.mensagem) || '')}</p></section>`; return; }
  const mostrar = us => { $('#u-box').hidden = false; $('#btn-atualizar').hidden = false; $('#u-nome').textContent = us.nome; $('#u-nivel').textContent = NIVEL_LBL[Portal.nivel('ambiental', us)] || ''; };
  mostrar(u); Portal.aoAtualizarUsuario = us => { mostrar(us); S.ro = !Portal.podeEditar('ambiental', us); render(); };
  const t = location.hash.slice(1); if (TABS.includes(t)) S.tab = t;
  $$('nav.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === S.tab));
  await carregar();
})();
})();
