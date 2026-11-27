/**
 * Suite de Pruebas Unitarias (sin conexión a bases de datos cloud).
 * Verifica validaciones de negocio, privacidad geográfica, CSRF y sanitización.
 * COMMUNITY 360 - Sistema Completo
 */

const assert = require('assert');
const Module = require('module');

// Mock de usuariosService para pruebas unitarias aisladas
const originalLoad = Module._load;
let mockUsuarioRespuesta = { existe: true, id_usuario: 'U000852', estatus: 'activo', consentimiento_datos: true };

Module._load = function (request, parent, isMain) {
  if (request === './usuariosService' || request.endsWith('usuariosService')) {
    return {
      verificarUsuarioYConsentimiento: async () => mockUsuarioRespuesta
    };
  }
  return originalLoad.apply(this, arguments);
};

const {
  validarYConstruirDocumento,
  sanitizarInteraccionSalida,
  HttpError
} = require('../services/interaccionesService');
const { verifyCsrf } = require('../middleware/csrf');

let pasadas = 0;
let fallidas = 0;

async function probar(nombre, fn) {
  try {
    await fn();
    console.log(`✓ ${nombre}`);
    pasadas++;
  } catch (err) {
    console.error(`✗ FALLÓ: ${nombre} -> ${err.message}`);
    fallidas++;
  }
}

