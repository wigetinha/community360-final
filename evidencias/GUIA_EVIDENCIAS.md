# Guía de Captura de Evidencias — COMMUNITY 360

Coloca en esta carpeta (`evidencias/`) las capturas de pantalla reales tomadas desde tu computadora durante la ejecución local o desplegada:

1. `01_login.png`: Pantalla `/login` con el formulario de inicio de sesión.
2. `02_dashboard_autenticado.png`: Vista completa de `/dashboard` mostrando las 5 tarjetas KPI con datos reales (1,068 usuarios, 207 interacciones válidas), gráfica de barras, gráfica de dona y indicadores separados de WebSocket, TiDB y Capella.
3. `03_mapa_calor_temas.png`: Sección del mapa de calor (Día × Hora UTC) y barras de temas populares.
4. `04_tabla_interacciones.png`: Tabla de solo lectura con filtros y paginación.
5. `05_pantalla_dividida_POST.png`: **Pantalla dividida** con Postman enviando `POST /api/interacciones` (HTTP 201) a la izquierda y el dashboard incrementando automáticamente a `208` interacciones a la derecha sin recargar.
6. `06_pantalla_dividida_PUT.png`: **Pantalla dividida** con Postman enviando `PUT /api/interacciones/TEST_POSTMAN_001` (HTTP 200) y el dashboard recalculando categorías/sentimiento al instante.
7. `07_pantalla_dividida_DELETE.png`: **Pantalla dividida** con Postman enviando `DELETE /api/interacciones/TEST_POSTMAN_001` (HTTP 200) y el dashboard regresando a `207` interacciones.
8. `08_pruebas_autenticacion_y_rest.png`: Captura de la terminal mostrando los resultados reales de `npm test`, `npm run test:auth` y `npm run test:integracion`.

9. `09_network_y_console.png`: Network con los seis GET analíticos, códigos HTTP y Console. Oculta cookies, tokens y datos personales.
10. `10_recuperacion.png`: Tras una desconexión temporal, registra la recuperación de los indicadores y las consultas sin recargar la página.

## Secuencia exacta de la demostración

1. Abre el dashboard con una sesión válida. Espera **Consultas actualizadas** y verifica los tres indicadores verdes. Captura las tarjetas, la dona y las barras **Por Tipo**. Cambia a **Por Canal** y toma una segunda captura.
2. Captura el mapa de calor UTC y los temas. En la tabla, aplica un filtro de canal, toma una captura y limpia el filtro antes de probar **Siguiente** y **Anterior**.
3. Coloca Postman a la izquierda y el dashboard a la derecha. Con **Por Tipo** visible, anota el total base. Ejecuta CSRF y login de la colección. Antes de POST usa un identificador exclusivo de la demostración y un ID de usuario existente.
4. Captura POST HTTP 201, el total incrementado y la barra de la categoría creada. Ejecuta PUT con otro tipo y tema. Captura HTTP 200 y las dos categorías con sus nuevas cantidades. Ejecuta DELETE y captura HTTP 200 y el total restaurado. Comprueba que el GET del identificador temporal devuelve 404.
5. Captura las salidas de `npm test`, `npm run test:auth` y `npm run test:integracion` con `TEST_BROWSER=1`. En Network registra los estados HTTP y omite cookies, tokens y contraseñas.

