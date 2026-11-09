# RJU+: bitácora

Archivo único de bitácora de RJU+. Reúne las 2 bitácoras por versión que había en la carpeta del proyecto, de la más reciente a la más antigua. Unificado el 09/11/2026.

Reglas de este archivo:

- Cada versión nueva agrega un apartado arriba de todo, con el título "Versión X.Y.Z (DD/MM/AAAA)", y registra solo lo nuevo de esa versión, sin copiar lo de las anteriores.
- Las referencias de otros documentos a un archivo de bitácora por versión remiten al apartado de este archivo que indica ese mismo nombre como archivo original.
- Los archivos originales se conservan sin cambios en la subcarpeta `bitacoras-por-version`.
- Al unificar se omitieron los párrafos que repetían, idénticos, el texto de una versión anterior (0 caracteres de 14.048); el texto completo de cada versión sigue en su archivo original.

## Versión 0.3.1 (04/11/2026)

Archivo original: `bitacora-2026-11-04-0.3.1.md`

### RJU+ beta 0.3.1: bitácora del 04/11/2026

#### 1. Motivo

El 03/11/2026 una revisión independiente de la beta 0.3.0 (`REVISION CODIGO TOTAL/rju-revision-0.3.0.md`) confirmó corregidos R1, R2, R4 a R8, R10, R11, R13 y R14, y encontró defectos en el nombre del archivo, en el destino de las descargas y en los avisos. Los dos de gravedad alta permitían guardar una ficha con el nombre de otra persona:

- X1 y X2: un clic en la grilla cuyo pedido fallaba o tardaba podía darle sus datos a la ficha que ya estaba en pantalla, cuando no se encontraba la fila marcada en celeste.
- X4: con la fila marcada en celeste, si las imágenes cambiaban sin un clic, la ficha nueva tomaba los datos de la fila marcada.

#### 2. Decisiones del autor (04/11/2026)

- Guardado: se adopta el selector de archivos de Chrome, que siempre pregunta dónde guardar. Como el selector necesita un clic, la bajada automática pasa a armar el PDF sola y a abrir el panel con el botón "Elegir dónde guardar"; un clic elige la carpeta. Se descarta el cuadro de Tampermonkey (`GM_download`), que según su configuración podía guardar en la carpeta Descargas sin preguntar.
- Posición: el panel sigue arrancando minimizado y anclado en el sector inferior derecho, según el criterio común de Lex+, sin recordar la posición de la sesión anterior.
- La preparación automática sigue activada por defecto, conforme a la decisión del autor de que la ficha se baje directamente al abrirla.

#### 3. Cambios

| Defecto de la revisión | Corrección |
|---|---|
| 1 (X1, X2): datos del clic aplicados a la ficha anterior | El clic registra las imágenes que había en pantalla al hacerlo y solo vale para una ficha distinta de esas. Se usa una sola vez, se olvida cuando el pedido al sitio termina sin ficha nueva y ante cualquier otro envío de la página. |
| 2 (X4): fila marcada aplicada a imágenes nuevas sin clic | Cada juego de imágenes es una ficha distinta, con clave propia. La fila marcada ya no da datos por sí sola: sirve de control, y si no coincide con la del clic, el archivo se nombra en forma genérica y el panel lo indica. Sin clic, el nombre es genérico. |
| 3 (R9): bajada automática activada | Se mantiene activada por decisión del autor; ya no guarda sin preguntar: arma el PDF y espera el clic en "Elegir dónde guardar". |
| 4 (X3): descargas que podían ir a la carpeta Descargas | Se quitan `GM_download` y el respaldo por enlace de descarga. Todo guardado usa el selector de Chrome, que se abre en Documentos. Sin selector disponible, el panel avisa y no descarga nada. En "Bajar ficha en PDF" y en el enlace "Descargar" del sitio, el selector se abre en el mismo clic, antes de armar el PDF. |
| 5: espera de `GM_download` sin tope | Desaparece con `GM_download`. |
| 6 (R12): el aviso de error se pisaba | El aviso "Esperando que abras una ficha." se escribe solo cuando la ficha deja de estar en pantalla, no ante cualquier cambio de la página. |
| 7: mensajes del navegador en inglés | Los errores del navegador se traducen al castellano; los propios ya estaban en castellano. |
| 8: funciones quitadas y agregadas | La posición recordada no vuelve, por decisión del autor. La vista maximizada y la pastilla de colores responden a los criterios comunes de Lex+ (tres botones de ventana, colores por estado). |
| 9: proceso | El banco de pruebas incluye pdf-lib en `pruebas/vendor/` y acepta otra ruta como argumento. Se suman pruebas de R7, R10, R11, R13 (paginador), R14 y de los casos X1, X1 con fila marcada, X2, X3 y X4. La copia de la 0.2.0 está en `versiones/` desde el 03/11/2026. |
| 10: palabras en inglés en la documentación | Se reemplazan "userscript" y "postback" por "programa de usuario" y "envío". |

