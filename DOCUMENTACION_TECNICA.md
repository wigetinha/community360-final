# Documentación Técnica — COMMUNITY 360 (Sistema Completo)

## 1. Arquitectura híbrida final

El sistema separa las cargas según la naturaleza de los datos:
- **TiDB Cloud (SQL compatible con MySQL, TLS obligatorio):** almacena datos estructurados y transaccionales (`usuarios` [1,068], `ubicaciones_autorizadas` [897], `administradores` y `sesiones_auth`).
- **Couchbase Capella (NoSQL documental, `couchbases://` TLS):** almacena eventos flexibles en la colección `interacciones` (`207` documentos iniciales válidos). Las `793` interacciones rechazadas en la Fase 2 permanecen en cuarentena fuera de la nube.
- **Backend Node.js + Express + Socket.IO:** actúa como única puerta de acceso, valida integridad referencial cruzada (`id_usuario` en TiDB antes de escribir en Couchbase), protege la privacidad geográfica, autentica sesiones y emite eventos WebSocket solo tras confirmar escrituras en Capella.
- **Frontend (HTML, CSS, Bootstrap 5, Chart.js, Socket.IO Client):** interfaz responsiva de solo lectura (sin formularios CRUD).

---

## 2. Tecnologías utilizadas

- **Backend:** Node.js, Express 4, Helmet, `express-rate-limit`, `cookie-parser`
- **SQL:** TiDB Cloud + `mysql2` + `express-mysql-session`
- **NoSQL:** Couchbase Capella + SDK oficial `couchbase`
- **Tiempo real:** Socket.IO 4
- **Seguridad:** `bcryptjs` (costo 12), `express-session`, protección CSRF (`X-CSRF-Token`)
- **Frontend:** HTML5, CSS3, JavaScript ES6, Bootstrap 5.3, Chart.js 4.4
- **Pruebas:** Suites automatizadas en Node.js (`pruebas/`) y Postman

---

## 3. Inventario exacto de endpoints REST (16 endpoints)

| # | Método | Ruta | Auth | CSRF | Propósito |
|---|---|---|---|---|---|
| 1 | `GET` | `/health` | No | No | Estado de salud del servidor y conectividad con TiDB/Capella (sin credenciales) |
| 2 | `GET` | `/api/auth/csrf` | No | No | Genera/devuelve token CSRF de la sesión |
| 3 | `POST` | `/api/auth/login` | No | Sí | Autentica administrador contra TiDB (`administradores`) |
| 4 | `POST` | `/api/auth/logout` | Sí | Sí | Destruye sesión en TiDB y limpia cookies |
| 5 | `GET` | `/api/auth/me` | Sí | No | Devuelve perfil no sensible del administrador autenticado |
| 6 | `GET` | `/api/privado/prueba` | Sí | No | Endpoint de verificación de autorización |
| 7 | `GET` | `/api/dashboard/resumen` | Sí | No | KPIs globales (usuarios, en riesgo, total interacciones, sentimiento promedio, distribución por tipo) |
| 8 | `GET` | `/api/dashboard/temas` | Sí | No | Conteo y porcentaje de interacciones por `tema` |
| 9 | `GET` | `/api/dashboard/participacion` | Sí | No | Distribución de usuarios por `estatus` desde TiDB |
| 10 | `GET` | `/api/dashboard/actividad` | Sí | No | Serie diaria y matriz 7×24 (día × hora UTC) para mapa de calor |
| 11 | `GET` | `/api/dashboard/canales` | Sí | No | Distribución de interacciones por `canal` |
| 12 | `GET` | `/api/interacciones` | Sí | No | Listado paginado y filtrable de interacciones (sin exponer `ubicacion`) |
| 13 | `GET` | `/api/interacciones/:id` | Sí | No | Consulta de una interacción específica por clave |
| 14 | `POST` | `/api/interacciones` | Sí | Sí | Crea interacción en Capella tras validar usuario y privacidad en TiDB |
| 15 | `PUT` | `/api/interacciones/:id` | Sí | Sí | Actualiza interacción existente en Capella |
| 16 | `DELETE` | `/api/interacciones/:id` | Sí | Sí | Elimina interacción existente en Capella |

---

## 4. Indicadores REST vs. actualizaciones por WebSockets

- **Consultados por REST:** Al cargar `/dashboard` (y tras reconexión), el cliente consulta `/api/dashboard/resumen`, `/api/dashboard/temas`, `/api/dashboard/participacion`, `/api/dashboard/actividad`, `/api/dashboard/canales` y `/api/interacciones`.
- **Actualizados por WebSockets:** Tras `POST`, `PUT` o `DELETE` confirmado en Couchbase, el servidor emite `interacciones:actualizadas` (y el evento específico `interaccion:creada`, `interaccion:actualizada` o `interaccion:eliminada`) a la sala `admins_autenticados`. El dashboard re-consulta los endpoints REST y actualiza tarjetas, gráficas, mapa de calor, temas y tabla sin recargar la página.

