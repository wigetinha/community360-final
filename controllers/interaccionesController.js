/**
 * Controlador CRUD para administración de interacciones en Couchbase Capella.
 * Emite notificaciones en tiempo real vía Socket.IO únicamente después de confirmar en BD.
 * COMMUNITY 360 - Fases 4 y 5
 */

const interaccionesService = require('../services/interaccionesService');
const { diagnosticarErrorCouchbase } = require('../config/couchbase');
const { invalidarDistribuciones } = require('../services/estadisticasService');
const { emitirCambioInteraccion } = require('../sockets/socketHandler');

function manejarError(res, error, contexto) {
  if (error instanceof interaccionesService.HttpError) {
    return res.status(error.status).json({
      error: error.message,
      codigo: error.codigo
    });
  }
  console.error(`[${contexto} Error]:`, error.message);
  const diag = diagnosticarErrorCouchbase(error);
  const esTimeout = diag.includes('Tiempo de espera agotado');
  return res.status(esTimeout ? 503 : 500).json({
    error: esTimeout ? diag : 'Error interno al procesar la operación en interacciones.'
  });
}

async function listar(req, res) {
  try {
    const { page, limit, tipo, canal, tema, id_usuario } = req.query;
    const resultado = await interaccionesService.listarInteracciones({
      page,
      limit,
      tipo,
      canal,
      tema,
      id_usuario
    });
    return res.status(200).json(resultado);
  } catch (error) {
    return manejarError(res, error, 'Listar Interacciones');
  }
}

async function obtenerPorId(req, res) {
  try {
    const interaccion = await interaccionesService.obtenerInteraccionPorId(req.params.id);
    return res.status(200).json({ interaccion });
  } catch (error) {
    return manejarError(res, error, 'Obtener Interacción');
  }
}

async function crear(req, res) {
  try {
    const interaccion = await interaccionesService.crearInteraccion(req.body);

    // Emitir evento WebSocket únicamente después de confirmar la escritura en Couchbase
    const io = req.app.get('io');
    invalidarDistribuciones();
    await emitirCambioInteraccion(io, 'creada', {
      id_interaccion: interaccion.id_interaccion,
      tipo: interaccion.tipo,
      canal: interaccion.canal,
      tema: interaccion.tema
    });

    return res.status(201).json({
      mensaje: 'Interacción registrada exitosamente en Couchbase Capella.',
      interaccion
    });
  } catch (error) {
    return manejarError(res, error, 'Crear Interacción');
  }
}

async function actualizar(req, res) {
  try {
    const interaccion = await interaccionesService.actualizarInteraccion(req.params.id, req.body);

    // Emitir evento WebSocket únicamente después de confirmar la actualización en Couchbase
    const io = req.app.get('io');
    invalidarDistribuciones();
    await emitirCambioInteraccion(io, 'actualizada', {
      id_interaccion: interaccion.id_interaccion,
      tipo: interaccion.tipo,
      canal: interaccion.canal,
      tema: interaccion.tema
    });

    return res.status(200).json({
      mensaje: 'Interacción actualizada exitosamente en Couchbase Capella.',
      interaccion
    });
  } catch (error) {
    return manejarError(res, error, 'Actualizar Interacción');
  }
}

async function eliminar(req, res) {
  try {
    const resultado = await interaccionesService.eliminarInteraccion(req.params.id);

    // Emitir evento WebSocket únicamente después de confirmar el borrado en Couchbase
    const io = req.app.get('io');
    invalidarDistribuciones();
    await emitirCambioInteraccion(io, 'eliminada', {
      id_interaccion: resultado.id_interaccion
    });

    return res.status(200).json({
      mensaje: 'Interacción eliminada exitosamente de Couchbase Capella.',
      id_interaccion: resultado.id_interaccion
    });
  } catch (error) {
    return manejarError(res, error, 'Eliminar Interacción');
  }
}

module.exports = {
  listar,
  obtenerPorId,
  crear,
  actualizar,
  eliminar
};
