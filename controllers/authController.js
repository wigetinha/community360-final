/**
 * Controlador de Autenticación para Administradores de COMMUNITY 360.
 * Conexión y validación contra tabla 'administradores' en TiDB Cloud.
 * COMMUNITY 360 - Fase 3
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../config/database');
const { desconectarSesion } = require('../sockets/socketHandler');

// Expresión regular básica para formato de correo electrónico
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Iniciar sesión de administrador
 * POST /api/auth/login
 */
async function login(req, res) {
  try {
    const { correo, password } = req.body || {};

    // 1. Validar campos obligatorios
    if (!correo || !password || typeof correo !== 'string' || typeof password !== 'string') {
      return res.status(400).json({
        error: 'El correo electrónico y la contraseña son obligatorios.',
        codigo: 'CAMPOS_REQUERIDOS'
      });
    }

    const correoLimpio = correo.trim().toLowerCase();

    if (!EMAIL_REGEX.test(correoLimpio)) {
      return res.status(400).json({
        error: 'El formato del correo electrónico es inválido.',
        codigo: 'FORMATO_CORREO_INVALIDO'
      });
    }

    // 2. Consultar administrador en TiDB Cloud (consulta parametrizada)
    const [rows] = await pool.query(
      'SELECT id_admin, correo, password_hash, rol, activo FROM administradores WHERE correo = ? LIMIT 1',
      [correoLimpio]
    );

    // Mensaje genérico de seguridad para evitar enumeración de usuarios
    const MENSAJE_ERROR_GENERICO = 'Correo o contraseña incorrectos.';

    if (rows.length === 0) {
      // Usuario no encontrado
      return res.status(401).json({
        error: MENSAJE_ERROR_GENERICO,
        codigo: 'CREDENCIALES_INVALIDAS'
      });
    }

    const admin = rows[0];

    // 3. Comprobar que el administrador esté activo
    if (!admin.activo) {
      return res.status(401).json({
        error: MENSAJE_ERROR_GENERICO,
        codigo: 'CUENTA_INACTIVA'
      });
    }

    // 4. Comparar contraseña con el hash bcrypt almacenado
    const coincide = await bcrypt.compare(password, admin.password_hash);
    if (!coincide) {
      return res.status(401).json({
        error: MENSAJE_ERROR_GENERICO,
        codigo: 'CREDENCIALES_INVALIDAS'
      });
    }

    // 5. Autenticación exitosa: Regenerar ID de sesión para prevenir fijación de sesión
    req.session.regenerate((err) => {
      if (err) {
        console.error('[Session Regenerate Error]:', err);
        return res.status(500).json({
          error: 'Error interno al inicializar la sesión de seguridad.'
        });
      }

      // Guardar únicamente información no sensible en la sesión
      req.session.adminId = admin.id_admin;
      req.session.correo = admin.correo;
      req.session.rol = admin.rol;
      req.session.csrfToken = crypto.randomBytes(32).toString('hex');

      req.session.save((saveError) => {
        if (saveError) {
          console.error('[Session Save Error]:', saveError.message);
          return res.status(500).json({ error: 'No se pudo guardar la sesión.' });
        }
        // Actualizar cookie XSRF
        res.cookie('XSRF-TOKEN', req.session.csrfToken, {
          httpOnly: false,
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          path: '/'
        });

        return res.status(200).json({
          mensaje: 'Inicio de sesión exitoso.',
          admin: {
            id_admin: admin.id_admin,
            correo: admin.correo,
            rol: admin.rol
          }
        });
      });
    });

  } catch (error) {
    console.error('[Login Controller Error]:', error.message);
    return res.status(500).json({
      error: 'Ocurrió un error en el servidor al procesar la autenticación.'
    });
  }
}

/**
 * Obtener información del administrador autenticado
 * GET /api/auth/me
 */
function getMe(req, res) {
  return res.status(200).json({
    autenticado: true,
    admin: {
      id_admin: req.admin.id_admin,
      correo: req.admin.correo,
      rol: req.admin.rol
    }
  });
}

/**
 * Cerrar sesión e invalidar datos en servidor y navegador
 * POST /api/auth/logout
 */
function logout(req, res) {
  if (!req.session) {
    res.clearCookie('community360_sid');
    res.clearCookie('XSRF-TOKEN');
    return res.status(200).json({ mensaje: 'Sesión finalizada.' });
  }

  const sessionId = req.sessionID;
  req.session.destroy((err) => {
    if (err) {
      console.error('[Logout Error]:', err);
      return res.status(500).json({ error: 'Error al destruir la sesión.' });
    }

    desconectarSesion(req.app.get('io'), sessionId);
    res.clearCookie('community360_sid', { path: '/' });
    res.clearCookie('XSRF-TOKEN', { path: '/' });

    return res.status(200).json({
      mensaje: 'Sesión cerrada exitosamente.'
    });
  });
}

/**
 * Endpoint de prueba privado para demostrar autorización
 * GET /api/privado/prueba
 */
function getPruebaPrivada(req, res) {
  return res.status(200).json({
    mensaje: 'Acceso autorizado a endpoint privado.',
    admin: {
      id_admin: req.admin.id_admin,
      correo: req.admin.correo,
      rol: req.admin.rol
    },
    fecha_acceso: new Date().toISOString()
  });
}

/**
 * Obtener token CSRF para formularios y clientes HTTP
 * GET /api/auth/csrf
 */
function getCsrfToken(req, res) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return res.status(200).json({
    csrfToken: req.session.csrfToken
  });
}

module.exports = {
  login,
  getMe,
  logout,
  getPruebaPrivada,
  getCsrfToken
};
