/**
 * Configuración de conexión a TiDB Cloud utilizando mysql2 con TLS/SSL obligatorio.
 * COMMUNITY 360 - Sistema Completo
 */

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const caCertPath = process.env.TIDB_CA_CERT
  ? path.resolve(__dirname, '..', process.env.TIDB_CA_CERT)
  : null;

const sslConfig = {
  minVersion: 'TLSv1.2',
  rejectUnauthorized: true,
  verifyIdentity: true
};

if (caCertPath && fs.existsSync(caCertPath)) {
  sslConfig.ca = fs.readFileSync(caCertPath);
}

const poolConfig = {
  host: process.env.TIDB_HOST,
  port: parseInt(process.env.TIDB_PORT || '4000', 10),
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE || 'community360',
  ssl: sslConfig,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  connectTimeout: 15000,
  timezone: 'Z',
  dateStrings: true
};

const pool = mysql.createPool(poolConfig);

/**
 * Prueba la conexión con el clúster de TiDB Cloud.
 */
async function testConnection() {
  try {
    const [rows] = await pool.query('SELECT VERSION() AS version, DATABASE() AS base');
    return {
      success: true,
      version: rows[0].version,
      base: rows[0].base
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  pool,
  poolConfig,
  testConnection
};
