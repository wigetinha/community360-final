/**
 * Middleware para protección contra ataques CSRF (Cross-Site Request Forgery).
 * Genera tokens criptográficamente seguros y valida peticiones que modifican estado.
 * COMMUNITY 360 - Sistema Completo
 */

const crypto = require('crypto');

/**
 * Comparación en tiempo constante para mitigar ataques de temporización.
 */
function tokensCoinciden(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Garantiza que la sesión tenga un token CSRF único.
 */
function ensureCsrfToken(req, res, next) {
  if (req.session && !req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  if (req.session) {
    res.cookie('XSRF-TOKEN', req.session.csrfToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/'
    });
  }
  next();
}

/**
 * Valida el token CSRF en operaciones que modifican estado (POST, PUT, DELETE, PATCH).
 */
function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  const token = req.headers['x-csrf-token'] ||
                req.headers['x-xsrf-token'] ||
                (req.body && req.body._csrf);

  if (!req.session || !req.session.csrfToken || !token || !tokensCoinciden(req.session.csrfToken, String(token))) {
    return res.status(403).json({
      error: 'Petición rechazada: Token CSRF inválido o ausente.',
      codigo: 'CSRF_INVALID'
    });
  }

  next();
}

module.exports = {
  ensureCsrfToken,
  verifyCsrf
};
