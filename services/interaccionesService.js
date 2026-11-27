/**
 * Servicio de administración, validación cruzada y privacidad de interacciones en Couchbase Capella.
 * COMMUNITY 360 - Fases 4, 5 y 6
 */

const { couchbase, getKeyspace, getCollection, executeQuery } = require('../config/couchbase');
const { verificarUsuarioYConsentimiento } = require('./usuariosService');

// Catálogos aprobados en Fase 1 y Fase 2
const CANALES_VALIDOS = ['Facebook', 'Instagram', 'Twitter/X', 'TikTok', 'Telegram', 'Discord'];
const TIPOS_VALIDOS = ['comentario', 'reaccion', 'mensaje', 'respuesta_encuesta', 'rsvp_evento'];
const TEMAS_VALIDOS = [
  'musica',
  'eventos_convenciones',
  'videojuegos',
  'fursuits',
  'reglas_moderacion',
  'arte_comisiones',
  'seguridad_privacidad',
  'memes_humor'
];
const DISPOSITIVOS_VALIDOS = ['Android', 'iOS', 'Escritorio', 'Web'];
const ID_INTERACCION_REGEX = /^[A-Za-z0-9_-]{3,40}$/;

/**
 * Error de negocio con código HTTP específico para ser manejado por los controladores.
 */
class HttpError extends Error {
  constructor(status, message, codigo = 'ERROR_VALIDACION') {
    super(message);
    this.status = status;
    this.codigo = codigo;
  }
}

/**
 * Normaliza un timestamp ISO 8601 a formato UTC estándar YYYY-MM-DDTHH:mm:ssZ.
 */
