/* =====================================================================
 * Portal GVC — tabela com filtro no cabeçalho (como no Excel) e exportação
 * (Excel, CSV e PDF) do que está na tela. Uma peça só, usada por todos os módulos.
 *
 *   const T = Portal.tabela('sol-todas', COLUNAS, { titulo, arquivo, aoMudar, filtrosExtras, totais, subtitulo });
 *   const lista = T.aplicar(listaDaTela);           // filtros das colunas + ordem
 *   html: T.botao()  ·  T.info(lista.length, listaDaTela.length)  ·  <thead>${T.cab('<th></th>')}</thead>
 *   depois de pôr o HTML na página: T.ligar();
 *
 * Coluna: { k, label, v: linha => texto, ord?: linha => valor para ordenar, num?: true, cls?: 'classe',
 *           x?: linha => valor na exportação, exp?: false (não exporta), filtro?: false (sem filtro) }
 * ===================================================================== */
(function () {
  const REG = {};
  const VAZIO = '(Vazias)';
  const LIB = {
    xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
    pdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    pdfTab: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.7.1/jspdf.plugin.autotable.min.js',
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ICO_FILTRO = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.6 5.4V13l-2.8-1.4V8.4z" fill="currentColor"/></svg>';
  const ICO_SETA = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let cssPronto = false;
  function css() {
    if (cssPronto) return; cssPronto = true;
    const st = document.createElement('style');
    st.textContent = `
th .fh{all:unset;display:inline-flex;align-items:center;gap:5px;cursor:pointer;font:inherit;letter-spacing:inherit;text-transform:inherit;color:inherit;border-radius:4px;padding:2px 4px;margin:-2px -4px}
th .fh:hover{color:var(--ink,#14211b);background:var(--line-soft,#e6ebe7)}
th .fh:focus-visible{outline:2px solid var(--accent,#1d6b52);outline-offset:1px}
th .fh .fi{display:inline-grid;place-items:center;width:16px;height:16px;border:1px solid var(--line,#d8dfda);border-radius:3px;background:var(--surface,#fff);flex-shrink:0}
th .fh .fi svg{width:11px;height:11px}
th .fh.on{color:var(--accent,#1d6b52)}
th .fh.on .fi{border-color:var(--accent,#1d6b52);background:var(--accent-soft,#dcefe6)}
.fpop{position:absolute;z-index:60;background:var(--surface,#fff);color:var(--ink,#14211b);border:1px solid var(--line,#d8dfda);border-radius:var(--r,6px);box-shadow:0 10px 30px rgba(0,0,0,.18);padding:8px;display:flex;flex-direction:column;gap:6px;font-size:13.5px;text-transform:none;letter-spacing:0;font-family:var(--f-body,"IBM Plex Sans",system-ui,sans-serif)}
.fpop .fp-ord{display:flex;flex-direction:column;border-bottom:1px solid var(--line-soft,#e6ebe7);padding-bottom:6px}
.fpop .fp-o{all:unset;cursor:pointer;padding:6px 8px;border-radius:4px}
.fpop .fp-o:hover,.fpop .fp-o:focus-visible{background:var(--sunken,#edf1ee)}
.fpop .fp-busca{width:100%;box-sizing:border-box}
.fpop .fp-lista{max-height:240px;overflow:auto;border:1px solid var(--line-soft,#e6ebe7);border-radius:4px;padding:4px}
.fpop .fp-lista label{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:4px;cursor:pointer;font-weight:500;text-transform:none;letter-spacing:0;font-size:13px;color:var(--ink,#14211b)}
.fpop .fp-lista label[hidden]{display:none}
.fpop .fp-lista label:hover{background:var(--sunken,#edf1ee)}
.fpop .fp-lista input{width:auto;margin:0}
.fpop .fp-lista span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fpop .fp-lista em{font-style:normal;color:var(--ink-3,#77857d);font-size:12px}
.fpop .fp-all{border-bottom:1px solid var(--line-soft,#e6ebe7);border-radius:0 !important}
.fpop .fp-bot{display:flex;gap:6px;align-items:center}
.filtro-info{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 8px;padding:6px 10px;border-radius:var(--r,6px);background:var(--accent-soft,#dcefe6);font-size:13px}
.filtro-info span{flex:1}
td.empty{text-align:center;color:var(--ink-3,#77857d);padding:18px}
.exp-wrap{position:relative;display:inline-block}
.exp-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:40;background:var(--surface,#fff);border:1px solid var(--line,#d8dfda);border-radius:var(--r,6px);box-shadow:0 10px 30px rgba(0,0,0,.14);min-width:240px;display:flex;flex-direction:column;overflow:hidden}
.exp-menu[hidden]{display:none}
.exp-menu .exp-info{padding:10px 14px;font-size:12px;color:var(--ink-2,#4b5a52);background:var(--sunken,#edf1ee);border-bottom:1px solid var(--line,#d8dfda);line-height:1.45}
.exp-menu .exp-info b{color:var(--ink,#14211b)}
.exp-menu .exp-info .tag-f{display:inline-block;background:var(--warn-bg,#fff3dc);color:var(--warn,#a86400);border-radius:8px;padding:0 6px;font-weight:600}
.exp-menu button{background:none;border:0;border-bottom:1px solid var(--line-soft,#e6ebe7);padding:10px 14px;text-align:left;font:500 13px var(--f-body,"IBM Plex Sans",system-ui,sans-serif);color:var(--ink,#14211b);cursor:pointer}
.exp-menu button:last-child{border-bottom:0}
.exp-menu button:hover,.exp-menu button:focus-visible{background:var(--accent-soft,#dcefe6);color:var(--accent,#1d6b52);outline:none}
@media (max-width:640px){.exp-menu{right:auto;left:0}}`;
    document.head.appendChild(st);
  }

  const carregados = {};
  function carregarScript(src) {
    if (carregados[src]) return carregados[src];
    return (carregados[src] = new Promise((ok, erro) => {
      const s = document.createElement('script'); s.src = src;
      s.onload = () => ok(); s.onerror = () => { delete carregados[src]; erro(new Error('lib')); };
      document.head.appendChild(s);
    }));
  }
  function aviso(msg) {
    if (typeof window.toast === 'function') { window.toast(msg); return; }
    const t = document.getElementById('toast');
    if (t) { t.textContent = msg; t.hidden = false; clearTimeout(aviso.h); aviso.h = setTimeout(() => { t.hidden = true; }, 3200); } else alert(msg);
  }
  function baixar(blob, nome) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 800);
  }
  const hojeArq = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  function fecharFiltro() {
    const p = document.getElementById('fpop'); if (p) p.remove();
    document.removeEventListener('mousedown', fecharFora, true); document.removeEventListener('keydown', escFiltro, true);
  }
  function fecharFora(ev) { const p = document.getElementById('fpop'); if (p && !p.contains(ev.target) && !ev.target.closest('[data-fcol]')) fecharFiltro(); }
  function escFiltro(ev) {
    if (ev.key !== 'Escape') return;
    const p = document.getElementById('fpop'); const k = p && p.dataset;
    fecharFiltro();
    const b = k && document.querySelector(`[data-tb="${k.tb}"][data-fcol="${k.col}"]`); if (b) b.focus();
  }

  function criar(id) {
    const T = { id, cols: [], opc: {}, filtros: {}, ordem: null, base: [] };
    const cols = () => T.cols;
    const vazioDe = c => c.vazio || VAZIO;
    const txt = (c, x) => { const v = c.v(x); return v === '' || v == null || v === '—' ? vazioDe(c) : String(v); };
    const valOrd = (c, x) => c.ord ? c.ord(x) : c.num ? (Number(String(c.v(x)).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0) : txt(c, x);
    const cmp = (a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'pt-BR', { numeric: true });
    T.passa = (x, exceto) => cols().every(c => c.k === exceto || !T.filtros[c.k] || T.filtros[c.k].has(txt(c, x)));
    T.temFiltro = () => Object.keys(T.filtros).length > 0 || !!T.ordem;
    T.aplicar = lista => {
      T.base = lista || [];
      // filtro de uma coluna que não existe mais (ou valor que sumiu de vez) não fica preso
      Object.keys(T.filtros).forEach(k => { if (!cols().some(c => c.k === k)) delete T.filtros[k]; });
      let out = T.base.filter(x => T.passa(x));
      const c = T.ordem && cols().find(y => y.k === T.ordem.k);
      if (c) out = out.slice().sort((a, b) => T.ordem.dir * cmp(valOrd(c, a), valOrd(c, b)));
      return out;
    };
    T.cab = (extraFim, extraIni) => '<tr>' + (extraIni || '') + cols().map(c => {
      if (c.filtro === false) return `<th class="${c.num ? 'num' : ''}${c.cls ? ' ' + c.cls : ''}">${esc(c.label)}</th>`;
      const on = !!T.filtros[c.k], ord = T.ordem && T.ordem.k === c.k ? (T.ordem.dir > 0 ? ' ↑' : ' ↓') : '';
      return `<th class="${c.num ? 'num' : ''}${c.cls ? ' ' + c.cls : ''}"><button type="button" class="fh${on || ord ? ' on' : ''}" data-tb="${esc(id)}" data-fcol="${esc(c.k)}" aria-haspopup="dialog" aria-label="Filtrar ou ordenar a coluna ${esc(c.label)}${on ? ' (filtro ativo)' : ''}">${esc(c.label)}${ord}<span class="fi">${on ? ICO_FILTRO : ICO_SETA}</span></button></th>`;
    }).join('') + (extraFim || '') + '</tr>';
    T.info = (nVis, nTotal) => T.temFiltro()
      ? `<div class="filtro-info"><span>${nVis} de ${nTotal} ${nTotal === 1 ? 'linha' : 'linhas'} com os filtros das colunas</span><button type="button" class="btn sm" data-tb-limpar="${esc(id)}">Limpar filtros</button></div>` : '';
    T.botao = (rotulo) => `<span class="exp-wrap"><button class="btn sm" type="button" data-tb-exp="${esc(id)}" aria-haspopup="menu" aria-expanded="false">${esc(rotulo || '↓ Exportar')}</button>
      <span class="exp-menu" role="menu" data-tb-menu="${esc(id)}" hidden><span class="exp-info"></span>
      <button type="button" role="menuitem" data-fmt="xlsx">📊 Planilha Excel (.xlsx)</button><button type="button" role="menuitem" data-fmt="csv">📄 CSV</button><button type="button" role="menuitem" data-fmt="pdf">🖨 PDF</button></span></span>`;
    const mudou = () => { fecharFiltro(); if (T.opc.aoMudar) T.opc.aoMudar(); };
    T.limpar = () => { T.filtros = {}; T.ordem = null; mudou(); };

    T.ligar = () => {
      css();
      document.querySelectorAll(`[data-tb="${id}"][data-fcol]`).forEach(b => b.onclick = ev => {
        ev.stopPropagation(); ev.preventDefault();
        const ja = document.getElementById('fpop'); if (ja && ja.dataset.tb === id && ja.dataset.col === b.dataset.fcol) { fecharFiltro(); return; }
        abrir(cols().find(c => c.k === b.dataset.fcol), b);
      });
      document.querySelectorAll(`[data-tb-limpar="${id}"]`).forEach(b => b.onclick = T.limpar);
      document.querySelectorAll(`[data-tb-exp="${id}"]`).forEach(b => {
        const m = b.parentElement.querySelector(`[data-tb-menu="${id}"]`); if (!m) return;
        const fechar = () => { m.hidden = true; b.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', fora, true); };
        const fora = e => { if (!e.target.closest('.exp-wrap')) fechar(); };
        b.onclick = () => {
          if (!m.hidden) return fechar();
          const n = T.aplicar(T.base).length, tot = T.base.length, f = descricaoFiltros().length;
          m.querySelector('.exp-info').innerHTML = `Vão sair <b>${n} de ${tot}</b> ${esc(T.opc.unidade || 'linhas')}${f ? ' <span class="tag-f">com filtro</span>' : ''}`;
          m.hidden = false; b.setAttribute('aria-expanded', 'true'); document.addEventListener('mousedown', fora, true);
          const p = m.querySelector('button'); if (p) p.focus();
        };
        m.onkeydown = e => { if (e.key === 'Escape') { fechar(); b.focus(); } };
        m.querySelectorAll('[data-fmt]').forEach(x => x.onclick = () => { fechar(); T.exportar(x.dataset.fmt); });
      });
    };

    function abrir(col, btn) {
      fecharFiltro(); css();
      const cont = new Map(), rep = new Map();
      T.base.filter(x => T.passa(x, col.k)).forEach(x => { const t = txt(col, x); cont.set(t, (cont.get(t) || 0) + 1); if (!rep.has(t)) rep.set(t, valOrd(col, x)); });
      const vz = vazioDe(col);
      const valores = [...cont.keys()].sort((a, b) => a === vz ? 1 : b === vz ? -1 : cmp(rep.get(a), rep.get(b)));
      const atual = T.filtros[col.k];
      const sel = new Set(valores.filter(v => !atual || atual.has(v)));
      const az = col.num ? ['Menor → maior', 'Maior → menor'] : col.ord ? ['Crescente', 'Decrescente'] : ['A → Z', 'Z → A'];
      const p = document.createElement('div');
      p.id = 'fpop'; p.className = 'fpop'; p.dataset.tb = id; p.dataset.col = col.k; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Filtro da coluna ' + col.label);
      p.innerHTML = `<div class="fp-ord"><button type="button" class="fp-o" data-o="1">↑ Ordenar ${az[0]}</button><button type="button" class="fp-o" data-o="-1">↓ Ordenar ${az[1]}</button></div>
        <input type="search" class="fp-busca" placeholder="Pesquisar" aria-label="Pesquisar valores de ${esc(col.label)}">
        <div class="fp-lista">
          <label class="fp-all"><input type="checkbox" data-all> <span>(Selecionar tudo)</span></label>
          ${valores.map((v, i) => `<label data-txt="${esc(v.toLowerCase())}"><input type="checkbox" data-i="${i}" ${sel.has(v) ? 'checked' : ''}> <span>${esc(v)}</span><em>${cont.get(v)}</em></label>`).join('') || '<div style="padding:6px;color:var(--ink-3,#77857d)">Nenhum valor.</div>'}
        </div>
        <div class="fp-bot"><button type="button" class="btn sm" data-limpar ${atual || (T.ordem && T.ordem.k === col.k) ? '' : 'disabled'}>Limpar</button><span style="flex:1"></span><button type="button" class="btn sm" data-cancel>Cancelar</button><button type="button" class="btn sm pri" data-ok>OK</button></div>`;
      document.body.appendChild(p);
      const r = btn.getBoundingClientRect(), w = Math.min(290, window.innerWidth - 16);
      p.style.width = w + 'px';
      p.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + window.scrollX + 'px';
      p.style.top = r.bottom + 4 + window.scrollY + 'px';
      const busca = p.querySelector('.fp-busca'), all = p.querySelector('[data-all]'), ok = p.querySelector('[data-ok]');
      const caixas = [...p.querySelectorAll('[data-i]')];
      const visiveis = () => caixas.filter(c => !c.closest('label').hidden);
      const atualizar = () => { const vis = visiveis(), n = vis.filter(c => c.checked).length; all.checked = vis.length > 0 && n === vis.length; all.indeterminate = n > 0 && n < vis.length; ok.disabled = n === 0; };
      caixas.forEach(c => c.onchange = () => { const v = valores[+c.dataset.i]; c.checked ? sel.add(v) : sel.delete(v); atualizar(); });
      all.onchange = () => { visiveis().forEach(c => { c.checked = all.checked; const v = valores[+c.dataset.i]; all.checked ? sel.add(v) : sel.delete(v); }); atualizar(); };
      busca.oninput = () => {
        const q = busca.value.trim().toLowerCase();
        caixas.forEach(c => { const l = c.closest('label'); l.hidden = !!q && !l.dataset.txt.includes(q); if (q) c.checked = !l.hidden; });
        if (!q) caixas.forEach(c => c.checked = sel.has(valores[+c.dataset.i]));
        atualizar();
      };
      const aplicar = () => {
        const q = busca.value.trim();
        const escolhidos = q ? visiveis().filter(c => c.checked).map(c => valores[+c.dataset.i]) : valores.filter(v => sel.has(v));
        if (escolhidos.length === valores.length && !q) delete T.filtros[col.k]; else T.filtros[col.k] = new Set(escolhidos);
        mudou();
      };
      ok.onclick = aplicar;
      busca.onkeydown = ev => { if (ev.key === 'Enter' && !ok.disabled) aplicar(); };
      p.querySelector('[data-cancel]').onclick = () => { fecharFiltro(); btn.focus(); };
      p.querySelector('[data-limpar]').onclick = () => { delete T.filtros[col.k]; if (T.ordem && T.ordem.k === col.k) T.ordem = null; mudou(); };
      p.querySelectorAll('[data-o]').forEach(b => b.onclick = () => { T.ordem = { k: col.k, dir: +b.dataset.o }; mudou(); });
      atualizar();
      document.addEventListener('mousedown', fecharFora, true); document.addEventListener('keydown', escFiltro, true);
      busca.focus();
    }

    /* ---------- exportação ---------- */
    function descricaoFiltros() {
      const out = (T.opc.filtrosExtras ? T.opc.filtrosExtras() : []).filter(Boolean);
      Object.entries(T.filtros).forEach(([k, set]) => { const c = cols().find(x => x.k === k); out.push((c ? c.label : k) + ': ' + [...set].join(', ')); });
      if (T.ordem) { const c = cols().find(x => x.k === T.ordem.k); out.push('Ordenado por ' + (c ? c.label : T.ordem.k) + (T.ordem.dir > 0 ? ' (crescente)' : ' (decrescente)')); }
      return out;
    }
    T.descricaoFiltros = descricaoFiltros;
    const colsExp = () => cols().filter(c => c.exp !== false).concat(T.opc.extrasExport || []);
    const valExp = (c, x) => {
      if (c.x) { const v = c.x(x); return v == null ? '' : v; }
      if (c.num) { const v = valOrd(c, x); return typeof v === 'number' ? v : ''; }
      const t = c.v(x); return t == null || t === '—' ? '' : String(t);
    };
    function dados() {
      const lista = T.aplicar(T.base);
      const cs = colsExp();
      const linhas = lista.map(x => { const o = {}; cs.forEach(c => { o[c.label] = valExp(c, x); }); return o; });
      const filtros = descricaoFiltros();
      const tot = T.opc.totais ? T.opc.totais(lista) : null;
      const nome = (T.opc.arquivo || id) + '-' + hojeArq() + (filtros.length ? '-filtrado' : '');
      return { lista, cs, linhas, filtros, tot, nome };
    }
    T.exportar = async fmt => {
      const d = dados();
      if (!d.linhas.length) { aviso('Nenhuma linha na tela para exportar. Confira os filtros.'); return; }
      try {
        if (fmt === 'csv') return exportarCsv(d);
        if (fmt === 'xlsx') { await carregarScript(LIB.xlsx); return exportarXlsx(d); }
        if (fmt === 'pdf') { await carregarScript(LIB.pdf); await carregarScript(LIB.pdfTab); return exportarPdf(d); }
      } catch (e) { aviso('Não consegui gerar o arquivo. Verifique a internet e tente de novo.'); }
    };
    function linhaTotal(d) {
      if (!d.tot) return null;
      const o = {}; d.cs.forEach((c, i) => { o[c.label] = c.label in d.tot ? d.tot[c.label] : (i === 0 ? 'TOTAL' : ''); }); return o;
    }
    function exportarCsv(d) {
      const cab = d.cs.map(c => c.label);
      const cel = v => { if (typeof v === 'number') v = String(v).replace('.', ','); v = String(v == null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const linhas = d.linhas.slice(); const t = linhaTotal(d); if (t) linhas.push(t);
      const csv = '﻿' + [cab.join(';')].concat(linhas.map(r => cab.map(k => cel(r[k])).join(';'))).join('\n');
      baixar(new Blob([csv], { type: 'text/csv;charset=utf-8' }), d.nome + '.csv');
    }
    function exportarXlsx(d) {
      const X = window.XLSX;
      const linhas = d.linhas.slice(); const t = linhaTotal(d); if (t) linhas.push(t);
      const ws = X.utils.json_to_sheet(linhas, { header: d.cs.map(c => c.label) });
      ws['!cols'] = d.cs.map(c => ({ wch: Math.min(48, Math.max(8, c.label.length + 2, ...linhas.map(r => String(r[c.label] == null ? '' : r[c.label]).length + 1))) }));
      const rng = X.utils.decode_range(ws['!ref']);
      d.cs.forEach((c, ci) => { if (!c.fmt) return; for (let r = 1; r <= rng.e.r; r++) { const cel = ws[X.utils.encode_cell({ r, c: ci })]; if (cel && cel.t === 'n') cel.z = c.fmt; } });
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, String(T.opc.aba || T.opc.titulo || 'Dados').slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
      const fr = [{ Item: 'Tabela', Valor: T.opc.titulo || id }];
      const sub = T.opc.subtitulo ? T.opc.subtitulo() : ''; if (sub) fr.push({ Item: 'Recorte', Valor: sub });
      fr.push({ Item: 'Exportado em', Valor: new Date().toLocaleString('pt-BR') }, { Item: 'Linhas exportadas', Valor: d.lista.length + ' de ' + T.base.length });
      if (!d.filtros.length) fr.push({ Item: 'Filtros', Valor: 'Nenhum filtro nas colunas' });
      d.filtros.forEach((f, i) => fr.push({ Item: i ? '' : 'Filtros', Valor: f }));
      const ws2 = X.utils.json_to_sheet(fr); ws2['!cols'] = [{ wch: 20 }, { wch: 90 }];
      X.utils.book_append_sheet(wb, ws2, 'Filtros');
      X.writeFile(wb, d.nome + '.xlsx');
    }
    function exportarPdf(d) {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(20, 33, 27);
      doc.text(T.opc.titulo || id, 14, 15);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(90, 105, 98);
      const sub = T.opc.subtitulo ? T.opc.subtitulo() : '';
      doc.text([sub, `Exportado em ${new Date().toLocaleString('pt-BR')} · ${d.lista.length} de ${T.base.length} ${T.opc.unidade || 'linhas'}`].filter(Boolean).join(' · '), 14, 21);
      const ft = doc.splitTextToSize(d.filtros.length ? 'Filtros: ' + d.filtros.join(' · ') : 'Sem filtro nas colunas', 268);
      doc.text(ft.slice(0, 3), 14, 26);
      const cs = d.cs.filter(c => c.pdf !== false);
      const fmtN = v => typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) : String(v == null ? '' : v);
      const body = d.linhas.map(r => cs.map(c => fmtN(r[c.label])));
      const t = linhaTotal(d); if (t) body.push(cs.map(c => fmtN(t[c.label])));
      doc.autoTable({
        startY: 27 + Math.min(3, ft.length) * 3.6, head: [cs.map(c => c.label)], body,
        styles: { font: 'helvetica', fontSize: cs.length > 10 ? 6.5 : 7.5, cellPadding: 1.8, textColor: [20, 33, 27], lineColor: [216, 223, 218], lineWidth: 0.2, overflow: 'linebreak' },
        headStyles: { fillColor: [29, 107, 82], textColor: [255, 255, 255], fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 247, 245] },
        columnStyles: Object.fromEntries(cs.map((c, i) => [i, c.num ? { halign: 'right' } : {}])),
        margin: { left: 14, right: 14 },
        didParseCell: h => { if (t && h.section === 'body' && h.row.index === body.length - 1) { h.cell.styles.fontStyle = 'bold'; h.cell.styles.fillColor = [220, 239, 230]; } },
      });
      doc.save(d.nome + '.pdf');
    }
    return T;
  }

  function tabela(id, colunas, opc) {
    css();
    const T = REG[id] || (REG[id] = criar(id));
    T.cols = colunas || []; T.opc = opc || {};
    return T;
  }
  function boot() {
    if (!window.Portal) { setTimeout(boot, 20); return; }
    window.Portal.tabela = tabela; window.Portal.fecharFiltroTabela = fecharFiltro; window.Portal.carregarScript = carregarScript;
  }
  boot();
})();
