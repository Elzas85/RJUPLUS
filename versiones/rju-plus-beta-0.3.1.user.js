// ==UserScript==
// @name         RJU+ - Bajar ficha del Registro de Juicios Universales
// @namespace    ignacio.kinbaum
// @version      0.3.1
// @description  Baja en PDF la ficha del Registro de Juicios Universales de la SCBA, armada con las mismas imágenes que se ven en pantalla. No usa la descarga del sitio, que falla con error de servidor y a veces entrega la ficha de otro registro. Puede preparar la ficha sola apenas se abre; cada descarga pregunta dónde guardarse, nunca en una carpeta fija. Panel movible, con minimizar, maximizar y cerrar.
// @author       Ignacio Kinbaum
// @license      Todos los derechos reservados
// @copyright    2026, Ignacio Kinbaum (estudiojuridicokinbaum@gmail.com)
// @supportURL   mailto:estudiojuridicokinbaum@gmail.com
// @match        https://rju.scba.gov.ar/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        unsafeWindow
// @require      https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js#sha384=weMABwrltA6jWR8DDe9Jp5blk+tZQh7ugpCsF3JwSA53WZM9/14PjS5LAJNHNjAI
// ==/UserScript==
/*
 * RJU+ - Bajar ficha del Registro de Juicios Universales
 * Copyright (C) 2026  Ignacio Kinbaum  <estudiojuridicokinbaum@gmail.com>
 * Todos los derechos reservados. Queda prohibida su copia, modificación o
 * distribución sin autorización escrita del autor. Se entrega sin garantía.
 * Desde la 0.3.0 (decisión del autor del 16/10/2026 para las aplicaciones de
 * Lex+) las actualizaciones no se distribuyen por GitHub.
 *
 * Funcionamiento
 *
 *   1. La ficha que el RJU muestra en pantalla son imágenes /imagegen.aspx
 *      (una por página). Las de /imagenpaginagen.aspx son las bandas con el
 *      número de página y no forman parte de la ficha.
 *   2. El PDF se arma copiando esas imágenes tal como están en pantalla
 *      (lienzo). No se vuelven a pedir al servidor: el servidor es el que, a
 *      veces, entrega la ficha de otro registro.
 *   3. Cada juego de imágenes distinto es una ficha distinta. Los datos del
 *      nombre del archivo (año, apellido, nombre, documento) se toman de la
 *      fila de la grilla en la que se hizo clic, y solo valen para la primera
 *      ficha distinta de la que había en pantalla al momento del clic. El clic
 *      se olvida si el pedido al sitio termina sin ficha nueva o si la página
 *      hace cualquier otro envío. Si la fila que el RJU marca como elegida
 *      (fondo celeste) no coincide con la del clic, o si no hay clic, el
 *      archivo se nombra en forma genérica.
 *   4. Cada guardado abre el selector de archivos de Chrome, que siempre
 *      pregunta dónde guardar (decisión del autor del 04/11/2026). El selector
 *      necesita un clic: con la bajada automática, RJU+ arma el PDF solo y el
 *      panel se abre con el botón "Elegir dónde guardar". Nunca se guarda en
 *      una carpeta fija ni en la carpeta Descargas.
 *   5. Una ficha se da por guardada solo después de escribirse el archivo.
 *      Las preparaciones automáticas que fallan se reintentan hasta tres veces.
 *   6. El observador de la página ignora los cambios del propio panel.
 *
 * Origen de las correcciones: reporte de revisión de código del 28/10/2026
 * (hallazgos R1 a R14, versión 0.3.0) y revisión independiente de la 0.3.0
 * del 03/11/2026 (versión 0.3.1).
 */
