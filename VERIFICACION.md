
# Verificación de la corrección

## Inicio en Windows

Abre PowerShell en la carpeta del proyecto. Si usas el ZIP, extrae la carpeta completa y coloca ahí el archivo `.env` de tu instalación original. Para una instalación nueva, copia `.env.example` a `.env` y completa los valores en local.

```powershell
npm.cmd install
npm.cmd run dev
```

Abre `http://localhost:3000/login` o utiliza el puerto de `PORT`. Detén el servidor con Ctrl+C antes de ejecutar `npm.cmd start` en el mismo puerto.

## Consultas con sesión

Importa `postman/COMMUNITY360.postman_collection.json`, establece `base_url` y las credenciales únicamente en tu entorno local. Ejecuta la solicitud de token CSRF y luego login usando el mismo host. Conserva la cookie de sesión de Postman. Las consultas GET de lectura usan esa cookie. Las operaciones de escritura también requieren el token CSRF vigente.

| Ruta GET | Campos que debes comprobar |
|---|---|
| `/api/dashboard/resumen` | Total y grupos de usuarios, tipos, total de interacciones y sentimiento. Los campos de una consulta fallida quedan en `null`. |
| `/api/dashboard/temas` | `temas` con tema, cantidad y porcentaje. |
| `/api/dashboard/participacion` | `distribucion` con estatus, cantidad y porcentaje. |
| `/api/dashboard/canales` | `canales` con canal, cantidad y porcentaje. |
| `/api/dashboard/actividad` | `mapa_calor` de siete filas de 24 horas UTC y `por_fecha`. |
| `/api/interacciones?page=1&limit=10` | `interacciones`, `total`, `pagina` y `total_paginas`. Prueba también `page=2`, `tipo`, `canal`, `tema` e `id_usuario`. |
| `/api/dashboard/estado` | Estado independiente de TiDB y Capella. |
| `/health` | HTTP 200 cuando ambas comprobaciones responden y HTTP 503 si una falla. |

Los seis endpoints devuelven HTTP 200 y JSON cuando sus consultas responden. El resumen admite HTTP 200 con datos parciales. Comprueba también HTTP 401 en las rutas protegidas desde una sesión anónima.

## Capella

La resolución de DNS SRV respondió. El acceso TCP a KV TLS (puerto devuelto por SRV, habitualmente 11207) y Query TLS (18093) agotó el tiempo de espera desde este equipo antes de la autenticación. Verifica la IP pública de salida del equipo en **Allowed IP Addresses**, el estado operativo del clúster y el acceso saliente a estos puertos. Un timeout TCP por sí solo no identifica cuál de estos controles impidió el acceso.

Cuando la red responda, selecciona `community360._default.interacciones` en Query Workbench. Ejecuta estas consultas de lectura y registra sus resultados.

```sql
SELECT COUNT(*) AS total FROM `community360`.`_default`.`interacciones`;
SELECT tipo, canal, tema, COUNT(*) AS cantidad
FROM `community360`.`_default`.`interacciones` GROUP BY tipo, canal, tema;
SELECT COUNT(*) AS con_sentimiento, AVG(sentimiento) AS promedio
FROM `community360`.`_default`.`interacciones` WHERE ISNUMBER(sentimiento);
SELECT COUNT(*) AS fechas_validas FROM `community360`.`_default`.`interacciones`
WHERE ISNUMBER(STR_TO_MILLIS(`timestamp`));
SELECT name, state, is_primary FROM system:indexes
WHERE bucket_id = "community360" AND scope_id = "_default" AND keyspace_id = "interacciones";
```

La Fase 2 define un índice primario y secundarios para usuario, timestamp, tipo y canal. Comprueba que estén `online`. Si una consulta sin filtros falla por falta de índice, un administrador de Capella puede crear el primario desde Query Workbench con la sentencia siguiente. Verifica con `EXPLAIN` los filtros y agregaciones antes de añadir índices adicionales.

```sql
CREATE PRIMARY INDEX IF NOT EXISTS ON `community360`.`_default`.`interacciones`;
```

## Pruebas

```powershell
npm.cmd test
$env:TEST_BROWSER = '1'
npm.cmd run test:integracion
Remove-Item Env:TEST_BROWSER
```

La integración crea un administrador de prueba con nombre aleatorio y lo retira al final. Ejecuta el CRUD sobre una interacción con ID aleatorio una vez que obtuvo el conteo base de Capella. Con `TEST_BROWSER=1`, Edge comprueba Chart.js, la autenticación de Socket.IO y la recuperación del gráfico tras retirar un fallo HTTP inducido en participación. Para usar Chrome, establece `BROWSER_CHANNEL=chrome` en ese PowerShell.

Para presentar, sigue `evidencias/GUIA_EVIDENCIAS.md` para capturas de la sesión, Network, gráficas, filtros y la secuencia de Postman. Toma como referencia el total vigente antes de POST y verifica el incremento de uno, el cambio de categoría tras PUT y la restauración del total tras DELETE.

## Render

