/**
 * Servicio de consulta de usuarios y participación en TiDB Cloud (SQL).
 * COMMUNITY 360 - Fases 4, 5 y 6
 */

const { pool } = require('../config/database');

/**
 * Obtiene el resumen estadístico de usuarios registrados en TiDB Cloud.
 * No expone datos geográficos privados.
 */
async function obtenerResumenUsuarios() {
  const [rows] = await pool.query(`
    SELECT
      COUNT(*) AS total_usuarios,
      COALESCE(SUM(CASE WHEN estatus = 'activo' THEN 1 ELSE 0 END), 0) AS usuarios_activos,
      COALESCE(SUM(CASE WHEN estatus = 'inactivo' THEN 1 ELSE 0 END), 0) AS usuarios_inactivos,
      COALESCE(SUM(CASE WHEN estatus = 'en_riesgo' THEN 1 ELSE 0 END), 0) AS usuarios_en_riesgo
    FROM usuarios
  `);

  const stats = rows[0] || {};
  const totalUsuarios = Number(stats.total_usuarios || 0);
  const usuariosActivos = Number(stats.usuarios_activos || 0);
  const usuariosInactivos = Number(stats.usuarios_inactivos || 0);
  const usuariosEnRiesgo = Number(stats.usuarios_en_riesgo || 0);

  const porcentajeEnRiesgo = totalUsuarios > 0
    ? Number(((usuariosEnRiesgo / totalUsuarios) * 100).toFixed(2))
    : 0;

  return {
    total_usuarios: totalUsuarios,
    usuarios_activos: usuariosActivos,
    usuarios_inactivos: usuariosInactivos,
    usuarios_en_riesgo: usuariosEnRiesgo,
    porcentaje_en_riesgo: porcentajeEnRiesgo
  };
}

/**
 * Obtiene la distribución de usuarios por estatus de participación desde TiDB Cloud.
 */
async function obtenerParticipacionPorEstatus() {
  const [rows] = await pool.query(`
    SELECT estatus, COUNT(*) AS cantidad
    FROM usuarios
    GROUP BY estatus
    ORDER BY cantidad DESC
  `);

  const total = rows.reduce((acc, r) => acc + Number(r.cantidad || 0), 0);

  return {
    total_usuarios: total,
    distribucion: rows.map((r) => {
      const cantidad = Number(r.cantidad || 0);
      return {
        estatus: r.estatus,
        cantidad,
        porcentaje: total > 0 ? Number(((cantidad / total) * 100).toFixed(2)) : 0
      };
    })
  };
}

/**
 * Verifica si un usuario existe en TiDB Cloud y si otorgó consentimiento para datos geográficos.
 * Se utiliza como validación de integridad referencial cruzada antes de escribir en Couchbase.
 */
async function verificarUsuarioYConsentimiento(idUsuario) {
  if (!idUsuario || typeof idUsuario !== 'string') {
    return { existe: false, consentimiento_datos: false };
  }

  const [rows] = await pool.query(
    'SELECT id_usuario, estatus, consentimiento_datos FROM usuarios WHERE id_usuario = ? LIMIT 1',
    [idUsuario.trim()]
  );

  if (rows.length === 0) {
    return { existe: false, consentimiento_datos: false };
  }

  return {
    existe: true,
    id_usuario: rows[0].id_usuario,
    estatus: rows[0].estatus,
    consentimiento_datos: Boolean(rows[0].consentimiento_datos)
  };
}

module.exports = {
  obtenerResumenUsuarios,
  obtenerParticipacionPorEstatus,
  verificarUsuarioYConsentimiento
};
