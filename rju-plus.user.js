// ==UserScript==
// @name         RJU+ - Bajar ficha del Registro de Juicios Universales
// @namespace    ignacio.kinbaum
// @version      0.2.0
// @description  Baja la ficha del RJU de la SCBA en PDF, armada con las mismas imagenes que estas viendo en pantalla. No usa el boton "Descargar" del sitio, que falla con error de servidor y a veces entrega la ficha de otro registro. Opcion de bajar sola apenas se abre la ficha. Panel movible por la pantalla, con minimizar y cerrar. Pestaña About con version, autoria y link al repositorio.
// @author       Ignacio Kinbaum
// @license      GPL-3.0-or-later
// @copyright    2026, Ignacio Kinbaum (estudiojuridicokinbaum@gmail.com)
// @homepageURL  https://github.com/Elzas85/RJUPLUS
// @supportURL   https://github.com/Elzas85/RJUPLUS/issues
// @updateURL    https://raw.githubusercontent.com/Elzas85/RJUPLUS/main/rju-plus.user.js
// @downloadURL  https://raw.githubusercontent.com/Elzas85/RJUPLUS/main/rju-plus.user.js
// @match        https://rju.scba.gov.ar/*
// @run-at       document-idle
// @require      https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js
// @grant        none
// ==/UserScript==
/*
 * RJU+ - Bajar ficha del Registro de Juicios Universales
 * Copyright (C) 2026  Ignacio Kinbaum  <estudiojuridicokinbaum@gmail.com>
 *
 * Este programa es software libre: usted puede redistribuirlo y/o modificarlo
 * bajo los terminos de la Licencia Publica General GNU (GPL) publicada por la
 * Free Software Foundation, en su version 3 o, a su eleccion, cualquier
 * version posterior.
 *
 * Este programa se distribuye con la esperanza de que sea util, pero SIN
 * NINGUNA GARANTIA. Vea la Licencia Publica General GNU para mas detalles.
 * https://www.gnu.org/licenses/gpl-3.0.html
 */
