// ==UserScript==
// @name         RJU+ - Bajar ficha del Registro de Juicios Universales
// @namespace    ignacio.kinbaum
// @version      0.3.0
// @description  Baja en PDF la ficha del Registro de Juicios Universales de la SCBA, armada con las mismas imágenes que se ven en pantalla. No usa la descarga del sitio, que falla con error de servidor y a veces entrega la ficha de otro registro. Puede bajar la ficha sola apenas se abre; cada descarga pregunta dónde guardarse. Panel movible, con minimizar, maximizar y cerrar.
// @author       Ignacio Kinbaum
// @license      Todos los derechos reservados
// @copyright    2026, Ignacio Kinbaum (estudiojuridicokinbaum@gmail.com)
// @supportURL   mailto:estudiojuridicokinbaum@gmail.com
// @match        https://rju.scba.gov.ar/*
// @run-at       document-idle
// @grant        GM_download
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
 *   3. Los datos del nombre del archivo se toman de la fila que el propio RJU
 *      marca como elegida en la grilla después del postback (fondo celeste).
 *      Si no hay fila marcada, se usan los datos de la fila en la que se hizo
 *      clic; si tampoco los hay, el archivo se nombra en forma genérica.
 *   4. Cada descarga abre el cuadro "Guardar como" (GM_download con saveAs).
 *      Si Tampermonkey no puede abrirlo, el panel ofrece "Guardar el PDF",
 *      que abre el selector de archivos de Chrome. Nunca hay carpeta fija.
 *   5. Una ficha se da por guardada solo después de una descarga exitosa.
 *      Las bajadas automáticas que fallan se reintentan hasta tres veces.
 *   6. El observador de la página ignora los cambios del propio panel.
 *
 * Origen de las correcciones de la 0.3.0: reporte de revisión de código del
 * 28/10/2026 (hallazgos R1 a R14) y criterios comunes de Lex+.
 */
