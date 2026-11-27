/**
 * Controlador de consultas analíticas del Dashboard (TiDB Cloud + Couchbase Capella).
 * COMMUNITY 360 - Fases 4 y 6
 */

const estadisticasService = require('../services/estadisticasService');
const { testConnection } = require('../config/database');
const { testCouchbaseConnection, diagnosticarErrorCouchbase } = require('../config/couchbase');

async function getResumen(req, res) {
  try {
    const resumen = await estadisticasService.obtenerResumenDashboard();
    if (!resumen.tidb_disponible && !resumen.couchbase_disponible) {
      return res.status(503).json({
        error: 'Ninguna base de datos respondió correctamente.',
        ...resumen
      });
    }
    return res.status(200).json(resumen);
  } catch (error) {
    console.error('[Dashboard Resumen Error]:', error.message);
    return res.status(500).json({
      error: 'Error interno al calcular el resumen del dashboard.'
    });
  }
}

async function getTemas(req, res) {
  try {
    const temas = await estadisticasService.obtenerTemasPopulares();
    return res.status(200).json(temas);
  } catch (error) {
    console.error('[Dashboard Temas Error]:', error.message);
    return res.status(503).json({
      error: diagnosticarErrorCouchbase(error)
    });
  }
}

async function getParticipacion(req, res) {
  try {
    const participacion = await estadisticasService.obtenerParticipacionPorEstatus();
    return res.status(200).json(participacion);
  } catch (error) {
    console.error('[Dashboard Participacion Error]:', error.message);
    return res.status(503).json({
      error: `Error al consultar participación en TiDB Cloud: ${error.message}`
    });
  }
}

async function getActividad(req, res) {
  try {
    const actividad = await estadisticasService.obtenerActividadTemporal();
    return res.status(200).json(actividad);
  } catch (error) {
    console.error('[Dashboard Actividad Error]:', error.message);
    return res.status(503).json({
      error: diagnosticarErrorCouchbase(error)
    });
  }
}

async function getCanales(req, res) {
  try {
    const canales = await estadisticasService.obtenerCanales();
    return res.status(200).json(canales);
  } catch (error) {
    console.error('[Dashboard Canales Error]:', error.message);
    return res.status(503).json({
      error: diagnosticarErrorCouchbase(error)
    });
  }
}

async function getEstadoServicios(req, res) {
  const [tidb, capella] = await Promise.all([
    testConnection(),
    testCouchbaseConnection()
  ]);

  return res.status(200).json({
    tidb: {
      conectado: tidb.success,
      error: tidb.success ? null : tidb.error
    },
    couchbase: {
      conectado: capella.success,
      error: capella.success ? null : capella.error
    },
    verificado_en: new Date().toISOString()
  });
}

module.exports = {
  getResumen,
  getTemas,
  getParticipacion,
  getActividad,
  getCanales,
  getEstadoServicios
};
