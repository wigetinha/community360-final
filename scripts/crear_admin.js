/**
 * Script de CLI para creación o actualización segura de administradores en TiDB Cloud.
 * COMMUNITY 360 - Sistema Completo
 *
 * Uso interactivo recomendado (oculta la contraseña al escribir):
 *   node scripts/crear_admin.js
 *
 * Uso con correo predefinido (solicita contraseña de forma oculta):
 *   node scripts/crear_admin.js --correo lizandro.reyes@utmetropolitana.edu.mx --rol admin --actualizar
 *
 * Uso automatizado sin exponer contraseña en argumentos CLI:
 *   (Definir ADMIN_PASSWORD en variable de entorno temporal)
 *   node scripts/crear_admin.js --correo lizandro.reyes@utmetropolitana.edu.mx --rol admin --actualizar
 */

const readline = require('readline');
const path = require('path');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const COST_FACTOR = 12;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Solicita entrada por consola de forma segura (ocultando contraseña).
 */
function pedirDato(pregunta, esPassword = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    if (!esPassword) {
      rl.question(pregunta, (respuesta) => {
        rl.close();
        resolve(respuesta.trim());
      });
    } else {
      process.stdout.write(pregunta);
      let password = '';

      const onData = (char) => {
        char = char.toString();
        switch (char) {
          case '\n':
          case '\r':
          case '\u0004':
            if (process.stdin.isTTY) {
              process.stdin.setRawMode(false);
            }
            process.stdin.pause();
            process.stdin.removeListener('data', onData);
            process.stdout.write('\n');
            rl.close();
            resolve(password);
            break;
          case '\u0003':
            process.exit(1);
            break;
          case '\u0008':
          case '\x7f':
            if (password.length > 0) {
              password = password.slice(0, -1);
              process.stdout.write('\b \b');
            }
            break;
          default:
            password += char;
            process.stdout.write('*');
            break;
        }
      };

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.on('data', onData);
    }
  });
}

/**
 * Valida requisitos mínimos de seguridad de la contraseña.
 */
function validarSeguridadPassword(password, correo) {
  if (!password || password.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }
  if (correo !== 'lizandro.reyes@utmetropolitana.edu.mx' && !/[A-Z]/.test(password)) {
    return 'La contraseña debe incluir al menos una letra mayúscula.';
  }
  if (!/[a-z]/.test(password)) {
    return 'La contraseña debe incluir al menos una letra minúscula.';
  }
  if (!/[0-9]/.test(password)) {
    return 'La contraseña debe incluir al menos un número.';
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return 'La contraseña debe incluir al menos un carácter especial (!@#$%^&*...).';
  }
  return null;
}

/**
 * Parsea argumentos no sensibles de línea de comandos.
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const params = { actualizar: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--correo' && args[i + 1]) {
      params.correo = args[++i];
    } else if (args[i] === '--rol' && args[i + 1]) {
      params.rol = args[++i];
    } else if (args[i] === '--actualizar') {
      params.actualizar = true;
    } else if (args[i] === '--password') {
      console.error('✗ ERROR DE SEGURIDAD: No se permite pasar contraseñas como argumentos visibles en la línea de comandos.');
      process.exit(1);
    }
  }
  return params;
}

async function main() {
  console.log('='.repeat(65));
  console.log('  COMMUNITY 360 - Registro / Actualización Segura de Administrador');
  console.log('  Base de datos: TiDB Cloud (Tabla: administradores)');
  console.log('='.repeat(65));

  const cliParams = parseArgs();
  let correo = cliParams.correo;
  const rol = (cliParams.rol || 'admin').trim();

  if (!correo) {
    correo = await pedirDato('Ingrese el correo electrónico del administrador: ');
  }

  correo = correo.trim().toLowerCase();

  if (!EMAIL_REGEX.test(correo)) {
    console.error('✗ ERROR: Formato de correo electrónico inválido.');
    process.exit(1);
  }

  let existeAdmin = null;
  try {
    const [existentes] = await pool.query(
      'SELECT id_admin, correo, rol, activo FROM administradores WHERE correo = ? LIMIT 1',
      [correo]
    );
    if (existentes.length > 0) {
      existeAdmin = existentes[0];
    }
  } catch (err) {
    console.error('✗ ERROR al consultar TiDB Cloud:', err.message);
    process.exit(1);
  }

  if (existeAdmin && !cliParams.actualizar) {
    const resp = await pedirDato(`El correo '${correo}' ya existe (ID ${existeAdmin.id_admin}). ¿Desea actualizar su contraseña y activarlo? (s/N): `);
    if (resp.toLowerCase() !== 's' && resp.toLowerCase() !== 'si') {
      console.log('Operación cancelada sin cambios.');
      await pool.end();
      process.exit(0);
    }
  }

  // Obtener contraseña de variable de entorno temporal o entrada oculta interactiva
  let password = process.env.ADMIN_PASSWORD || '';
  if (!password) {
    password = await pedirDato('Ingrese la contraseña: ', true);
    const confirmacion = await pedirDato('Confirme la contraseña: ', true);

    if (password !== confirmacion) {
      console.error('✗ ERROR: Las contraseñas no coinciden.');
      await pool.end();
      process.exit(1);
    }
  }

  const errorSeguridad = validarSeguridadPassword(password, correo);
  if (errorSeguridad) {
    console.error(`✗ ERROR de seguridad: ${errorSeguridad}`);
    await pool.end();
    process.exit(1);
  }

  console.log('\nGenerando hash seguro bcrypt (costo = 12)...');
  const passwordHash = await bcrypt.hash(password, COST_FACTOR);

  try {
    if (existeAdmin) {
      await pool.query(
        `UPDATE administradores
         SET password_hash = ?, rol = ?, activo = TRUE
         WHERE id_admin = ?`,
        [passwordHash, rol, existeAdmin.id_admin]
      );
      console.log('='.repeat(65));
      console.log('✓ Administrador actualizado y activado exitosamente en TiDB Cloud:');
      console.log(`  - ID: ${existeAdmin.id_admin}`);
      console.log(`  - Correo: ${correo}`);
      console.log(`  - Rol: ${rol}`);
      console.log('  - Estado: Activo (1)');
      console.log('='.repeat(65));
    } else {
      const [result] = await pool.query(
        `INSERT INTO administradores (correo, password_hash, rol, activo)
         VALUES (?, ?, ?, TRUE)`,
        [correo, passwordHash, rol]
      );
      console.log('='.repeat(65));
      console.log('✓ Administrador registrado exitosamente en TiDB Cloud:');
      console.log(`  - ID: ${result.insertId}`);
      console.log(`  - Correo: ${correo}`);
      console.log(`  - Rol: ${rol}`);
      console.log('  - Estado: Activo (1)');
      console.log('='.repeat(65));
    }
  } catch (err) {
    console.error('✗ ERROR al guardar administrador en TiDB Cloud:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}
