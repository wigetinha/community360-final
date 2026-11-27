/**
 * Manejador de WebSockets en tiempo real con Socket.IO.
 * Comparte el servidor HTTP de Express y valida la sesión existente en TiDB Cloud.
 * COMMUNITY 360 - Fase 5
 */

const { Server } = require('socket.io');
const { pool } = require('../config/database');

function salaSesion(id) {
  return 'sesion:' + id;
}

async function autorizado(socket) {
  const req = socket.request;
  const adminId = socket.admin?.id_admin;
  if (!socket.connected || !adminId) return false;
  try {
    const vigente = await new Promise((resolve, reject) => {
      req.sessionStore.get(req.sessionID, (error, session) => error ? reject(error) : resolve(session));
    });
    if (vigente?.adminId !== adminId) return false;
    const [rows] = await pool.query('SELECT activo FROM administradores WHERE id_admin = ? LIMIT 1', [adminId]);
    return socket.connected && Boolean(rows[0]?.activo);
  } catch (error) {
    console.error('[Socket autorización]', error.message);
    return false;
  }
}

function desconectarSesion(io, id) {
  if (io && id) io.in(salaSesion(id)).disconnectSockets(true);
}

/**
 * Inicializa Socket.IO sobre el servidor HTTP de Express con autenticación por sesión.
 */
function initSocketServer(httpServer, sessionMiddleware) {
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
    : undefined;

  const io = new Server(httpServer, {
    cors: corsOrigin ? { origin: corsOrigin, credentials: true } : undefined
  });

  // Compartir express-session con el handshake de Socket.IO
  io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
  });

  // Middleware de autorización estricta: rechazar conexiones anónimas o inactivas
  io.use(async (socket, next) => {
    try {
      const req = socket.request;
      if (!req.session || !req.session.adminId) {
        return next(new Error('NO_AUTORIZADO: Se requiere sesión activa.'));
      }

      const [rows] = await pool.query(
        'SELECT id_admin, correo, rol, activo FROM administradores WHERE id_admin = ? LIMIT 1',
        [req.session.adminId]
      );

      if (rows.length === 0 || !rows[0].activo) {
        return next(new Error('NO_AUTORIZADO: Cuenta inactiva o inexistente.'));
      }

      socket.admin = {
        id_admin: rows[0].id_admin,
        correo: rows[0].correo,
        rol: rows[0].rol
      };

      return next();
    } catch (error) {
      console.error('[Socket Auth Error]:', error.message);
      return next(new Error('ERROR_VERIFICACION_SESION'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(['admins_autenticados', salaSesion(socket.request.sessionID)]);
    const control = setInterval(async () => {
      if (!await autorizado(socket)) socket.disconnect(true);
    }, 30000);
    control.unref();
    socket.once('disconnect', () => clearInterval(control));
    socket.emit('conexion:confirmada', {
      mensaje: 'Conectado al canal en tiempo real de COMMUNITY 360.',
      admin: socket.admin.correo,
      timestamp: new Date().toISOString()
    });
  });

  return io;
}

/**
 * Emite una notificación de cambio a todos los administradores autenticados conectados.
 */
async function emitirCambioInteraccion(io, accion, detalle = {}) {
  if (!io) return;

  const payload = {
    accion,
    ...detalle,
    timestamp: new Date().toISOString()
  };

  const sockets = io.of('/').sockets;
  const ids = io.of('/').adapter.rooms.get('admins_autenticados') || [];
  await Promise.all([...ids].map(async (id) => {
    const socket = sockets.get(id);
    if (!socket) return;
    if (!await autorizado(socket)) {
      socket.disconnect(true);
      return;
    }
    socket.emit('interacciones:actualizadas', payload);
    socket.emit('interaccion:' + accion, payload);
  }));
}

module.exports = {
  initSocketServer,
  desconectarSesion,
  emitirCambioInteraccion
};
