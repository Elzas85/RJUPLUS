'use strict';
// Banco de pruebas de RJU+ 0.3.1. Simula el RJU (grilla con fila elegida en
// celeste, envíos parciales, imágenes /imagegen.aspx con nocache, enlace
// "Descargar", paginador, pedidos que fallan o tardan) con la interceptación
// de red de Playwright, y comprueba las correcciones de R1 a R14 y de los
// casos X1 a X4 de la revisión independiente del 03/11/2026.
//
// Uso: node pruebas/banco.js [ruta de pdf-lib.min.js]
// Por omisión toma pruebas/vendor/pdf-lib.min.js (pdf-lib 1.17.1, la misma
// huella sha384 que declara el encabezado del programa).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const SCRIPT = fs.readFileSync(path.join(RAIZ, 'rju-plus.user.js'), 'utf8');
const RUTA_PDFLIB = process.argv[2] || path.join(__dirname, 'vendor', 'pdf-lib.min.js');
const PDFLIB = fs.readFileSync(RUTA_PDFLIB, 'utf8');

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
const NOMBRES = [
  'RJU_2019_PEREZ_JUAN_10111222.pdf',
  'RJU_2020_GOMEZ_ANA-MARIA_20333444.pdf',
  'RJU_2021_NUNEZ_JOSE_30555666.pdf',
  'RJU_2022_DIAZ_LUIS_40777888.pdf'
];
const GENERICO = /^RJU_ficha_\d{8}-\d{6}\.pdf$/;
// Tamaño de cada ficha. Al segundo pedido de una misma imagen, el servidor
// entrega otra (999x999): simula "la ficha de otra persona".
const TAM = [[300, 420], [310, 430], [320, 440], [330, 450]];

