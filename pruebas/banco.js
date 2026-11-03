'use strict';
// Banco de pruebas de RJU+ 0.3.0. Simula el RJU (grilla, postbacks parciales,
// imágenes /imagegen.aspx, enlace "Descargar") con interceptación de red de
// Playwright, y comprueba cada corrección del reporte del 28/10/2026.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(RAIZ, 'rju-plus.user.js'), 'utf8');
const PDFLIB = fs.readFileSync(path.join(RAIZ, 'vendor/package/dist/pdf-lib.min.js'), 'utf8');

// ---------- PNG mínimo de color liso
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function trozo(tipo, datos) {
  const l = Buffer.alloc(4); l.writeUInt32BE(datos.length);
  const td = Buffer.concat([Buffer.from(tipo), datos]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([l, td, c]);
}
function png(w, h, rgb) {
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const fila = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { fila[1 + x * 3] = rgb[0]; fila[2 + x * 3] = rgb[1]; fila[3 + x * 3] = rgb[2]; }
  const crudo = Buffer.concat(Array.from({ length: h }, () => fila));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo('IHDR', ih), trozo('IDAT', zlib.deflateSync(crudo)), trozo('IEND', Buffer.alloc(0))]);
}

// ---------- página simulada
const FILAS = [
  ['2019', '11', 'PEREZ', 'JUAN', '10111222', '01/01/2019'],
  ['2020', '22', 'GOMEZ', 'ANA MARIA', '20333444', '02/02/2020'],
  ['2021', '33', 'NUÑEZ', 'JOSÉ', '30555666', '03/03/2021'],
  ['2022', '44', 'DIAZ', 'LUIS', '40777888', '04/04/2022']
];
function html() {
  const enc = '<tr style="font-weight:bold;"><th>Ver</th><th>año</th><th>num_oficio</th><th>apellido</th><th>nombre</th><th>num_documento</th><th>fallecimiento</th></tr>';
  const filas = FILAS.map((f, i) => '<tr style="background-color:' + (i % 2 ? '#D9DADB' : 'White') + ';"><td><input type="image" src="./Images/Lupa.png" onclick="javascript:__doPostBack(\'GridConsulta\',\'Select$' + i + '\');return false;"></td>' +
    f.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<form><table id="GridConsulta">${enc}${filas}</table>
<div id="UpdatePanel2"><a id="lnkDesc" href="javascript:Descargar()"><img src="./Images/desc.png"></a><div id="ficha"></div></div></form>
<script>
window.__llamadas = [];
const fin = [];
window.Sys = { WebForms: { PageRequestManager: { getInstance: () => ({ add_endRequest: (f) => fin.push(f) }) } } };
function Descargar() { __doPostBack('Descargar', ''); }
window.__mostrar = function (i, marcar) {
  const g = document.getElementById('GridConsulta');
  [...g.rows].slice(1).forEach((tr, k) => { tr.style.backgroundColor = (marcar && k === i) ? '#A1DCF2' : (k % 2 ? '#D9DADB' : 'White'); });
  const n = (i % 2) + 1; let h = '';
  for (let p = 1; p <= n; p++) h += '<img src="imagenpaginagen.aspx?pagina=' + p + '"><img src="imagegen.aspx?pagina=' + p + '&nocache=' + Math.random() + '">';
  document.getElementById('ficha').innerHTML = h;
  fin.forEach((f) => f());
};
window.__doPostBack = function (t, a) {
  window.__llamadas.push(t + '|' + a);
  const m = /^Select\\$(\\d+)$/.exec(a || '');
  if (t === 'GridConsulta' && m) { fetch('/elegir?i=' + m[1]); setTimeout(() => window.__mostrar(+m[1], window.__marcar !== false), 300); }
};
</script></body></html>`;
}

// Tamaños por ficha. El servidor, al segundo pedido de una imagen, entrega
// otra (simula "la ficha de otra persona").
const TAM = [[300, 420], [310, 430], [320, 440], [330, 450]];

async function nuevaPagina(navegador, opciones) {
  const o = Object.assign({ descarga: 'ok', prefs: {}, demoraImagen: 0 }, opciones || {});
  const ctx = await navegador.newContext();
  const page = await ctx.newPage();
  const servidor = { elegida: 0, pedidos: {} };
  await page.route('https://rju.scba.gov.ar/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === '/' || u.pathname === '/index.aspx') return route.fulfill({ contentType: 'text/html', body: html() });
    if (u.pathname === '/elegir') { servidor.elegida = +u.searchParams.get('i'); return route.fulfill({ body: 'ok' }); }
    if (u.pathname.toLowerCase().endsWith('/imagegen.aspx')) {
      if (o.demoraImagen === 'nunca') return undefined; // la imagen nunca llega
      const k = servidor.elegida + '-' + u.searchParams.get('pagina');
      servidor.pedidos[k] = (servidor.pedidos[k] || 0) + 1;
      const [w, h] = servidor.pedidos[k] > 1 ? [999, 999] : TAM[servidor.elegida];
      return route.fulfill({ contentType: 'image/png', body: png(w, h, [200, 200, 200]) });
    }
    return route.fulfill({ contentType: 'image/png', body: png(10, 10, [0, 0, 0]) });
  });
  await page.addInitScript((cfg) => {
    window.__descargas = [];
    window.__prefs = cfg.prefs;
    window.GM_getValue = (k, d) => (k in window.__prefs ? window.__prefs[k] : d);
    window.GM_setValue = (k, v) => { window.__prefs[k] = v; };
    window.unsafeWindow = window;
    window.__modoDescarga = cfg.descarga;
    window.GM_download = (d) => {
      const reg = { name: d.name, saveAs: d.saveAs };
      window.__descargas.push(reg);
      fetch(d.url).then((r) => r.arrayBuffer()).then(async (b) => {
        const doc = await window.PDFLib.PDFDocument.load(b);
        reg.paginas = doc.getPageCount();
        reg.imagenes = [];
        doc.context.enumerateIndirectObjects().forEach(([, obj]) => {
          const dict = obj && obj.dict;
          if (dict && String(dict.get(window.PDFLib.PDFName.of('Subtype'))) === '/Image') {
            reg.imagenes.push(dict.get(window.PDFLib.PDFName.of('Width')).asNumber() + 'x' + dict.get(window.PDFLib.PDFName.of('Height')).asNumber());
          }
        });
        const m = window.__modoDescarga;
        setTimeout(() => (m === 'ok' ? d.onload() : d.onerror(m === 'cancelar' ? { error: 'not_succeeded', details: { current: 'USER_CANCELED' } } : { error: 'not_permitted' })), 50);
      });
    };
  }, o);
  await page.goto('https://rju.scba.gov.ar/');
  await page.addScriptTag({ content: PDFLIB });
  await page.addScriptTag({ content: SCRIPT });
  return { page, ctx, servidor };
}

const resultados = [];
function chequear(nombre, ok, detalle) {
  resultados.push({ nombre, ok: !!ok });
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (detalle !== undefined ? '  -> ' + JSON.stringify(detalle) : ''));
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const descargas = (p) => p.evaluate(() => window.__descargas.map((d) => Object.assign({}, d)));
const textoEstado = (p) => p.evaluate(() => document.querySelector('#rjuplus .est').textContent);
const clicFila = (p, i) => p.evaluate((k) => document.getElementById('GridConsulta').rows[k + 1].querySelector('input').click(), i);

async function pruebaArranque(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  const r = await page.evaluate(() => {
    const c = document.getElementById('rjuplus'); const b = c.getBoundingClientRect();
    return { caja: c.querySelector('.caja').style.display, pastilla: c.querySelector('.pastilla').style.display,
      derecha: window.innerWidth - b.right, abajo: window.innerHeight - b.bottom,
      botones: [...c.querySelectorAll('.ctrl [data-b]')].map((e) => e.dataset.b).join(',') };
  });
  chequear('Arranca minimizada', r.caja === 'none' && r.pastilla === 'block', r);
  chequear('Anclada abajo a la derecha', r.derecha >= 10 && r.derecha <= 20 && r.abajo >= 10 && r.abajo <= 20, r);
  chequear('Tres botones de ventana', r.botones === 'min,max,cerrar', r.botones);
  const lic = await page.evaluate(() => document.querySelector('#rjuplus .pie').textContent);
  await page.evaluate(() => {
    window.__cambios = 0;
    new MutationObserver((m) => { window.__cambios += m.length; }).observe(document.getElementById('rjuplus'), { childList: true, subtree: true, characterData: true, attributes: true });
    document.body.appendChild(document.createElement('span')); // un cambio de la página
  });
  await esperar(3000);
  const c0 = await page.evaluate(() => window.__cambios);
  chequear('Sin ficha abierta tampoco hay bucle (R1)', c0 === 0, c0);
  chequear('Pie sin GPL ni repositorio', /Todos los derechos reservados/.test(lic) && !/GPL|github/i.test(lic), lic);
  await ctx.close();
}

async function pruebaBajadaAutomatica(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  await clicFila(page, 1);
  await esperar(2500);
  const d = await descargas(page);
  chequear('Baja sola una vez al abrir', d.length === 1, d.length);
  chequear('Pregunta dónde guardar (saveAs)', d[0] && d[0].saveAs === true, d[0]);
  chequear('Nombre según la fila elegida', d[0] && d[0].name === 'RJU_2020_GOMEZ_ANA-MARIA_20333444.pdf', d[0] && d[0].name);
  chequear('PDF con las páginas de la ficha', d[0] && d[0].paginas === 2, d[0] && d[0].paginas);
  chequear('PDF con la imagen de pantalla, no la del servidor (R2)', d[0] && d[0].imagenes.every((x) => x === '310x430'), d[0] && d[0].imagenes);
  // R1: sin bucle. Se cuentan las escrituras del panel durante 3 segundos.
  await page.evaluate(() => {
    window.__cambios = 0;
    new MutationObserver((m) => { window.__cambios += m.length; }).observe(document.getElementById('rjuplus'), { childList: true, subtree: true, characterData: true, attributes: true });
  });
  await esperar(3000);
  const cambios = await page.evaluate(() => window.__cambios);
  chequear('Sin bucle: el panel queda quieto (R1)', cambios === 0, cambios);
  chequear('No vuelve a bajar la misma ficha', (await descargas(page)).length === 1);
  // Otra ficha: se baja con sus datos.
  await clicFila(page, 2);
  await esperar(2500);
  const d2 = await descargas(page);
  chequear('Segunda ficha con su propio nombre (acentos limpios)', d2.length === 2 && d2[1].name === 'RJU_2021_NUNEZ_JOSE_30555666.pdf', d2.map((x) => x.name));
  // El mismo registro redibujado (nuevo nocache) no se baja otra vez.
  await page.evaluate(() => window.__mostrar(2, true));
  await esperar(1500);
  chequear('Redibujar la misma ficha no la baja de nuevo', (await descargas(page)).length === 2);
  await ctx.close();
}

async function pruebaFichaPorOtroCamino(nav) {
  const { page, ctx, servidor } = await nuevaPagina(nav);
  await clicFila(page, 0);
  await esperar(2500);
  // La ficha 3 aparece sin pasar por el clic (otro camino), con la fila marcada.
  servidor.elegida = 3;
  await page.evaluate(() => window.__mostrar(3, true));
  await esperar(2500);
  const d = await descargas(page);
  chequear('Ficha abierta por otro camino: nombre de su fila marcada (R3)', d[1] && d[1].name === 'RJU_2022_DIAZ_LUIS_40777888.pdf', d.map((x) => x.name));
  // Sin fila marcada ni clic: nombre genérico, nunca el de la ficha anterior.
  servidor.elegida = 1;
  await page.evaluate(() => window.__mostrar(1, false));
  await esperar(2500);
  const d2 = await descargas(page);
  chequear('Sin datos de la fila: nombre genérico (R3)', d2[2] && /^RJU_ficha_\d{8}-\d{6}\.pdf$/.test(d2[2].name), d2.map((x) => x.name));
  await ctx.close();
}

async function pruebaRespaldoDelClic(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  await page.evaluate(() => { window.__marcar = false; });
  await clicFila(page, 2);
  await esperar(2500);
  const d = await descargas(page);
  chequear('Sin fila marcada: usa los datos del clic', d[0] && d[0].name === 'RJU_2021_NUNEZ_JOSE_30555666.pdf', d.map((x) => x.name));
  await ctx.close();
}

async function pruebaDescargarDelSitio(nav) {
  const { page, ctx } = await nuevaPagina(nav, { prefs: { rjuplus_auto: false } });
  await clicFila(page, 0);
  await esperar(1500);
  chequear('Con la bajada automática apagada no baja sola', (await descargas(page)).length === 0);
  await page.evaluate(() => document.getElementById('lnkDesc').click());
  await esperar(2000);
  const ll = await page.evaluate(() => window.__llamadas);
  chequear('Enlace Descargar del sitio pasa por RJU+ (R8)', (await descargas(page)).length === 1 && !ll.some((x) => x.startsWith('Descargar')), ll);
  await page.evaluate(() => window.__doPostBack('Descargar', ''));
  await esperar(2000);
  chequear('__doPostBack(Descargar) directo también (R8)', (await descargas(page)).length === 2);
  await ctx.close();
}

async function pruebaCancelarYFallo(nav) {
  let { page, ctx } = await nuevaPagina(nav, { descarga: 'cancelar' });
  await clicFila(page, 0);
  await esperar(4000);
  chequear('Cancelar "Guardar como" no reintenta', (await descargas(page)).length === 1, await textoEstado(page));
  await ctx.close();
  ({ page, ctx } = await nuevaPagina(nav, { descarga: 'fallo' }));
  await clicFila(page, 0);
  await esperar(4000);
  const vis = await page.evaluate(() => [...document.querySelectorAll('#rjuplus button')].find((b) => /Guardar el PDF/.test(b.textContent)).style.display);
  chequear('Si Tampermonkey no abre el cuadro, ofrece "Guardar el PDF"', vis === 'block' && (await descargas(page)).length === 1, await textoEstado(page));
  await ctx.close();
}

async function pruebaReintento(nav) {
  const { page, ctx } = await nuevaPagina(nav, { demoraImagen: 'nunca' });
  await clicFila(page, 0);
  await esperar(23000);
  const est = await textoEstado(page);
  const color = await page.evaluate(() => document.querySelector('#rjuplus .pastilla').style.background);
  chequear('Imágenes que no cargan: error visible y no se da por guardada (R4, R12)', /no terminaron de cargar/.test(est) && (await descargas(page)).length === 0, est);
  chequear('Pastilla en rojo ante el error', /179, 38, 30|b3261e/i.test(color), color);
  await ctx.close();
}

async function pruebaCerrarYMaximizar(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  await page.click('#rjuplus .pastilla');
  await page.click('#rjuplus [data-b="max"]');
  await clicFila(page, 1);
  await esperar(3000);
  const m = await page.evaluate(() => ({ max: document.getElementById('rjuplus').classList.contains('max'),
    minis: document.querySelectorAll('#rjuplus .minis canvas').length, hist: document.querySelectorAll('#rjuplus .hist li').length }));
  chequear('Maximizar muestra páginas y fichas de la sesión', m.max && m.minis === 2 && m.hist === 1, m);
  await page.click('#rjuplus [data-b="min"]');
  await page.click('#rjuplus .pastilla');
  chequear('Restaurar vuelve al modo anterior (maximizado)', await page.evaluate(() => document.getElementById('rjuplus').classList.contains('max')));
  await page.click('#rjuplus [data-b="cerrar"]');
  await clicFila(page, 3);
  await esperar(2500);
  chequear('Cerrar apaga la bajada automática (R6)', (await descargas(page)).length === 1);
  await page.evaluate(() => document.getElementById('lnkDesc').click());
  await esperar(2000);
  chequear('Cerrada, el enlace Descargar sigue sin usar la descarga rota', (await descargas(page)).length === 2);
  await ctx.close();
}

async function pruebaPreferencia(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  await page.click('#rjuplus .pastilla');
  await page.click('#rjuplus input[type=checkbox]');
  const v = await page.evaluate(() => window.__prefs.rjuplus_auto);
  chequear('La opción automática se guarda en Tampermonkey', v === false, v);
  await ctx.close();
}

(async () => {
  const nav = await chromium.launch();
  const errores = [];
  for (const p of [pruebaArranque, pruebaBajadaAutomatica, pruebaFichaPorOtroCamino, pruebaRespaldoDelClic, pruebaDescargarDelSitio, pruebaCancelarYFallo, pruebaCerrarYMaximizar, pruebaPreferencia, pruebaReintento]) {
    try { await p(nav); } catch (e) { errores.push(p.name + ': ' + e.message); chequear(p.name + ' (excepción)', false, e.message); }
  }
  await nav.close();
  const malas = resultados.filter((r) => !r.ok).length;
  console.log('\n' + (resultados.length - malas) + ' en verde, ' + malas + ' fallas.');
  process.exit(malas ? 1 : 0);
})();
