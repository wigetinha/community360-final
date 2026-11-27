/**
 * Middleware requireAuth para proteger rutas web y endpoints REST.
 * COMMUNITY 360 - Fase 3
 */

const { pool } = require('../config/database');

/**
 * Middleware que verifica la autenticación y el estado activo del administrador.
 */
async function requireAuth(req, res, next) {
  // Configurar encabezados anti-caché estrictos para todas las rutas protegidas
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });

  // 1. Verificar si existe sesión válida con ID de administrador
  if (!req.session || !req.session.adminId) {
    return handleUnauthorized(req, res);
  }

  try {
    // 2. Comprobar en TiDB Cloud que el administrador siga existiendo y esté activo
    const [rows] = await pool.query(
      'SELECT id_admin, correo, rol, activo FROM administradores WHERE id_admin = ? LIMIT 1',
      [req.session.adminId]
    );

    if (rows.length === 0 || !rows[0].activo) {
      // Si fue eliminado o desactivado, destruir sesión
      req.session.destroy(() => {
        res.clearCookie('community360_sid');
        return handleUnauthorized(req, res, 'Cuenta inactiva o no encontrada.');
      });
      return;
    }

    // Actualizar datos de sesión por si hubo cambios de rol
    req.admin = {
      id_admin: rows[0].id_admin,
      correo: rows[0].correo,
      rol: rows[0].rol
    };

    next();
  } catch (error) {
    console.error('[requireAuth Error]:', error.message);
    return res.status(500).json({
      error: 'Error interno de verificación de sesión.'
    });
  }
}

/**
 * Maneja respuestas de rechazo (Redirección para vistas HTML, 401 para API REST).
 */
function handleUnauthorized(req, res, mensaje = 'No autorizado. Se requiere iniciar sesión.') {
  const isApiRequest = req.originalUrl.startsWith('/api/') ||
                       req.path.startsWith('/api/') ||
                       req.xhr ||
                       (req.headers.accept && req.headers.accept.includes('application/json'));

  if (isApiRequest) {
    return res.status(401).json({
      error: mensaje,
      autenticado: false
    });
  }

  // Si es una petición de navegación en navegador (como /dashboard)
  return res.redirect('/login');
}

module.exports = {
  requireAuth
};
