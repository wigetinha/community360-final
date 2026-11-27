/**
 * Suite de Pruebas de Integración Completa (TiDB Cloud + Couchbase Capella + Express + Socket.IO).
 * Limpia automáticamente todos los registros temporales de prueba al finalizar.
 * COMMUNITY 360 - Fases 4, 5 y 6
 */

const path = require('path');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { pool } = require('../config/database');
const { closeCouchbase, executeQuery, getKeyspace, couchbase, getCollection } = require('../config/couchbase');
const { httpServer, io } = require('../server');
const { emitirCambioInteraccion } = require('../sockets/socketHandler');
const assert = require('node:assert/strict');
const { sessionStore } = require('../config/session');

let BASE_URL;

const ADMIN_TEST = {
  correo: `admin_test_${randomUUID()}@community360.com`,
  password: randomUUID(),
  rol: 'admin'
};

const ID_TEST_INTERACCION = `TEST_${randomUUID().replaceAll('-', '')}`;

function extraerCookies(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  const jar = {};
  for (const item of raw) {
    const part = item.split(';')[0];
    const idx = part.indexOf('=');
    if (idx > 0) {
      jar[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  return jar;
}

function serializarCookies(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function main() {
  let superadas = 0;
  let fallidas = 0;
  let jar = {};
  let navegador;
  let tiposBase;
  let temasBase;
  const tipos = (r) => Object.fromEntries(r.distribucion_por_tipo.map(x => [x.tipo, x.cantidad]));
  const esperarBarras = (esperado) => navegador?.page.waitForFunction((cantidades) => {
    const grafica = Chart.getChart('barChart');
    const barras = grafica?.getDatasetMeta(0).data;
    return barras?.length === Object.keys(cantidades).length && barras.every((barra, i) =>
      Math.abs(barra.y - barra.base) > 0 && grafica.data.datasets[0].data[i] === cantidades[grafica.data.labels[i]]);
  }, esperado);
  let interaccionCreada = false;
  let csrfToken = '';

  function registrar(num, desc, ok, detalle = '') {
    if (ok) {
      console.log(`[${num}] ✓ ${desc} ${detalle ? `(${detalle})` : ''}`);
      superadas++;
    } else {
      console.error(`[${num}] ✗ FALLÓ: ${desc} ${detalle ? `(${detalle})` : ''}`);
      fallidas++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('COMMUNITY 360 - Pruebas de Integración (TiDB + Capella + REST)');
  console.log('='.repeat(70) + '\n');

  try {
    // Setup admin temporal en TiDB
    const hash = await bcrypt.hash(ADMIN_TEST.password, 10);
    await pool.query(
      'INSERT INTO administradores (correo, password_hash, rol, activo) VALUES (?, ?, ?, TRUE)',
      [ADMIN_TEST.correo, hash, ADMIN_TEST.rol]
    );

    // Consultar un usuario SIN consentimiento y uno CON consentimiento en TiDB
    const [[uSinConsent]] = await pool.query('SELECT id_usuario FROM usuarios WHERE consentimiento_datos = FALSE LIMIT 1');
    const [[uConConsent]] = await pool.query('SELECT id_usuario FROM usuarios WHERE consentimiento_datos = TRUE LIMIT 1');

    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    BASE_URL = 'http://127.0.0.1:' + httpServer.address().port;

    // 1. /health
    {
      const res = await fetch(`${BASE_URL}/health`);
      const data = await res.json();
      registrar(1, 'GET /health conectado a TiDB y Couchbase', res.status === 200 && data.status === 'ok', `${data.servicios?.tidb} / ${data.servicios?.couchbase}`);
    }

    // 2. Protecciones sin sesión
    {
      const res = await fetch(`${BASE_URL}/api/dashboard/resumen`, { headers: { Accept: 'application/json' } });
      registrar(2, 'GET /api/dashboard/resumen bloqueado sin sesión (401)', res.status === 401, `HTTP ${res.status}`);
    }

    // 3. Autenticación real
    {
      const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
      const csrfData = await csrfRes.json();
      jar = extraerCookies(csrfRes);
      csrfToken = csrfData.csrfToken;

      const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: serializarCookies(jar),
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({ correo: ADMIN_TEST.correo, password: ADMIN_TEST.password })
      });
      jar = { ...jar, ...extraerCookies(loginRes) };
      csrfToken = decodeURIComponent(jar['XSRF-TOKEN'] || '');
      registrar(3, 'Login de administrador de integración', loginRes.status === 200, `HTTP ${loginRes.status}`);
    }

    // 4. Consultas históricas reales
    let totalInicial = 0;
    {
      const [r1, r2, r3, r4, r5, r6] = await Promise.all([
        fetch(`${BASE_URL}/api/dashboard/resumen`, { headers: { Cookie: serializarCookies(jar) } }),
        fetch(`${BASE_URL}/api/dashboard/temas`, { headers: { Cookie: serializarCookies(jar) } }),
        fetch(`${BASE_URL}/api/dashboard/participacion`, { headers: { Cookie: serializarCookies(jar) } }),
        fetch(`${BASE_URL}/api/dashboard/actividad`, { headers: { Cookie: serializarCookies(jar) } }),
        fetch(`${BASE_URL}/api/dashboard/canales`, { headers: { Cookie: serializarCookies(jar) } }),
        fetch(`${BASE_URL}/api/interacciones?page=1&limit=5`, { headers: { Cookie: serializarCookies(jar) } })
      ]);

      const [d1, d2, d3, d4, d5] = await Promise.all([r1, r2, r3, r4, r5].map((r) => r.json()));
      const [[{ total: totalSQL }]] = await pool.query('SELECT COUNT(*) AS total FROM usuarios');
      registrar('4a', 'Resumen TiDB coincide con SQL', r1.status === 200 && d1.total_usuarios === Number(totalSQL), 'HTTP ' + r1.status + ', usuarios ' + d1.total_usuarios);
      registrar('4b', 'Participación TiDB coincide con SQL', r3.status === 200 && d3.total_usuarios === Number(totalSQL) && Array.isArray(d3.distribucion), 'HTTP ' + r3.status);
      registrar('4c', 'Temas', r2.status === 200 && Array.isArray(d2.temas), 'HTTP ' + r2.status);
      registrar('4d', 'Actividad UTC', r4.status === 200 && d4.mapa_calor?.length === 7 && d4.mapa_calor.every((fila) => fila.horas.length === 24), 'HTTP ' + r4.status);
      registrar('4e', 'Canales', r5.status === 200 && Array.isArray(d5.canales), 'HTTP ' + r5.status);
      const chart = await fetch(BASE_URL + '/vendor/chart.js');
      registrar('4f', 'Chart.js servido localmente', chart.ok && (await chart.text()).includes('Chart.js v4.4.4'), 'HTTP ' + chart.status);
      const d6 = await r6.json();
      totalInicial = d1.total_interacciones;
      const ok = r1.status === 200 && r2.status === 200 && r3.status === 200 && r4.status === 200 && r5.status === 200 && r6.status === 200 && d1.total_usuarios > 0 && Array.isArray(d6.interacciones) && d6.interacciones.length <= 5 && d6.total === totalInicial;
      registrar('4g', 'Listado de interacciones', r6.status === 200 && Array.isArray(d6.interacciones), 'HTTP ' + r6.status);
      if (process.env.TEST_BROWSER === '1') {
        const { probarDashboard } = require('./dashboard_browser');
        navegador = await probarDashboard(BASE_URL, jar, Number(totalSQL));
        registrar('4h', 'Navegador móvil, Chart.js, WebSocket autenticado, fallo parcial y recuperación', true);
      }
      if (!Number.isFinite(totalInicial)) {
        throw new Error('Capella no devolvió el conteo base. Las pruebas de escritura quedan pendientes.');
      }
      tiposBase = tipos(d1);
      temasBase = d2.temas;
      if (navegador) {
        await esperarBarras(tiposBase);
        const resumenUrl = '**/api/dashboard/resumen';
        const fallarTipos = async (ruta) => {
          const respuesta = await ruta.fetch();
          const datos = await respuesta.json();
          await ruta.fulfill({ response: respuesta, json: { ...datos, distribucion_por_tipo: null } });
        };
        await navegador.page.route(resumenUrl, fallarTipos);
        await navegador.page.locator('#btnActualizarDatos').click();
        await navegador.page.locator('#barChartError').waitFor({ state: 'visible' });
        await navegador.page.unroute(resumenUrl, fallarTipos);
        await navegador.page.locator('#btnActualizarDatos').click();
        await esperarBarras(tiposBase);
        await navegador.page.locator('#btnBarCanal').click();
        await esperarBarras(Object.fromEntries(d5.canales.map(x => [x.canal, x.cantidad])));
        await navegador.page.locator('#btnBarTipo').click();
        await esperarBarras(tiposBase);
        const desconectado = navegador.page.waitForFunction(() => document.querySelector('#wsStatusText').textContent === 'WS: Desconectado');
        await navegador.page.context().setOffline(true);
        await desconectado;
        await navegador.page.context().setOffline(false);
        await navegador.page.waitForFunction(() => document.querySelector('#wsStatusText').textContent === 'WS: Conectado', null, { timeout: 35000 });
        await esperarBarras(tiposBase);
        registrar('4k', 'Barras por tipo y canal, dona, desconexión y reconexión', true);
      }
      const capella = await executeQuery('SELECT COUNT(*) AS total FROM ' + getKeyspace(), { scanConsistency: couchbase.QueryScanConsistency.RequestPlus });
      registrar('4i', 'Resumen y listado coinciden con el conteo SQL++', totalInicial === capella.rows[0].total && d6.total === totalInicial);
      const muestra = d6.interacciones?.[0];
      if (muestra) {
        const filtros = new URLSearchParams({ limit: '1', tipo: muestra.tipo, canal: muestra.canal, tema: muestra.tema, id_usuario: muestra.id_usuario });
        const primera = await fetch(BASE_URL + '/api/interacciones?' + filtros, { headers: { Cookie: serializarCookies(jar) } });
        const muestraFiltrada = await primera.json();
        registrar('4j', 'Filtros efectivos y sin geolocalización en la respuesta', primera.ok && muestraFiltrada.interacciones?.length === 1 && muestraFiltrada.interacciones.every((doc) => !('ubicacion' in doc) && ['tipo', 'canal', 'tema', 'id_usuario'].every((campo) => doc[campo] === muestra[campo])));
      }
      registrar(4, 'Consultas históricas REST (resumen, temas, participacion, actividad, canales, paginacion)', ok, `Usuarios: ${d1.total_usuarios}, Interacciones: ${totalInicial}`);
    }

    // 5. Rechazo de usuario inexistente (400)
    {
      const res = await fetch(`${BASE_URL}/api/interacciones`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: serializarCookies(jar),
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          id_interaccion: 'TEST_ERR_USER',
          id_usuario: 'U999999',
          timestamp: '2026-11-26T18:00:00Z',
          canal: 'Discord',
          tipo: 'comentario',
          tema: 'musica'
        })
      });
      registrar(5, 'Rechazo de id_usuario inexistente en TiDB (400)', res.status === 400, `HTTP ${res.status}`);
    }

    // 6. Rechazo de privacidad geográfica (403)
    if (uSinConsent) {
      const res = await fetch(`${BASE_URL}/api/interacciones`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: serializarCookies(jar),
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          id_interaccion: 'TEST_ERR_PRIV',
          id_usuario: uSinConsent.id_usuario,
          timestamp: '2026-11-26T18:00:00Z',
          canal: 'Discord',
          tipo: 'comentario',
          tema: 'musica',
          ubicacion: { pais: 'México', estado: 'Yucatán', ciudad: 'Mérida' }
        })
      });
      registrar(6, 'Bloqueo de ubicación para usuario sin consentimiento (403)', res.status === 403, `HTTP ${res.status}`);
    }

    // 7. POST válido (201) + incremento en resumen
    {
      const res = await fetch(`${BASE_URL}/api/interacciones`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: serializarCookies(jar),
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          id_interaccion: ID_TEST_INTERACCION,
          id_usuario: uConConsent.id_usuario,
          timestamp: '2026-11-26T18:30:00Z',
          canal: 'Discord',
          tipo: 'comentario',
          texto: 'Prueba integración POST',
          tema: 'musica',
          sentimiento: 0.9,
          etiquetas: ['integracion'],
          ubicacion: { pais: 'Prueba', estado: 'Prueba', ciudad: 'Prueba' }
        })
      });
      interaccionCreada = res.status === 201;
      const resSum = await fetch(`${BASE_URL}/api/dashboard/resumen`, { headers: { Cookie: serializarCookies(jar) } });
      const sumData = await resSum.json();
      if (navegador && res.status === 201) {
        await navegador.page.waitForFunction((total) => Number(document.querySelector('#kpiTotalInteracciones').textContent.replace(/\D/g, '')) === total, totalInicial + 1);
      }
      const tiposPost = { ...tiposBase, comentario: tiposBase.comentario + 1 };
      assert.deepEqual(tipos(sumData), tiposPost);
      await esperarBarras(tiposPost);
      registrar(7, 'POST crear interacción (201) y recálculo real en Capella', res.status === 201 && sumData.total_interacciones === totalInicial + 1, `Total: ${sumData.total_interacciones}`);
    }

    // 8. POST duplicado (409)
    {
      const res = await fetch(`${BASE_URL}/api/interacciones`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: serializarCookies(jar),
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          id_interaccion: ID_TEST_INTERACCION,
          id_usuario: uConConsent.id_usuario,
          timestamp: '2026-11-26T18:30:00Z',
          canal: 'Discord',
          tipo: 'comentario',
          tema: 'musica'
        })
      });
      registrar(8, 'Rechazo de ID duplicado (409 Conflict)', res.status === 409, `HTTP ${res.status}`);
    }

    // 9. PUT modificar interacción (200)
    {
      const res = await fetch(`${BASE_URL}/api/interacciones/${ID_TEST_INTERACCION}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Cookie: serializarCookies(jar),
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({
          id_usuario: uSinConsent.id_usuario,
          tipo: 'rsvp_evento',
          tema: 'videojuegos',
          sentimiento: -0.4
        })
      });
      const data = await res.json();
      if (navegador && res.ok) {
        await navegador.page.waitForFunction(() => document.querySelector('#liveEventMessage').textContent.includes('modificada'));
      }
      const tiposPut = { ...tiposBase, rsvp_evento: tiposBase.rsvp_evento + 1 };
      await esperarBarras(tiposPut);
      const temasPut = await fetch(BASE_URL + '/api/dashboard/temas', { headers: { Cookie: serializarCookies(jar) } }).then(r => r.json());
      for (const tema of temasBase) {
        const cantidad = tema.cantidad + Number(tema.tema === 'videojuegos');
        assert.deepEqual(temasPut.temas.find(t => t.tema === tema.tema), { ...tema, cantidad, porcentaje: Number((cantidad * 100 / (totalInicial + 1)).toFixed(2)) });
      }
      const documento = await (await getCollection()).get(ID_TEST_INTERACCION);
      assert.equal('ubicacion' in documento.content, false);
      registrar('9a', 'Cambio de propietario elimina la ubicación persistida', true);
      registrar(9, 'PUT modificar interacción (200)', res.status === 200 && data.interaccion?.tipo === 'rsvp_evento', `HTTP ${res.status}`);
    }

    // 10. DELETE eliminar interacción (200) y restaurar total
    {
      const res = await fetch(`${BASE_URL}/api/interacciones/${ID_TEST_INTERACCION}`, {
        method: 'DELETE',
        headers: { Cookie: serializarCookies(jar), 'X-CSRF-Token': csrfToken }
      });
      const resSum = await fetch(`${BASE_URL}/api/dashboard/resumen`, { headers: { Cookie: serializarCookies(jar) } });
      const sumData = await resSum.json();
      if (res.ok) interaccionCreada = false;
      if (navegador && res.ok) {
        await navegador.page.waitForFunction((total) => Number(document.querySelector('#kpiTotalInteracciones').textContent.replace(/\D/g, '')) === total, totalInicial);
      }
      await esperarBarras(tiposBase);
      assert.deepEqual(tipos(sumData), tiposBase);
      const temasFinales = await fetch(BASE_URL + '/api/dashboard/temas', { headers: { Cookie: serializarCookies(jar) } }).then(r => r.json());
      assert.deepEqual(temasFinales.temas, temasBase);
      registrar(10, 'DELETE eliminar interacción (200) y recálculo exacto', res.status === 200 && sumData.total_interacciones === totalInicial, `Total restaurado: ${sumData.total_interacciones}`);
    }

    // 11. GET tras DELETE (404)
    {
      const res = await fetch(`${BASE_URL}/api/interacciones/${ID_TEST_INTERACCION}`, {
        headers: { Cookie: serializarCookies(jar) }
      });
      registrar(11, 'GET interacción eliminada devuelve 404', res.status === 404, `HTTP ${res.status}`);
    }
    if (navegador) {
      const verificarRevocacion = async (cambio) => {
        const socket = [...io.of('/').sockets.values()][0];
        assert.ok(socket?.connected);
        const payloadAntes = await navegador.page.locator('#liveEventMessage').textContent();
        await cambio(socket);
        await emitirCambioInteraccion(io, 'prueba_revocacion', { id_interaccion: 'REVOCADO' });
        assert.equal(socket.connected, false);
        assert.equal(await navegador.page.locator('#liveEventMessage').textContent(), payloadAntes);
      };
      const admin = [...io.of('/').sockets.values()][0].admin.id_admin;
      try {
        await verificarRevocacion(() => pool.query('UPDATE administradores SET activo = FALSE WHERE id_admin = ?', [admin]));
      } finally {
        await pool.query('UPDATE administradores SET activo = TRUE WHERE id_admin = ?', [admin]);
      }
      await navegador.page.reload();
      await navegador.page.waitForFunction(() => document.querySelector('#wsStatusText').textContent === 'WS: Conectado');
      const sesion = [...io.of('/').sockets.values()][0].request.sessionID;
      const [[fila]] = await pool.query('SELECT expires FROM sesiones_auth WHERE session_id = ?', [sesion]);
      try {
        await verificarRevocacion(() => pool.query('UPDATE sesiones_auth SET expires = 1 WHERE session_id = ?', [sesion]));
      } finally {
        await pool.query('UPDATE sesiones_auth SET expires = ? WHERE session_id = ?', [fila.expires, sesion]);
      }
      await navegador.page.reload();
      await navegador.page.waitForFunction(() => document.querySelector('#wsStatusText').textContent === 'WS: Conectado');
      await verificarRevocacion(async () => {
        const logout = await fetch(BASE_URL + '/api/auth/logout', { method: 'POST', headers: { Cookie: serializarCookies(jar), 'X-CSRF-Token': csrfToken } });
        assert.equal(logout.status, 200);
        const privado = await fetch(BASE_URL + '/api/dashboard/resumen', { headers: { Cookie: serializarCookies(jar) } });
        assert.equal(privado.status, 401);
      });
      registrar('12', 'Socket revocado por desactivación, expiración y logout, con HTTP 401 posterior', true);
    }
  } finally {
    await navegador?.close();
    // Limpieza garantizada
    try {
      if (csrfToken && httpServer.listening && interaccionCreada) {
        await fetch(`${BASE_URL}/api/interacciones/${ID_TEST_INTERACCION}`, {
          method: 'DELETE',
          headers: { Cookie: serializarCookies(jar), 'X-CSRF-Token': csrfToken }
        });
      }
    } catch (_) {}

    io.disconnectSockets(true);
    httpServer.closeAllConnections();
    await io.close();
    await pool.query('DELETE FROM administradores WHERE correo = ?', [ADMIN_TEST.correo]);
    await closeCouchbase();
    await sessionStore.close();
    await pool.end();
  }

  console.log('\n' + '='.repeat(70));
  console.log(`RESUMEN INTEGRACIÓN: ${superadas} superadas, ${fallidas} fallidas.`);
  console.log('='.repeat(70) + '\n');
  process.exit(fallidas > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Error crítico en integración:', err);
  process.exit(1);
});