function normalizarTimestamp(valor) {
  if (!valor || typeof valor !== 'string') {
    return null;
  }
  const fecha = new Date(valor.trim());
  if (Number.isNaN(fecha.getTime())) {
    return null;
  }
  return fecha.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Verifica que un valor sea un entero no negativo estricto.
 */
function esEnteroNoNegativo(valor) {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0;
}

/**
 * Elimina información geográfica privada antes de devolver documentos por REST o WebSockets.
 */
function sanitizarInteraccionSalida(doc) {
  if (!doc || typeof doc !== 'object') {
    return null;
  }
  return {
    id_interaccion: doc.id_interaccion,
    id_usuario: doc.id_usuario,
    timestamp: doc.timestamp,
    canal: doc.canal,
    tipo: doc.tipo,
    texto: doc.texto ?? null,
    tema: doc.tema,
    sentimiento: doc.sentimiento ?? null,
    idioma: doc.idioma || 'es',
    dispositivo: doc.dispositivo || 'Web',
    longitud_texto: doc.longitud_texto ?? 0,
    reacciones_recibidas: doc.reacciones_recibidas ?? 0,
    etiquetas: Array.isArray(doc.etiquetas) ? doc.etiquetas : []
  };
}

/**
 * Valida y construye el documento JSON compatible con el modelo de la Fase 1 y 2.
 */
async function validarYConstruirDocumento(payload, { esActualizacion = false, docExistente = null } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'El cuerpo de la petición debe ser un objeto JSON válido.', 'PAYLOAD_INVALIDO');
  }

  const base = esActualizacion && docExistente ? { ...docExistente } : {};

  // 1. Identificador de interacción
  const idInteraccion = esActualizacion
    ? docExistente.id_interaccion
    : (typeof payload.id_interaccion === 'string' ? payload.id_interaccion.trim() : '');

  if (!idInteraccion || !ID_INTERACCION_REGEX.test(idInteraccion)) {
    throw new HttpError(
      400,
      'El campo id_interaccion es obligatorio y debe tener entre 3 y 40 caracteres alfanuméricos, guiones o guiones bajos.',
      'ID_INTERACCION_INVALIDO'
    );
  }

  if (esActualizacion && payload.id_interaccion && payload.id_interaccion.trim() !== docExistente.id_interaccion) {
    throw new HttpError(400, 'No está permitido modificar el id_interaccion de un documento existente.', 'ID_INMUTABLE');
  }

  // 2. Usuario referenciado en TiDB Cloud
  const idUsuario = payload.id_usuario !== undefined
    ? (typeof payload.id_usuario === 'string' ? payload.id_usuario.trim() : '')
    : base.id_usuario;

  if (!idUsuario) {
    throw new HttpError(400, 'El campo id_usuario es obligatorio.', 'USUARIO_REQUERIDO');
  }

  const usuarioInfo = await verificarUsuarioYConsentimiento(idUsuario);
  if (!usuarioInfo.existe) {
    throw new HttpError(
      400,
      `El usuario '${idUsuario}' no existe en TiDB Cloud. Se rechaza la interacción para preservar la integridad referencial.`,
      'USUARIO_NO_EXISTE'
    );
  }

  // 3. Catálogos: tipo, canal, tema
  const tipo = payload.tipo !== undefined ? payload.tipo : base.tipo;
  if (!TIPOS_VALIDOS.includes(tipo)) {
    throw new HttpError(
      400,
      `El campo 'tipo' es inválido. Valores permitidos: ${TIPOS_VALIDOS.join(', ')}.`,
      'TIPO_INVALIDO'
    );
  }

  const canal = payload.canal !== undefined ? payload.canal : base.canal;
  if (!CANALES_VALIDOS.includes(canal)) {
    throw new HttpError(
      400,
      `El campo 'canal' es inválido. Valores permitidos: ${CANALES_VALIDOS.join(', ')}.`,
      'CANAL_INVALIDO'
    );
  }

  const tema = payload.tema !== undefined ? payload.tema : base.tema;
  if (!TEMAS_VALIDOS.includes(tema)) {
    throw new HttpError(
      400,
      `El campo 'tema' es inválido. Valores permitidos: ${TEMAS_VALIDOS.join(', ')}.`,
      'TEMA_INVALIDO'
    );
  }

  // 4. Timestamp ISO 8601
  const tsInput = payload.timestamp !== undefined ? payload.timestamp : base.timestamp;
  const timestamp = normalizarTimestamp(tsInput);
  if (!timestamp) {
    throw new HttpError(400, 'El campo timestamp debe ser una fecha/hora válida en formato ISO 8601.', 'TIMESTAMP_INVALIDO');
  }

  // 5. Texto y longitud_texto
  let texto = payload.texto !== undefined ? payload.texto : base.texto;
  if (texto !== null && texto !== undefined && typeof texto !== 'string') {
    throw new HttpError(400, 'El campo texto debe ser una cadena o null.', 'TEXTO_INVALIDO');
  }
  if (tipo === 'reaccion') {
    texto = texto && texto.trim() !== '' ? texto.trim() : null;
  } else {
    if (texto !== null && texto !== undefined) {
      texto = texto.trim();
    } else {
      texto = null;
    }
  }

  let longitudTexto;
  if (payload.longitud_texto !== undefined) {
    longitudTexto = payload.longitud_texto;
  } else if (esActualizacion && payload.texto === undefined) {
    longitudTexto = base.longitud_texto ?? 0;
  } else {
    longitudTexto = texto ? texto.length : 0;
  }

  if (!esEnteroNoNegativo(longitudTexto)) {
    throw new HttpError(400, 'El campo longitud_texto debe ser un entero no negativo.', 'LONGITUD_INVALIDA');
  }

  // 6. Sentimiento (-1 a 1 o null)
  const sentimiento = payload.sentimiento !== undefined ? payload.sentimiento : (base.sentimiento ?? null);
  if (sentimiento !== null) {
    if (typeof sentimiento !== 'number' || Number.isNaN(sentimiento) || sentimiento < -1 || sentimiento > 1) {
      throw new HttpError(400, 'El campo sentimiento debe ser un número entre -1 y 1 (o null).', 'SENTIMIENTO_INVALIDO');
    }
  }

  // 7. Contadores (reacciones_recibidas)
  const reaccionesRecibidas = payload.reacciones_recibidas !== undefined
    ? payload.reacciones_recibidas
    : (base.reacciones_recibidas ?? 0);

  if (!esEnteroNoNegativo(reaccionesRecibidas)) {
    throw new HttpError(400, 'El campo reacciones_recibidas debe ser un entero no negativo.', 'REACCIONES_INVALIDAS');
  }

  // 8. Etiquetas (arreglo de cadenas)
  const etiquetas = payload.etiquetas !== undefined ? payload.etiquetas : (base.etiquetas ?? []);
  if (!Array.isArray(etiquetas) || etiquetas.some((e) => typeof e !== 'string')) {
    throw new HttpError(400, 'El campo etiquetas debe ser un arreglo de cadenas.', 'ETIQUETAS_INVALIDAS');
  }
  const etiquetasLimpias = [...new Set(etiquetas.map((e) => e.trim()).filter(Boolean))];

  // 9. Idioma y dispositivo
  const idioma = payload.idioma !== undefined ? String(payload.idioma).trim() : (base.idioma || 'es');
  if (!idioma || idioma.length > 10) {
    throw new HttpError(400, 'El campo idioma es inválido.', 'IDIOMA_INVALIDO');
  }

  const dispositivo = payload.dispositivo !== undefined ? payload.dispositivo : (base.dispositivo || 'Web');
  if (!DISPOSITIVOS_VALIDOS.includes(dispositivo)) {
    throw new HttpError(
      400,
      `El campo 'dispositivo' es inválido. Valores permitidos: ${DISPOSITIVOS_VALIDOS.join(', ')}.`,
      'DISPOSITIVO_INVALIDO'
    );
  }

  // 10. Privacidad geográfica obligatoria
  const documento = {
    id_interaccion: idInteraccion,
    id_usuario: idUsuario,
    timestamp,
    canal,
    tipo,
    texto,
    tema,
    sentimiento: sentimiento !== null ? Number(sentimiento.toFixed(4)) : null,
    idioma,
    dispositivo,
    longitud_texto: longitudTexto,
    reacciones_recibidas: reaccionesRecibidas,
    etiquetas: etiquetasLimpias
  };

  if (payload.ubicacion !== undefined && payload.ubicacion !== null) {
    if (!usuarioInfo.consentimiento_datos) {
      throw new HttpError(
        403,
        `Privacidad geográfica: el usuario '${idUsuario}' no autorizó el tratamiento de su ubicación (consentimiento_datos = false).`,
        'PRIVACIDAD_GEOGRAFICA'
      );
    }
    if (typeof payload.ubicacion !== 'object' || Array.isArray(payload.ubicacion)) {
      throw new HttpError(400, 'El campo ubicacion debe ser un objeto con pais, estado y ciudad.', 'UBICACION_INVALIDA');
    }
    const pais = typeof payload.ubicacion.pais === 'string' ? payload.ubicacion.pais.trim() : '';
    const estado = typeof payload.ubicacion.estado === 'string' ? payload.ubicacion.estado.trim() : '';
    const ciudad = typeof payload.ubicacion.ciudad === 'string' ? payload.ubicacion.ciudad.trim() : '';

    if (!pais || !estado || !ciudad) {
      throw new HttpError(400, 'La ubicación autorizada debe incluir pais, estado y ciudad no vacíos.', 'UBICACION_INCOMPLETA');
    }

    documento.ubicacion = { pais, estado, ciudad };
  } else if (esActualizacion && docExistente && docExistente.ubicacion && idUsuario === docExistente.id_usuario && payload.ubicacion !== null && usuarioInfo.consentimiento_datos) {
    documento.ubicacion = docExistente.ubicacion;
  }

  return documento;
}