Configura un **Web Service** con `npm ci` para construir y `npm start` para arrancar. Usa `NODE_ENV=production`, `HOST=0.0.0.0`, un secreto de sesión aleatorio y las variables TiDB y Capella de `.env.example` como secretos de Render. Usa el puerto que proporciona Render. Conserva el CA TLS de TiDB y las conexiones `couchbases://`.

En Render, abre **Connect > Outbound** para obtener los rangos CIDR de salida. Autoriza dichos rangos en TiDB y Capella antes de habilitar el chequeo de disponibilidad en `/health`. Luego verifica HTTPS, cookies seguras, login y Socket.IO desde el dominio del servicio.

- [Rangos de salida de Render](https://render.com/docs/outbound-ip-addresses)
- [Health checks de Render](https://render.com/docs/health-checks)
- [Funciones de fecha SQL++](https://docs.couchbase.com/server/current/n1ql/n1ql-language-reference/datefun.html)


## Resultados de la verificación

- TiDB Cloud por TLS en `community360`. 1,068 usuarios, 390 activos, 257 inactivos y 421 en riesgo (39.42 %).
- REST autenticado. Resumen y participación HTTP 200. Temas, actividad, canales y listado HTTP 503 tras timeout de Capella. `/health` devolvió HTTP 503 con TiDB conectado y Capella desconectado.
- Pruebas unitarias. 8 aprobadas. Edge en vista móvil confirmó el KPI de usuarios, Chart.js 4.4.4, autenticación de Socket.IO, error aislado en participación y recuperación de la dona.
- Pendientes con Capella operativo. Verificar los documentos iniciales, consultas e índices SQL++, gráficas y tabla documentales y el ciclo POST, PUT y DELETE con actualización visible. El conteo histórico de 207 es la referencia de la Fase 2.


## Validación después de autorizar la IP

Capella respondió en community360._default.interacciones con 207 documentos. Los seis GET analíticos devolvieron HTTP 200. La suite con Edge aprobó 21 comprobaciones, incluidos los filtros, la protección de sesión y el ciclo POST, PUT y DELETE. El total cambió de 207 a 208 y regresó a 207. El registro temporal eliminado devolvió HTTP 404.

El login espera a que TiDB confirme el guardado de la sesión antes de devolver HTTP 200. La suite usa un ID temporal aleatorio que cumple el límite de 40 caracteres.

## Revisión previa al despliegue

La consulta de Capella agrupa tipo, canal y tema en una sola lectura e incluye el sentimiento. Las respuestas simultáneas comparten el resultado durante cinco segundos. POST, PUT y DELETE invalidan ese resultado al confirmar la escritura. La siguiente lectura usa `RequestPlus` para incluir el cambio en el índice. Los reintentos de la aplicación se limitan a un intento adicional ante un fallo transitorio de lectura. El sondeo del dashboard se ejecuta cada 60 segundos en la pestaña visible y Socket.IO sigue actualizando al recibir cambios.

Capella devolvió cinco agregaciones consecutivas con 207 documentos, cinco tipos, seis canales y ocho temas. La primera tardó 1,612 ms y las siguientes entre 227 y 236 ms. `EXPLAIN` usó el índice primario. Con el volumen medido se conserva ese índice. No se pudo reproducir el fallo original de tipos en el servidor durante estas consultas. Edge verifica la recuperación al inducir un error en la respuesta del resumen y retirarlo.

Socket.IO comprueba la sesión y el estado del administrador antes de enviar cada evento privado. El cierre de sesión desconecta los sockets de esa sesión en el servidor. Un control periódico también desconecta sockets cuya sesión expiró o cuya cuenta fue desactivada. La interfaz comprueba HTTP 401 en `/api/auth/me` antes de redirigir tras el logout.

Para crear o actualizar la cuenta docente, abre PowerShell en la carpeta del proyecto y ejecuta:

```powershell
Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
node scripts/crear_admin.js --correo lizandro.reyes@utmetropolitana.edu.mx --rol admin --actualizar
```

Introduce y confirma la contraseña exacta de los lineamientos en el prompt oculto. La excepción de mayúscula se aplica a esa cuenta. Para probarla, inicia sesión y abre `/dashboard`. La variante automatizada de `npm.cmd run test:auth` usa `ADMIN_DOCENTE_PASSWORD` si el entorno la proporciona de forma segura. Mantén ese valor fuera del historial de comandos, el código y el ZIP.

Para la revisión local desde un checkout limpio usa `npm.cmd ci`. Ejecuta `npm.cmd start` y las tres suites enumeradas arriba. Para Render usa `npm ci` y `npm start`, autoriza los rangos salientes de **Connect > Outbound** en ambos clústeres y usa HTTPS con el proxy de Render. Las pruebas locales con cabecera de proxy permiten comprobar los atributos de las cookies. La URL pública y Socket.IO sobre ella se validan después de autorizar el despliegue.


Resultados de esta revisión: 9 pruebas unitarias, 13 de autenticación en desarrollo y 14 en producción con proxy simulado. La integración y Edge comprobaron las barras, la dona, el cambio visual durante el CRUD, la reconexión y la revocación de sockets. El conteo tras la limpieza regresó a 207. npm ci completó en una instalación limpia y npm start en producción devolvió HTTP 200 en /health. El acceso con la contraseña oficial del docente y la URL pública de Render siguen pendientes.
