# COMMUNITY 360 — Sistema Analítico Híbrido en Tiempo Real (Fases 3, 4, 5 y 6)

Aplicación web completa conectada a **TiDB Cloud (SQL)** y **Couchbase Capella (NoSQL)**, con autenticación segura, API REST, notificaciones en tiempo real mediante **Socket.IO** y dashboard analítico responsivo con **Bootstrap 5** y **Chart.js**.

---

## 1. Requisitos previos (Windows / Visual Studio Code)

- **Node.js** v18 o superior (probado en v24.x) y **npm**.
- **Visual Studio Code**.
- **Postman** (para las pruebas REST y demostración en tiempo real).
- Credenciales de acceso a los clústeres existentes de **TiDB Cloud** y **Couchbase Capella**.
- Archivo de certificado CA `tidb-ca.pem` en la raíz del proyecto.

---

## 2. Instalación y ejecución local paso a paso

1. Descomprime `COMMUNITY360-FINAL.zip` en una carpeta de trabajo.
2. Abre la carpeta `COMMUNITY360-FINAL` en **Visual Studio Code**.
3. Abre una terminal integrada en VS Code (`Ctrl + ñ` o `Terminal > New Terminal`) e instala dependencias:
   ```powershell
   npm install
   ```
4. Copia `.env.example` a `.env`:
   ```powershell
   Copy-Item .env.example .env
   ```
5. Edita `.env` con tus credenciales reales (ver explicación de cada variable abajo).
6. Inicia el servidor en modo desarrollo:
   ```powershell
   npm run dev
   ```
7. Abre tu navegador en:
   `http://localhost:3000/login`
8. Inicia sesión con una cuenta de administrador activa (ej. `lizandro.reyes@utmetropolitana.edu.mx`).
9. Consulta el dashboard analítico con datos reales de TiDB Cloud y Couchbase Capella.
10. Ejecuta las 3 pruebas en tiempo real desde **Postman** (`postman/COMMUNITY360.postman_collection.json`) y observa las actualizaciones automáticas sin recargar la página.
11. Ejecuta las suites de verificación:
    ```powershell
    npm test
    npm run test:auth
    npm run test:integracion
    ```
12. Prueba el modo de producción local:
    ```powershell
    npm start
    ```

---

## 3. Explicación de variables de entorno (`.env`)

| Variable | Propósito | Ejemplo |
|---|---|---|
| `PORT` | Puerto HTTP donde escucha Express y Socket.IO | `3000` |
| `NODE_ENV` | Modo de ejecución (`development` o `production`) | `development` |
| `CORS_ORIGIN` | Orígenes permitidos para Socket.IO en producción | `https://tu-app.onrender.com` |
| `TIDB_HOST` | Host del clúster serverless en TiDB Cloud | `gateway01.us-west-2.prod.aws.tidbcloud.com` |
| `TIDB_PORT` | Puerto TLS de TiDB Cloud | `4000` |
| `TIDB_USER` | Usuario SQL de TiDB Cloud (con prefijo de clúster) | `xxxxx.root` |
| `TIDB_PASSWORD` | Contraseña de acceso a TiDB Cloud | *(secreto)* |
| `TIDB_DATABASE` | Base de datos relacional aprobada | `community360` |
| `TIDB_CA_CERT` | Ruta relativa al certificado raíz TLS de TiDB | `./tidb-ca.pem` |
| `CB_CONNECTION_STRING` | Cadena TLS obligatoria (`couchbases://`) de Capella | `couchbases://cb.xxxx.cloud.couchbase.com` |
| `CB_USERNAME` | Usuario de acceso al bucket de Capella | *(usuario)* |
| `CB_PASSWORD` | Contraseña del usuario de Capella | *(secreto)* |
| `CB_BUCKET` | Bucket en Couchbase Capella | `community360` |
| `CB_SCOPE` | Scope de la colección | `_default` |
| `CB_COLLECTION` | Colección de interacciones JSON | `interacciones` |
| `SESSION_SECRET` | Clave secreta para firmar cookies (mín. 32 chars en prod) | *(cadena aleatoria)* |
| `SESSION_LIFETIME_MS` | Tiempo de vida de la sesión en milisegundos | `86400000` |