/**
 * Lista interacciones paginadas con filtros opcionales sin descargar toda la colección.
 */
async function listarInteracciones({ page = 1, limit = 15, tipo = '', canal = '', tema = '', id_usuario = '' } = {}) {
  const pagina = Math.max(1, parseInt(page, 10) || 1);
  const limite = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));
  const offset = (pagina - 1) * limite;

  const condiciones = [];
  const params = {};

  if (tipo && TIPOS_VALIDOS.includes(tipo)) {
    condiciones.push('tipo = $tipo');
    params.tipo = tipo;
  }
  if (canal && CANALES_VALIDOS.includes(canal)) {
    condiciones.push('canal = $canal');
    params.canal = canal;
  }
  if (tema && TEMAS_VALIDOS.includes(tema)) {
    condiciones.push('tema = $tema');
    params.tema = tema;
  }
  if (id_usuario && typeof id_usuario === 'string' && id_usuario.trim()) {
    condiciones.push('id_usuario = $id_usuario');
    params.id_usuario = id_usuario.trim();
  }

  const whereClause = condiciones.length > 0 ? `WHERE ${condiciones.join(' AND ')}` : '';
  const keyspace = getKeyspace();

  const countSql = `SELECT COUNT(*) AS total FROM ${keyspace} ${whereClause};`;
  const dataSql = `
    SELECT id_interaccion, id_usuario, \`timestamp\`, canal, tipo, texto, tema,
           sentimiento, idioma, dispositivo, longitud_texto, reacciones_recibidas, etiquetas
    FROM ${keyspace}
    ${whereClause}
    ORDER BY \`timestamp\` DESC, META().id ASC
    LIMIT $limit OFFSET $offset;
  `;

  const [countRes, dataRes] = await Promise.all([
    executeQuery(countSql, {
      parameters: params,
      readOnly: true,
      scanConsistency: couchbase.QueryScanConsistency.RequestPlus
    }),
    executeQuery(dataSql, {
      parameters: { ...params, limit: limite, offset },
      readOnly: true,
      scanConsistency: couchbase.QueryScanConsistency.RequestPlus
    })
  ]);

  const total = Number(countRes.rows[0]?.total || 0);
  const totalPaginas = Math.max(1, Math.ceil(total / limite));

  return {
    total,
    pagina,
    limite,
    total_paginas: totalPaginas,
    interacciones: dataRes.rows.map(sanitizarInteraccionSalida)
  };
}