Además, con el panel cerrado RJU+ sigue registrando la ficha abierta, para que el enlace "Descargar" del sitio la guarde con el nombre que corresponde.

#### 4. Verificación

- `node --check` y ESLint (83 reglas, funciones de hasta 40 líneas, complejidad 10): sin errores ni advertencias.
- Banco de pruebas `pruebas/banco.js`: 47 chequeos en verde, 0 fallas. El navegador del banco no tiene salida a internet.
- Mutantes: ver la sección 5.
- Prueba en vivo en el RJU real, en solo lectura: ver la sección 6.

#### 5. Mutantes

Se probaron 18 alteraciones del código. En la primera corrida sobrevivieron cuatro: quitar el control de las imágenes previas al clic, no consumir el clic al aceptar la ficha, abrir el selector después de armar el PDF y quitar las defensas contra el bucle. Para las tres primeras se agregaron pruebas específicas (pedido lento con el panel cerrado, redibujo sin aviso de fin de pedido y orden entre el selector y el armado del PDF), que las detectan. La cuarta es equivalente: además de esas dos defensas, la revisión descarta la ficha cuya clave no cambió, de modo que no se produce bucle. Resultado final: 17 de 18 detectadas y una equivalente.

#### 6. Prueba en vivo

Prueba en el RJU real (04/11/2026), en solo lectura, con el código inyectado en una pestaña y el selector de archivos simulado (no se guardó ningún archivo en la computadora). En esa pestaña estaba instalada la 0.2.0, que se neutralizó solo en esa pestaña, sin modificar su configuración.

- Al abrir una ficha desde la lupa, RJU+ armó el PDF solo, abrió el panel y mostró "Elegir dónde guardar" con el nombre de la fila marcada por el Registro; no guardó nada antes del clic.
- Al hacer clic, el selector se abrió en Documentos y el PDF tuvo dos páginas con las mismas medidas que las imágenes de pantalla.
- Una segunda ficha tomó su propio nombre, distinto del anterior, y sus propias imágenes.
- El panel no registró cambios durante cuatro segundos de reposo.
- El enlace "Descargar" del sitio pasó por RJU+: el selector se abrió antes de armar el PDF, con el nombre y las imágenes de la ficha abierta.
- Al terminar cada pedido, el clic quedó olvidado.

Observación: en el Chrome del autor figura instalada la beta 0.2.0, no la 0.3.0.


---

## Versión 0.3.0 (03/11/2026)

Archivo original: `bitacora-2026-11-03-0.3.0.md`

### RJU+ beta 0.3.0: bitácora del 03/11/2026

#### 1. Motivo

RJU+ había quedado en la beta 0.2.0 del 07/09/2026, sin cambios posteriores, mientras las demás aplicaciones de Lex+ incorporaban los criterios comunes del proyecto. El reporte de revisión de código del 28/10/2026 (carpeta REVISION CODIGO TOTAL) señaló en RJU+ catorce hallazgos (R1 a R14), tres de ellos de severidad alta: un bucle permanente, un PDF que podía no corresponder a la ficha vista en pantalla y un nombre de archivo que podía corresponder a otra persona. El plan de reforma del 03/11/2026 los ubica en la Fase 1.

