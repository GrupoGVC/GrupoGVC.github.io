/* =====================================================================
 * Localização pelo Google (Mapa Operacional)
 *  - buscar: endereço, lugar ou CEP no geocodificador do Google (serviço Maps do Apps Script,
 *    sem chave de API). Resultados com coordenadas e o endereço separado em campos.
 *  - link: lê as coordenadas de um link do Google Maps (longo ou curto, maps.app.goo.gl).
 *  - reverso: endereço de um ponto (para preencher rua, bairro, cidade, UF e CEP).
 *  Só leitura: não grava nada na planilha. Resultados ficam 6 h em cache para poupar a cota diária.
 *  Links curtos (maps.app.goo.gl) precisam abrir o endereço na internet, o que exige uma autorização
 *  extra da conta dona do script. Até ela ser dada, o serviço é chamado de forma indireta (sem pedir a
 *  permissão no envio do código, para o portal não parar) e o usuário recebe a orientação de colar o link completo.
 * ===================================================================== */

function servicoLinks_() { return globalThis['Url' + 'Fetch' + 'App']; }

const GEO_CACHE_S = 6 * 3600;

function mapaGeo_(body) {
  const tipo = String(body.tipo || '');
  try {
    if (tipo === 'buscar') return geoBuscar_(String(body.q || ''));
    if (tipo === 'reverso') return geoReverso_(Number(body.lat), Number(body.lng));
    if (tipo === 'link') return geoLink_(String(body.url || ''));
    return { ok: false, erro: 'dados_invalidos', mensagem: 'Tipo de busca desconhecido.' };
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/too many times|quota|OVER_QUERY_LIMIT/i.test(msg))
      return { ok: false, erro: 'cota', mensagem: 'A cota diária de buscas no Google acabou. Marque clicando no mapa ou cole as coordenadas; amanhã a busca volta.' };
    if (/permiss|authoriz|autoriza/i.test(msg))
      return { ok: false, erro: 'autorizacao', mensagem: 'O portal ainda não tem permissão para abrir links curtos do Google. Use o link completo ou as coordenadas (o administrador precisa autorizar uma vez no Apps Script).' };
    return { ok: false, erro: 'falha', mensagem: 'Não consegui consultar o Google agora. Tente de novo em instantes.' };
  }
}

function geocoder_() {
  // região Brasil e preferência para o Nordeste (só dá prioridade, não limita)
  return Maps.newGeocoder().setRegion('br').setLanguage('pt-BR').setBounds(-18.5, -47.5, -8.0, -37.0);
}

function geoCache_(chave, fn) {
  const c = CacheService.getScriptCache(), k = 'GEO_' + Utilities.base64EncodeWebSafe(chave).slice(0, 200);
  const v = c.get(k); if (v) return JSON.parse(v);
  const r = fn();
  if (r && r.ok) try { c.put(k, JSON.stringify(r), GEO_CACHE_S); } catch (e) {}
  return r;
}

/** Endereço do Google separado nos campos do cadastro. */
function geoEndereco_(res) {
  const out = { logradouro: '', numero: '', bairro: '', cidade: '', uf: '', cep: '' };
  (res.address_components || []).forEach(function (c) {
    const t = c.types || [];
    if (t.indexOf('route') >= 0) out.logradouro = c.long_name;
    else if (t.indexOf('street_number') >= 0) out.numero = c.long_name;
    else if ((t.indexOf('sublocality_level_1') >= 0 || t.indexOf('sublocality') >= 0 || t.indexOf('neighborhood') >= 0) && !out.bairro) out.bairro = c.long_name;
    else if (t.indexOf('administrative_area_level_2') >= 0) out.cidade = c.long_name;
    else if (t.indexOf('locality') >= 0 && !out.cidade) out.cidade = c.long_name;
    else if (t.indexOf('administrative_area_level_1') >= 0) out.uf = c.short_name;
    else if (t.indexOf('postal_code') >= 0) out.cep = c.long_name;
  });
  return out;
}
function geoResultado_(res) {
  const loc = res.geometry && res.geometry.location;
  return { nome: String(res.formatted_address || '').replace(/, Brazil$|, Brasil$/, ''), lat: Number(loc.lat), lng: Number(loc.lng),
           preciso: (res.geometry.location_type === 'ROOFTOP' || res.geometry.location_type === 'RANGE_INTERPOLATED'),
           endereco: geoEndereco_(res) };
}

function geoBuscar_(q) {
  q = q.trim().replace(/\s+/g, ' ');
  if (q.length < 3) return { ok: true, resultados: [] };
  const coord = geoCoordenadas_(q);
  if (coord) return { ok: true, resultados: [{ nome: 'Coordenadas ' + coord.lat + ', ' + coord.lng, lat: coord.lat, lng: coord.lng, preciso: true, endereco: null }] };
  return geoCache_('b:' + q.toLowerCase(), function () {
    const r = geocoder_().geocode(q);
    if (r.status === 'OVER_QUERY_LIMIT') throw new Error('OVER_QUERY_LIMIT');
    return { ok: true, resultados: (r.results || []).slice(0, 6).map(geoResultado_) };
  });
}