async function main() {
  console.log('='.repeat(65));
  console.log('  COMMUNITY 360 - Suite de Pruebas Unitarias (Simuladas/Aisladas)');
  console.log('='.repeat(65));

  await probar('1. Construcción de documento válido con usuario con consentimiento', async () => {
    mockUsuarioRespuesta = { existe: true, id_usuario: 'U000852', estatus: 'activo', consentimiento_datos: true };
    const doc = await validarYConstruirDocumento({
      id_interaccion: 'TEST_U_001',
      id_usuario: 'U000852',
      timestamp: '2026-11-26T18:00:00Z',
      canal: 'Discord',
      tipo: 'comentario',
      texto: 'Hola comunidad',
      tema: 'musica',
      sentimiento: 0.75,
      reacciones_recibidas: 2,
      etiquetas: ['musica', 'saludo'],
      ubicacion: { pais: 'México', estado: 'Yucatán', ciudad: 'Mérida', campo_extra: 'ignorar' }
    });
    assert.strictEqual(doc.id_interaccion, 'TEST_U_001');
    assert.strictEqual(doc.longitud_texto, 14);
    assert.deepStrictEqual(doc.ubicacion, { pais: 'México', estado: 'Yucatán', ciudad: 'Mérida' });
  });

  await probar('Privacidad: otro usuario con consentimiento no hereda ubicación', async () => {
    const docExistente = { id_interaccion: 'TEST_PRIV', id_usuario: 'U_ANTERIOR',
      timestamp: '2026-11-26T18:00:00Z', canal: 'Discord', tipo: 'comentario', tema: 'musica',
      ubicacion: { pais: 'México', estado: 'Yucatán', ciudad: 'Mérida' } };
    mockUsuarioRespuesta = { existe: true, id_usuario: 'U_NUEVO', consentimiento_datos: true };
    const cambiado = await validarYConstruirDocumento({ id_usuario: 'U_NUEVO' }, { esActualizacion: true, docExistente });
    assert.strictEqual(cambiado.id_usuario, 'U_NUEVO');
    assert.strictEqual(cambiado.ubicacion, undefined);
  });

  await probar('2. Rechazo (403) si usuario SIN consentimiento intenta enviar ubicacion', async () => {
    mockUsuarioRespuesta = { existe: true, id_usuario: 'U000100', estatus: 'activo', consentimiento_datos: false };
    await assert.rejects(
      () => validarYConstruirDocumento({
        id_interaccion: 'TEST_U_002',
        id_usuario: 'U000100',
        timestamp: '2026-11-26T18:00:00Z',
        canal: 'Facebook',
        tipo: 'mensaje',
        tema: 'videojuegos',
        ubicacion: { pais: 'México', estado: 'CDMX', ciudad: 'Ciudad de México' }
      }),
      (err) => err instanceof HttpError && err.status === 403 && err.codigo === 'PRIVACIDAD_GEOGRAFICA'
    );
  });

  await probar('3. Rechazo (400) cuando id_usuario no existe en TiDB', async () => {
    mockUsuarioRespuesta = { existe: false, consentimiento_datos: false };
    await assert.rejects(
      () => validarYConstruirDocumento({
        id_interaccion: 'TEST_U_003',
        id_usuario: 'U999999',
        timestamp: '2026-11-26T18:00:00Z',
        canal: 'Facebook',
        tipo: 'mensaje',
        tema: 'videojuegos'
      }),
      (err) => err instanceof HttpError && err.status === 400 && err.codigo === 'USUARIO_NO_EXISTE'
    );
  });

  await probar('4. Rechazo (400) cuando sentimiento está fuera de [-1, 1]', async () => {
    mockUsuarioRespuesta = { existe: true, id_usuario: 'U000852', estatus: 'activo', consentimiento_datos: true };
    await assert.rejects(
      () => validarYConstruirDocumento({
        id_interaccion: 'TEST_U_004',
        id_usuario: 'U000852',
        timestamp: '2026-11-26T18:00:00Z',
        canal: 'Discord',
        tipo: 'comentario',
        tema: 'musica',
        sentimiento: 1.5
      }),
      (err) => err instanceof HttpError && err.status === 400
    );
  });

  await probar('5. Rechazo (400) cuando etiquetas no es un arreglo', async () => {
    await assert.rejects(
      () => validarYConstruirDocumento({
        id_interaccion: 'TEST_U_005',
        id_usuario: 'U000852',
        timestamp: '2026-11-26T18:00:00Z',
        canal: 'Discord',
        tipo: 'comentario',
        tema: 'musica',
        etiquetas: 'no_es_arreglo'
      }),
      (err) => err instanceof HttpError && err.status === 400
    );
  });

  await probar('6. Rechazo (400) cuando reacciones_recibidas es negativo', async () => {
    await assert.rejects(
      () => validarYConstruirDocumento({
        id_interaccion: 'TEST_U_006',
        id_usuario: 'U000852',
        timestamp: '2026-11-26T18:00:00Z',
        canal: 'Discord',
        tipo: 'comentario',
        tema: 'musica',
        reacciones_recibidas: -3
      }),
      (err) => err instanceof HttpError && err.status === 400
    );
  });

  await probar('7. Sanitización de salida omite objeto ubicacion', () => {
    const salida = sanitizarInteraccionSalida({
      id_interaccion: 'I0001825',
      id_usuario: 'U000852',
      timestamp: '2026-10-28T16:59:03Z',
      canal: 'Facebook',
      tipo: 'comentario',
      texto: 'Prueba',
      tema: 'musica',
      sentimiento: 0.86,
      ubicacion: { pais: 'México', estado: 'Yucatán', ciudad: 'Mérida' }
    });
    assert.strictEqual('ubicacion' in salida, false);
  });

  await probar('8. Middleware CSRF bloquea POST sin token y permite POST con token válido', () => {
    let statusCode = null;
    let nextCalled = false;

    verifyCsrf(
      { method: 'POST', headers: {}, session: { csrfToken: 'abc123' } },
      { status: (c) => ({ json: () => { statusCode = c; } }) },
      () => { nextCalled = true; }
    );
    assert.strictEqual(statusCode, 403);
    assert.strictEqual(nextCalled, false);

    verifyCsrf(
      { method: 'POST', headers: { 'x-csrf-token': 'abc123' }, session: { csrfToken: 'abc123' } },
      { status: () => ({ json: () => {} }) },
      () => { nextCalled = true; }
    );
    assert.strictEqual(nextCalled, true);
  });

  console.log('='.repeat(65));
  console.log(`RESUMEN UNITARIO: ${pasadas} pasadas, ${fallidas} fallidas.`);
  console.log('='.repeat(65));
  process.exit(fallidas > 0 ? 1 : 0);
}

main();