/**
 * Obtiene una interacción específica por su clave de documento.
 */
async function obtenerInteraccionPorId(id) {
  if (!id || !ID_INTERACCION_REGEX.test(id.trim())) {
    throw new HttpError(400, 'Identificador de interacción inválido.', 'ID_INTERACCION_INVALIDO');
  }

  try {
    const collection = await getCollection();
    const result = await collection.get(id.trim());
    return sanitizarInteraccionSalida(result.content);
  } catch (error) {
    if (error instanceof couchbase.DocumentNotFoundError || error.name === 'DocumentNotFoundError') {
      throw new HttpError(404, `No se encontró la interacción '${id.trim()}'.`, 'INTERACCION_NO_ENCONTRADA');
    }
    throw error;
  }
}

/**
 * Crea una nueva interacción en Couchbase Capella tras validar integridad y privacidad.
 */
async function crearInteraccion(payload) {
  const documento = await validarYConstruirDocumento(payload, { esActualizacion: false });

  try {
    const collection = await getCollection();
    await collection.insert(documento.id_interaccion, documento);
    return sanitizarInteraccionSalida(documento);
  } catch (error) {
    if (error instanceof couchbase.DocumentExistsError || error.name === 'DocumentExistsError') {
      throw new HttpError(
        409,
        `Ya existe una interacción con el identificador '${documento.id_interaccion}'.`,
        'ID_DUPLICADO'
      );
    }
    throw error;
  }
}

/**
 * Modifica una interacción existente en Couchbase Capella.
 */
async function actualizarInteraccion(id, payload) {
  if (!id || !ID_INTERACCION_REGEX.test(id.trim())) {
    throw new HttpError(400, 'Identificador de interacción inválido.', 'ID_INTERACCION_INVALIDO');
  }

  const docId = id.trim();
  const collection = await getCollection();

  let existente;
  let cas;
  try {
    const resGet = await collection.get(docId);
    existente = resGet.content;
    cas = resGet.cas;
  } catch (error) {
    if (error instanceof couchbase.DocumentNotFoundError || error.name === 'DocumentNotFoundError') {
      throw new HttpError(404, `No se encontró la interacción '${docId}'.`, 'INTERACCION_NO_ENCONTRADA');
    }
    throw error;
  }

  const documentoActualizado = await validarYConstruirDocumento(payload, {
    esActualizacion: true,
    docExistente: existente
  });

  try {
    await collection.replace(docId, documentoActualizado, { cas });
  } catch (error) {
    if (error instanceof couchbase.CasMismatchError) {
      throw new HttpError(409, 'La interacción cambió durante la edición. Consulta su versión actual.', 'CONFLICTO_EDICION');
    }
    throw error;
  }
  return sanitizarInteraccionSalida(documentoActualizado);
}

/**
 * Elimina una interacción existente de Couchbase Capella.
 */
async function eliminarInteraccion(id) {
  if (!id || !ID_INTERACCION_REGEX.test(id.trim())) {
    throw new HttpError(400, 'Identificador de interacción inválido.', 'ID_INTERACCION_INVALIDO');
  }

  const docId = id.trim();
  const collection = await getCollection();

  try {
    await collection.remove(docId);
    return { eliminado: true, id_interaccion: docId };
  } catch (error) {
    if (error instanceof couchbase.DocumentNotFoundError || error.name === 'DocumentNotFoundError') {
      throw new HttpError(404, `No se encontró la interacción '${docId}'.`, 'INTERACCION_NO_ENCONTRADA');
    }
    throw error;
  }
}

module.exports = {
  HttpError,
  CANALES_VALIDOS,
  TIPOS_VALIDOS,
  TEMAS_VALIDOS,
  DISPOSITIVOS_VALIDOS,
  validarYConstruirDocumento,
  sanitizarInteraccionSalida,
  listarInteracciones,
  obtenerInteraccionPorId,
  crearInteraccion,
  actualizarInteraccion,
  eliminarInteraccion
};
