/**
 * Suite Integral de Pruebas de Autenticación, CSRF y Seguridad (contra TiDB Cloud).
 * COMMUNITY 360 - Fases 3 y 4
 */

const path = require('path');
const { randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { pool } = require('../config/database');
const { httpServer } = require('../server');

let BASE_URL;
const produccion = process.env.NODE_ENV === 'production';
const fetch = (url, options = {}) => globalThis.fetch(url, {
  ...options,
  headers: { ...options.headers, ...(produccion ? { 'X-Forwarded-Proto': 'https' } : {}) }
});

const ADMIN_TEST = {
  correo: 'admin_test_' + randomUUID() + '@community360.com',
  password: 'PasswordValido2026!',
  rol: 'admin'
};

const ADMIN_INACTIVO = {
  correo: 'admin_inactivo_' + randomUUID() + '@community360.com',
  password: 'PasswordValido2026!',
  rol: 'analista'
};

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

async function obtenerCsrfYCookies(jarPrevio = {}) {
  const res = await fetch(`${BASE_URL}/api/auth/csrf`, {
    headers: Object.keys(jarPrevio).length ? { Cookie: serializarCookies(jarPrevio) } : {}
  });
  const data = await res.json();
  const nuevas = extraerCookies(res);
  return {
    csrfToken: data.csrfToken,
    jar: { ...jarPrevio, ...nuevas }
  };
}

async function prepararBaseDatos() {
  await pool.query('DELETE FROM administradores WHERE correo IN (?, ?)', [
    ADMIN_TEST.correo,
    ADMIN_INACTIVO.correo
  ]);

  const hashValido = await bcrypt.hash(ADMIN_TEST.password, 12);
  const hashInactivo = await bcrypt.hash(ADMIN_INACTIVO.password, 12);

  await pool.query(
    'INSERT INTO administradores (correo, password_hash, rol, activo) VALUES (?, ?, ?, TRUE)',
    [ADMIN_TEST.correo, hashValido, ADMIN_TEST.rol]
  );

  await pool.query(
    'INSERT INTO administradores (correo, password_hash, rol, activo) VALUES (?, ?, ?, FALSE)',
    [ADMIN_INACTIVO.correo, hashInactivo, ADMIN_INACTIVO.rol]
  );
}

async function limpiarBaseDatos() {
  try {
    await pool.query('DELETE FROM administradores WHERE correo IN (?, ?)', [
      ADMIN_TEST.correo,
      ADMIN_INACTIVO.correo
    ]);
  } catch (e) {
    console.warn('[Teardown Warning]:', e.message);
  }
}

async function ejecutarPruebas() {
  console.log('\n' + '='.repeat(70));
  console.log('COMMUNITY 360 - Suite de Autenticación y CSRF (TiDB Cloud Real)');
  console.log('='.repeat(70) + '\n');

  let superadas = 0;
  let fallidas = 0;

  function registrar(num, desc, ok, detalle) {
    if (ok) {
      console.log(`[${num}] ✓ ${desc} (${detalle})`);
      superadas++;
    } else {
      console.error(`[${num}] ✗ FALLÓ: ${desc} (${detalle})`);
      fallidas++;
    }
  }

  let jarActivo = {};
  let csrfActivo = '';

  try {
    // 1. POST sin token CSRF -> 403
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo: ADMIN_TEST.correo, password: ADMIN_TEST.password })
      });
      registrar(1, 'Rechazo de POST /api/auth/login sin token CSRF', res.status === 403, `HTTP ${res.status}`);
    }

    const sesionInicial = await obtenerCsrfYCookies();

    // 2. Campos vacíos -> 400
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: serializarCookies(sesionInicial.jar),
          'X-CSRF-Token': sesionInicial.csrfToken
        },
        body: JSON.stringify({})
      });
      registrar(2, 'Validación de campos vacíos', res.status === 400, `HTTP ${res.status}`);
    }

    // 3. Correo inexistente -> 401
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: serializarCookies(sesionInicial.jar),
          'X-CSRF-Token': sesionInicial.csrfToken
        },
        body: JSON.stringify({ correo: 'no_existe@community360.com', password: ADMIN_TEST.password })
      });
      registrar(3, 'Rechazo de correo inexistente', res.status === 401, `HTTP ${res.status}`);
    }

    // 4. Contraseña incorrecta -> 401
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: serializarCookies(sesionInicial.jar),
          'X-CSRF-Token': sesionInicial.csrfToken
        },
        body: JSON.stringify({ correo: ADMIN_TEST.correo, password: 'Incorrecta999!' })
      });
      registrar(4, 'Rechazo de contraseña incorrecta', res.status === 401, `HTTP ${res.status}`);
    }

    // 5. Admin inactivo -> 401
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: serializarCookies(sesionInicial.jar),
          'X-CSRF-Token': sesionInicial.csrfToken
        },
        body: JSON.stringify({ correo: ADMIN_INACTIVO.correo, password: ADMIN_INACTIVO.password })
      });
      registrar(5, 'Rechazo de administrador inactivo', res.status === 401, `HTTP ${res.status}`);
    }

    // 6. Login válido -> 200
    {
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: serializarCookies(sesionInicial.jar),
          'X-CSRF-Token': sesionInicial.csrfToken
        },
        body: JSON.stringify({ correo: ADMIN_TEST.correo, password: ADMIN_TEST.password })
      });
      const data = await res.json();
      const nuevas = extraerCookies(res);
      jarActivo = { ...sesionInicial.jar, ...nuevas };
      csrfActivo = decodeURIComponent(jarActivo['XSRF-TOKEN'] || '');
      if (produccion) {
        const cookie = res.headers.getSetCookie().find(x => x.startsWith('community360_sid='));
        registrar('6a', 'Cookie Secure y HttpOnly detrás del proxy', /; Secure/i.test(cookie) && /; HttpOnly/i.test(cookie), 'HTTPS reenviado');
      }
      registrar(6, 'Inicio de sesión correcto con TiDB', res.status === 200 && Boolean(jarActivo.community360_sid) && data.admin?.correo === ADMIN_TEST.correo, `HTTP ${res.status}`);
    }

    // 7. REST sin sesión -> 401
    {
      const res = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Accept: 'application/json' } });
      registrar(7, 'Bloqueo /api/auth/me sin sesión', res.status === 401, `HTTP ${res.status}`);
    }

    // 8. REST con sesión -> 200
    {
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Accept: 'application/json', Cookie: serializarCookies(jarActivo) }
      });
      const data = await res.json();
      registrar(8, 'Consulta /api/auth/me con sesión', res.status === 200 && data.autenticado === true, `HTTP ${res.status}`);
    }

    // 9. /dashboard sin sesión -> 302
    {
      const res = await fetch(`${BASE_URL}/dashboard`, { redirect: 'manual' });
      registrar(9, 'Redirección de /dashboard sin sesión', res.status === 302 && res.headers.get('location') === '/login', `HTTP ${res.status}`);
    }

    // 10. /dashboard con sesión -> 200
    {
      const res = await fetch(`${BASE_URL}/dashboard`, { headers: { Cookie: serializarCookies(jarActivo) } });
      const html = await res.text();
      registrar(10, 'Acceso a /dashboard con sesión', res.status === 200 && html.includes('COMMUNITY 360'), `HTTP ${res.status}`);
    }

    // 11. Logout sin CSRF -> 403
    {
      const res = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: { Cookie: serializarCookies(jarActivo), Accept: 'application/json' }
      });
      registrar(11, 'Rechazo de logout sin token CSRF', res.status === 403, `HTTP ${res.status}`);
    }

    // 12. Logout válido -> 200
    {
      const res = await fetch(`${BASE_URL}/api/auth/logout`, {
        method: 'POST',
        headers: {
          Cookie: serializarCookies(jarActivo),
          'X-CSRF-Token': csrfActivo,
          Accept: 'application/json'
        }
      });
      registrar(12, 'Cierre de sesión válido (POST /api/auth/logout)', res.status === 200, `HTTP ${res.status}`);
    }

    // 13. Reutilizar cookie tras logout -> 401
    {
      const res = await fetch(`${BASE_URL}/api/auth/me`, {
        headers: { Accept: 'application/json', Cookie: serializarCookies(jarActivo) }
      });
      registrar(13, 'Rechazo de sesión destruida tras logout', res.status === 401, `HTTP ${res.status}`);
    }
    const docentePassword = process.env.ADMIN_DOCENTE_PASSWORD;
    if (docentePassword) {
      const csrf = await fetch(BASE_URL + '/api/auth/csrf');
      const inicial = extraerCookies(csrf);
      const login = await fetch(BASE_URL + '/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: serializarCookies(inicial),
          'X-CSRF-Token': (await csrf.json()).csrfToken },
        body: JSON.stringify({ correo: 'lizandro.reyes@utmetropolitana.edu.mx', password: docentePassword })
      });
      const cookies = extraerCookies(login);
      const dashboard = await fetch(BASE_URL + '/dashboard', { redirect: 'manual', headers: { Cookie: serializarCookies(cookies) } });
      registrar(14, 'Cuenta docente inicia sesión y accede al dashboard', login.ok && dashboard.ok, 'HTTP ' + login.status + '/' + dashboard.status);
      if (login.ok) await fetch(BASE_URL + '/api/auth/logout', {
        method: 'POST', headers: { Cookie: serializarCookies(cookies), 'X-CSRF-Token': cookies['XSRF-TOKEN'] }
      });
    } else {
      console.log('[14] Pendiente: prueba de acceso docente requiere ADMIN_DOCENTE_PASSWORD.');
    }
  } finally {
    console.log(`\nRESUMEN AUTH: ${superadas} superadas, ${fallidas} fallidas.`);
  }

  return { superadas, fallidas };
}

async function main() {
  try {
    await prepararBaseDatos();
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    BASE_URL = 'http://127.0.0.1:' + httpServer.address().port;
    const { fallidas } = await ejecutarPruebas();
    await new Promise((resolve) => httpServer.close(resolve));
    await limpiarBaseDatos();
    await pool.end();
    process.exit(fallidas > 0 ? 1 : 0);
  } catch (err) {
    console.error('Error en suite de autenticación:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