/* global PDFLib */
(function () {
  'use strict';

  // ------------------------------------------------------------ configuración

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const APP = {
    nombre: 'RJU+ - Bajar ficha del Registro de Juicios Universales',
    version: 'beta 0.3.1',
    autor: 'Ignacio Kinbaum',
    licencia: 'Todos los derechos reservados'
  };

  const COLOR = {
    verde: '#1a7f37',
    ambar: '#b7791f',
    rojo: '#b3261e',
    texto: '#333'
  };

  const CLAVE_AUTO = 'rjuplus_auto';
  const ID_PANEL = 'rjuplus';

  // Colores con que el RJU pinta las filas de la grilla (relevados en vivo el
  // 03/11/2026): blanco y gris alternados; celeste la fila elegida.
  const COLOR_FILA_ELEGIDA = 'rgb(161, 220, 242)';
  const COLORES_ALTERNADOS = ['rgb(255, 255, 255)', 'rgb(217, 218, 219)'];

  const ESPERA_IMAGENES_MS = 20000;
  const PAUSA_REINTENTO_MS = 3000;
  const MAX_INTENTOS_AUTO = 3;
  const A4 = { ancho: 595.28, alto: 841.89, margen: 14 };

  // Columnas de la grilla, reconocidas por el encabezado (con la posición
  // relevada como respaldo).
  const REGLAS_COLUMNAS = [
    ['anio', /^ano$/, 1],
    ['oficio', /oficio/, 2],
    ['apellido', /apellido/, 3],
    ['nombre', /^nombre/, 4],
    ['documento', /documento/, 5],
    ['fallecimiento', /fallec/, 6]
  ];

  // ------------------------------------------------------------------- estado

  const S = {
    clic: null,              // { datos, indice, firmaAntes }: clic en la grilla aún sin ficha
    fichaActual: null,       // { clave, firma, imgs, datos, origen }
    guardadas: new Set(),    // claves de fichas ya guardadas
    intentos: new Map(),     // clave -> preparaciones automáticas fallidas
    trabajando: false,
    apagada: false,
    pendiente: null,         // { blob, nombre, ficha }: PDF armado, a la espera de "Elegir dónde guardar"
    historial: [],           // fichas procesadas en esta sesión
    observador: null,
    temporizador: null,
    modo: 'min',             // 'min' | 'normal' | 'max'
    modoAnterior: 'normal'
  };

  const UI = {};

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  // -------------------------------------------------------------- preferencias

  function leerGM(clave) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(clave, undefined);
    } catch (e) { /* sin Tampermonkey */ }
    return undefined;
  }

  // Valor guardado por la 0.2.0 en el almacenamiento del sitio.
  function leerAnterior(clave) {
    try {
      const v = localStorage.getItem(clave);
      return v === null ? undefined : v === '1';
    } catch (e) { return undefined; }
  }

  function leerPref(clave, porDefecto) {
    const gm = leerGM(clave);
    if (gm !== undefined) return gm;
    const anterior = leerAnterior(clave);
    return anterior === undefined ? porDefecto : anterior;
  }

  function guardarPref(clave, valor) {
    try {
      if (typeof GM_setValue === 'function') { GM_setValue(clave, valor); return; }
    } catch (e) { /* se intenta en el sitio */ }
    try { localStorage.setItem(clave, valor ? '1' : '0'); } catch (e) { /* sin persistencia */ }
  }

  // La bajada automática viene activada por decisión del autor ("que la
  // ficha se baje directamente al abrirla").
  function autoActiva() {
    return UI.chkAuto ? UI.chkAuto.checked : leerPref(CLAVE_AUTO, true);
  }

  // ------------------------------------------------------------------ textos

  function textoCelda(td) {
    return (td.innerText || td.textContent || '').trim();
  }

  function normalizar(s) {
    return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  }

  function limpiarNombre(s) {
    return String(s || '')
      .normalize('NFD').replace(/\p{M}/gu, '')
      .replace(/[^A-Za-z0-9_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '');
  }

  function dosCifras(n) {
    return String(n).padStart(2, '0');
  }

  function sello(d) {
    return d.getFullYear() + dosCifras(d.getMonth() + 1) + dosCifras(d.getDate()) + '-' +
      dosCifras(d.getHours()) + dosCifras(d.getMinutes()) + dosCifras(d.getSeconds());
  }

  function horaCorta(d) {
    return dosCifras(d.getHours()) + ':' + dosCifras(d.getMinutes());
  }

  // Error propio, con el texto ya en castellano.
  function errorPropio(texto) {
    const e = new Error(texto);
    e.rjuplus = true;
    return e;
  }

  const ERRORES_DEL_NAVEGADOR = [
    [/tainted|SecurityError/i, 'el navegador no permitió copiar la imagen de la ficha'],
    [/PDFLib/, 'no se cargó la biblioteca que arma el PDF; recargá la página'],
    [/NotAllowedError|user activation|gesture/i, 'Chrome no permitió abrir el cuadro para elegir dónde guardar; volvé a hacer clic'],
    [/QuotaExceeded|NoModificationAllowed|InvalidState/i, 'no se pudo escribir el archivo en la carpeta elegida'],
    [/memory|allocation/i, 'no alcanzó la memoria para armar el PDF']
  ];

  // Los mensajes del navegador vienen en inglés: se muestran en castellano.
  function mensajeDeError(e) {
    if (e && e.rjuplus) return e.message;
    const crudo = (e && (e.name + ' ' + e.message)) || String(e);
    const regla = ERRORES_DEL_NAVEGADOR.find(([re]) => re.test(crudo));
    return regla ? regla[1] : 'ocurrió un error inesperado del navegador';
  }

  function nombreArchivo(datos) {
    const d = datos || {};
    const partes = ['RJU', d.anio, d.apellido, d.nombre, d.documento]
      .map(limpiarNombre)
      .filter((x) => x && x !== '0');
    if (partes.length > 1) return partes.join('_') + '.pdf';
    return 'RJU_ficha_' + sello(new Date()) + '.pdf';
  }

  function descripcionDatos(datos) {
    if (!datos || !datos.apellido) return '';
    return datos.apellido + ' ' + (datos.nombre || '') +
      (datos.documento ? ', doc. ' + datos.documento : '');
  }

  // ------------------------------------------------------- lectura de la grilla

  function grilla() {
    return document.getElementById('GridConsulta');
  }

  function enlaceSelect(tr) {
    return Array.from(tr.querySelectorAll('[onclick],[href]')).find((el) =>
      /Select\$\d+/.test((el.getAttribute('onclick') || '') + (el.getAttribute('href') || '')));
  }

  function filasDeDatos(g) {
    return Array.from(g.rows).filter((tr) => enlaceSelect(tr));
  }

  function columnasDeLaGrilla(g) {
    const enc = g.rows[0] ? Array.from(g.rows[0].cells).map((td) => normalizar(textoCelda(td))) : [];
    const col = {};
    REGLAS_COLUMNAS.forEach(([campo, re, respaldo]) => {
      const i = enc.findIndex((t) => re.test(t));
      col[campo] = i >= 0 ? i : respaldo;
    });
    return col;
  }

  function datosDeFila(tr, col) {
    const celdas = Array.from(tr.cells).map(textoCelda);
    const datos = {};
    Object.keys(col).forEach((campo) => { datos[campo] = celdas[col[campo]] || ''; });
    return datos;
  }

  // Busca la fila por su enlace Select$N y no por la posición: con un
  // paginador arriba, la posición no coincide con el índice (R13).
  function filaPorIndice(g, idx) {
    const re = new RegExp('Select\\$' + idx + '(?!\\d)');
    const porEnlace = Array.from(g.rows).find((tr) => {
      const el = enlaceSelect(tr);
      return el && re.test((el.getAttribute('onclick') || '') + (el.getAttribute('href') || ''));
    });
    return porEnlace || null;
  }

  // Fila que el RJU marca como elegida después del envío.
  function filaMarcada(g) {
    const filas = filasDeDatos(g);
    const celeste = filas.find((tr) => tr.style.backgroundColor === COLOR_FILA_ELEGIDA);
    if (celeste) return celeste;
    const distintas = filas.filter((tr) =>
      tr.style.backgroundColor && !COLORES_ALTERNADOS.includes(tr.style.backgroundColor));
    return distintas.length === 1 ? distintas[0] : null;
  }

  function mismosDatos(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  // La fila marcada sirve de control: si existe y no es la del clic, los
  // datos no se usan (X4).
  function marcaContradiceAlClic(datosClic) {
    const g = grilla();
    const tr = g ? filaMarcada(g) : null;
    return !!tr && !mismosDatos(datosDeFila(tr, columnasDeLaGrilla(g)), datosClic);
  }

  // El clic vale solo para una ficha distinta de la que había al hacerlo (X1, X2).
  function datosDeLaFichaAbierta(firma) {
    const c = S.clic;
    if (!c || c.firmaAntes === firma) return { datos: null, origen: 'ninguno' };
    if (marcaContradiceAlClic(c.datos)) return { datos: null, origen: 'conflicto' };
    return { datos: c.datos, origen: 'clic' };
  }

  // ------------------------------------------------------- ficha en pantalla

  function urlDeImagen(img) {
    try { return new URL(img.src, location.href); } catch (e) { return null; }
  }

  function esImagenFicha(img) {
    const u = urlDeImagen(img);
    return !!u && u.pathname.toLowerCase().endsWith('/imagegen.aspx');
  }

  function nroPagina(img) {
    const u = urlDeImagen(img);
    return u ? parseInt(u.searchParams.get('pagina') || '0', 10) : 0;
  }

  function imagenesDeLaFicha() {
    return Array.from(document.querySelectorAll('img'))
      .filter((img) => !img.closest('#' + ID_PANEL))
      .filter(esImagenFicha)
      .sort((a, b) => nroPagina(a) - nroPagina(b));
  }

  function firmaDeImagenes(imgs) {
    return imgs.map((i) => i.src).join('|');
  }

  function firmaEnPantalla() {
    return firmaDeImagenes(imagenesDeLaFicha());
  }

  // Cada juego de imágenes es una ficha: la clave no depende de los datos.
  function fichaEnPantalla() {
    const imgs = imagenesDeLaFicha();
    if (!imgs.length) return null;
    const firma = firmaDeImagenes(imgs);
    const { datos, origen } = datosDeLaFichaAbierta(firma);
    return { clave: 'imagenes:' + firma, firma, imgs, datos, origen };
  }

  function imagenesCargadas(imgs) {
    return imgs.length > 0 && imgs.every((i) => i.isConnected && i.complete && i.naturalWidth > 0);
  }

  async function esperarCarga(imgs, msMax) {
    const t0 = Date.now();
    while (Date.now() - t0 < msMax) {
      if (imagenesCargadas(imgs)) return true;
      await dormir(250);
    }
    return false;
  }

  // ------------------------------------------------------------ armado del PDF

  // La imagen se copia tal como está en pantalla (R2, R5). Las imágenes son
  // del mismo sitio, así que el lienzo no queda bloqueado.
  async function bytesDeImagenEnPantalla(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    if (!blob) throw errorPropio('no se pudo copiar la imagen de la página ' + (nroPagina(img) || ''));
    return new Uint8Array(await blob.arrayBuffer());
  }

  function medidasEnHoja(im) {
    const esc = Math.min((A4.ancho - A4.margen * 2) / im.width, (A4.alto - A4.margen * 2) / im.height);
    const w = im.width * esc;
    const h = im.height * esc;
    return { x: (A4.ancho - w) / 2, y: (A4.alto - h) / 2, width: w, height: h };
  }

  async function agregarPagina(doc, img) {
    const im = await doc.embedPng(await bytesDeImagenEnPantalla(img));
    const pag = doc.addPage([A4.ancho, A4.alto]);
    pag.drawImage(im, medidasEnHoja(im));
  }

  async function nuevoDocumento(titulo) {
    const doc = await PDFLib.PDFDocument.create();
    doc.setTitle(titulo);
    doc.setProducer('RJU+ ' + APP.version);
    doc.setCreator('RJU+ ' + APP.version);
    return doc;
  }

  async function armarPdf(ficha, nombre) {
    estado('Esperando que carguen las páginas...', 'trabajando');
    if (!await esperarCarga(ficha.imgs, ESPERA_IMAGENES_MS)) {
      throw errorPropio('las imágenes de la ficha no terminaron de cargar');
    }
    const doc = await nuevoDocumento(nombre.replace(/\.pdf$/, ''));
    for (let i = 0; i < ficha.imgs.length; i++) {
      estado('Armando página ' + (i + 1) + ' de ' + ficha.imgs.length + '...', 'trabajando');
      await agregarPagina(doc, ficha.imgs[i]);
    }
    return new Blob([await doc.save()], { type: 'application/pdf' });
  }

  // --------------------------------------------------------------- guardado

  function selectorDeArchivos() {
    const s = W.showSaveFilePicker || window.showSaveFilePicker;
    return typeof s === 'function' ? s : null;
  }

  // Abre el cuadro "Guardar como" de Chrome. Tiene que llamarse en el mismo
  // clic, antes de cualquier espera. Devuelve null si se canceló.
  async function pedirDestino(nombre) {
    const selector = selectorDeArchivos();
    if (!selector) throw errorPropio('este navegador no permite elegir dónde guardar; usá Chrome actualizado');
    try {
      return await selector.call(W, {
        suggestedName: nombre,
        startIn: 'documents',
        types: [{ description: 'Documento PDF', accept: { 'application/pdf': ['.pdf'] } }]
      });
    } catch (e) {
      if (e && e.name === 'AbortError') return null;
      throw e;
    }
  }

  async function escribir(destino, blob) {
    const w = await destino.createWritable();
    await w.write(blob);
    await w.close();
  }

  function mostrarPendiente(blob, nombre, ficha) {
    S.pendiente = { blob, nombre, ficha };
    UI.btnGuardar.textContent = 'Elegir dónde guardar ' + nombre;
    UI.btnGuardar.style.display = 'block';
    if (S.modo === 'min') aplicarModo(S.modoAnterior);
  }

  function quitarPendiente() {
    S.pendiente = null;
    if (UI.btnGuardar) UI.btnGuardar.style.display = 'none';
  }

  // ------------------------------------------------------- historial y avisos

  function anotarHistorial(ficha, nombre, resultado) {
    S.historial.unshift({ hora: new Date(), nombre, paginas: ficha.imgs.length, resultado });
    if (S.historial.length > 30) S.historial.length = 30;
    pintarHistorial();
  }

  function aclaracionDeDatos(ficha) {
    if (ficha.origen === 'conflicto') return ' (la fila marcada no coincide con la del clic: nombre genérico)';
    if (ficha.origen === 'ninguno') return ' (sin datos de la fila: nombre genérico)';
    return '';
  }

  function registrarGuardado(ficha, nombre) {
    S.guardadas.add(ficha.clave);
    quitarPendiente();
    anotarHistorial(ficha, nombre, 'guardado');
    estado('Guardada: ' + nombre + aclaracionDeDatos(ficha), 'ok');
  }

  function registrarFalla(ficha, e, automatica) {
    if (automatica) S.intentos.set(ficha.clave, (S.intentos.get(ficha.clave) || 0) + 1);
    estado((automatica ? 'No se pudo armar el PDF: ' : 'No se pudo bajar la ficha: ') + mensajeDeError(e) + '.', 'error');
  }

  // --------------------------------------------- preparación automática

  // Arma el PDF de la ficha nueva y deja listo "Elegir dónde guardar".
  async function prepararFicha(ficha) {
    const nombre = nombreArchivo(ficha.datos);
    S.trabajando = true;
    try {
      const blob = await armarPdf(ficha, nombre);
      if (S.fichaActual !== ficha) return; // llegó otra ficha mientras tanto
      if (S.pendiente) anotarHistorial(S.pendiente.ficha, S.pendiente.nombre, 'pendiente');
      mostrarPendiente(blob, nombre, ficha);
      estado('PDF listo: elegí dónde guardar ' + nombre + aclaracionDeDatos(ficha) + '.', 'aviso');
    } catch (e) {
      registrarFalla(ficha, e, true);
    } finally {
      S.trabajando = false;
      setTimeout(continuarAutomatico, 0);
    }
  }

  function yaPreparada(ficha) {
    return !!S.pendiente && S.pendiente.ficha.clave === ficha.clave;
  }

  function debePrepararSola(ficha) {
    return !S.apagada && autoActiva() && !S.guardadas.has(ficha.clave) && !yaPreparada(ficha) &&
      (S.intentos.get(ficha.clave) || 0) < MAX_INTENTOS_AUTO;
  }

  // Después de cada preparación: si la ficha en pantalla sigue sin prepararse
  // (otra ficha que llegó mientras tanto, o un intento fallido), se prepara (R4).
  function continuarAutomatico() {
    const ficha = S.fichaActual;
    if (!ficha || S.trabajando || !debePrepararSola(ficha)) return;
    const pausa = S.intentos.get(ficha.clave) ? PAUSA_REINTENTO_MS : 0;
    setTimeout(() => {
      if (S.fichaActual === ficha && !S.trabajando && debePrepararSola(ficha)) prepararFicha(ficha);
    }, pausa);
  }

  // ------------------------------------------------- guardado con un clic

  // Botón "Elegir dónde guardar": guarda el PDF ya armado.
  async function guardarPendiente() {
    const p = S.pendiente;
    if (!p) return;
    try {
      const destino = await pedirDestino(p.nombre);
      if (!destino) { estado('Guardado cancelado. El PDF sigue listo para guardar.', 'aviso'); return; }
      await escribir(destino, p.blob);
      registrarGuardado(p.ficha, p.nombre);
    } catch (e) {
      estado('No se pudo guardar: ' + mensajeDeError(e) + '.', 'error');
    }
  }

  async function bajarConDestino(ficha) {
    const nombre = nombreArchivo(ficha.datos);
    const destino = await pedirDestino(nombre); // primero, mientras dura el clic
    if (!destino) { estado('Guardado cancelado.', 'aviso'); return; }
    S.trabajando = true;
    try {
      await escribir(destino, await armarPdf(ficha, nombre));
      registrarGuardado(ficha, nombre);
    } finally {
      S.trabajando = false;
    }
  }

  // "Bajar ficha en PDF" y el enlace "Descargar" del sitio: siempre con clic.
  // La ficha se toma siempre de la pantalla; si es la misma ya aceptada, se
  // conservan sus datos (con el panel cerrado, la aceptada puede ser vieja).
  function fichaParaBajar() {
    const enPantalla = fichaEnPantalla();
    if (!enPantalla) return null;
    return S.fichaActual && S.fichaActual.clave === enPantalla.clave ? S.fichaActual : enPantalla;
  }

  async function bajarFicha() {
    const ficha = fichaParaBajar();
    if (ficha && yaPreparada(ficha)) { await guardarPendiente(); return; }
    if (S.trabajando) { estado('Ya hay una ficha en preparación.', 'aviso'); return; }
    if (!ficha) { estado('No hay ninguna ficha abierta.', 'error'); return; }
    try {
      await bajarConDestino(ficha);
    } catch (e) {
      registrarFalla(ficha, e, false);
    }
  }

  // ------------------------------------------------------- revisión de página

  function avisarFichaDetectada(ficha) {
    const quien = descripcionDatos(ficha.datos);
    estado('Ficha detectada: ' + ficha.imgs.length + (ficha.imgs.length === 1 ? ' página' : ' páginas') +
      (quien ? ', ' + quien : '') + aclaracionDeDatos(ficha) + '.', 'neutro');
  }

  // El aviso solo se escribe cuando la ficha cambia: un error queda a la
  // vista aunque la página cambie (R12).
  function sinFicha() {
    if (!S.fichaActual) return;
    S.fichaActual = null;
    if (!S.trabajando && !S.pendiente) estado('Esperando que abras una ficha.', 'neutro');
  }

  function aceptarFicha(ficha) {
    S.fichaActual = ficha;
    S.clic = null; // el clic se usa una sola vez
    if (!S.trabajando) avisarFichaDetectada(ficha);
    pintarMiniaturas(ficha);
    continuarAutomatico();
  }

  // Con el panel cerrado se sigue registrando la ficha abierta (para el
  // enlace "Descargar" del sitio), pero no se prepara nada solo.
  function revisar() {
    engancharPagina();
    const ficha = fichaEnPantalla();
    if (!ficha) { sinFicha(); return; }
    if (S.fichaActual && S.fichaActual.clave === ficha.clave) return;
    aceptarFicha(ficha);
  }

  // ------------------------------------------------- enganches con el sitio

  function anotarClicEnGrilla(target, arg) {
    const m = /^Select\$(\d+)$/.exec(String(arg || ''));
    if (String(target) !== 'GridConsulta' || !m) { S.clic = null; return; }
    const g = grilla();
    const tr = g ? filaPorIndice(g, parseInt(m[1], 10)) : null;
    S.clic = tr ? { datos: datosDeFila(tr, columnasDeLaGrilla(g)), indice: m[1], firmaAntes: firmaEnPantalla() } : null;
  }

  // El enlace "Descargar" del sitio llama a __doPostBack('Descargar'): esa
  // llamada no llega al servidor y se reemplaza por la bajada de RJU+ (R8).
  // Cualquier otro envío anota u olvida el clic en la grilla.
  function envolverPostBack(original) {
    const envoltorio = function (target) {
      if (String(target) === 'Descargar') { bajarFicha(); return false; }
      try { anotarClicEnGrilla(target, arguments[1]); } catch (e) { S.clic = null; }
      return original.apply(this, arguments);
    };
    envoltorio.__rjuplus = true;
    return envoltorio;
  }

  function engancharPostBack() {
    const actual = W.__doPostBack;
    if (typeof actual !== 'function' || actual.__rjuplus) return;
    W.__doPostBack = envolverPostBack(actual);
  }

  // El enlace del sitio es "javascript:Descargar()": se reemplaza la función.
  function reemplazarDescargar() {
    if (W.Descargar && W.Descargar.__rjuplus) return;
    const nueva = function () { bajarFicha(); return false; };
    nueva.__rjuplus = true;
    W.Descargar = nueva;
  }

  // Al terminar un pedido al sitio: se revisa la página y, si no llegó una
  // ficha nueva, el clic se olvida (X1: el pedido falló).
  function alTerminarPedido() {
    setTimeout(() => {
      revisar();
      S.clic = null;
    }, 400);
  }

  function engancharAjax() {
    try {
      const prm = W.Sys && W.Sys.WebForms && W.Sys.WebForms.PageRequestManager &&
        W.Sys.WebForms.PageRequestManager.getInstance();
      if (prm && !prm.__rjuplus) {
        prm.add_endRequest(alTerminarPedido);
        prm.__rjuplus = true;
      }
    } catch (e) { /* el sitio puede no tener ScriptManager en todas las vistas */ }
  }

  function engancharPagina() {
    engancharPostBack();
    reemplazarDescargar();
    engancharAjax();
  }

  // Los cambios del propio panel no cuentan: así no hay bucle (R1).
  function esCambioDelPanel(m) {
    const n = m.target.nodeType === 1 ? m.target : m.target.parentElement;
    return !!(n && n.closest && n.closest('#' + ID_PANEL));
  }

  function alCambiarLaPagina(cambios) {
    if (cambios.every(esCambioDelPanel)) return;
    clearTimeout(S.temporizador);
    S.temporizador = setTimeout(revisar, 500);
  }

  function observar() {
    S.observador = new MutationObserver(alCambiarLaPagina);
    S.observador.observe(document.body, { childList: true, subtree: true });
  }

  // Cerrar apaga la preparación automática hasta recargar la página (R6). El
  // enlace "Descargar" del sitio sigue pasando por RJU+, para no recibir la
  // ficha equivocada; esa descarga siempre pregunta dónde guardar.
  function apagar() {
    S.apagada = true;
    if (S.observador) S.observador.disconnect();
    clearTimeout(S.temporizador);
    quitarPendiente();
    UI.cont.style.display = 'none';
  }

  // ------------------------------------------------------------------ interfaz

  function css() {
    const v = COLOR.verde;
    const s = document.createElement('style');
    s.textContent = [
      '#rjuplus{position:fixed;right:16px;bottom:16px;z-index:999999;font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:#333}',
      '#rjuplus .caja{background:#fff;border:2px solid ' + v + ';border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);width:310px}',
      '#rjuplus.max .caja{width:min(640px,90vw)}',
      '#rjuplus .barra{background:' + v + ';color:#fff;padding:6px 10px;border-radius:4px 4px 0 0;display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none}',
      '#rjuplus .ctrl{display:flex;gap:2px}',
      '#rjuplus .ctrl span{width:20px;height:18px;line-height:18px;text-align:center;border-radius:3px;cursor:pointer;font-size:12px}',
      '#rjuplus .ctrl span:hover{background:rgba(255,255,255,.25)}',
      '#rjuplus .barra b{letter-spacing:.5px;font-size:14px}',
      '#rjuplus .cuerpo{padding:10px;max-height:80vh;overflow:auto}',
      '#rjuplus button{background:' + v + ';color:#fff;border:0;border-radius:5px;padding:7px 10px;cursor:pointer;font-size:13px;width:100%;margin-bottom:6px;word-break:break-word}',
      '#rjuplus button.secundario{background:' + COLOR.ambar + ';font-weight:600}',
      '#rjuplus label{display:flex;gap:6px;align-items:center;margin:4px 0 6px;cursor:pointer}',
      '#rjuplus .est{font-size:12px;line-height:1.35;min-height:32px;border-top:1px solid #e3e3e3;padding-top:7px;word-break:break-word}',
      '#rjuplus .ampliado{display:none;border-top:1px solid #e3e3e3;margin-top:8px;padding-top:6px}',
      '#rjuplus.max .ampliado{display:block}',
      '#rjuplus .ampliado h4{margin:4px 0;font-size:12px;color:' + v + '}',
      '#rjuplus .minis{display:flex;flex-wrap:wrap;gap:6px}',
      '#rjuplus .minis canvas{border:1px solid #ccc}',
      '#rjuplus .hist{font-size:11.5px;margin:0;padding-left:16px}',
      '#rjuplus .pie{font-size:10.5px;color:#777;margin-top:6px;border-top:1px solid #eee;padding-top:5px}',
      '#rjuplus .pastilla{background:' + v + ';color:#fff;padding:7px 12px;border-radius:16px;cursor:move;box-shadow:0 3px 10px rgba(0,0,0,.3);font-weight:600;user-select:none}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function botonVentana(accion, titulo, simbolo) {
    return '<span data-b="' + accion + '" title="' + titulo + '">' + simbolo + '</span>';
  }

  function crearBarra() {
    const barra = document.createElement('div');
    barra.className = 'barra';
    barra.innerHTML = '<b>RJU+</b><span class="ctrl">' +
      botonVentana('min', 'Minimizar', '&#8211;') +
      botonVentana('max', 'Maximizar o restaurar', '&#9633;') +
      botonVentana('cerrar', 'Cerrar: RJU+ deja de preparar fichas solo hasta recargar la página', '&#10005;') +
      '</span>';
    return barra;
  }

  function crearBoton(texto, alHacerClic, clase) {
    const b = document.createElement('button');
    b.textContent = texto;
    if (clase) b.className = clase;
    b.addEventListener('click', alHacerClic);
    return b;
  }

  function crearOpcionAuto() {
    const lab = document.createElement('label');
    UI.chkAuto = document.createElement('input');
    UI.chkAuto.type = 'checkbox';
    UI.chkAuto.checked = leerPref(CLAVE_AUTO, true);
    UI.chkAuto.addEventListener('change', () => {
      guardarPref(CLAVE_AUTO, UI.chkAuto.checked);
      if (UI.chkAuto.checked) continuarAutomatico();
    });
    lab.appendChild(UI.chkAuto);
    lab.appendChild(document.createTextNode('Preparar sola al abrir la ficha'));
    return lab;
  }

  function crearAmpliado() {
    const amp = document.createElement('div');
    amp.className = 'ampliado';
    amp.innerHTML = '<h4>Páginas de la ficha abierta (tal como se guardan)</h4><div class="minis"></div>' +
      '<h4>Fichas de esta sesión</h4><ol class="hist"></ol>';
    UI.minis = amp.querySelector('.minis');
    UI.hist = amp.querySelector('.hist');
    return amp;
  }

  function crearPie() {
    const pie = document.createElement('div');
    pie.className = 'pie';
    pie.textContent = APP.version + ' | ' + APP.autor + ' | ' + APP.licencia;
    return pie;
  }

  function crearCuerpo() {
    const cuerpo = document.createElement('div');
    cuerpo.className = 'cuerpo';
    UI.btnGuardar = crearBoton('Elegir dónde guardar', guardarPendiente, 'secundario');
    UI.btnGuardar.style.display = 'none';
    UI.est = document.createElement('div');
    UI.est.className = 'est';
    cuerpo.append(UI.btnGuardar, crearBoton('Bajar ficha en PDF', bajarFicha),
      crearOpcionAuto(), UI.est, crearAmpliado(), crearPie());
    return cuerpo;
  }

  function crearPastilla() {
    const p = document.createElement('div');
    p.className = 'pastilla';
    p.textContent = 'RJU+';
    return p;
  }

  // ---------------------------------------------------- estado en pantalla

  const COLOR_ESTADO = { ok: COLOR.verde, trabajando: COLOR.ambar, aviso: COLOR.ambar, error: COLOR.rojo, neutro: COLOR.verde };

  // Solo escribe si el texto o el tipo cambiaron (R1, R12).
  function estado(txt, tipo) {
    if (!UI.est) return;
    const t = tipo || 'neutro';
    if (UI.est.textContent === txt && UI.est.dataset.tipo === t) return;
    UI.est.textContent = txt;
    UI.est.dataset.tipo = t;
    UI.est.style.color = t === 'error' ? COLOR.rojo : COLOR.texto;
    UI.pastilla.style.background = COLOR_ESTADO[t] || COLOR.verde;
    UI.pastilla.title = txt;
  }

  function miniatura(img) {
    const c = document.createElement('canvas');
    const esc = 140 / (img.naturalWidth || 140);
    c.width = 140;
    c.height = Math.round((img.naturalHeight || 198) * esc);
    try { c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); } catch (e) { /* sin vista previa */ }
    return c;
  }

  async function pintarMiniaturas(ficha) {
    if (!UI.minis) return;
    UI.minis.textContent = '';
    if (!await esperarCarga(ficha.imgs, ESPERA_IMAGENES_MS) || S.fichaActual !== ficha) return;
    ficha.imgs.forEach((img) => UI.minis.appendChild(miniatura(img)));
  }

  const TEXTO_HISTORIAL = { guardado: 'guardada', pendiente: 'sin guardar' };

  function pintarHistorial() {
    if (!UI.hist) return;
    UI.hist.textContent = '';
    S.historial.forEach((h) => {
      const li = document.createElement('li');
      li.textContent = horaCorta(h.hora) + ' | ' + h.nombre + ' | ' + h.paginas +
        (h.paginas === 1 ? ' página' : ' páginas') + ' | ' + TEXTO_HISTORIAL[h.resultado];
      UI.hist.appendChild(li);
    });
  }

  // -------------------------------------------------- ventana: modos y lugar

  function aplicarModo(modo) {
    if (modo !== 'min') S.modoAnterior = modo;
    S.modo = modo;
    UI.caja.style.display = modo === 'min' ? 'none' : 'block';
    UI.pastilla.style.display = modo === 'min' ? 'block' : 'none';
    UI.cont.classList.toggle('max', modo === 'max');
    if (UI.cont.style.left) aplicarPos(parseInt(UI.cont.style.left, 10), parseInt(UI.cont.style.top, 10));
  }

  function alternarMaximizar() {
    aplicarModo(S.modo === 'max' ? 'normal' : 'max');
  }

  function aplicarPos(left, top) {
    const ancho = UI.cont.offsetWidth || 120;
    const alto = UI.cont.offsetHeight || 28;
    const l = Math.max(4, Math.min(left, window.innerWidth - Math.min(ancho, 90) - 4));
    const t = Math.max(4, Math.min(top, window.innerHeight - Math.min(alto, 28) - 4));
    UI.cont.style.left = l + 'px';
    UI.cont.style.top = t + 'px';
    UI.cont.style.right = 'auto';
    UI.cont.style.bottom = 'auto';
  }

  const ARRASTRE = { activo: false, movio: false, recien: false, sx: 0, sy: 0, ox: 0, oy: 0 };

  function alMoverArrastre(e) {
    if (!ARRASTRE.activo) return;
    const dx = e.clientX - ARRASTRE.sx;
    const dy = e.clientY - ARRASTRE.sy;
    if (!ARRASTRE.movio && Math.abs(dx) + Math.abs(dy) < 4) return; // umbral: clic o arrastre
    ARRASTRE.movio = true;
    aplicarPos(ARRASTRE.ox + dx, ARRASTRE.oy + dy);
  }

  function alSoltarArrastre() {
    ARRASTRE.activo = false;
    ARRASTRE.recien = ARRASTRE.movio;
    UI.cont.style.userSelect = '';
    document.removeEventListener('mousemove', alMoverArrastre);
    document.removeEventListener('mouseup', alSoltarArrastre);
  }

  function alEmpezarArrastre(e) {
    if (e.target.closest('[data-b]')) return; // los botones de ventana no arrastran
    e.preventDefault();
    const r = UI.cont.getBoundingClientRect();
    Object.assign(ARRASTRE, { activo: true, movio: false, recien: false, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top });
    UI.cont.style.userSelect = 'none';
    document.addEventListener('mousemove', alMoverArrastre);
    document.addEventListener('mouseup', alSoltarArrastre);
  }

  function alHacerClicEnPastilla() {
    if (ARRASTRE.recien) { ARRASTRE.recien = false; return; } // venía de moverla
    aplicarModo(S.modoAnterior);
  }

  function conectarVentana(barra) {
    barra.addEventListener('mousedown', alEmpezarArrastre);
    UI.pastilla.addEventListener('mousedown', alEmpezarArrastre);
    barra.querySelector('[data-b="min"]').addEventListener('click', () => aplicarModo('min'));
    barra.querySelector('[data-b="max"]').addEventListener('click', alternarMaximizar);
    barra.querySelector('[data-b="cerrar"]').addEventListener('click', apagar);
    UI.pastilla.addEventListener('click', alHacerClicEnPastilla);
    window.addEventListener('resize', () => {
      if (UI.cont.style.left) aplicarPos(parseInt(UI.cont.style.left, 10), parseInt(UI.cont.style.top, 10));
    });
  }

  // Criterio común de Lex+: al cargar, minimizada y anclada abajo a la
  // derecha (confirmado por el autor el 04/11/2026).
  function construirPanel() {
    if (document.getElementById(ID_PANEL)) return;
    css();
    UI.cont = document.createElement('div');
    UI.cont.id = ID_PANEL;
    UI.caja = document.createElement('div');
    UI.caja.className = 'caja';
    const barra = crearBarra();
    UI.caja.append(barra, crearCuerpo());
    UI.pastilla = crearPastilla();
    UI.cont.append(UI.caja, UI.pastilla);
    document.body.appendChild(UI.cont);
    conectarVentana(barra);
    aplicarModo('min');
    estado('Esperando que abras una ficha.', 'neutro');
  }

  // ------------------------------------------------------------- arranque

  function iniciar() {
    construirPanel();
    engancharPagina();
    observar();
    revisar();
    // El ScriptManager puede registrarse después de document-idle.
    setTimeout(engancharAjax, 1500);
    setTimeout(engancharAjax, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