#### 2. Relevamiento previo en el sitio real

Antes de modificar el código se relevó el RJU en Chrome, en modo de solo lectura (03/11/2026), con una búsqueda de Sucesiones por apellido:

- La grilla `GridConsulta` tiene una fila de encabezado con celdas TH: Ver, año, num_oficio, apellido, nombre, num_documento, fallecimiento.
- Cada lupa es un `input type="image"` con `onclick="javascript:__doPostBack('GridConsulta','Select$N');return false;"`.
- Las filas alternan fondo blanco (`rgb(255, 255, 255)`) y gris (`rgb(217, 218, 219)`); después del postback, la fila elegida queda con fondo celeste (`rgb(161, 220, 242)`). Se verificó con dos filas distintas.
- La ficha se muestra como imágenes `/imagegen.aspx?pagina=N&nocache=...`, del mismo sitio; copiarlas a un lienzo no produce bloqueo de seguridad.
- El enlace de descarga del sitio es `javascript:Descargar()`, y la función `Descargar` llama a `__doPostBack`.
- El sitio usa `Sys.WebForms.PageRequestManager` (postbacks parciales).

#### 3. Cambios

##### 3.1 Hallazgos del reporte

| N° | Corrección |
|----|------------|
| R1 | El observador de la página descarta los cambios producidos dentro del propio panel, y la línea de estado solo se escribe cuando cambia el texto o el tipo. No queda ningún ciclo de escritura. |
| R2 | El PDF se arma exclusivamente con las imágenes tal como están en pantalla (lienzo). Ya no se vuelven a pedir al servidor. |
| R3 | Los datos del nombre del archivo se toman de la fila que el RJU marca en celeste después del postback. Como respaldo se usan los datos de la fila en la que se hizo clic, atados a las imágenes de la ficha que llegó después de ese clic; una ficha posterior nunca hereda esos datos. Sin ninguno de los dos, el archivo se nombra `RJU_ficha_AAAAMMDD-HHMMSS.pdf` y el panel lo indica. |
| R4 | Una ficha se da por guardada solo después de una descarga exitosa. Si la bajada automática falla, se reintenta hasta tres veces, con tres segundos de pausa. Si llega otra ficha mientras se prepara una, se procesa al terminar. |
| R5 | Al no pedirse la imagen al servidor, una respuesta de error del servidor ya no puede incorporarse al PDF. |
| R6 | Cerrar el panel apaga la bajada automática y el observador hasta recargar la página. El enlace "Descargar" del sitio sigue pasando por RJU+, para no recibir la ficha equivocada; esa descarga pregunta dónde guardar. |
| R7 | pdf-lib 1.17.1 se carga con verificación de integridad (sha384), con el mismo hash que usan las demás aplicaciones. El hash se comprobó contra el paquete publicado en npm. |
| R8 | Además de reemplazar la función `Descargar`, el envoltorio de `__doPostBack` intercepta el destino `Descargar`, que nunca llega al servidor. |
| R9 | Cada descarga abre el cuadro "Guardar como" (GM_download con saveAs). Si Tampermonkey no puede abrirlo, el panel muestra el botón "Guardar el PDF...", que abre el selector de archivos de Chrome. No hay carpeta fija. La bajada automática sigue activada por defecto, por decisión del autor ("que la ficha se baje directamente al abrirla"). |
| R10 | Licencia "Todos los derechos reservados", conforme a la decisión del autor del 16/10/2026 para las aplicaciones de Lex+. |
| R11 | Se quitan @homepageURL, @updateURL y @downloadURL: las actualizaciones no se distribuyen por GitHub (16/10/2026). |
| R12 | Los mensajes de error quedan visibles (se corrige con R1) y la pastilla del panel minimizado se pinta de rojo. |
| R13 | La fila del clic se busca por su enlace `Select$N` y no por la posición. Las columnas se reconocen por el encabezado, con la posición relevada como respaldo. |
| R14 | La descripción ya no menciona una pestaña About inexistente. |

##### 3.2 Criterios comunes de Lex+

