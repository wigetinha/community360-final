
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');

async function probarDashboard(baseUrl, cookies, totalUsuarios) {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addCookies(Object.entries(cookies).map(([name, value]) => ({ name, value, url: baseUrl })));
    const page = await context.newPage();
    const errores = [];
    page.on('pageerror', (error) => errores.push(error.message));

    const endpoint = '**/api/dashboard/participacion';
    const fallarParticipacion = (route) => route.fulfill({
      status: 503,
      json: { error: 'Falla temporal de participación para la prueba' }
    });
    await page.route(endpoint, fallarParticipacion);
    await page.goto(baseUrl + '/dashboard', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('#wsStatusText')?.textContent === 'WS: Conectado');
    await page.waitForFunction(() => document.querySelector('#doughnutChartError')?.textContent.includes('Falla temporal'));
    await page.waitForFunction((total) => {
      const valor = document.querySelector('#kpiTotalUsuarios')?.textContent.replace(/\D/g, '');
      return Number(valor) === total;
    }, totalUsuarios);
    assert.equal(await page.evaluate(() => Chart.version), '4.4.4');

    await page.unroute(endpoint, fallarParticipacion);
    await page.locator('#btnActualizarDatos').click({ timeout: 40000 });
    await page.waitForFunction(() => Boolean(Chart.getChart('doughnutChart')));
    await page.waitForFunction(() => {
      const grafica = Chart.getChart('doughnutChart');
      return grafica?.getDatasetMeta(0).data.every((arco) => arco.circumference > 0);
    });
    assert.deepEqual(errores, []);

    const socketSinSesion = await browser.newPage();
    try {
      await socketSinSesion.goto(baseUrl + '/login');
      await socketSinSesion.addScriptTag({ url: baseUrl + '/socket.io/socket.io.js' });
      const resultado = await socketSinSesion.evaluate(() => new Promise((resolve) => {
        const socket = io({ reconnection: false });
        const finalizar = (mensaje) => { clearTimeout(limite); socket.disconnect(); resolve(mensaje); };
        const limite = setTimeout(() => finalizar('Sin respuesta'), 5000);
        socket.once('connect', () => finalizar('Aceptado'));
        socket.once('connect_error', (error) => finalizar(error.message));
      }));
      assert.match(resultado, /NO_AUTORIZADO/);
    } finally {
      await socketSinSesion.close();
    }
    return { page, close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

module.exports = { probarDashboard };

