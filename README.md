# RJU+

Programa de usuario para Tampermonkey sobre el Registro de Juicios Universales de la Suprema Corte de Justicia de la Provincia de Buenos Aires (https://rju.scba.gov.ar/). Forma parte del proyecto Lex+.

Versión vigente: beta 0.3.1 (04/11/2026).

## Función

Baja en PDF la ficha que el Registro muestra en pantalla. El PDF se arma con las mismas imágenes que se ven, sin usar la descarga del sitio, que responde con error de servidor y, en ocasiones, entrega la ficha de otro registro.

- Preparación automática al abrir cada ficha (activada por defecto; se apaga desde el panel): RJU+ arma el PDF y abre el panel con el botón "Elegir dónde guardar".
- Cada guardado abre el selector de archivos de Chrome, que empieza en Documentos. Nunca se guarda en una carpeta fija ni en la carpeta Descargas.
- Nombre del archivo con año, apellido, nombre y documento de la fila en la que se hizo clic, controlado con la fila que el Registro marca como elegida. Si los datos no se pueden asegurar, el nombre es genérico (`RJU_ficha_AAAAMMDD-HHMMSS.pdf`) y el panel lo indica.
- El enlace "Descargar" del sitio queda reemplazado por la bajada de RJU+.
- Panel minimizado al cargar, en el sector inferior derecho, con minimizar, maximizar y cerrar. La vista maximizada muestra las páginas de la ficha abierta y las fichas procesadas en la sesión.

## Archivos

- `rju-plus.user.js`: versión vigente.
- `versiones/`: copia de cada versión.
- `bitacora-AAAA-MM-DD-X.Y.Z.md`: registro de cada cambio.
- `pruebas/`: banco de pruebas (Playwright), configuración de ESLint y copia de pdf-lib 1.17.1 (`pruebas/vendor/`). Uso: `node pruebas/banco.js`.

## Instalación

Abrir `rju-plus.user.js` con Tampermonkey instalado y aceptar los permisos (almacenamiento y acceso a la página). Requiere Chrome actualizado, que ofrece el selector de archivos.

## Licencia

Todos los derechos reservados. Queda prohibida su copia, modificación o distribución sin autorización escrita del autor.