---

## 5. Definición matemática de indicadores

1. **Total de interacciones ($N_{int}$):** número de documentos válidos en `community360._default.interacciones`.
2. **Porcentaje de usuarios en riesgo:**
   $$\%\text{EnRiesgo} = \begin{cases} \dfrac{N_{\text{en\_riesgo}}}{N_{\text{usuarios}}} \times 100 & \text{si } N_{\text{usuarios}} > 0 \\ 0 & \text{si } N_{\text{usuarios}} = 0 \end{cases}$$
3. **Distribución por tipo / canal / tema:**
   $$\%_k = \begin{cases} \dfrac{n_k}{N_{int}} \times 100 & \text{si } N_{int} > 0 \\ 0 & \text{si } N_{int} = 0 \end{cases}$$
4. **Sentimiento promedio ($\bar{S}$):**
   $$\bar{S} = \begin{cases} \dfrac{\sum_{i \in V} s_i}{|V|} & \text{si } |V| > 0 \\ 0 & \text{si } |V| = 0 \end{cases}$$
   donde $V$ es el subconjunto de interacciones con valor numérico de `sentimiento` en $[-1, 1]$.
5. **Actividad por periodo (Mapa de calor):** conteo $C(d, h)$ de interacciones cuyo `timestamp` UTC cae en el día de la semana $d \in \{0..6\}$ y hora $h \in \{0..23\}$.

---

## 6. Consultas reales ejecutadas

- **TiDB (SQL):**
  - `SELECT COUNT(*) AS total_usuarios, SUM(CASE WHEN estatus='activo' ...), ... FROM usuarios`
  - `SELECT estatus, COUNT(*) AS cantidad FROM usuarios GROUP BY estatus`
  - `SELECT id_usuario, estatus, consentimiento_datos FROM usuarios WHERE id_usuario = ? LIMIT 1`
- **Couchbase Capella (SQL++ con `RequestPlus`):**
  - `SELECT tipo, COUNT(*) AS cantidad FROM \`community360\`.\`_default\`.\`interacciones\` GROUP BY tipo`
  - `SELECT COUNT(sentimiento) AS n_sentimiento, COALESCE(SUM(sentimiento), 0) AS suma_sentimiento FROM ... WHERE sentimiento IS NUMBER`
  - `SELECT tema, COUNT(*) AS cantidad FROM ... GROUP BY tema ORDER BY cantidad DESC`
  - `SELECT canal, COUNT(*) AS cantidad FROM ... GROUP BY canal ORDER BY cantidad DESC`
  - `SELECT RAW \`timestamp\` FROM ... WHERE \`timestamp\` IS STRING`
  - `SELECT ... FROM ... WHERE ... ORDER BY \`timestamp\` DESC LIMIT $limit OFFSET $offset`

---

## 7. Limitaciones y escalabilidad

- **Limitaciones actuales:** El plan gratuito de TiDB Cloud y Couchbase Capella tiene límites de IOPS/cuota; el mapa de calor lee los `timestamp` de la colección (óptimo para cientos/miles de documentos, no para millones); no existe transacción distribuida 2PC entre TiDB y Capella.
- **Para escalar a cientos de miles de interacciones:**
  1. Agregar caché en memoria/Redis para agregaciones del dashboard con invalidación por eventos.
  2. Pre-agregar contadores por hora/día/tema mediante Eventing o vistas materializadas incrementales en Couchbase.
  3. Usar colas de mensajes (Kafka/RabbitMQ) para desacoplar la ingesta masiva de la emisión WebSocket.
  4. Escalar Socket.IO horizontalmente con `@socket.io/redis-adapter`.

---

## 8. Cambios realizados respecto a la Fase 1

1. **Driver SQL:** En la Fase 1 se propuso Prisma; en la implementación final (Fases 3–6) se utiliza `mysql2/promise` directo con pool TLS y `express-mysql-session` para mayor control de consultas agregadas y sesiones en TiDB Cloud.
2. **Almacenamiento de sesiones:** Se incorporó la tabla técnica `sesiones_auth` en TiDB Cloud para persistencia de sesiones del lado del servidor.
3. **Protección CSRF:** Se completó la aplicación de `verifyCsrf` en todas las rutas `POST`, `PUT` y `DELETE` (autenticación e interacciones).
