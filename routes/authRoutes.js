/**
 * Rutas de Autenticación y Endpoints Protegidos.
 * COMMUNITY 360 - Sistema Completo
 */

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/requireAuth');
const { verifyCsrf } = require('../middleware/csrf');

// Limitador de intentos para inicio de sesión (Protección contra fuerza bruta)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // Máximo 10 intentos por IP cada 15 min
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    return res.status(429).json({
      error: 'Demasiados intentos de inicio de sesión fallidos. Por favor intente más tarde.',
      codigo: 'LIMITE_INTENTOS_EXCEDIDO'
    });
  }
});

// Rutas de autenticación (POST protegidos con verifyCsrf)
router.get('/auth/csrf', authController.getCsrfToken);
router.post('/auth/login', loginLimiter, verifyCsrf, authController.login);
router.post('/auth/logout', requireAuth, verifyCsrf, authController.logout);
router.get('/auth/me', requireAuth, authController.getMe);

// Endpoint privado de demostración
router.get('/privado/prueba', requireAuth, authController.getPruebaPrivada);

module.exports = router;