- Al cargar, el panel aparece minimizado y anclado en el sector inferior derecho (criterio del 09/09/2026). La posición ya no se recuerda entre visitas, porque contradecía ese criterio; el panel puede moverse durante la sesión.
- Barra con los tres botones: minimizar, maximizar y cerrar (criterio del 11/09/2026). La vista maximizada muestra miniaturas de las páginas de la ficha abierta, tal como se guardan, y la lista de fichas procesadas en la sesión (hora, nombre del archivo, páginas y resultado), para facilitar la revisión de cada ficha.
- Color de la pastilla según el estado: verde normal, ámbar en proceso o con aviso, rojo ante un error.
- Código dividido en microfunciones (ninguna supera las 40 líneas útiles ni la complejidad 10).
- Textos de pantalla con tildes y en voseo; comentarios en registro profesional.
- La preferencia "Bajar sola al abrir la ficha" se guarda en el almacenamiento de Tampermonkey; si existía la de la 0.2.0 en el almacenamiento del sitio, se toma como valor inicial.

##### 3.3 Permisos

La 0.2.0 corría con `@grant none`. La 0.3.0 pide `GM_download` (cuadro "Guardar como"), `GM_getValue`, `GM_setValue` y `unsafeWindow` (para enganchar `__doPostBack` y `Descargar` del sitio). Tampermonkey solicitará confirmar estos permisos al instalar.

#### 4. Verificación

- `node --check`: sin errores.
- ESLint con las reglas recomendadas y las de calidad de Lex+ (83 reglas): 0 errores y 0 advertencias.
- Banco de pruebas `pruebas/banco.js` (Playwright, con un RJU simulado que reproduce la grilla, los colores, los postbacks parciales, el enlace Descargar y un servidor que entrega otra imagen al segundo pedido): 29 chequeos en verde, 0 fallas.
- Mutantes: se probaron diez alteraciones del código (quitar las dos defensas contra el bucle, quitar solo una, `saveAs` en falso, pedir la imagen al servidor, no soltar el clic, no atar el clic a su ficha, no interceptar Descargar, arrancar abierta, marcar como guardada antes de tiempo, cerrar sin apagar). El banco detectó ocho; las dos restantes no cambian el comportamiento observable (cada defensa contra el bucle cubre por sí sola el caso, y marcar como guardada una descarga cancelada no altera el resultado porque esa ficha ya queda resuelta).
- El banco encontró dos fallas reales durante el desarrollo, corregidas antes de la entrega: los datos de un clic anterior podían pasar a una ficha posterior sin fila marcada, y una segunda revisión de la misma ficha podía descartar los datos del clic.
- Prueba en vivo en el RJU real (03/11/2026), en solo lectura, con el código inyectado en la página y la descarga simulada (no se guardó ningún archivo): la ficha abierta se detectó y se procesó una sola vez; el nombre coincidió con la fila marcada en celeste; el PDF tuvo 2 páginas con las mismas medidas que las imágenes de pantalla (1696x2906 y 1712x2923); al abrir otra ficha desde la lupa del sitio se generó un segundo PDF con el nombre y las medidas de esa ficha; el panel no registró ningún cambio durante 4 segundos de reposo (sin bucle); el enlace "Descargar" del sitio, `Descargar()` y `__doPostBack('Descargar')` pasaron por RJU+ y pidieron "Guardar como".
- Armar una ficha de dos páginas tarda alrededor de 5 segundos, por la copia sin pérdida (PNG) de imágenes de unos 1700x2900 píxeles. Un clic en "Bajar ficha" o en "Descargar" durante ese lapso se rechaza con el aviso "Ya hay una ficha en preparación".

#### 5. Pendiente

- Probar la versión instalada en Tampermonkey: el cuadro "Guardar como" depende de que Tampermonkey use la descarga del navegador (Configuración, Descargas). Si no lo abre, el panel ofrece "Guardar el PDF...".
- Incorporar la función de RJU+ a MEV Ultra (pedido del 21/10/2026, Fase 3 del plan de reforma).
- Decisión abierta del autor (D6 del plan): si el código se distribuye con nombre, matrícula y correo.