/* global PDFLib */
(function () {
  'use strict';

  const APP = {
    nombre: 'RJU+ - Bajar ficha del Registro de Juicios Universales',
    version: 'beta 0.2.0',
    autor: 'Ignacio Kinbaum',
    anio: '2026',
    mail: 'estudiojuridicokinbaum@gmail.com',
    licencia: 'GPL-3.0-or-later',
    licenciaUrl: 'https://www.gnu.org/licenses/gpl-3.0.html',
    github: 'https://github.com/Elzas85/RJUPLUS'
  };

  const VERDE = '#1a7f37';
  const CLAVE_AUTO = 'rjuplus_auto';
  const CLAVE_MIN = 'rjuplus_min';
  const CLAVE_POS = 'rjuplus_pos';

  // Estado
  let filaSel = null; // indice de la fila de la grilla que se clickeo
  let datosFila = null; // datos de esa fila, capturados ANTES del postback
  let claveFicha = null; // huella de la ficha ya procesada, para no repetir
  let trabajando = false;

  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  function pref(k, def) {
    try { const v = localStorage.getItem(k); return v === null ? def : v === '1'; }
    catch (e) { return def; }
  }
  function guardarPref(k, v) {
    try { localStorage.setItem(k, v ? '1' : '0'); } catch (e) { /* sin persistencia */ }
  }

  // ---------------------------------------------------------------- utilidades

  function esImagenFicha(img) {
    try {
      const u = new URL(img.src, location.href);
      return u.pathname.toLowerCase().endsWith('/imagegen.aspx');
    } catch (e) { return false; }
  }

  function nroPagina(img) {
    try {
      const u = new URL(img.src, location.href);
      return parseInt(u.searchParams.get('pagina') || '0', 10);
    } catch (e) { return 0; }
  }

  // Solo /imagegen.aspx: las de /imagenpaginagen.aspx son las bandas con el
  // numero de pagina, no forman parte de la ficha.
  function imagenesDeLaFicha() {
    return Array.from(document.querySelectorAll('img'))
      .filter(esImagenFicha)
      .sort((a, b) => nroPagina(a) - nroPagina(b));
  }

  async function esperarCarga(imgs, msMax) {
    const t0 = Date.now();
    while (Date.now() - t0 < (msMax || 20000)) {
      if (imgs.length && imgs.every((i) => i.complete && i.naturalWidth > 0)) return true;
      await dormir(250);
    }
    return false;
  }

  function limpiarNombre(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '');
  }

  function nombreArchivo() {
    const d = datosFila || {};
    const partes = ['RJU', d.anio, d.apellido, d.nombre, d.documento]
      .map((x) => limpiarNombre(x))
      .filter((x) => x && x !== '0');
    const base = partes.length > 1 ? partes.join('_') : 'RJU_ficha';
    return base + '.pdf';
  }

  // ------------------------------------------------- lectura de la fila elegida

  function capturarFila(idx) {
    const g = document.getElementById('GridConsulta');
    if (!g || !g.rows[idx + 1]) return null;
    const c = Array.from(g.rows[idx + 1].cells).map((td) => (td.innerText || '').trim());
    // Columnas: Ver | año | num_oficio | apellido | nombre | num_documento | fallecimiento
    return {
      anio: c[1] || '',
      oficio: c[2] || '',
      apellido: c[3] || '',
      nombre: c[4] || '',
      documento: c[5] || '',
      fallecimiento: c[6] || ''
    };
  }

  // El dato se toma en el momento del clic, no despues del postback. Asi el
  // archivo queda nombrado segun la fila que se eligio en pantalla.
  function engancharPostBack() {
    if (typeof window.__doPostBack !== 'function' || window.__doPostBack.__rjuplus) return;
    const original = window.__doPostBack;
    const envoltorio = function (target, arg) {
      try {
        const m = /^Select\$(\d+)$/.exec(String(arg || ''));
        if (String(target) === 'GridConsulta' && m) {
          filaSel = parseInt(m[1], 10);
          datosFila = capturarFila(filaSel);
          claveFicha = null; // se abre otra ficha, se habilita una nueva bajada
        }
      } catch (e) { /* no interrumpir el postback del sitio */ }
      return original.apply(this, arguments);
    };
    envoltorio.__rjuplus = true;
    window.__doPostBack = envoltorio;
  }

  // ------------------------------------------------------------ armado del PDF

  async function bytesDeImagen(img) {
    try {
      const r = await fetch(img.src, { credentials: 'include' });
      if (r.ok) return new Uint8Array(await r.arrayBuffer());
    } catch (e) { /* se intenta por canvas */ }
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function incrustar(doc, bytes) {
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return doc.embedJpg(bytes);
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return doc.embedPng(bytes);
    throw new Error('formato de imagen no reconocido');
  }

  async function bajarFicha(manual) {
    if (trabajando) return;
    const imgs = imagenesDeLaFicha();
    if (!imgs.length) {
      estado('No hay ninguna ficha abierta.', true);
      return;
    }
    trabajando = true;
    try {
      estado('Esperando que carguen las paginas...');
      const ok = await esperarCarga(imgs, 20000);
      if (!ok) { estado('Las imagenes no terminaron de cargar. Reintentá.', true); return; }

      const A4_ANCHO = 595.28;
      const A4_ALTO = 841.89;
      const MARGEN = 14;

      const doc = await PDFLib.PDFDocument.create();
      doc.setTitle(nombreArchivo().replace(/\.pdf$/, ''));
      doc.setProducer('RJU+ ' + APP.version);
      doc.setCreator('RJU+ ' + APP.version);

      for (let i = 0; i < imgs.length; i++) {
        estado('Armando pagina ' + (i + 1) + ' de ' + imgs.length + '...');
        const bytes = await bytesDeImagen(imgs[i]);
        const im = await incrustar(doc, bytes);
        const pag = doc.addPage([A4_ANCHO, A4_ALTO]);
        const esc = Math.min(
          (A4_ANCHO - MARGEN * 2) / im.width,
          (A4_ALTO - MARGEN * 2) / im.height
        );
        const w = im.width * esc;
        const h = im.height * esc;
        pag.drawImage(im, {
          x: (A4_ANCHO - w) / 2,
          y: (A4_ALTO - h) / 2,
          width: w,
          height: h
        });
      }

      const pdf = await doc.save();
      const blob = new Blob([pdf], { type: 'application/pdf' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nombreArchivo();
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);

      claveFicha = imgs.map((i) => i.src).join('|');
      const d = datosFila || {};
      estado('Listo: ' + nombreArchivo() +
        (d.apellido ? ' (' + d.apellido + ' ' + d.nombre + ', doc ' + d.documento + ')' : ''));
    } catch (e) {
      estado('Error al armar el PDF: ' + (e && e.message ? e.message : e), true);
    } finally {
      trabajando = false;
      if (manual) { /* nada extra */ }
    }
  }

  // ------------------------------------------------------------------- interfaz

  let elEstado = null;

  function estado(txt, esError) {
    if (!elEstado) return;
    elEstado.textContent = txt;
    elEstado.style.color = esError ? '#b3261e' : '#333';
  }

  function css() {
    const s = document.createElement('style');
    s.textContent = [
      '#rjuplus{position:fixed;right:16px;bottom:16px;z-index:999999;font-family:Segoe UI,Arial,sans-serif;font-size:13px}',
      '#rjuplus .caja{background:#fff;border:2px solid ' + VERDE + ';border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.25);width:310px}',
      '#rjuplus .barra{background:' + VERDE + ';color:#fff;padding:6px 10px;border-radius:4px 4px 0 0;display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none}',
      '#rjuplus .ctrl{display:flex;gap:2px}',
      '#rjuplus .ctrl span{width:20px;height:18px;line-height:18px;text-align:center;border-radius:3px;cursor:pointer;font-size:12px}',
      '#rjuplus .ctrl span:hover{background:rgba(255,255,255,.25)}',
      '#rjuplus .barra b{letter-spacing:.5px;font-size:14px}',
      '#rjuplus .cuerpo{padding:10px}',
      '#rjuplus button{background:' + VERDE + ';color:#fff;border:0;border-radius:5px;padding:7px 10px;cursor:pointer;font-size:13px;width:100%}',
      '#rjuplus button:disabled{opacity:.6;cursor:default}',
      '#rjuplus label{display:flex;gap:6px;align-items:center;margin:9px 0 6px;cursor:pointer}',
      '#rjuplus .est{font-size:12px;line-height:1.35;min-height:32px;border-top:1px solid #e3e3e3;padding-top:7px;word-break:break-word}',
      '#rjuplus .pie{font-size:10.5px;color:#777;margin-top:6px;border-top:1px solid #eee;padding-top:5px}',
      '#rjuplus .pie a{color:' + VERDE + ';text-decoration:none}',
      '#rjuplus .pastilla{background:' + VERDE + ';color:#fff;padding:7px 12px;border-radius:16px;cursor:move;box-shadow:0 3px 10px rgba(0,0,0,.3);font-weight:600;user-select:none}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function construirPanel() {
    if (document.getElementById('rjuplus')) return;
    css();

    const cont = document.createElement('div');
    cont.id = 'rjuplus';

    const caja = document.createElement('div');
    caja.className = 'caja';

    const barra = document.createElement('div');
    barra.className = 'barra';
    barra.innerHTML = '<b>RJU+</b><span class="ctrl">' +
      '<span data-b="min" title="Minimizar">&#9472;</span>' +
      '<span data-b="cerrar" title="Cerrar hasta recargar la pagina">&#10005;</span>' +
      '</span>';

    const cuerpo = document.createElement('div');
    cuerpo.className = 'cuerpo';

    const btn = document.createElement('button');
    btn.textContent = 'Bajar ficha en PDF';
    btn.addEventListener('click', () => bajarFicha(true));

    const lab = document.createElement('label');
    const chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = pref(CLAVE_AUTO, true);
    chk.addEventListener('change', () => guardarPref(CLAVE_AUTO, chk.checked));
    lab.appendChild(chk);
    lab.appendChild(document.createTextNode('Bajar sola al abrir la ficha'));

    elEstado = document.createElement('div');
    elEstado.className = 'est';
    elEstado.textContent = 'Esperando que abras una ficha.';

    const pie = document.createElement('div');
    pie.className = 'pie';
    pie.innerHTML = APP.version + ' | ' + APP.autor + ' | ' +
      '<a href="' + APP.licenciaUrl + '" target="_blank" rel="noopener">' + APP.licencia + '</a> | ' +
      '<a href="' + APP.github + '" target="_blank" rel="noopener">repositorio</a>';

    cuerpo.appendChild(btn);
    cuerpo.appendChild(lab);
    cuerpo.appendChild(elEstado);
    cuerpo.appendChild(pie);
    caja.appendChild(barra);
    caja.appendChild(cuerpo);

    const pastilla = document.createElement('div');
    pastilla.className = 'pastilla';
    pastilla.textContent = 'RJU+';
    pastilla.style.display = 'none';

    cont.appendChild(caja);
    cont.appendChild(pastilla);
    document.body.appendChild(cont);

    function minimizar(v) {
      caja.style.display = v ? 'none' : 'block';
      pastilla.style.display = v ? 'block' : 'none';
      guardarPref(CLAVE_MIN, v);
    }

    // Posicion libre, recordada entre visitas. Vale para el panel y para la
    // pastilla: las dos son el mismo contenedor.
    function aplicarPos(left, top) {
      const a = cont.offsetWidth || 120;
      const l = Math.max(4, Math.min(left, window.innerWidth - Math.min(a, 90) - 4));
      const t = Math.max(4, Math.min(top, window.innerHeight - 28));
      cont.style.left = l + 'px';
      cont.style.top = t + 'px';
      cont.style.right = 'auto';
      cont.style.bottom = 'auto';
    }

    let recienArrastrado = false;

    function habilitarArrastre(mango) {
      let sx, sy, ox, oy, moviendo = false, arrastro = false;
      mango.addEventListener('mousedown', (e) => {
        if (e.target.closest('[data-b]')) return; // los botones de ventana no arrastran
        e.preventDefault();
        recienArrastrado = false;
        const r = cont.getBoundingClientRect();
        ox = r.left; oy = r.top; sx = e.clientX; sy = e.clientY;
        moviendo = true; arrastro = false;
        document.addEventListener('mousemove', alMover);
        document.addEventListener('mouseup', alSoltar);
      });
      function alMover(e) {
        if (!moviendo) return;
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (!arrastro && Math.abs(dx) + Math.abs(dy) < 4) return; // umbral: click o arrastre
        arrastro = true;
        cont.style.userSelect = 'none';
        aplicarPos(ox + dx, oy + dy);
      }
      function alSoltar() {
        moviendo = false;
        cont.style.userSelect = '';
        document.removeEventListener('mousemove', alMover);
        document.removeEventListener('mouseup', alSoltar);
        if (arrastro) {
          recienArrastrado = true;
          try {
            localStorage.setItem(CLAVE_POS, JSON.stringify({
              left: parseInt(cont.style.left, 10),
              top: parseInt(cont.style.top, 10)
            }));
          } catch (e) { /* sin persistencia */ }
        }
      }
    }

    habilitarArrastre(barra);
    habilitarArrastre(pastilla);

    barra.querySelector('[data-b="min"]').addEventListener('click', () => minimizar(true));
    barra.querySelector('[data-b="cerrar"]').addEventListener('click', () => { cont.style.display = 'none'; });
    pastilla.addEventListener('click', () => {
      if (recienArrastrado) { recienArrastrado = false; return; } // venia de moverla
      minimizar(false);
    });

    try {
      const guardada = JSON.parse(localStorage.getItem(CLAVE_POS));
      if (guardada && typeof guardada.left === 'number') aplicarPos(guardada.left, guardada.top);
    } catch (e) { /* sin posicion guardada */ }

    window.addEventListener('resize', () => {
      if (cont.style.left) aplicarPos(parseInt(cont.style.left, 10), parseInt(cont.style.top, 10));
    });

    if (pref(CLAVE_MIN, false)) minimizar(true);

    window.__rjuplusAuto = () => chk.checked;
  }

  // ------------------------------------------------------------- ciclo de vida

  function reemplazarDescargar() {
    // El boton del sitio hace __doPostBack("Descargar") dentro de un UpdatePanel:
    // el servidor responde 500 y, cuando responde, puede entregar otra ficha.
    if (window.Descargar && window.Descargar.__rjuplus) return;
    const nueva = function () { bajarFicha(true); return false; };
    nueva.__rjuplus = true;
    window.Descargar = nueva;
  }

  async function revisar() {
    engancharPostBack();
    reemplazarDescargar();

    const imgs = imagenesDeLaFicha();
    if (!imgs.length) {
      if (elEstado && !trabajando) estado('Esperando que abras una ficha.');
      return;
    }
    const clave = imgs.map((i) => i.src).join('|');
    if (clave === claveFicha) return;

    const d = datosFila || {};
    estado('Ficha detectada: ' + imgs.length + (imgs.length === 1 ? ' pagina' : ' paginas') +
      (d.apellido ? ', ' + d.apellido + ' ' + d.nombre : '') + '.');

    const auto = window.__rjuplusAuto ? window.__rjuplusAuto() : pref(CLAVE_AUTO, true);
    if (auto) {
      claveFicha = clave; // se marca antes para no disparar dos veces
      await bajarFicha(false);
    }
  }

  function engancharAjax() {
    try {
      if (window.Sys && window.Sys.WebForms && window.Sys.WebForms.PageRequestManager) {
        const prm = window.Sys.WebForms.PageRequestManager.getInstance();
        if (prm && !prm.__rjuplus) {
          prm.add_endRequest(() => setTimeout(revisar, 400));
          prm.__rjuplus = true;
        }
      }
    } catch (e) { /* el sitio puede no tener ScriptManager en todas las vistas */ }
  }

  let pendiente = null;
  function observar() {
    const obs = new MutationObserver(() => {
      clearTimeout(pendiente);
      pendiente = setTimeout(revisar, 500);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function iniciar() {
    construirPanel();
    engancharPostBack();
    engancharAjax();
    reemplazarDescargar();
    observar();
    revisar();
    // El ScriptManager puede registrarse despues del document-idle.
    setTimeout(engancharAjax, 1500);
    setTimeout(engancharAjax, 4000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
