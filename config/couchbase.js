/**
 * Configuración de conexión segura (TLS) a Couchbase Capella mediante el SDK oficial Node.js.
 * COMMUNITY 360 - Fases 4, 5 y 6
 */

const path = require('path');
const couchbase = require('couchbase');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const CB_BUCKET = (process.env.CB_BUCKET || 'community360').trim();
const CB_SCOPE = (process.env.CB_SCOPE || '_default').trim();
const CB_COLLECTION = (process.env.CB_COLLECTION || 'interacciones').trim();

let clusterInstance = null;
let connectingPromise = null;

/**
 * Devuelve el nombre completo del keyspace en formato SQL++: `bucket`.`scope`.`collection`
 */
function getKeyspace() {
  return `\`${CB_BUCKET}\`.\`${CB_SCOPE}\`.\`${CB_COLLECTION}\``;
}

/**
 * Valida que las variables de entorno de Couchbase Capella estén presentes y usen TLS.
 */
function validarConfiguracionCouchbase() {
  const connStr = (process.env.CB_CONNECTION_STRING || '').trim();
  const username = (process.env.CB_USERNAME || '').trim();
  const password = (process.env.CB_PASSWORD || '').trim();

  if (!connStr || !username || !password) {
    throw new Error('Configuración de Couchbase Capella incompleta (CB_CONNECTION_STRING, CB_USERNAME, CB_PASSWORD).');
  }

  if (!connStr.startsWith('couchbases://')) {
    throw new Error('CB_CONNECTION_STRING debe utilizar el esquema seguro couchbases:// con TLS.');
  }

  return { connStr, username, password };
}

/**
 * Traduce errores técnicos del SDK de Couchbase a diagnósticos claros sin exponer credenciales.
 */
function diagnosticarErrorCouchbase(error) {
  const msg = [error?.message, error?.context?.firstErrorMessage].filter(Boolean).join(': ');
  const lower = msg.toLowerCase();

  if (lower.includes('unambiguous timeout') || lower.includes('ambiguous timeout') || lower.includes('timed out')) {
    return 'Tiempo de espera agotado al conectar con Couchbase Capella. Verifica que el clúster esté activo y que tu IP pública actual esté autorizada en Capella (Allowed IP Addresses).';
  }
  if (lower.includes('authentication') || lower.includes('authorization') || lower.includes('permission')) {
    return 'Credenciales de Couchbase Capella inválidas o sin permisos sobre el bucket.';
  }
  if (lower.includes('bucket') && lower.includes('not found')) {
    return `El bucket '${CB_BUCKET}' no existe o no es accesible.`;
  }
  if (lower.includes('index') || lower.includes('no index available')) {
    return 'Falta un índice secundario o primario en Couchbase Capella para ejecutar la consulta.';
  }
  return 'No se pudo ejecutar la consulta en Couchbase Capella. Revisa el registro del servidor.';
}

/**
 * Obtiene una instancia conectada del clúster de Couchbase Capella (con reconexión automática).
 */
async function getCluster() {
  if (clusterInstance) {
    return clusterInstance;
  }

  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = Promise.resolve().then(async () => {
    try {
      const { connStr, username, password } = validarConfiguracionCouchbase();
      const cluster = await couchbase.connect(connStr, {
        username,
        password,
        // Límites explícitos: wanDevelopment los sobrescribe con hasta 120 s.
        dnsConfig: { dnsSrvTimeout: 5000 },
        timeouts: {
          kvTimeout: 5000,
          queryTimeout: 10000,
          bootstrapTimeout: 10000,
          connectTimeout: 8000,
          resolveTimeout: 5000
        }
      });

      clusterInstance = cluster;
      return clusterInstance;
    } catch (error) {
      clusterInstance = null;
      throw error;
    } finally {
      connectingPromise = null;
    }
  });

  return connectingPromise;
}

/**
 * Reinicia la referencia del clúster para forzar reconexión en la siguiente operación.
 */
function resetCluster() {
  if (clusterInstance) {
    try {
      void clusterInstance.close().catch(() => {});
    } catch (_) {
      // Ignorar errores al cerrar instancia caída
    }
  }
  clusterInstance = null;
}

/**
 * Obtiene la colección configurada (`interacciones`).
 */
async function getCollection() {
  const cluster = await getCluster();
  const bucket = cluster.bucket(CB_BUCKET);
  const scope = bucket.scope(CB_SCOPE);
  return scope.collection(CB_COLLECTION);
}

/**
 * Ejecuta una consulta SQL++ (N1QL) contra Couchbase Capella con manejo de reconexión.
 */
async function executeQuery(statement, options = {}) {
  const consultar = async () => (await getCluster()).query(statement, options);
  try {
    return await consultar();
  } catch (error) {
    const transitorio = error instanceof couchbase.UnambiguousTimeoutError ||
      error instanceof couchbase.TemporaryFailureError;
    if (!options.readOnly || !transitorio) throw error;
    console.warn('[Capella lectura] Reintento:', error.name);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return consultar();
  }
}

/**
 * Prueba la conexión con Couchbase Capella ejecutando un conteo mínimo.
 */
async function testCouchbaseConnection() {
  try {
    const keyspace = getKeyspace();
    const result = await executeQuery(`SELECT COUNT(*) AS total FROM ${keyspace};`, {
      scanConsistency: couchbase.QueryScanConsistency.RequestPlus
    });
    const total = result.rows[0]?.total ?? 0;
    return {
      success: true,
      keyspace: `${CB_BUCKET}.${CB_SCOPE}.${CB_COLLECTION}`,
      totalDocumentos: total
    };
  } catch (error) {
    return {
      success: false,
      error: diagnosticarErrorCouchbase(error)
    };
  }
}

/**
 * Cierra ordenadamente la conexión con Couchbase Capella.
 */
async function closeCouchbase() {
  if (clusterInstance) {
    try {
      await clusterInstance.close();
    } catch (_) {
      // Ignorar
    }
    clusterInstance = null;
  }
}

module.exports = {
  couchbase,
  CB_BUCKET,
  CB_SCOPE,
  CB_COLLECTION,
  getKeyspace,
  getCluster,
  getCollection,
  executeQuery,
  testCouchbaseConnection,
  diagnosticarErrorCouchbase,
  closeCouchbase,
  resetCluster
};
