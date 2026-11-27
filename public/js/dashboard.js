/**
 * Lógica del Dashboard Analítico en Tiempo Real - COMMUNITY 360
 * Consulta cada endpoint de forma independiente (Promise.allSettled) para evitar
 * que una falla en un motor oculte los datos válidos del otro.
 * No contiene formularios ni operaciones CRUD (solo lectura y análisis).
 */

document.addEventListener('DOMContentLoaded', async () => {
  const adminEmailDisplay = document.getElementById('adminEmailDisplay');
  const adminRoleDisplay = document.getElementById('adminRoleDisplay');
  const logoutBtn = document.getElementById('logoutBtn');

  // Estados diferenciados
  const wsStatusBadge = document.getElementById('wsStatusBadge');
  const wsStatusText = document.getElementById('wsStatusText');
  const tidbStatusBadge = document.getElementById('tidbStatusBadge');
  const tidbStatusText = document.getElementById('tidbStatusText');
  const capellaStatusBadge = document.getElementById('capellaStatusBadge');
  const capellaStatusText = document.getElementById('capellaStatusText');

  const btnActualizarDatos = document.getElementById('btnActualizarDatos');
  const iconActualizar = document.getElementById('iconActualizar');
  const ultimaActualizacion = document.getElementById('ultimaActualizacion');
  const estadoGeneralTexto = document.getElementById('estadoGeneralTexto');

  const dbErrorBanner = document.getElementById('dbErrorBanner');
  const dbErrorDetail = document.getElementById('dbErrorDetail');
  const btnReintentarTodo = document.getElementById('btnReintentarTodo');

  const liveEventToast = document.getElementById('liveEventToast');
  const liveEventMessage = document.getElementById('liveEventMessage');
  const liveEventTime = document.getElementById('liveEventTime');

  // KPIs
  const kpiTotalUsuarios = document.getElementById('kpiTotalUsuarios');
  const kpiTotalUsuariosSub = document.getElementById('kpiTotalUsuariosSub');
  const kpiUsuariosActivos = document.getElementById('kpiUsuariosActivos');
  const kpiInactivosSub = document.getElementById('kpiInactivosSub');
  const kpiUsuariosRiesgo = document.getElementById('kpiUsuariosRiesgo');
  const kpiPorcentajeRiesgo = document.getElementById('kpiPorcentajeRiesgo');
  const kpiTotalInteracciones = document.getElementById('kpiTotalInteracciones');
  const kpiInteraccionesSub = document.getElementById('kpiInteraccionesSub');
  const kpiSentimientoPromedio = document.getElementById('kpiSentimientoPromedio');
  const kpiSentimientoSub = document.getElementById('kpiSentimientoSub');

  // Gráficas
  const btnBarTipo = document.getElementById('btnBarTipo');
  const btnBarCanal = document.getElementById('btnBarCanal');
  const barChartError = document.getElementById('barChartError');
  const doughnutChartError = document.getElementById('doughnutChartError');
  let barChart = null;
  let doughnutChart = null;
  let modoBarras = 'tipo';
  let ultimosDatosTipos = [];
  let ultimosDatosCanales = [];
  let errorTipos = null;
  let errorCanales = null;

  // Tabla y paginación
  const filtroTipo = document.getElementById('filtroTipo');
  const filtroCanal = document.getElementById('filtroCanal');
  const filtroTema = document.getElementById('filtroTema');
  const filtroUsuario = document.getElementById('filtroUsuario');
  const btnAplicarFiltros = document.getElementById('btnAplicarFiltros');
  const btnLimpiarFiltros = document.getElementById('btnLimpiarFiltros');
  const tablaBody = document.getElementById('tablaInteraccionesBody');
  const tablaResumenTotal = document.getElementById('tablaResumenTotal');
  const paginacionInfo = document.getElementById('paginacionInfo');
  const btnPaginaAnterior = document.getElementById('btnPaginaAnterior');
  const btnPaginaSiguiente = document.getElementById('btnPaginaSiguiente');

  let paginaActual = 1;
  const limitePorPagina = 10;

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------
  async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(35000), headers: { Accept: 'application/json' } });
    if (res.status === 401) {
      window.location.replace('/login');
      throw new Error('Sesión expirada');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error || `Error HTTP ${res.status}`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Respuesta JSON inválida.');
    return data;
  }

  function formatearNumero(n) {
    return Number(n).toLocaleString('es-MX');
  }

  function obtenerCsrfCookie() {
    const match = document.cookie.match(new RegExp('(^| )XSRF-TOKEN=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : '';
  }

  function actualizarBadge(badgeEl, textEl, estado, texto) {
    badgeEl.className = `ws-status-badge ws-${estado}`;
    textEl.textContent = texto;
  }

  function mostrarNotificacionViva(texto) {
    liveEventMessage.textContent = texto;
    liveEventTime.textContent = new Date().toLocaleTimeString('es-MX');
    liveEventToast.classList.remove('d-none');
    liveEventToast.classList.add('d-flex');
  }

  function escaparHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------------------
  // 1. Verificar sesión activa
  // ---------------------------------------------------------------------------
  try {
    const me = await fetchJson('/api/auth/me');
    if (me.admin) {
      adminEmailDisplay.textContent = me.admin.correo;
      adminRoleDisplay.textContent = (me.admin.rol || 'admin').toUpperCase();
    }
  } catch (err) {
    console.error('No se pudo cargar el perfil:', err);
  }

  // ---------------------------------------------------------------------------
  // 2. Renderizado de Gráficas (Chart.js)
  // ---------------------------------------------------------------------------
  function renderizarGraficaBarras() {
    const esTipo = modoBarras === 'tipo';
    const fuente = esTipo ? ultimosDatosTipos : ultimosDatosCanales;
    const errActual = esTipo ? errorTipos : errorCanales;

    if (typeof Chart === 'undefined') {
      barChartError.textContent = 'No se pudo cargar Chart.js.';
      barChartError.classList.remove('d-none');
      return;
    }

    if (errActual) {
      if (barChart) { barChart.destroy(); barChart = null; }
      barChartError.textContent = errActual;
      barChartError.classList.remove('d-none');
      return;
    }

    if (!fuente || fuente.length === 0) {
      if (barChart) { barChart.destroy(); barChart = null; }
      barChartError.textContent = 'Sin datos disponibles para graficar.';
      barChartError.classList.remove('d-none');
      return;
    }

    barChartError.classList.add('d-none');
    const ctx = document.getElementById('barChart').getContext('2d');
    const labels = fuente.map((item) => (esTipo ? item.tipo : item.canal));
    const valores = fuente.map((item) => item.cantidad);
    const porcentajes = fuente.map((item) => item.porcentaje);

    if (barChart) {
      barChart.destroy();
    }

    barChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: esTipo ? 'Interacciones por Tipo' : 'Interacciones por Canal',
          data: valores,
          backgroundColor: [
            'rgba(99, 102, 241, 0.78)',
            'rgba(16, 185, 129, 0.78)',
            'rgba(245, 158, 11, 0.78)',
            'rgba(14, 165, 233, 0.78)',
            'rgba(236, 72, 153, 0.78)',
            'rgba(168, 85, 247, 0.78)'
          ],
          borderColor: 'rgba(255, 255, 255, 0.25)',
          borderWidth: 1,
          borderRadius: 6
        }]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => {
                const idx = context.dataIndex;
                return `${context.parsed.y} interacciones (${porcentajes[idx] ?? 0}%)`;
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#cbd5e1' },
            grid: { color: 'rgba(255,255,255,0.05)' }
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#cbd5e1', precision: 0 },
            grid: { color: 'rgba(255,255,255,0.08)' }
          }
        }
      }
    });
  }

  function renderizarGraficaDona(participacion) {
    if (typeof Chart === 'undefined') {
      doughnutChartError.textContent = 'No se pudo cargar Chart.js.';
      doughnutChartError.classList.remove('d-none');
      return;
    }

    const dist = participacion?.distribucion || [];
    if (dist.length === 0) {
      if (doughnutChart) { doughnutChart.destroy(); doughnutChart = null; }
      doughnutChartError.textContent = 'Sin datos de participación disponibles.';
      doughnutChartError.classList.remove('d-none');
      return;
    }

    doughnutChartError.classList.add('d-none');
    const ctx = document.getElementById('doughnutChart').getContext('2d');

    const etiquetaLegible = {
      activo: 'Activos',
      en_riesgo: 'En riesgo',
      inactivo: 'Inactivos'
    };

    const colores = {
      activo: 'rgba(16, 185, 129, 0.85)',
      en_riesgo: 'rgba(239, 68, 68, 0.85)',
      inactivo: 'rgba(148, 163, 184, 0.78)'
    };

    const labels = dist.map((d) => `${etiquetaLegible[d.estatus] || d.estatus}: ${formatearNumero(d.cantidad)} (${d.porcentaje}%)`);
    const values = dist.map((d) => d.cantidad);
    const bgColors = dist.map((d) => colores[d.estatus] || 'rgba(99, 102, 241, 0.8)');

    if (doughnutChart) {
      doughnutChart.destroy();
    }

    doughnutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: bgColors,
          borderColor: 'rgba(15, 23, 42, 0.9)',
          borderWidth: 2
        }]
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: '#e2e8f0', padding: 14 }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const item = dist[context.dataIndex];
                return `${formatearNumero(item.cantidad)} usuarios (${item.porcentaje}%)`;
              }
            }
          }
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 3. Renderizado de Mapa de Calor (Día x Hora UTC)
  // ---------------------------------------------------------------------------
  function renderizarMapaCalor(actividad) {
    const container = document.getElementById('heatmapContainer');
    const filas = actividad?.mapa_calor || [];
    const max = Math.max(1, actividad?.maximo_celda_hora || 1);

    if (filas.length === 0 || actividad.total_interacciones === 0) {
      container.innerHTML = '<div class="text-secondary small">Sin datos temporales disponibles.</div>';
      return;
    }

    let html = '<div class="heatmap-row heatmap-header-row"><div class="heatmap-day-label"></div>';
    for (let h = 0; h < 24; h++) {
      html += `<div class="heatmap-hour-label">${String(h).padStart(2, '0')}</div>`;
    }
    html += '</div>';

    for (const fila of filas) {
      html += `<div class="heatmap-row"><div class="heatmap-day-label">${escaparHtml(fila.dia_nombre)}</div>`;
      fila.horas.forEach((conteo, hora) => {
        let nivel = 0;
        if (conteo > 0) {
          const ratio = conteo / max;
          if (ratio >= 0.75) nivel = 4;
          else if (ratio >= 0.5) nivel = 3;
          else if (ratio >= 0.25) nivel = 2;
          else nivel = 1;
        }
        html += `<div class="heatmap-cell level-${nivel}" title="${escaparHtml(fila.dia_nombre)} ${String(hora).padStart(2, '0')}:00 UTC — ${conteo} interacciones">${conteo > 0 ? conteo : ''}</div>`;
      });
      html += '</div>';
    }

    container.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // 4. Renderizado de Temas Populares
  // ---------------------------------------------------------------------------
  function renderizarTemas(dataTemas) {
    const container = document.getElementById('temasContainer');
    const temas = dataTemas?.temas || [];

    if (temas.length === 0) {
      container.innerHTML = '<div class="text-secondary small">Sin interacciones registradas.</div>';
      return;
    }

    container.innerHTML = temas.map((t) => `
      <div>
        <div class="d-flex justify-content-between small mb-1">
          <span class="text-light fw-semibold">${escaparHtml(t.tema)}</span>
          <span class="text-secondary">${formatearNumero(t.cantidad)} (${t.porcentaje}%)</span>
        </div>
        <div class="progress bg-dark" style="height: 8px;">
          <div class="progress-bar bg-primary" role="progressbar" style="width: ${t.porcentaje}%;" aria-valuenow="${t.porcentaje}" aria-valuemin="0" aria-valuemax="100"></div>
        </div>
      </div>
    `).join('');
  }

  // ---------------------------------------------------------------------------
  // 5. Tabla de Interacciones (Solo Lectura, Filtros y Paginación)
  // ---------------------------------------------------------------------------
  let solicitudTabla = 0;
  async function cargarTablaInteracciones() {
    const solicitud = ++solicitudTabla;
    const params = new URLSearchParams({
      page: String(paginaActual),
      limit: String(limitePorPagina)
    });
    if (filtroTipo.value) params.set('tipo', filtroTipo.value);
    if (filtroCanal.value) params.set('canal', filtroCanal.value);
    if (filtroTema.value) params.set('tema', filtroTema.value);
    if (filtroUsuario.value.trim()) params.set('id_usuario', filtroUsuario.value.trim());

    try {
      const data = await fetchJson(`/api/interacciones?${params.toString()}`);
      if (solicitud !== solicitudTabla) return { ok: true };
      if (!Number.isFinite(data.total) || !Array.isArray(data.interacciones)) throw new Error('Respuesta de interacciones incompleta.');
      if (data.pagina > data.total_paginas) {
        paginaActual = data.total_paginas;
        return cargarTablaInteracciones();
      }
      tablaResumenTotal.textContent = `Total encontrado: ${formatearNumero(data.total)} interacciones válidas`;
      paginacionInfo.textContent = `Página ${data.pagina} de ${data.total_paginas}`;
      btnPaginaAnterior.disabled = data.pagina <= 1;
      btnPaginaSiguiente.disabled = data.pagina >= data.total_paginas;

      if (!data.interacciones || data.interacciones.length === 0) {
        tablaBody.innerHTML = '<tr><td colspan="8" class="text-center text-secondary py-4">No se encontraron interacciones con los filtros seleccionados.</td></tr>';
        return { ok: true };
      }

      tablaBody.innerHTML = data.interacciones.map((item) => {
        const sent = item.sentimiento !== null && item.sentimiento !== undefined
          ? Number(item.sentimiento).toFixed(2)
          : 'N/A';
        const badgeSent = item.sentimiento > 0.15
          ? 'bg-success'
          : (item.sentimiento < -0.15 ? 'bg-danger' : 'bg-secondary');

        const etiquetasHtml = (item.etiquetas || [])
          .slice(0, 3)
          .map((e) => `<span class="badge bg-primary bg-opacity-25 text-info me-1">#${escaparHtml(e)}</span>`)
          .join('');

        return `
          <tr>
            <td class="fw-semibold text-info">${escaparHtml(item.id_interaccion)}</td>
            <td>${escaparHtml(item.id_usuario)}</td>
            <td class="text-secondary">${escaparHtml(item.timestamp)}</td>
            <td><span class="badge bg-dark border border-secondary">${escaparHtml(item.canal)}</span></td>
            <td>${escaparHtml(item.tipo)}</td>
            <td>${escaparHtml(item.tema)}</td>
            <td><span class="badge ${badgeSent}">${sent}</span></td>
            <td>
              <div class="text-truncate" style="max-width: 260px;" title="${escaparHtml(item.texto || '')}">
                ${escaparHtml(item.texto || '—')}
              </div>
              <div>${etiquetasHtml}</div>
            </td>
          </tr>
        `;
      }).join('');
      return { ok: true };
    } catch (err) {
      if (solicitud !== solicitudTabla) return { ok: true };
      paginacionInfo.textContent = 'Paginación no disponible';
      btnPaginaAnterior.disabled = btnPaginaSiguiente.disabled = true;
      tablaResumenTotal.textContent = 'No se pudo consultar Couchbase Capella';
      tablaBody.innerHTML = `<tr><td colspan="8" class="text-center text-danger py-4"><i class="bi bi-exclamation-triangle me-1"></i>${escaparHtml(err.message)}</td></tr>`;
      return { ok: false, error: err.message };
    }
  }

  // ---------------------------------------------------------------------------
  // 6. Carga resiliente e independiente de todos los módulos
  // ---------------------------------------------------------------------------

  let actualizando = false;
  let actualizacionPendiente = false;

  async function cargarTodoDashboard() {
    if (actualizando) {
      actualizacionPendiente = true;
      return;
    }

    actualizando = true;
    btnActualizarDatos.disabled = true;
    iconActualizar.classList.add('spin-anim');
    estadoGeneralTexto.textContent = 'Consultando estadísticas…';
    const errores = [];
    let consultasCorrectas = 0;

    const consultar = async (nombre, obtener, mostrar, mostrarError) => {
      try {
        mostrar(await obtener());
        if (nombre !== 'Conexiones') consultasCorrectas++;
      } catch (error) {
        console.error(nombre, error);
        errores.push(nombre + ': ' + error.message);
        mostrarError(error.message);
      }
    };

    const mostrarAviso = (elemento, mensaje) => {
      elemento.textContent = mensaje;
      elemento.classList.remove('d-none');
    };
    const exigirLista = (lista) => {
      if (!Array.isArray(lista)) throw new Error('Respuesta estadística incompleta.');
      return lista;
    };
    const mostrarUsuarios = (r) => {
      const campos = [r.total_usuarios, r.usuarios_activos, r.usuarios_inactivos, r.usuarios_en_riesgo, r.porcentaje_en_riesgo];
      const disponibles = campos.every(Number.isFinite);
      kpiTotalUsuarios.textContent = disponibles ? formatearNumero(r.total_usuarios) : 'No disponible';
      kpiTotalUsuariosSub.textContent = disponibles ? 'Padrón TiDB Cloud' : 'Error al consultar usuarios';
      kpiUsuariosActivos.textContent = disponibles ? formatearNumero(r.usuarios_activos) : 'No disponible';
      kpiInactivosSub.textContent = disponibles ? 'Inactivos: ' + formatearNumero(r.usuarios_inactivos) : 'Inactivos: no disponible';
      kpiUsuariosRiesgo.textContent = disponibles ? formatearNumero(r.usuarios_en_riesgo) : 'No disponible';
      kpiPorcentajeRiesgo.textContent = disponibles ? r.porcentaje_en_riesgo + '% del padrón' : 'Porcentaje no disponible';
      return disponibles;
    };
    const mostrarResumen = (r) => {
      const usuariosOk = mostrarUsuarios(r);
      const tiposOk = Number.isFinite(r.total_interacciones) && Array.isArray(r.distribucion_por_tipo);
      const sentimientoOk = Number.isFinite(r.interacciones_con_sentimiento) &&
        (r.interacciones_con_sentimiento === 0 || Number.isFinite(r.sentimiento_promedio));
      kpiTotalInteracciones.textContent = tiposOk ? formatearNumero(r.total_interacciones) : 'No disponible';
      kpiInteraccionesSub.textContent = tiposOk ? 'Couchbase Capella' : 'Error al consultar interacciones';
      kpiSentimientoPromedio.textContent = Number.isFinite(r.sentimiento_promedio)
        ? r.sentimiento_promedio.toFixed(3) : (sentimientoOk ? 'Sin datos' : 'No disponible');
      kpiSentimientoSub.textContent = sentimientoOk
        ? 'Registros con sentimiento: ' + formatearNumero(r.interacciones_con_sentimiento) : 'Error al consultar sentimiento';
      ultimosDatosTipos = tiposOk ? r.distribucion_por_tipo : [];
      errorTipos = tiposOk ? null : (r.errores?.tipos || 'No se pudo consultar la distribución por tipo.');
      if (!usuariosOk) errores.push('Usuarios: consulta no disponible.');
      if (!tiposOk) errores.push(errorTipos);
      if (!sentimientoOk) errores.push('Sentimiento: consulta no disponible.');
      if (modoBarras === 'tipo') renderizarGraficaBarras();
    };

    const pintarConexion = (bd, nombre, badge, etiqueta) => {
      actualizarBadge(badge, etiqueta, bd?.conectado ? 'connected' : 'disconnected',
        nombre + (bd?.conectado ? ': Disponible' : ': No disponible'));
    };

    try {
      await Promise.allSettled([
        consultar('Resumen', () => fetchJson('/api/dashboard/resumen'), mostrarResumen, () => mostrarResumen({})),
        consultar('Temas', () => fetchJson('/api/dashboard/temas'), (r) => {
          exigirLista(r.temas);
          renderizarTemas(r);
        }, (error) => mostrarAviso(document.getElementById('temasContainer'), error)),
        consultar('Participación', () => fetchJson('/api/dashboard/participacion'), (r) => {
          exigirLista(r.distribucion);
          renderizarGraficaDona(r);
        }, (error) => {
          if (doughnutChart) { doughnutChart.destroy(); doughnutChart = null; }
          mostrarAviso(doughnutChartError, error);
        }),
        consultar('Canales', () => fetchJson('/api/dashboard/canales'), (r) => {
          ultimosDatosCanales = exigirLista(r.canales);
          errorCanales = null;
          if (modoBarras === 'canal') renderizarGraficaBarras();
        }, (error) => {
          ultimosDatosCanales = [];
          errorCanales = error;
          if (modoBarras === 'canal') renderizarGraficaBarras();
        }),
        consultar('Actividad UTC', () => fetchJson('/api/dashboard/actividad'), (r) => {
          exigirLista(r.mapa_calor);
          renderizarMapaCalor(r);
        }, (error) => mostrarAviso(document.getElementById('heatmapContainer'), error)),
        consultar('Interacciones', cargarTablaInteracciones, (r) => {
          if (!r.ok) throw new Error(r.error);
        }, () => {}),
        consultar('Conexiones', () => fetchJson('/api/dashboard/estado'), (r) => {
          if (!r.tidb?.conectado) errores.push('TiDB: comprobación de conexión fallida.');
          if (!r.couchbase?.conectado) errores.push('Capella: comprobación de conexión fallida.');
          pintarConexion(r.tidb, 'TiDB', tidbStatusBadge, tidbStatusText);
          pintarConexion(r.couchbase, 'Capella', capellaStatusBadge, capellaStatusText);
        }, () => {
          pintarConexion(null, 'TiDB', tidbStatusBadge, tidbStatusText);
          pintarConexion(null, 'Capella', capellaStatusBadge, capellaStatusText);
        })
      ]);
    } finally {
      dbErrorDetail.textContent = [...new Set(errores)].join(' | ');
      dbErrorBanner.classList.toggle('d-none', errores.length === 0);
      dbErrorBanner.classList.toggle('d-flex', errores.length > 0);
      estadoGeneralTexto.textContent = errores.length === 0 ? 'Consultas actualizadas.'
        : consultasCorrectas ? 'Algunas consultas requieren atención.' : 'No se pudieron actualizar las consultas.';
      if (consultasCorrectas) ultimaActualizacion.textContent = new Date().toLocaleTimeString('es-MX');
      btnActualizarDatos.disabled = false;
      iconActualizar.classList.remove('spin-anim');
      actualizando = false;
      if (actualizacionPendiente) {
        actualizacionPendiente = false;
        void cargarTodoDashboard();
      }
    }
  }


  // Botones de actualización manual y reintento
  btnActualizarDatos.addEventListener('click', () => cargarTodoDashboard());
  btnReintentarTodo.addEventListener('click', () => cargarTodoDashboard());

  // Eventos de UI (filtros, cambio de gráfica y paginación)
  btnBarTipo.addEventListener('click', () => {
    modoBarras = 'tipo';
    btnBarTipo.classList.add('active', 'btn-primary');
    btnBarTipo.classList.remove('btn-outline-primary');
    btnBarCanal.classList.remove('active', 'btn-primary');
    btnBarCanal.classList.add('btn-outline-primary');
    renderizarGraficaBarras();
  });

  btnBarCanal.addEventListener('click', () => {
    modoBarras = 'canal';
    btnBarCanal.classList.add('active', 'btn-primary');
    btnBarCanal.classList.remove('btn-outline-primary');
    btnBarTipo.classList.remove('active', 'btn-primary');
    btnBarTipo.classList.add('btn-outline-primary');
    renderizarGraficaBarras();
  });

  btnAplicarFiltros.addEventListener('click', () => {
    paginaActual = 1;
    cargarTablaInteracciones();
  });

  btnLimpiarFiltros.addEventListener('click', () => {
    filtroTipo.value = '';
    filtroCanal.value = '';
    filtroTema.value = '';
    filtroUsuario.value = '';
    paginaActual = 1;
    cargarTablaInteracciones();
  });

  btnPaginaAnterior.addEventListener('click', () => {
    if (paginaActual > 1) {
      paginaActual -= 1;
      cargarTablaInteracciones();
    }
  });

  btnPaginaSiguiente.addEventListener('click', () => {
    paginaActual += 1;
    cargarTablaInteracciones();
  });

  // ---------------------------------------------------------------------------
  // 7. Conexión en Tiempo Real con Socket.IO (Fase 5)
  // ---------------------------------------------------------------------------
  let estuvoDesconectado = false;
  const socket = typeof io === 'function' ? io({ withCredentials: true }) : null;
  if (!socket) actualizarBadge(wsStatusBadge, wsStatusText, 'disconnected', 'WS: No disponible');

  socket?.on('connect', () => {
    actualizarBadge(wsStatusBadge, wsStatusText, 'connected', 'WS: Conectado');
    if (estuvoDesconectado) {
      estuvoDesconectado = false;
      mostrarNotificacionViva('Conexión WebSocket restablecida. Sincronizando estadísticas desde la nube...');
      cargarTodoDashboard();
    }
  });

  socket?.on('disconnect', () => {
    estuvoDesconectado = true;
    actualizarBadge(wsStatusBadge, wsStatusText, 'disconnected', 'WS: Desconectado');
  });

  socket?.on('connect_error', (err) => {
    estuvoDesconectado = true;
    actualizarBadge(wsStatusBadge, wsStatusText, 'disconnected', 'WS: Error');
    if (err.message?.includes('NO_AUTORIZADO')) window.location.replace('/login');
  });

  socket?.on('interacciones:actualizadas', async (evento) => {
    const accionTexto = {
      creada: 'registrada',
      actualizada: 'modificada',
      eliminada: 'eliminada'
    }[evento.accion] || 'actualizada';

    mostrarNotificacionViva(`Interacción ${evento.id_interaccion || ''} ${accionTexto}. Actualizando indicadores...`);
    await cargarTodoDashboard();
  });

  // ---------------------------------------------------------------------------
  // 8. Cierre de Sesión seguro con CSRF
  // ---------------------------------------------------------------------------
  void cargarTodoDashboard();
  setInterval(() => {
    if (!document.hidden) {
      if (socket && !socket.active && !socket.connected) socket.connect();
      void cargarTodoDashboard();
    }
  }, 60000);

  logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    logoutBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Cerrando...';

    try {
      let csrfToken = obtenerCsrfCookie();
      if (!csrfToken) {
        const csrfRes = await fetch('/api/auth/csrf');
        const csrfData = await csrfRes.json().catch(() => ({}));
        csrfToken = csrfData.csrfToken || '';
      }

      const respuesta = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'X-CSRF-Token': csrfToken
        }
      });
      if (!respuesta.ok) throw new Error('No se pudo cerrar la sesión. Intenta de nuevo.');
      const estado = await fetch('/api/auth/me', { cache: 'no-store' });
      if (estado.status !== 401) throw new Error('No se pudo confirmar el cierre de sesión.');
      socket?.disconnect();
      window.location.replace('/login');
    } catch (err) {
      window.alert(err.message);
      logoutBtn.disabled = false;
      logoutBtn.textContent = 'Cerrar sesión';
    }
  });
});
