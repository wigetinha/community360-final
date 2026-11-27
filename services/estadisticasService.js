/**
 * Servicio de estadísticas analíticas híbridas (TiDB Cloud + Couchbase Capella).
 * Procesa cada motor de forma independiente para que una falla parcial no oculte datos disponibles.
 * COMMUNITY 360 - Fases 4, 5 y 6
 */

const { couchbase, getKeyspace, executeQuery, diagnosticarErrorCouchbase } = require('../config/couchbase');
const { obtenerResumenUsuarios, obtenerParticipacionPorEstatus } = require('./usuariosService');

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];


let distribuciones;
const CONSISTENCIA = { readOnly: true, scanConsistency: couchbase.QueryScanConsistency.RequestPlus };

function invalidarDistribuciones() {
  distribuciones = undefined;
}

function obtenerDistribuciones() {
  if (distribuciones && Date.now() < distribuciones.vence) return distribuciones.resultado;

  const entrada = { vence: Infinity };
  distribuciones = entrada;
  entrada.resultado = executeQuery(
    `SELECT tipo, canal, tema, COUNT(*) AS cantidad,
            SUM(CASE WHEN ISNUMBER(sentimiento) THEN 1 ELSE 0 END) AS n_sentimiento,
            SUM(CASE WHEN ISNUMBER(sentimiento) THEN sentimiento ELSE 0 END) AS suma_sentimiento
     FROM ${getKeyspace()}
     GROUP BY tipo, canal, tema;`,
    CONSISTENCIA
  ).then(({ rows }) => {
    const total = rows.reduce((sum, row) => sum + row.cantidad, 0);
    const conSentimiento = rows.reduce((sum, row) => sum + row.n_sentimiento, 0);
    const suma = rows.reduce((sum, row) => sum + row.suma_sentimiento, 0);
    const agrupar = (campo) => {
      const cantidades = new Map();
      for (const row of rows) {
        const etiqueta = row[campo] ?? 'Sin clasificar';
        cantidades.set(etiqueta, (cantidades.get(etiqueta) ?? 0) + row.cantidad);
      }
      return [...cantidades.entries()].map(([etiqueta, cantidad]) => ({
        [campo]: etiqueta, cantidad, porcentaje: Number((cantidad * 100 / total).toFixed(2))
      })).sort((a, b) => b.cantidad - a.cantidad || a[campo].localeCompare(b[campo]));
    };
    entrada.vence = Date.now() + 5000;
    return {
      total, conSentimiento, promedio: conSentimiento ? Number((suma / conSentimiento).toFixed(4)) : null,
      tipos: agrupar('tipo'), canales: agrupar('canal'), temas: agrupar('tema')
    };
  }).catch((error) => {
    if (distribuciones === entrada) invalidarDistribuciones();
    console.error('[Capella distribuciones]', error.name, error.message, error.context?.firstErrorMessage);
    throw error;
  });
  return entrada.resultado;
}

async function obtenerResumenDashboard() {
  const [tidb, capella] = await Promise.allSettled([obtenerResumenUsuarios(), obtenerDistribuciones()]);
  const usuarios = tidb.value || {
    total_usuarios: null, usuarios_activos: null, usuarios_inactivos: null,
    usuarios_en_riesgo: null, porcentaje_en_riesgo: null
  };
  const datos = capella.value;
  const errores = {};
  if (tidb.status === 'rejected') {
    console.error('[TiDB usuarios]', tidb.reason.message);
    errores.tidb = 'No se pudo consultar el padrón en TiDB Cloud.';
  }
  if (capella.status === 'rejected') {
    errores.tipos = diagnosticarErrorCouchbase(capella.reason);
    errores.sentimiento = errores.tipos;
  }
  return {
    ...usuarios,
    total_interacciones: datos?.total ?? null,
    sentimiento_promedio: datos?.promedio ?? null,
    interacciones_con_sentimiento: datos?.conSentimiento ?? null,
    distribucion_por_tipo: datos?.tipos ?? [],
    tidb_disponible: tidb.status === 'fulfilled',
    couchbase_disponible: capella.status === 'fulfilled',
    errores,
    actualizado_en: new Date().toISOString()
  };
}

async function obtenerTemasPopulares() {
  const { total, temas } = await obtenerDistribuciones();
  return { total_interacciones: total, temas };
}

async function obtenerCanales() {
  const { total, canales } = await obtenerDistribuciones();
  return { total_interacciones: total, canales };
}


/**
 * Obtiene la actividad agregada directamente en Couchbase (SQL++ GROUP BY) por fecha y por matriz día-hora UTC.
 * Optimizado para no descargar documentos completos.
 */
async function obtenerActividadTemporal() {
  const keyspace = getKeyspace();

  const [resMatriz, resFechas] = await Promise.all([
    executeQuery(
      `SELECT DATE_PART_STR(STR_TO_UTC(\`timestamp\`), 'dow') AS dia_indice,
              DATE_PART_STR(STR_TO_UTC(\`timestamp\`), 'hour') AS hora,
              COUNT(*) AS cantidad
       FROM ${keyspace}
       WHERE ISNUMBER(STR_TO_MILLIS(\`timestamp\`))
       GROUP BY DATE_PART_STR(STR_TO_UTC(\`timestamp\`), 'dow'), DATE_PART_STR(STR_TO_UTC(\`timestamp\`), 'hour');`,
      { readOnly: true, scanConsistency: couchbase.QueryScanConsistency.RequestPlus }
    ),
    executeQuery(
      `SELECT SUBSTR(STR_TO_UTC(\`timestamp\`), 0, 10) AS fecha,
              COUNT(*) AS cantidad
       FROM ${keyspace}
       WHERE ISNUMBER(STR_TO_MILLIS(\`timestamp\`))
       GROUP BY SUBSTR(STR_TO_UTC(\`timestamp\`), 0, 10)
       ORDER BY fecha DESC
       LIMIT 90;`,
      { readOnly: true, scanConsistency: couchbase.QueryScanConsistency.RequestPlus }
    )
  ]);

  const matrizDiaHora = Array.from({ length: 7 }, () => Array(24).fill(0));
  let maximoCelda = 0;
  let totalInteracciones = 0;

  for (const row of resMatriz.rows || []) {
    const dia = Number(row.dia_indice);
    const hora = Number(row.hora);
    const cant = Number(row.cantidad || 0);
    if (dia >= 0 && dia <= 6 && hora >= 0 && hora <= 23) {
      matrizDiaHora[dia][hora] = cant;
      totalInteracciones += cant;
      if (cant > maximoCelda) {
        maximoCelda = cant;
      }
    }
  }

  const porFecha = [...resFechas.rows].reverse().map((r) => ({
    fecha: r.fecha,
    cantidad: Number(r.cantidad || 0)
  }));

  const mapaCalor = DIAS_SEMANA.map((nombreDia, indiceDia) => ({
    dia_indice: indiceDia,
    dia_nombre: nombreDia,
    horas: matrizDiaHora[indiceDia]
  }));

  return {
    total_interacciones: totalInteracciones,
    maximo_celda_hora: maximoCelda,
    por_fecha: porFecha,
    mapa_calor: mapaCalor
  };
}

module.exports = {
  invalidarDistribuciones,
  obtenerResumenDashboard,
  obtenerTemasPopulares,
  obtenerParticipacionPorEstatus,
  obtenerCanales,
  obtenerActividadTemporal
};