> **Nota de seguridad:** En `NODE_ENV=production`, el servidor rechazará el arranque si `SESSION_SECRET` falta o usa un valor predeterminado.

---

## 4. Aprovisionamiento seguro de la cuenta del profesor

Para crear o actualizar la cuenta obligatoria `lizandro.reyes@utmetropolitana.edu.mx` sin exponer la contraseña en el código ni en argumentos visibles de consola:

```powershell
node scripts/crear_admin.js --correo lizandro.reyes@utmetropolitana.edu.mx --rol admin --actualizar
```

El script solicitará la contraseña de forma oculta, la cifrará con **bcryptjs** (factor de costo 12) y la almacenará activa en la tabla `administradores` de TiDB Cloud.

---

## 5. Uso de la colección Postman y recuperación de pruebas

1. Importa `postman/COMMUNITY360.postman_collection.json` en Postman.
2. En las variables de la colección, configura `admin_correo` y `admin_password`.
3. Ejecuta en orden:
   - `0.1 Obtener Token CSRF inicial` (guarda automáticamente `csrf_token`).
   - `0.2 Iniciar Sesión (Admin)` (guarda la cookie de sesión `community360_sid` y actualiza `csrf_token`).
4. Con el dashboard abierto en el navegador al lado de Postman, ejecuta:
   - **Prueba 1 (`POST /api/interacciones`)**: crea `TEST_POSTMAN_001` (HTTP 201). El dashboard incrementa el contador y actualiza gráficas al instante.
   - **Prueba 2 (`PUT /api/interacciones/TEST_POSTMAN_001`)**: modifica `tipo` y `tema` (HTTP 200). Se descuenta la categoría anterior y se incrementa la nueva.
   - **Prueba 3 (`DELETE /api/interacciones/TEST_POSTMAN_001`)**: elimina el registro temporal (HTTP 200). Las estadísticas regresan a su estado original.

### Procedimiento de recuperación si una prueba se interrumpe
Si Postman se cierra antes de ejecutar el `DELETE`, ejecuta nuevamente `0.1`, `0.2` y `Prueba 3 - DELETE` (o verifica con `GET /api/interacciones/TEST_POSTMAN_001` que responda `404`).

---

## 6. Preparación para despliegue en Render

1. Sube el proyecto a un repositorio privado de GitHub (sin `.env` ni `node_modules`).
2. Crea un **Web Service** en Render conectado al repositorio:
   - **Build Command:** `npm ci`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
3. Configura en Render todas las variables del `.env.example` con `NODE_ENV=production` y un `SESSION_SECRET` aleatorio de 64 caracteres.
4. **Seguridad de red en TiDB y Couchbase Capella:**
   - En **Couchbase Capella > Allowed IP Addresses**, agrega las **Outbound IP Addresses** de tu servicio en Render (disponibles en el panel de Render) en lugar de abrir `0.0.0.0/0`.
   - En **TiDB Cloud > Networking**, agrega las mismas IPs salientes de Render (o configura acceso autorizado específico para el entorno de despliegue).
5. **Limitación de plan gratuito:** El plan gratuito de Render suspende el servicio tras ~15 minutos de inactividad, lo que provoca un arranque en frío de ~30–50 segundos y desconexión temporal de WebSockets. Para la evaluación en clase o disponibilidad continua, se recomienda el plan **Starter** (sin suspensión) o despertar la URL `/health` minutos antes de la demostración.

El script permite omitir la mayúscula únicamente para el correo docente indicado. Introduce la contraseña oficial exactamente como te fue entregada. El resto de las validaciones se aplica también a esa cuenta.

## Verificación de la versión corregida

Consulta [VERIFICACION.md](VERIFICACION.md) para las pruebas de navegador, los endpoints REST, el diagnóstico de Capella y los pasos de despliegue.
