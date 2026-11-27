/**
 * Servidor Principal de Aplicación Web - COMMUNITY 360
 * Sistema Completo: Autenticación (Fase 3), API REST (Fase 4), WebSockets (Fase 5) y Dashboard (Fase 6)
 */

const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const { testConnection } = require('./config/database');
const { testCouchbaseConnection } = require('./config/couchbase');
const { sessionMiddleware } = require('./config/session');
const { ensureCsrfToken } = require('./middleware/csrf');
const { requireAuth } = require('./middleware/requireAuth');
const { initSocketServer } = require('./sockets/socketHandler');

const authRoutes = require('./routes/authRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const interaccionesRoutes = require('./routes/interaccionesRoutes');

const app = express();
const httpServer = http.createServer(app);

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const isProduction = process.env.NODE_ENV === 'production';

// Confiar en proxy inverso HTTPS (necesario para cookies Secure en Render)
if (isProduction) {
  app.set('trust proxy', 1);
}

// 1. Encabezados de Seguridad con Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'"
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'https://cdn.jsdelivr.net'
        ],
        fontSrc: [
          "'self'",
          'https://cdn.jsdelivr.net'
        ],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:']
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// 7. Endpoint de Salud para monitoreo de despliegue (sin exponer credenciales)
app.get('/health', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const [tidb, capella] = await Promise.all([
    testConnection(),
    testCouchbaseConnection()
  ]);

  const saludable = tidb.success && capella.success;
  return res.status(saludable ? 200 : 503).json({
    status: saludable ? 'ok' : 'degraded',
    uptime_segundos: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    servicios: {
      tidb: tidb.success ? 'conectado' : 'desconectado',
      couchbase: capella.success ? 'conectado' : 'desconectado'
    }
  });
});

// 2. Parsers de Peticiones y Cookies
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 3. Manejo de Sesiones Persistentes (TiDB)
app.use(sessionMiddleware);

// 4. Inyección de Token CSRF en Sesión
app.use(ensureCsrfToken);

// 5. Inicializar Socket.IO compartiendo el servidor HTTP y las sesiones
const io = initSocketServer(httpServer, sessionMiddleware);
app.set('io', io);

const chartJsPath = require.resolve('chart.js/auto').replace(/auto[\/\\]auto\.cjs$/, 'dist/chart.umd.js');
app.get('/vendor/chart.js', (req, res) => res.sendFile(chartJsPath));

// 6. Archivos Estáticos Públicos (CSS, JS cliente, imágenes)
app.use(express.static(path.join(__dirname, 'public')));

// 8. Rutas de Vistas Web (Frontend)
app.get('/', (req, res) => {
  res.redirect('/dashboard');
});

app.get('/login', (req, res) => {
  if (req.session && req.session.adminId) {
    return res.redirect('/dashboard');
  }

  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  return res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
  return res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// 9. Rutas de API REST
app.use('/api', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/interacciones', interaccionesRoutes);

// 10. Manejo de Recursos No Encontrados (404)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint no encontrado.' });
  }
  return res.status(404).redirect('/login');
});

// 11. Manejador Global de Errores (sin exponer información interna)
app.use((err, req, res, next) => {
  console.error('[Unhandled Server Error]:', err.message || err);
  if (res.headersSent) {
    return next(err);
  }
  return res.status(500).json({
    error: 'Ocurrió un error inesperado en el servidor.'
  });
});

// 12. Inicio del Servidor y Verificación Inicial de Conexiones
if (require.main === module) {
  httpServer.listen(PORT, HOST, async () => {
    console.log('='.repeat(65));
    console.log('  COMMUNITY 360 - Sistema Analítico Híbrido (Fases 3, 4, 5 y 6)');
    console.log(`  Servidor activo en: http://localhost:${PORT}`);
    console.log(`  Modo: ${process.env.NODE_ENV || 'development'}`);
    console.log('='.repeat(65));

    const [tidb, capella] = await Promise.all([
      testConnection(),
      testCouchbaseConnection()
    ]);

    if (tidb.success) {
      console.log(`✓ TiDB Cloud conectado (${tidb.version})`);
    } else {
      console.error(`✗ Error de conexión con TiDB Cloud: ${tidb.error}`);
    }

    if (capella.success) {
      console.log(`✓ Couchbase Capella conectado (${capella.keyspace}, docs: ${capella.totalDocumentos})`);
    } else {
      console.error(`✗ Error de conexión con Couchbase Capella: ${capella.error}`);
    }
  });
}

module.exports = { app, httpServer, io };
