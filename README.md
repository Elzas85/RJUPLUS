# RJU+

Programa de usuario (userscript) para Tampermonkey sobre el Registro de Juicios Universales de la Suprema Corte de Justicia de la Provincia de Buenos Aires (https://rju.scba.gov.ar/). Forma parte del proyecto Lex+.

Versión vigente: beta 0.3.0 (03/11/2026).

## Función

Baja en PDF la ficha que el Registro muestra en pantalla. El PDF se arma con las mismas imágenes que se ven, sin usar la descarga del sitio, que responde con error de servidor y, en ocasiones, entrega la ficha de otro registro.

- Bajada automática al abrir cada ficha (activada por defecto; se apaga desde el panel).
- Cada descarga pregunta dónde guardarse.
- Nombre del archivo con año, apellido, nombre y documento de la fila elegida en la grilla.
- El enlace "Descargar" del sitio queda reemplazado por la bajada de RJU+.
- Panel minimizado al cargar, en el sector inferior derecho, con minimizar, maximizar y cerrar. La vista maximizada muestra las páginas de la ficha abierta y las fichas procesadas en la sesión.

## Archivos

- `rju-plus.user.js`: versión vigente.
- `versiones/`: copia de cada versión.
- `bitacora-AAAA-MM-DD-X.Y.Z.md`: registro de cada cambio.
- `pruebas/`: banco de pruebas (Playwright) y configuración de ESLint.

## Instalación

Abrir `rju-plus.user.js` con Tampermonkey instalado y aceptar los permisos (descarga, almacenamiento y acceso a la página). Para que la descarga abra el cuadro "Guardar como", Tampermonkey debe usar el modo de descarga del navegador.

## Licencia

Todos los derechos reservados. Queda prohibida su copia, modificación o distribución sin autorización escrita del autor.
