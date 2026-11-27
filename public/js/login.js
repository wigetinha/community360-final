/**
 * Manejador del Formulario de Inicio de Sesión
 * COMMUNITY 360 - Fase 3
 */

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const correoInput = document.getElementById('correoInput');
  const passwordInput = document.getElementById('passwordInput');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');
  const toggleIcon = document.getElementById('toggleIcon');
  const submitBtn = document.getElementById('submitBtn');
  const btnSpinner = document.getElementById('btnSpinner');
  const btnText = document.getElementById('btnText');
  const alertContainer = document.getElementById('alertContainer');
  const alertMessage = document.getElementById('alertMessage');
  const alertIcon = document.getElementById('alertIcon');

  // 1. Mostrar / Ocultar Contraseña
  togglePasswordBtn.addEventListener('click', () => {
    const isPassword = passwordInput.getAttribute('type') === 'password';
    passwordInput.setAttribute('type', isPassword ? 'text' : 'password');
    toggleIcon.className = isPassword ? 'bi bi-eye-slash' : 'bi bi-eye';
  });

  // 2. Función auxiliar para mostrar alertas de error
  function mostrarAlerta(mensaje, esError = true) {
    alertContainer.className = esError 
      ? 'alert alert-danger alert-custom d-block' 
      : 'alert alert-success alert-custom d-block';
    alertIcon.className = esError 
      ? 'bi bi-exclamation-triangle-fill flex-shrink-0' 
      : 'bi bi-check-circle-fill flex-shrink-0';
    alertMessage.textContent = mensaje;
  }

  function ocultarAlerta() {
    alertContainer.className = 'alert alert-danger alert-custom';
    alertContainer.style.display = 'none';
  }

  // 3. Obtener token CSRF de la sesión
  async function obtenerCsrfToken() {
    try {
      const res = await fetch('/api/auth/csrf');
      if (res.ok) {
        const data = await res.json();
        return data.csrfToken;
      }
    } catch (e) {
      console.warn('No se pudo precargar el token CSRF:', e);
    }
    // Alternativa: leer cookie XSRF-TOKEN
    const match = document.cookie.match(new RegExp('(^| )XSRF-TOKEN=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : '';
  }

  // 4. Envío y procesamiento de formulario
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    ocultarAlerta();

    const correo = correoInput.value.trim();
    const password = passwordInput.value;

    // Validación cliente básica
    if (!correo || !password) {
      mostrarAlerta('Por favor, ingresa tanto tu correo como tu contraseña.');
      return;
    }

    // Activar estado de carga visual
    submitBtn.disabled = true;
    btnSpinner.classList.remove('d-none');
    btnText.textContent = 'Verificando credenciales...';

    try {
      const csrfToken = await obtenerCsrfToken();

      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };

      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }

      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ correo, password })
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && response.status === 200) {
        // Inicio de sesión correcto
        btnText.textContent = '¡Acceso concedido! Redirigiendo...';
        mostrarAlerta('Autenticación correcta. Redirigiendo al panel...', false);
        
        // Redirigir al dashboard protegido reemplazando el historial
        setTimeout(() => {
          window.location.replace('/dashboard');
        }, 600);

      } else if (response.status === 429) {
        mostrarAlerta(data.error || 'Demasiados intentos fallidos. Por seguridad, intente más tarde.');
      } else if (response.status === 400) {
        mostrarAlerta(data.error || 'Datos incompletos o inválidos.');
      } else if (response.status === 401) {
        mostrarAlerta(data.error || 'Correo o contraseña incorrectos.');
      } else {
        mostrarAlerta(data.error || 'Ocurrió un error inesperado. Inténtelo más tarde.');
      }

    } catch (error) {
      console.error('Error de red al iniciar sesión:', error);
      mostrarAlerta('No se pudo establecer conexión con el servidor. Verifique su red.');
    } finally {
      // Restaurar estado de botón si no hubo redirección exitosa
      if (btnText.textContent !== '¡Acceso concedido! Redirigiendo...') {
        submitBtn.disabled = false;
        btnSpinner.classList.add('d-none');
        btnText.textContent = 'Iniciar Sesión';
      }
    }
  });
});