function html(paginador) {
  const enc = '<tr style="font-weight:bold;"><th>Ver</th><th>año</th><th>num_oficio</th><th>apellido</th><th>nombre</th><th>num_documento</th><th>fallecimiento</th></tr>';
  const pag = paginador ? '<tr><td colspan="7"><a href="javascript:__doPostBack(\'GridConsulta\',\'Page$2\')">2</a></td></tr>' : '';
  const filas = FILAS.map((f, i) => '<tr style="background-color:' + (i % 2 ? '#D9DADB' : 'White') + ';"><td><input type="image" src="./Images/Lupa.png" onclick="javascript:__doPostBack(\'GridConsulta\',\'Select$' + i + '\');return false;"></td>' +
    f.map((c) => '<td>' + c + '</td>').join('') + '</tr>').join('');
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<form><table id="GridConsulta">${enc}${pag}${filas}</table>
<div id="UpdatePanel2"><a id="lnkDesc" href="javascript:Descargar()">Descargar</a><div id="ficha"></div></div><div id="aviso"></div></form>
<script>
window.__llamadas = [];
const fin = [];
window.Sys = { WebForms: { PageRequestManager: { getInstance: () => ({ add_endRequest: (f) => fin.push(f) }) } } };
function Descargar() { __doPostBack('Descargar', ''); }
window.__terminar = () => { if (!window.__sinFin) fin.forEach((f) => f()); };
window.__marcarFila = function (i) {
  const g = document.getElementById('GridConsulta');
  [...g.rows].filter((tr) => tr.querySelector('input')).forEach((tr, k) => { tr.style.backgroundColor = (k === i) ? '#A1DCF2' : (k % 2 ? '#D9DADB' : 'White'); });
};
window.__dibujar = function (i) {
  const n = (i % 2) + 1; let h = '';
  for (let p = 1; p <= n; p++) h += '<img src="imagenpaginagen.aspx?pagina=' + p + '"><img src="imagegen.aspx?f=' + i + '&pagina=' + p + '&nocache=' + Math.random() + '">';
  document.getElementById('ficha').innerHTML = h;
};
window.__mostrar = function (i, marcar) {
  if (marcar) window.__marcarFila(i); else window.__marcarFila(-1);
  window.__dibujar(i);
  window.__terminar();
};
window.__doPostBack = function (t, a) {
  window.__llamadas.push(t + '|' + a);
  const m = /^Select\\$(\\d+)$/.exec(a || '');
  if (t !== 'GridConsulta' || !m) { setTimeout(window.__terminar, 100); return; }
  const demora = window.__demora || 300;
  if (window.__demora) document.getElementById('aviso').textContent = 'Cargando...';
  setTimeout(() => {
    document.getElementById('aviso').textContent = '';
    if (window.__falla) { window.__terminar(); return; }
    window.__mostrar(+m[1], window.__marcar !== false);
  }, demora);
};
</script></body></html>`;
}

async function nuevaPagina(navegador, opciones) {
  const o = Object.assign({ selector: 'ok', prefs: {}, imagenes: 'ok', paginador: false, sinSelector: false, lienzoBloqueado: false }, opciones || {});
  const ctx = await navegador.newContext();
  const page = await ctx.newPage();
  const servidor = { pedidos: {}, descargasDelNavegador: 0 };
  page.on('download', () => { servidor.descargasDelNavegador++; });
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname === 'rju.scba.gov.ar') {
      if (u.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html(o.paginador) });
      if (u.pathname.toLowerCase().endsWith('/imagegen.aspx')) {
        if (o.imagenes === 'nunca') return undefined;
        const k = u.searchParams.get('f') + '-' + u.searchParams.get('pagina');
        servidor.pedidos[k] = (servidor.pedidos[k] || 0) + 1;
        const [w, h] = servidor.pedidos[k] > 1 ? [999, 999] : TAM[+u.searchParams.get('f')];
        return route.fulfill({ contentType: 'image/png', body: png(w, h, [200, 200, 200]) });
      }
      return route.fulfill({ contentType: 'image/png', body: png(10, 10, [0, 0, 0]) });
    }
    return route.abort(); // sin salida a internet
  });
  await page.addInitScript((cfg) => {
    window.__guardados = [];
    window.__selectores = [];
    window.__prefs = cfg.prefs;
    window.GM_getValue = (k, d) => (k in window.__prefs ? window.__prefs[k] : d);
    window.GM_setValue = (k, v) => { window.__prefs[k] = v; };
    window.unsafeWindow = window;
    window.__modoSelector = cfg.selector;
    if (cfg.lienzoBloqueado) {
      HTMLCanvasElement.prototype.toBlob = function () { throw new DOMException("Failed to execute 'toBlob' on 'HTMLCanvasElement': Tainted canvases may not be exported.", 'SecurityError'); };
    }
    window.__lienzos = 0;
    const toBlobOriginal = HTMLCanvasElement.prototype.toBlob;
    if (!cfg.lienzoBloqueado) HTMLCanvasElement.prototype.toBlob = function () { window.__lienzos++; return toBlobOriginal.apply(this, arguments); };
    if (cfg.sinSelector) { window.showSaveFilePicker = undefined; return; }
    window.showSaveFilePicker = async (op) => {
      const reg = { nombre: op.suggestedName, inicio: op.startIn, activo: navigator.userActivation.isActive, lienzos: window.__lienzos };
      window.__selectores.push(reg);
      if (window.__modoSelector === 'cancelar') throw new DOMException('The user aborted a request.', 'AbortError');
      return { createWritable: async () => ({
        write: async (blob) => {
          const b = await blob.arrayBuffer();
          const P = window.PDFLib; const doc = await P.PDFDocument.load(b);
          const g = { nombre: op.suggestedName, paginas: doc.getPageCount(), imagenes: [] };
          doc.context.enumerateIndirectObjects().forEach(([, obj]) => {
            const d = obj && obj.dict;
            if (d && String(d.get(P.PDFName.of('Subtype'))) === '/Image') g.imagenes.push(d.get(P.PDFName.of('Width')).asNumber() + 'x' + d.get(P.PDFName.of('Height')).asNumber());
          });
          window.__guardados.push(g);
        },
        close: async () => {}
      }) };
    };
  }, o);
  await page.goto('https://rju.scba.gov.ar/');
  await page.addScriptTag({ content: PDFLIB });
  await page.addScriptTag({ content: SCRIPT });
  return { page, ctx, servidor };
}

// ---------- utilidades
const resultados = [];
function chequear(nombre, ok, detalle) {
  resultados.push({ nombre, ok: !!ok });
  console.log((ok ? 'OK   ' : 'FALLA') + ' ' + nombre + (detalle !== undefined ? '  -> ' + JSON.stringify(detalle) : ''));
}
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const guardados = (p) => p.evaluate(() => window.__guardados.map((d) => Object.assign({}, d)));
const selectores = (p) => p.evaluate(() => window.__selectores.map((d) => Object.assign({}, d)));
const textoEstado = (p) => p.evaluate(() => document.querySelector('#rjuplus .est').textContent);
const clicFila = (p, i) => p.evaluate((k) => [...document.querySelectorAll('#GridConsulta input')][k].click(), i);
const botonGuardar = (p) => p.evaluate(() => {
  const b = [...document.querySelectorAll('#rjuplus button')].find((x) => /Elegir dónde guardar/.test(x.textContent));
  return b && b.style.display !== 'none' ? b.textContent : null;
});
async function guardarConClic(p) {
  await p.click('#rjuplus button.secundario');
  await esperar(800);
}
async function contarCambiosDelPanel(p, ms) {
  await p.evaluate(() => {
    window.__cambios = 0;
    new MutationObserver((m) => { window.__cambios += m.length; }).observe(document.getElementById('rjuplus'), { childList: true, subtree: true, characterData: true, attributes: true });
  });
  await esperar(ms);
  return p.evaluate(() => window.__cambios);
}

// ---------- pruebas
async function pruebaEstatica() {
  const enc = SCRIPT.slice(0, SCRIPT.indexOf('==/UserScript=='));
  const sha = crypto.createHash('sha384').update(PDFLIB).digest('base64');
  chequear('R7: pdf-lib con huella sha384 correcta', enc.includes('#sha384=' + sha), sha);
  chequear('R10: licencia "Todos los derechos reservados" y sin GPL', /@license\s+Todos los derechos reservados/.test(enc) && !/GPL|gnu\.org/i.test(SCRIPT));
  chequear('R11: sin actualización por GitHub', !/@updateURL|@downloadURL|@homepageURL|github\.com|githubusercontent/i.test(SCRIPT));
  chequear('R14: la descripción no menciona About', !/About/.test(enc));
  chequear('Sin GM_download ni enlaces con download (nunca Descargas)', !/GM_download|\.download\s*=/.test(SCRIPT));
  chequear('Sin palabras en inglés en comentarios (userscript, postback)', !/\buserscript\b|\bpostback\b/i.test(SCRIPT.slice(SCRIPT.indexOf('==/UserScript==') + 15)));
}

async function pruebaArranque(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  const r = await page.evaluate(() => {
    const c = document.getElementById('rjuplus'); const b = c.getBoundingClientRect();
    return { caja: c.querySelector('.caja').style.display, pastilla: c.querySelector('.pastilla').style.display,
      derecha: window.innerWidth - b.right, abajo: window.innerHeight - b.bottom,
      botones: [...c.querySelectorAll('.ctrl [data-b]')].map((e) => e.dataset.b).join(',') };
  });
  chequear('Arranca minimizada, anclada abajo a la derecha', r.caja === 'none' && r.pastilla === 'block' && r.derecha >= 10 && r.derecha <= 20 && r.abajo >= 10 && r.abajo <= 20, r);
  chequear('Tres botones de ventana', r.botones === 'min,max,cerrar', r.botones);
  await page.evaluate(() => document.body.appendChild(document.createElement('span')));
  chequear('R1: sin ficha no hay bucle', (await contarCambiosDelPanel(page, 3000)) === 0);
  await ctx.close();
}

async function pruebaAutomatica(nav) {
  const { page, ctx, servidor } = await nuevaPagina(nav);
  await clicFila(page, 1);
  await esperar(2500);
  const b = await botonGuardar(page);
  chequear('Prepara sola y abre el panel con "Elegir dónde guardar"', b && b.includes(NOMBRES[1]) && await page.evaluate(() => document.querySelector('#rjuplus .caja').style.display === 'block'), b);
  chequear('Sin clic no guarda nada', (await guardados(page)).length === 0 && (await selectores(page)).length === 0);
  await guardarConClic(page);
  const s = await selectores(page); const g = await guardados(page);
  chequear('El selector de Chrome se abre dentro del clic, en Documentos', s.length === 1 && s[0].activo === true && s[0].inicio === 'documents', s);
  chequear('Nombre según la fila elegida', g[0] && g[0].nombre === NOMBRES[1], g[0] && g[0].nombre);
  chequear('R2: PDF con las imágenes de pantalla, no las del servidor', g[0] && g[0].paginas === 2 && g[0].imagenes.every((x) => x === '310x430'), g[0]);
  chequear('Guardado: el botón desaparece', (await botonGuardar(page)) === null);
  chequear('R1: con ficha, el panel queda quieto', (await contarCambiosDelPanel(page, 3000)) === 0);
  await clicFila(page, 2);
  await esperar(2500);
  await guardarConClic(page);
  const g2 = await guardados(page);
  chequear('Segunda ficha con su nombre (tildes y eñe limpias)', g2.length === 2 && g2[1].nombre === NOMBRES[2], g2.map((x) => x.nombre));
  chequear('Ninguna descarga del navegador (carpeta Descargas)', servidor.descargasDelNavegador === 0);
  await ctx.close();
}

async function pruebaX1(nav) {
  const { page, ctx } = await nuevaPagina(nav, { prefs: { rjuplus_auto: false } });
  await clicFila(page, 0); await esperar(1500);
  await page.evaluate(() => { window.__falla = true; window.__marcar = false; });
  await clicFila(page, 2); await esperar(1500);
  const est = await textoEstado(page);
  chequear('X1: un clic que falla no renombra la ficha en pantalla', !/NUÑEZ/.test(est), est);
  await page.evaluate(() => { window.__falla = false; });
  await page.evaluate(() => window.__mostrar(0, false)); // la página redibuja la ficha sin clic
  await esperar(1500);
  await page.click('#rjuplus .pastilla');
  await page.click('#rjuplus button:not(.secundario)');
  await esperar(1500);
  const g = await guardados(page);
  chequear('X1: el clic fallido se olvida (nombre genérico, no NUÑEZ)', g[0] && GENERICO.test(g[0].nombre), g.map((x) => x.nombre));
  await ctx.close();
}

async function pruebaX1Marcada(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  await clicFila(page, 0); await esperar(2500); await guardarConClic(page);
  await page.evaluate(() => { window.__falla = true; });
  await clicFila(page, 2); await esperar(2500);
  chequear('X1m: con fila marcada, el clic fallido no genera nada', (await botonGuardar(page)) === null && (await guardados(page)).length === 1);
  await ctx.close();
}

async function pruebaX2(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  await page.evaluate(() => { window.__marcar = false; });
  await clicFila(page, 0); await esperar(2500); await guardarConClic(page);
  await page.evaluate(() => { window.__demora = 3000; });
  await clicFila(page, 3);
  await esperar(1500); // durante el pedido lento cambia la página ("Cargando...")
  chequear('X2: durante un pedido lento la ficha anterior no toma el nombre nuevo', (await botonGuardar(page)) === null, await textoEstado(page));
  await esperar(3500);
  await guardarConClic(page);
  const g = await guardados(page);
  chequear('X2: al llegar, la ficha nueva lleva su nombre', g.length === 2 && g[1].nombre === NOMBRES[3] && g[1].imagenes[0] === '330x450', g.map((x) => x.nombre));
  await ctx.close();
}

async function pruebaX4(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  await clicFila(page, 0); await esperar(2500); await guardarConClic(page);
  // La fila de PEREZ sigue marcada y las imágenes pasan a ser de GOMEZ, sin clic.
  await page.evaluate(() => { window.__dibujar(1); window.__terminar(); });
  await esperar(2500);
  const b = await botonGuardar(page);
  chequear('X4: imágenes nuevas sin clic con la fila anterior marcada: nombre genérico', b && !b.includes('PEREZ') && /RJU_ficha_/.test(b), b);
  await guardarConClic(page);
  const g = await guardados(page);
  chequear('X4: el PDF lleva las imágenes nuevas', g[1] && g[1].imagenes.every((x) => x === '310x430'), g[1]);
  await ctx.close();
}

async function pruebaConflicto(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  // El clic es en NUÑEZ, pero el sitio marca a DIAZ.
  await page.evaluate(() => {
    const orig = window.__mostrar;
    window.__mostrar = (i, m) => { orig(i, false); window.__marcarFila(3); };
  });
  await clicFila(page, 2); await esperar(2500);
  const b = await botonGuardar(page);
  chequear('Fila marcada distinta de la del clic: nombre genérico', b && /RJU_ficha_/.test(b), b);
  await ctx.close();
}

async function pruebaRespaldoDelClic(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  await page.evaluate(() => { window.__marcar = false; });
  await clicFila(page, 2); await esperar(2500);
  const b = await botonGuardar(page);
  chequear('Sin fila marcada: usa los datos del clic', b && b.includes(NOMBRES[2]), b);
  await ctx.close();
}

async function pruebaClicSinFichaNueva(nav) {
  // Panel cerrado: la ficha A aparece sin que RJU+ la registre; durante un
  // pedido lento a otra fila se pide "Descargar": no debe tomar esa fila.
  const { page, ctx } = await nuevaPagina(nav);
  await page.click('#rjuplus .pastilla');
  await page.click('#rjuplus [data-b="cerrar"]');
  await page.evaluate(() => { window.__marcar = false; window.__dibujar(0); window.__demora = 4000; });
  await esperar(800);
  await clicFila(page, 2);
  await esperar(500);
  await page.click('#lnkDesc');
  await esperar(2500);
  const g = await guardados(page);
  chequear('X2: la ficha anterior al clic nunca toma los datos de ese clic', g[0] && GENERICO.test(g[0].nombre), g.map((x) => x.nombre));
  await ctx.close();
}

async function pruebaClicDeUnSoloUso(nav) {
  // Sin aviso de fin de pedido: el clic se consume al aceptar la ficha.
  const { page, ctx } = await nuevaPagina(nav);
  await page.evaluate(() => { window.__sinFin = true; window.__marcar = false; });
  await clicFila(page, 1); await esperar(2500); await guardarConClic(page);
  await page.evaluate(() => window.__dibujar(1)); // redibujo sin clic
  await esperar(2500);
  const b = await botonGuardar(page);
  chequear('El clic se usa una sola vez: el redibujo sin clic lleva nombre genérico', b && /RJU_ficha_/.test(b), b);
  await ctx.close();
}

async function pruebaR13(nav) {
  const { page, ctx } = await nuevaPagina(nav, { paginador: true });
  await clicFila(page, 1); await esperar(2500);
  const b = await botonGuardar(page);
  chequear('R13: con paginador arriba toma la fila correcta', b && b.includes(NOMBRES[1]), b);
  await ctx.close();
}

async function pruebaDescargarDelSitio(nav) {
  const { page, ctx, servidor } = await nuevaPagina(nav, { prefs: { rjuplus_auto: false } });
  await clicFila(page, 0); await esperar(1500);
  chequear('Con la preparación automática apagada no arma nada', (await botonGuardar(page)) === null);
  await page.click('#lnkDesc');
  await esperar(2000);
  const ll = await page.evaluate(() => window.__llamadas);
  const s = await selectores(page); const g = await guardados(page);
  chequear('R8: el enlace Descargar del sitio pasa por RJU+, con selector dentro del clic', s.length === 1 && s[0].activo && g.length === 1 && g[0].nombre === NOMBRES[0] && !ll.some((x) => x.startsWith('Descargar')), { s, ll });
  await page.evaluate(() => window.__doPostBack('Descargar', ''));
  await esperar(1500);
  chequear('El selector se abre antes de armar el PDF (mientras dura el clic)', s[0] && s[0].lienzos === 0, s[0]);
  chequear('R8: __doPostBack(Descargar) directo no llega al servidor', !(await page.evaluate(() => window.__llamadas)).some((x) => x.startsWith('Descargar')));
  chequear('Ninguna descarga del navegador', servidor.descargasDelNavegador === 0);
  await ctx.close();
}

async function pruebaCancelar(nav) {
  const { page, ctx } = await nuevaPagina(nav, { selector: 'cancelar' });
  await clicFila(page, 0); await esperar(2500);
  await guardarConClic(page);
  chequear('Cancelar el selector: no guarda y el botón sigue', (await guardados(page)).length === 0 && (await botonGuardar(page)) !== null, await textoEstado(page));
  await page.evaluate(() => { window.__modoSelector = 'ok'; });
  await guardarConClic(page);
  chequear('Después de cancelar, se puede guardar', (await guardados(page)).length === 1);
  await ctx.close();
}

async function pruebaSinSelector(nav) {
  const { page, ctx, servidor } = await nuevaPagina(nav, { sinSelector: true });
  await clicFila(page, 0); await esperar(2500);
  await guardarConClic(page);
  await esperar(1000);
  const est = await textoEstado(page);
  chequear('Sin selector de archivos: avisa y no descarga a Descargas (X3)', servidor.descargasDelNavegador === 0 && /no permite elegir dónde guardar/.test(est), est);
  await ctx.close();
}

async function pruebaErrorEnCastellano(nav) {
  const { page, ctx } = await nuevaPagina(nav, { lienzoBloqueado: true });
  await clicFila(page, 0); await esperar(2500);
  const est = await textoEstado(page);
  chequear('R5/7: error del navegador en castellano', /no permitió copiar la imagen/.test(est) && !/Tainted|Failed|canvas/i.test(est), est);
  await ctx.close();
}

async function pruebaErrorPersiste(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  await page.click('#rjuplus .pastilla');
  await page.click('#rjuplus button:not(.secundario)');
  await esperar(500);
  await page.evaluate(() => document.body.appendChild(document.createElement('span')));
  await esperar(1500);
  const est = await textoEstado(page);
  chequear('R12: el error queda a la vista aunque la página cambie', /No hay ninguna ficha abierta/.test(est), est);
  await ctx.close();
}

async function pruebaCerrarYMaximizar(nav) {
  const { page, ctx } = await nuevaPagina(nav);
  await page.click('#rjuplus .pastilla');
  await page.click('#rjuplus [data-b="max"]');
  await clicFila(page, 1);
  await esperar(3000);
  await guardarConClic(page);
  const m = await page.evaluate(() => ({ max: document.getElementById('rjuplus').classList.contains('max'),
    minis: document.querySelectorAll('#rjuplus .minis canvas').length, hist: document.querySelectorAll('#rjuplus .hist li').length }));
  chequear('Maximizar muestra páginas y fichas de la sesión', m.max && m.minis === 2 && m.hist === 1, m);
  await page.click('#rjuplus [data-b="min"]');
  await page.click('#rjuplus .pastilla');
  chequear('Restaurar vuelve al modo anterior (maximizado)', await page.evaluate(() => document.getElementById('rjuplus').classList.contains('max')));
  await page.click('#rjuplus [data-b="cerrar"]');
  await clicFila(page, 3);
  await esperar(2500);
  chequear('R6: cerrar apaga la preparación automática', (await botonGuardar(page)) === null && (await guardados(page)).length === 1);
  await page.click('#lnkDesc');
  await esperar(4000);
  chequear('Cerrada, el enlace Descargar sigue pasando por RJU+ con el nombre correcto', (await guardados(page)).length === 2 && (await guardados(page))[1].nombre === NOMBRES[3], { est: await textoEstado(page), sel: await selectores(page), g: await guardados(page) });
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

async function pruebaReintento(nav) {
  const { page, ctx } = await nuevaPagina(nav, { imagenes: 'nunca' });
  await clicFila(page, 0);
  await esperar(23000);
  const est = await textoEstado(page);
  const color = await page.evaluate(() => document.querySelector('#rjuplus .pastilla').style.background);
  chequear('R4/R12: imágenes que no cargan: error visible, nada para guardar', /no terminaron de cargar/.test(est) && (await botonGuardar(page)) === null, est);
  chequear('Pastilla en rojo ante el error', /179, 38, 30|b3261e/i.test(color), color);
  await ctx.close();
}

(async () => {
  await pruebaEstatica();
  const nav = await chromium.launch();
  const pruebas = [pruebaArranque, pruebaAutomatica, pruebaX1, pruebaX1Marcada, pruebaX2, pruebaX4, pruebaConflicto, pruebaRespaldoDelClic, pruebaClicSinFichaNueva, pruebaClicDeUnSoloUso, pruebaR13,
    pruebaDescargarDelSitio, pruebaCancelar, pruebaSinSelector, pruebaErrorEnCastellano, pruebaErrorPersiste, pruebaCerrarYMaximizar, pruebaPreferencia, pruebaReintento];
  for (const p of pruebas) {
    try { await p(nav); } catch (e) { chequear(p.name + ' (excepción)', false, e.message); }
  }
  await nav.close();
  const malas = resultados.filter((r) => !r.ok).length;
  console.log('\n' + (resultados.length - malas) + ' en verde, ' + malas + ' fallas.');
  process.exit(malas ? 1 : 0);
})();
