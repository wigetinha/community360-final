/**
 * Rutas de consultas analíticas del Dashboard.
 * Todas las rutas requieren sesión de administrador activa.
 * COMMUNITY 360 - Fase 4
 */

const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const { requireAuth } = require('../middleware/requireAuth');

router.use(requireAuth);

router.get('/resumen', dashboardController.getResumen);
router.get('/temas', dashboardController.getTemas);
router.get('/participacion', dashboardController.getParticipacion);
router.get('/actividad', dashboardController.getActividad);
router.get('/canales', dashboardController.getCanales);
router.get('/estado', dashboardController.getEstadoServicios);

module.exports = router;