/* global PDFLib */
(function () {
  'use strict';

  // ------------------------------------------------------------ configuración

  const W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  const APP = {
    nombre: 'RJU+ - Bajar ficha del Registro de Juicios Universales',
    version: 'beta 0.3.0',
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
    clicFila: null,          // { datos, firma }: fila tomada en el momento del clic
    fichaActual: null,       // { clave, imgs, datos }
    guardadas: new Set(),    // claves de fichas ya guardadas
    resueltas: new Set(),    // claves cuya descarga se canceló a pedido
    intentos: new Map(),     // clave -> intentos automáticos fallidos
    trabajando: false,
    apagada: false,
    pendiente: null,         // { blob, nombre } a la espera de "Guardar el PDF"
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

  function mensajeDeError(e) {
    return e && e.message ? e.message : String(e);
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

  // Fila que el RJU marca como elegida después del postback.
  function filaMarcada(g) {
    const filas = filasDeDatos(g);
    const celeste = filas.find((tr) => tr.style.backgroundColor === COLOR_FILA_ELEGIDA);
    if (celeste) return celeste;
    const distintas = filas.filter((tr) =>
      tr.style.backgroundColor && !COLORES_ALTERNADOS.includes(tr.style.backgroundColor));
    return distintas.length === 1 ? distintas[0] : null;
  }

  // El clic sirve solo para la ficha que llega después de él: queda atado a
  // esas imágenes y una ficha distinta nunca hereda sus datos (R3).
  function clicVigente(firma) {
    return !!S.clicFila && (!S.clicFila.firma || S.clicFila.firma === firma);
  }

  function datosDeLaFichaAbierta(firma) {
    const g = grilla();
    const tr = g ? filaMarcada(g) : null;
    if (tr) return { datos: datosDeFila(tr, columnasDeLaGrilla(g)), origen: 'grilla' };
    if (clicVigente(firma)) return { datos: S.clicFila.datos, origen: 'clic' };
    return { datos: null, origen: 'ninguno' };
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

  // Con datos de la fila, la clave no depende del parámetro nocache de las
  // imágenes: volver a dibujar la misma ficha no la baja de nuevo.
  function firmaDeImagenes(imgs) {
    return imgs.map((i) => i.src).join('|');
  }

  function claveDeFicha(imgs, datos) {
    if (datos) return 'datos:' + JSON.stringify(datos) + '|paginas:' + imgs.length;
    return 'imagenes:' + firmaDeImagenes(imgs);
  }

  function fichaEnPantalla() {
    const imgs = imagenesDeLaFicha();
    if (!imgs.length) return null;
    const firma = firmaDeImagenes(imgs);
    const { datos, origen } = datosDeLaFichaAbierta(firma);
    return { clave: claveDeFicha(imgs, datos), imgs, datos, origen, firma };
  }

  function atarOSoltarClic(ficha) {
    if (ficha.origen === 'clic') S.clicFila.firma = ficha.firma;
    else S.clicFila = null;
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
    if (!blob) throw new Error('no se pudo copiar la imagen de la página ' + (nroPagina(img) || ''));
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
      throw new Error('las imágenes de la ficha no terminaron de cargar');
    }
    const doc = await nuevoDocumento(nombre.replace(/\.pdf$/, ''));
    for (let i = 0; i < ficha.imgs.length; i++) {
      estado('Armando página ' + (i + 1) + ' de ' + ficha.imgs.length + '...', 'trabajando');
      await agregarPagina(doc, ficha.imgs[i]);
    }
    return new Blob([await doc.save()], { type: 'application/pdf' });
  }

  // --------------------------------------------------------------- guardado

  function fueCancelada(e) {
    let t;
    try { t = JSON.stringify(e || {}); } catch (x) { t = String(e); }
    return /cancel/i.test(t);
  }

  // Cuadro "Guardar como" de Tampermonkey (R9: nunca carpeta fija).
  function descargarConDialogo(blob, nombre) {
    const url = URL.createObjectURL(blob);
    return new Promise((resolve) => {
      let listo = false;
      const fin = (r) => { if (!listo) { listo = true; resolve(r); } };
      try {
        GM_download({
          url,
          name: nombre,
          saveAs: true,
          onload: () => fin('guardado'),
          onerror: (e) => fin(fueCancelada(e) ? 'cancelado' : 'fallo'),
          ontimeout: () => fin('fallo')
        });
      } catch (e) { fin('fallo'); }
    }).finally(() => setTimeout(() => URL.revokeObjectURL(url), 180000));
  }

  function hayDescargaDeTampermonkey() {
    return typeof GM_download === 'function';
  }

  async function guardarPdf(blob, nombre) {
    const r = hayDescargaDeTampermonkey() ? await descargarConDialogo(blob, nombre) : 'fallo';
    if (r === 'fallo') dejarPendiente(blob, nombre);
    return r === 'fallo' ? 'pendiente' : r;
  }

  function dejarPendiente(blob, nombre) {
    S.pendiente = { blob, nombre };
    if (UI.btnGuardar) UI.btnGuardar.style.display = 'block';
  }

  function quitarPendiente() {
    S.pendiente = null;
    if (UI.btnGuardar) UI.btnGuardar.style.display = 'none';
  }

  async function escribirConSelector(selector, p) {
    const h = await selector.call(W, {
      suggestedName: p.nombre,
      types: [{ description: 'Documento PDF', accept: { 'application/pdf': ['.pdf'] } }]
    });
    const w = await h.createWritable();
    await w.write(p.blob);
    await w.close();
  }

  // Solo para navegadores sin selector de archivos: decide el navegador.
  function guardarPorEnlace(p) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(p.blob);
    a.download = p.nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 180000);
  }

  // Se llama desde el botón "Guardar el PDF": el clic habilita el selector.
  async function guardarPendiente() {
    const p = S.pendiente;
    if (!p) return;
    const selector = W.showSaveFilePicker || window.showSaveFilePicker;
    try {
      if (typeof selector === 'function') await escribirConSelector(selector, p);
      else guardarPorEnlace(p);
      quitarPendiente();
      estado('Guardado: ' + p.nombre, 'ok');
    } catch (e) {
      if (e && e.name === 'AbortError') estado('Guardado cancelado. El PDF sigue disponible.', 'aviso');
      else estado('No se pudo guardar: ' + mensajeDeError(e), 'error');
    }
  }

  // ------------------------------------------------------- bajada de la ficha

  function anotarHistorial(ficha, nombre, resultado) {
    S.historial.unshift({ hora: new Date(), nombre, paginas: ficha.imgs.length, resultado });
    if (S.historial.length > 30) S.historial.length = 30;
    pintarHistorial();
  }

  const TEXTO_RESULTADO = {
    guardado: 'Guardada: ',
    cancelado: 'Descarga cancelada: ',
    pendiente: 'Tampermonkey no abrió "Guardar como". Usá "Guardar el PDF": '
  };

  function informarResultado(ficha, nombre, r) {
    const extra = ficha.origen === 'ninguno' ? ' (sin datos de la fila: nombre genérico)' : '';
    const tipo = r === 'guardado' ? 'ok' : 'aviso';
    estado(TEXTO_RESULTADO[r] + nombre + extra, tipo);
  }

  function registrarResultado(ficha, nombre, r) {
    if (r === 'guardado') { S.guardadas.add(ficha.clave); quitarPendiente(); }
    if (r === 'cancelado') S.resueltas.add(ficha.clave);
    if (r === 'pendiente') S.resueltas.add(ficha.clave);
    anotarHistorial(ficha, nombre, r);
    informarResultado(ficha, nombre, r);
  }

  function registrarFalla(ficha, e) {
    S.intentos.set(ficha.clave, (S.intentos.get(ficha.clave) || 0) + 1);
    estado('No se pudo armar el PDF: ' + mensajeDeError(e) + '.', 'error');
  }

  async function procesarFicha(ficha) {
    const nombre = nombreArchivo(ficha.datos);
    try {
      const blob = await armarPdf(ficha, nombre);
      estado('Elegí dónde guardar ' + nombre + '...', 'trabajando');
      registrarResultado(ficha, nombre, await guardarPdf(blob, nombre));
    } catch (e) {
      registrarFalla(ficha, e);
    }
  }

  async function bajarFicha(manual) {
    if (S.trabajando) {
      if (manual) estado('Ya hay una ficha en preparación.', 'aviso');
      return;
    }
    const ficha = manual ? fichaEnPantalla() : S.fichaActual;
    if (!ficha) { estado('No hay ninguna ficha abierta.', 'error'); return; }
    S.trabajando = true;
    try {
      await procesarFicha(ficha);
    } finally {
      S.trabajando = false;
      setTimeout(continuarAutomatico, 0);
    }
  }

  function debeBajarSola(ficha) {
    return !S.apagada && autoActiva() &&
      !S.guardadas.has(ficha.clave) && !S.resueltas.has(ficha.clave) &&
      (S.intentos.get(ficha.clave) || 0) < MAX_INTENTOS_AUTO;
  }

  // Después de cada bajada: si la ficha en pantalla sigue sin guardarse (otra
  // ficha que llegó mientras tanto, o un intento fallido), se baja (R4).
  function continuarAutomatico() {
    const ficha = S.fichaActual;
    if (!ficha || S.trabajando || !debeBajarSola(ficha)) return;
    const pausa = S.intentos.get(ficha.clave) ? PAUSA_REINTENTO_MS : 0;
    setTimeout(() => {
      if (S.fichaActual === ficha && debeBajarSola(ficha)) bajarFicha(false);
    }, pausa);
  }

  // ------------------------------------------------------- revisión de página

  function avisarFichaDetectada(ficha) {
    const quien = descripcionDatos(ficha.datos);
    estado('Ficha detectada: ' + ficha.imgs.length + (ficha.imgs.length === 1 ? ' página' : ' páginas') +
      (quien ? ', ' + quien : '') + '.', 'neutro');
  }

  function revisar() {
    if (S.apagada) return;
    engancharPagina();
    const ficha = fichaEnPantalla();
    if (!ficha) {
      S.fichaActual = null;
      if (!S.trabajando && !S.pendiente) estado('Esperando que abras una ficha.', 'neutro');
      return;
    }
    if (S.fichaActual && S.fichaActual.clave === ficha.clave) return;
    S.fichaActual = ficha;
    atarOSoltarClic(ficha);
    if (!S.trabajando) avisarFichaDetectada(ficha);
    pintarMiniaturas(ficha);
    continuarAutomatico();
  }

  // ------------------------------------------------- enganches con el sitio

  function anotarClicEnGrilla(target, arg) {
    const m = /^Select\$(\d+)$/.exec(String(arg || ''));
    if (String(target) !== 'GridConsulta' || !m) return;
    const g = grilla();
    const tr = g ? filaPorIndice(g, parseInt(m[1], 10)) : null;
    S.clicFila = tr ? { datos: datosDeFila(tr, columnasDeLaGrilla(g)), firma: null } : null;
  }

  // El enlace "Descargar" del sitio llama a __doPostBack('Descargar'): esa
  // llamada no llega al servidor y se reemplaza por la bajada de RJU+ (R8).
  function envolverPostBack(original) {
    const envoltorio = function (target) {
      if (String(target) === 'Descargar') { bajarFicha(true); return false; }
      try { anotarClicEnGrilla(target, arguments[1]); } catch (e) { /* no interrumpir el sitio */ }
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
    const nueva = function () { bajarFicha(true); return false; };
    nueva.__rjuplus = true;
    W.Descargar = nueva;
  }

  function engancharAjax() {
    try {
      const prm = W.Sys && W.Sys.WebForms && W.Sys.WebForms.PageRequestManager &&
        W.Sys.WebForms.PageRequestManager.getInstance();
      if (prm && !prm.__rjuplus) {
        prm.add_endRequest(() => setTimeout(revisar, 400));
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

  // Cerrar apaga la bajada automática hasta recargar la página (R6). El
  // enlace "Descargar" del sitio sigue pasando por RJU+, para no recibir la
  // ficha equivocada; esa descarga siempre pregunta dónde guardar.
  function apagar() {
    S.apagada = true;
    if (S.observador) S.observador.disconnect();
    clearTimeout(S.temporizador);
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
      '#rjuplus button{background:' + v + ';color:#fff;border:0;border-radius:5px;padding:7px 10px;cursor:pointer;font-size:13px;width:100%;margin-bottom:6px}',
      '#rjuplus button.secundario{background:' + COLOR.ambar + '}',
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
      botonVentana('cerrar', 'Cerrar: RJU+ deja de bajar fichas solo hasta recargar la página', '&#10005;') +
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
    lab.appendChild(document.createTextNode('Bajar sola al abrir la ficha'));
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
    UI.btnGuardar = crearBoton('Guardar el PDF...', guardarPendiente, 'secundario');
    UI.btnGuardar.style.display = 'none';
    UI.est = document.createElement('div');
    UI.est.className = 'est';
    cuerpo.append(crearBoton('Bajar ficha en PDF', () => bajarFicha(true)), UI.btnGuardar,
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

  // Solo escribe si el texto cambió (R1, R12).
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

  const TEXTO_HISTORIAL = { guardado: 'guardada', cancelado: 'cancelada', pendiente: 'sin guardar' };

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

  // Criterio común de Lex+: al cargar, minimizada y anclada abajo a la derecha.
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