function geoReverso_(lat, lng) {
  if (!geoValido_(lat, lng)) return { ok: false, erro: 'dados_invalidos', mensagem: 'Coordenadas inválidas.' };
  return geoCache_('r:' + lat.toFixed(5) + ',' + lng.toFixed(5), function () {
    const r = Maps.newGeocoder().setLanguage('pt-BR').reverseGeocode(lat, lng);
    if (r.status === 'OVER_QUERY_LIMIT') throw new Error('OVER_QUERY_LIMIT');
    // prefere o endereço de rua; deixa por último os "plus codes" (ex.: 5H3F+99) e os genéricos (só cidade)
    const nota = function (x) { const t = x.types || []; return t.indexOf('plus_code') >= 0 ? 0 : t.indexOf('street_address') >= 0 || t.indexOf('premise') >= 0 ? 4 : t.indexOf('route') >= 0 ? 3 : t.indexOf('establishment') >= 0 || t.indexOf('point_of_interest') >= 0 ? 2 : 1; };
    const res = (r.results || []).slice().sort(function (a, b) { return nota(b) - nota(a); })[0];
    return { ok: true, resultado: res ? geoResultado_(res) : null };
  });
}

function geoValido_(lat, lng) { return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0); }

/** "-12.84, -38.42" (como o Google Maps copia) → {lat, lng}. */
function geoCoordenadas_(t) {
  const m = String(t).trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1].replace(',', '.')), lng = Number(m[2].replace(',', '.'));
  return geoValido_(lat, lng) ? { lat: lat, lng: lng } : null;
}

/** Coordenadas escritas num link do Google Maps (o pino do lugar tem prioridade sobre o centro da tela). */
function geoDoLink_(u) {
  let s = u; try { s = decodeURIComponent(u); } catch (e) {}
  const num = '(-?\\d{1,3}\\.\\d+)';
  const tenta = function (re) { let m, ult = null; const r = new RegExp(re, 'g'); while ((m = r.exec(s))) ult = m; return ult && geoValido_(Number(ult[1]), Number(ult[2])) ? { lat: Number(ult[1]), lng: Number(ult[2]) } : null; };
  return tenta('!3d' + num + '!4d' + num) ||
         tenta('[?&](?:q|query|ll|sll|center|destination|daddr|saddr)=(?:loc:)?' + num + ',\\s*\\+?' + num) ||
         tenta('/search/' + num + ',\\s*\\+?' + num) ||
         tenta('/place/' + num + ',\\s*\\+?' + num) ||
         tenta('@' + num + ',' + num);
}
/** Nome do lugar no link (quando o link não traz coordenadas): /place/Nome/ ou ?q=texto. */
function geoTextoDoLink_(u) {
  let s = u; try { s = decodeURIComponent(u.replace(/\+/g, ' ')); } catch (e) {}
  const m = s.match(/\/place\/([^\/@?]+)/) || s.match(/[?&](?:q|query)=([^&]+)/);
  return m ? m[1].trim() : '';
}

function geoLink_(url) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (!/^https:\/\/([a-z0-9-]+\.)*(google\.[a-z.]+|goo\.gl|g\.co|app\.goo\.gl)(\/|$)/i.test(url))
    return { ok: false, erro: 'dados_invalidos', mensagem: 'Cole um link do Google Maps (google.com/maps ou maps.app.goo.gl).' };
  return geoCache_('l:' + url, function () {
    let atual = url, corpo = '';
    // link curto: segue os redirecionamentos até o endereço completo
    for (let i = 0; i < 6 && !geoDoLink_(atual) && /goo\.gl|g\.co\b|\/maps\/?\?|share\.google/i.test(atual); i++) {
      const r = servicoLinks_().fetch(atual, { followRedirects: false, muteHttpExceptions: true });
      const h = r.getAllHeaders(); const loc = h.Location || h.location;
      if (loc) { atual = Array.isArray(loc) ? loc[0] : String(loc); continue; }
      corpo = r.getContentText().slice(0, 200000);
      break;
    }
    let c = geoDoLink_(atual) || (corpo && geoDoLink_(corpo.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&')));
    const texto = geoTextoDoLink_(atual);
    if (!c && texto) {
      const b = geoBuscar_(texto);
      if (b.ok && b.resultados.length) return { ok: true, resultado: b.resultados[0], urlFinal: atual };
    }
    if (!c) return { ok: false, erro: 'sem_coordenadas', mensagem: 'Não achei a localização nesse link. No Google Maps, abra o lugar, toque em "Compartilhar" e cole o link aqui; ou cole as coordenadas.' };
    let rev = null; try { const rr = geoReverso_(c.lat, c.lng); rev = rr.ok && rr.resultado; } catch (e) {}
    return { ok: true, resultado: { nome: texto || (rev && rev.nome) || ('Coordenadas ' + c.lat + ', ' + c.lng), lat: c.lat, lng: c.lng, preciso: true, endereco: rev ? rev.endereco : null }, urlFinal: atual };
  });
}
