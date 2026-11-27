/**
 * Configuración de sesiones seguras y persistentes con TiDB Cloud.
 * Utiliza express-session y express-mysql-session.
 * COMMUNITY 360 - Sistema Completo
 */

const path = require('path');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const { pool } = require('./database');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const isProduction = process.env.NODE_ENV === 'production';
const DEFAULT_DEV_SECRET = 'clave_secreta_para_desarrollo_community360';
const PLACEHOLDER_SECRET = 'cambia_esta_clave_por_una_cadena_aleatoria_segura_de_64_caracteres';

const sessionSecret = (process.env.SESSION_SECRET || '').trim();

if (isProduction) {
  if (!sessionSecret || sessionSecret === DEFAULT_DEV_SECRET || sessionSecret === PLACEHOLDER_SECRET || sessionSecret.length < 32) {
    console.error('[FATAL] En producción, SESSION_SECRET debe estar definido y tener al menos 32 caracteres seguros.');
    process.exit(1);
  }
}

const sessionLifetime = parseInt(process.env.SESSION_LIFETIME_MS || '86400000', 10); // 24 horas por defecto

// Configuración del almacén MySQL/TiDB
const storeOptions = {
  clearExpired: true,
  checkExpirationInterval: 900000, // Limpiar sesiones expiradas cada 15 min
  expiration: sessionLifetime,
  createDatabaseTable: true,
  schema: {
    tableName: 'sesiones_auth', // Tabla técnica independiente (no altera tablas de negocio)
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
};

const sessionStore = new MySQLStore(storeOptions, pool);

sessionStore.on('error', (error) => {
  console.error('[SessionStore Error]:', error.message);
});

const sessionMiddleware = session({
  key: 'community360_sid',
  secret: sessionSecret || DEFAULT_DEV_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true, // Renovar expiración de cookie con cada solicitud activa
  proxy: isProduction, // Confiar en proxy HTTPS (ej. Render) para cookies Secure
  cookie: {
    httpOnly: true, // Impide acceso desde scripts del navegador (mitiga XSS)
    secure: isProduction, // HTTPS obligatorio en producción, false en localhost
    sameSite: 'lax', // Protección frente a ataques CSRF
    maxAge: sessionLifetime,
    path: '/'
  }
});

module.exports = {
  sessionMiddleware,
  sessionStore
};
