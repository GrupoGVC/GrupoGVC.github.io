/* Portal Grupo GVC — sessão e acesso compartilhados pelos módulos.
 * Cada módulo carrega ../config.js e ../portal.js e chama Portal.exigir('nomeDoModulo').
 * A sessão (token) fica no navegador, na chave "gvc-portal", e vale para todos os módulos.
 */
(function () {
  const CHAVE = 'gvc-portal';
  // Raiz do site = pasta onde este arquivo está (funciona no GitHub Pages e em testes locais).
  const RAIZ = new URL('.', (document.currentScript && document.currentScript.src) || location.href).href;
  const SEM_LOGIN = ['login', 'enviarCodigo', 'definirSenha', 'sair'];
  const MODULOS = {
    destinacao: { nome: 'Controle de Destinação', caminho: 'destinacao/',
      desc: 'Destinações de resíduos (custo), vendas de recicláveis (receita), locação de veículos e conferência dos MTRs do mês.' },
    mapa: { nome: 'Mapa Operacional', caminho: 'mapa/',
      desc: 'Clientes, unidades GVC, parceiros, fornecedores, destinadores, transportadores e recicladores no mapa, com resíduos, preços e equipamentos.' },
  };
  const NIVEIS = { leitor: 'Leitor', editor: 'Editor', admin: 'Administrador' };

  function ler() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(CHAVE) || '{}') || {}; } catch (e) {}
    // Quem já estava conectado no Controle de Destinação antigo (mesma API, mesmo token) entra direto.
    if (!s.token) {
      try {
        const antiga = JSON.parse(localStorage.getItem('cd-auth') || '{}') || {};
        if (antiga.token) { s.token = antiga.token; localStorage.setItem(CHAVE, JSON.stringify(s)); localStorage.removeItem('cd-auth'); }
      } catch (e) {}
    }
    return s;
  }
  function gravar(s) { try { localStorage.setItem(CHAVE, JSON.stringify(s)); } catch (e) {} }
  function apiUrl() { return (window.CONFIG || {}).API_URL || ''; }

  function irParaLogin(motivo) {
    const s = ler(); delete s.token; gravar(s);
    const volta = location.href.startsWith(RAIZ) ? location.href.slice(RAIZ.length) : '';
    const q = new URLSearchParams();
    if (volta && volta !== 'index.html') q.set('voltar', volta);
    if (motivo) q.set('motivo', motivo);
    location.replace(RAIZ + (q.toString() ? '?' + q : ''));
  }

  const espera = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  // Uma chamada à API. O Google às vezes redireciona o POST e o corpo se perde no caminho
  // (acontece com mais de uma conta Google no navegador): o servidor responde "sem_corpo"
  // ou, em versões antigas, "nao_autenticado" sem ter recebido o token.
  async function chamar(acao, dados) {
    let r;
    try {
      r = await fetch(apiUrl(), { method: 'POST', redirect: 'follow', cache: 'no-store', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ acao: acao, token: ler().token || '' }, dados || {})) });
    } catch (e) { return { ok: false, erro: 'rede', mensagem: 'Sem conexão com o servidor. Verifique a internet.' }; }
    try { return await r.json(); }
    catch (e) { return { ok: false, erro: 'resposta', mensagem: 'O servidor respondeu algo inesperado. Tente de novo.' }; }
  }

  // Corpo perdido: nada foi executado no servidor, então é seguro repetir. Resposta estranha também
  // se repete, menos no login/código (as ações gravadas do portal são todas idempotentes).
  async function chamarComRetry(acao, dados) {
    let j = await chamar(acao, dados);
    const repete = function (x) { return !x.ok && (x.erro === 'sem_corpo' || (x.erro === 'resposta' && SEM_LOGIN.indexOf(acao) < 0)); };
    for (let i = 1; i <= 3 && repete(j); i++) {
      await espera(400 * i);
      j = await chamar(acao, dados);
    }
    return j;
  }

  async function api(acao, dados) {
    if (!apiUrl()) throw { erro: 'config', mensagem: 'O endereço da API não está configurado (config.js).' };
    let j = await chamarComRetry(acao, dados);
    // "Sessão terminou" só vale se o servidor confirmar duas vezes: um aviso falso não pode derrubar o login.
    if (!j.ok && j.erro === 'nao_autenticado' && SEM_LOGIN.indexOf(acao) < 0 && ler().token) {
      let negativas = 0;
      for (let i = 1; i <= 3; i++) {
        await espera(500 * i);
        const eu = await chamarComRetry('eu', {});
        if (eu.ok) { j = await chamarComRetry(acao, dados); break; }
        if (eu.erro === 'nao_autenticado' && ++negativas >= 2) break; // confirmado
      }
    }
    if (!j.ok) {
      if (j.erro === 'nao_autenticado' && SEM_LOGIN.indexOf(acao) < 0 && Portal.aoExpirar) Portal.aoExpirar();
      throw j;
    }
    return j;
  }

  // Garante que há sessão e acesso ao módulo. Devolve o usuário { email, nome, adminPortal, modulos }.
  // Usa o último usuário conhecido na hora (abre rápido) e confirma com o servidor em seguida.
  function exigir(modulo) {
    const s = ler();
    if (!s.token) { irParaLogin(); return new Promise(function () {}); }
    const temAcesso = function (u) { return !modulo || !!(u && u.modulos && u.modulos[modulo]); };
    const confirmar = api('eu', {}).then(function (j) {
      const atual = ler(); atual.usuario = j.usuario; gravar(atual);
      if (!temAcesso(j.usuario)) location.replace(RAIZ + '?semAcesso=' + encodeURIComponent(modulo));
      Portal.usuario = j.usuario;
      if (Portal.aoAtualizarUsuario) Portal.aoAtualizarUsuario(j.usuario);
      return j.usuario;
    });
    if (s.usuario && temAcesso(s.usuario)) {
      confirmar.catch(function () {}); // sem internet: segue com o último usuário conhecido
      Portal.usuario = s.usuario;
      return Promise.resolve(s.usuario);
    }
    return confirmar.catch(function (e) {
      if (e && e.erro === 'nao_autenticado') return new Promise(function () {});
      throw e;
    });
  }

  async function sair() {
    try { await api('sair', {}); } catch (e) {}
    const s = ler(); delete s.token; delete s.usuario; gravar(s);
    location.replace(RAIZ);
  }

  function nivel(modulo, u) { u = u || Portal.usuario || ler().usuario; return (u && u.modulos && u.modulos[modulo]) || ''; }
  function podeEditar(modulo, u) { const n = nivel(modulo, u); return n === 'editor' || n === 'admin'; }

  /* ---------- histórico, auditoria e trava de exclusão (iguais em todos os módulos) ---------- */
  const escH = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function dataHora(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] + (m[4] ? ' às ' + m[4] + ':' + m[5] : '') : String(iso || '');
  }
  // "Criado por Fulano em 28/10/2026 às 09:12 · Alterado por …"
  function auditoriaHTML(o) {
    css();
    if (!o || !o.criadoEm) return '';
    let h = '<span>Criado por <b>' + escH(o.criadoPor || '—') + '</b> em ' + dataHora(o.criadoEm) + '</span>';
    if (o.atualizadoEm && o.atualizadoEm !== o.criadoEm) h += '<span>Alterado por <b>' + escH(o.atualizadoPor || '—') + '</b> em ' + dataHora(o.atualizadoEm) + '</span>';
    return h;
  }
  let cssPronto = false;
  function css() {
    if (cssPronto) return; cssPronto = true;
    const st = document.createElement('style');
    st.textContent =
      '.gvc-ov{position:fixed;inset:0;z-index:100000;background:rgba(10,25,18,.45);display:flex;align-items:center;justify-content:center;padding:16px;font-family:"IBM Plex Sans",system-ui,sans-serif;color:#14211b}' +
      '.gvc-dlg{background:#fff;border-radius:10px;max-width:560px;width:100%;max-height:86vh;display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.25);border-top:4px solid #1d6b52}' +
      '.gvc-dlg.alerta{border-top-color:#b42f2f}' +
      '.gvc-dlg h3{margin:0;font:700 17px/1.3 "Archivo","Arial Narrow",system-ui,sans-serif}' +
      '.gvc-hd{padding:16px 18px 10px;display:flex;justify-content:space-between;gap:10px;align-items:flex-start}' +
      '.gvc-hd small{display:block;color:#77857d;font:500 12px "IBM Plex Mono",monospace;margin-top:2px}' +
      '.gvc-bd{padding:4px 18px 12px;overflow:auto;font-size:14px;line-height:1.45}' +
      '.gvc-ft{padding:12px 18px;border-top:1px solid #e6ebe7;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}' +
      '.gvc-btn{border:1px solid #d8dfda;background:#fff;color:#14211b;border-radius:8px;padding:8px 14px;font:600 14px inherit;cursor:pointer}' +
      '.gvc-btn.pri{background:#1d6b52;border-color:#1d6b52;color:#fff}' +
      '.gvc-btn:focus-visible{outline:2px solid #1d6b52;outline-offset:2px}' +
      '.gvc-x{border:0;background:none;font-size:22px;line-height:1;cursor:pointer;color:#4b5a52;padding:0 4px}' +
      '.gvc-tl{list-style:none;margin:0;padding:0}' +
      '.gvc-tl li{position:relative;padding:0 0 14px 20px}' +
      '.gvc-tl li:before{content:"";position:absolute;left:4px;top:6px;width:9px;height:9px;border-radius:50%;background:#1d6b52}' +
      '.gvc-tl li:after{content:"";position:absolute;left:8px;top:17px;bottom:2px;width:1px;background:#d8dfda}' +
      '.gvc-tl li:last-child:after{display:none}' +
      '.gvc-tl li.neg:before{background:#b42f2f}' +
      '.gvc-tl .q{font-weight:600;font-size:13px}.gvc-tl .w{color:#4b5a52;font-size:12.5px}' +
      '.gvc-tl .d{margin-top:3px}.gvc-tl .c{color:#4b5a52}' +
      '.gvc-old{text-decoration:line-through;color:#b42f2f}.gvc-new{color:#1d7a3e;font-weight:600}' +
      '.gvc-det{color:#4b5a52;font-size:12.5px;margin-top:2px;word-break:break-word}' +
      '.gvc-uses{list-style:none;margin:10px 0;padding:0;border:1px solid #d8dfda;border-radius:8px}' +
      '.gvc-uses li{display:flex;justify-content:space-between;gap:10px;padding:8px 12px;border-bottom:1px solid #e6ebe7}' +
      '.gvc-uses li:last-child{border-bottom:0}.gvc-uses b{font-variant-numeric:tabular-nums}' +
      '.gvc-audit{display:flex;flex-wrap:wrap;gap:2px 14px;font-size:12.5px;color:#4b5a52}.gvc-audit b{color:inherit;font-weight:600}';
    document.head.appendChild(st);
  }
  function abrirDialogo(html, classe) {
    css();
    const ov = document.createElement('div');
    ov.className = 'gvc-ov';
    ov.innerHTML = '<div class="gvc-dlg ' + (classe || '') + '" role="dialog" aria-modal="true">' + html + '</div>';
    document.body.appendChild(ov);
    const fechar = function () { ov.remove(); document.removeEventListener('keydown', esc); };
    const esc = function (e) { if (e.key === 'Escape') fechar(); };
    document.addEventListener('keydown', esc);
    ov.addEventListener('click', function (e) { if (e.target === ov) fechar(); });
    return { el: ov, fechar: fechar };
  }
  function itemHistorico(x) {
    const quem = escH(x.nome || x.email || 'sistema');
    let d = '';
    if (x.campo && (x.de || x.para)) d = '<div class="d"><span class="c">' + escH(x.campo) + ':</span> ' +
      (x.de ? '<span class="gvc-old">' + escH(x.de) + '</span>' : '') + (x.de && x.para ? ' → ' : '') + (x.para ? '<span class="gvc-new">' + escH(x.para) + '</span>' : '') + '</div>';
    else if (x.campo) d = '<div class="d"><span class="c">' + escH(x.campo) + '</span></div>';
    const acoes = { criou: 'Criou', alterou: 'Alterou', inativou: 'Inativou', reativou: 'Reativou', excluiu: 'Excluiu', 'registro antigo': 'Registro anterior ao portal', migrou: 'Migração' };
    const neg = x.acao === 'inativou' || x.acao === 'excluiu';
    return '<li class="' + (neg ? 'neg' : '') + '"><div class="q">' + dataHora(x.quando) + '</div><div class="w">' + quem + ' · ' + escH(acoes[x.acao] || x.acao) + '</div>' + d +
      (x.detalhe && x.acao !== 'alterou' ? '<div class="gvc-det">' + escH(x.detalhe) + '</div>' : '') + '</li>';
  }
  // Abre a janela com o histórico de um registro (tabela: "Cadastros", "Lancamentos"…).
  async function mostrarHistorico(tabela, id, titulo) {
    const d = abrirDialogo('<div class="gvc-hd"><div><h3>Histórico · ' + escH(titulo || id) + '</h3><small>' + escH(id) + '</small></div><button class="gvc-x" aria-label="Fechar">×</button></div>' +
      '<div class="gvc-bd"><p>Carregando…</p></div>');
    d.el.querySelector('.gvc-x').onclick = d.fechar;
    try {
      const j = await api('historico.registro', { tabela: tabela, id: id });
      d.el.querySelector('.gvc-bd').innerHTML = j.itens.length ? '<ol class="gvc-tl">' + j.itens.map(itemHistorico).join('') + '</ol>' : '<p>Nenhuma alteração registrada ainda.</p>';
    } catch (e) { d.el.querySelector('.gvc-bd').innerHTML = '<p>' + escH((e && e.mensagem) || 'Não consegui carregar o histórico.') + '</p>'; }
  }
  // Mostra por que não dá para excluir e oferece inativar. Resolve true se a pessoa escolher Inativar.
  function confirmarInativar(resp, nome) {
    return new Promise(function (resolve) {
      const usos = (resp && resp.usos) || [];
      const d = abrirDialogo('<div class="gvc-hd"><div><h3>Não é possível excluir “' + escH(nome) + '”</h3></div></div>' +
        '<div class="gvc-bd"><p>Já está em uso e faz parte do histórico:</p><ul class="gvc-uses">' +
        usos.map(function (u) { return '<li><span>' + escH(u.rotulo) + '</span><b>' + u.n + '</b></li>'; }).join('') + '</ul>' +
        '<p>Inativar: deixa de aparecer para novos registros, e tudo o que já foi lançado continua igual. Dá para reativar depois.</p></div>' +
        '<div class="gvc-ft"><button class="gvc-btn" data-n>Cancelar</button><button class="gvc-btn pri" data-s>Inativar</button></div>', 'alerta');
      d.el.querySelector('[data-n]').onclick = function () { d.fechar(); resolve(false); };
      d.el.querySelector('[data-s]').onclick = function () { d.fechar(); resolve(true); };
      d.el.querySelector('[data-s]').focus();
    });
  }

  window.Portal = {
    RAIZ: RAIZ, MODULOS: MODULOS, NIVEIS: NIVEIS,
    api: api, exigir: exigir, sair: sair, nivel: nivel, podeEditar: podeEditar,
    sessao: ler, gravarSessao: gravar, irParaLogin: irParaLogin,
    mostrarHistorico: mostrarHistorico, confirmarInativar: confirmarInativar, auditoriaHTML: auditoriaHTML, dataHora: dataHora,
    itemHistoricoHTML: itemHistorico,
    usuario: null,
    aoExpirar: function () { irParaLogin('expirada'); },
    aoAtualizarUsuario: null,
  };
})();
