/**
 * Rutas REST para consulta y administración de interacciones.
 * Lectura protegida con requireAuth; escritura protegida con requireAuth + verifyCsrf.
 * COMMUNITY 360 - Fase 4
 */

const express = require('express');
const router = express.Router();
const interaccionesController = require('../controllers/interaccionesController');
const { requireAuth } = require('../middleware/requireAuth');
const { verifyCsrf } = require('../middleware/csrf');

router.use(requireAuth);

router.get('/', interaccionesController.listar);
router.get('/:id', interaccionesController.obtenerPorId);
router.post('/', verifyCsrf, interaccionesController.crear);
router.put('/:id', verifyCsrf, interaccionesController.actualizar);
router.delete('/:id', verifyCsrf, interaccionesController.eliminar);

module.exports = router;
