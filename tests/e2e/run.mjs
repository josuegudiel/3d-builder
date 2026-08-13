/**
 * Ejecuta todas las pruebas de navegador sin depender de que haya un servidor
 * en marcha: construye el proyecto, levanta `vite preview`, pasa las tres
 * baterías contra el paquete ya construido y apaga el servidor al terminar.
 *
 *   node tests/e2e/run.mjs            # construye y prueba
 *   node tests/e2e/run.mjs <url>      # usa un servidor que ya está en marcha
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const PORT = 4183;
const SUITES = ['smoke.mjs', 'tools.mjs', 'ux.mjs', 'angles.mjs', 'hud.mjs'];

function run(cmd, args, opts = {}) {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', ...opts });
    p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} salió con código ${code}`))));
    p.on('error', fail);
  });
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* todavía no responde */
    }
    await sleep(300);
  }
  return false;
}

async function main() {
  const given = process.argv[2];
  let server = null;
  let url = given;

  if (!given) {
    console.log('\n▸ Construyendo…');
    await run('npx', ['vite', 'build', '--logLevel', 'warn']);

    console.log(`▸ Sirviendo el paquete construido en el puerto ${PORT}…`);
    server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: 'ignore',
      detached: true,
    });
    url = `http://127.0.0.1:${PORT}/`;
    if (!(await waitForServer(url))) {
      throw new Error('El servidor de vista previa no respondió a tiempo.');
    }
  }

  let failed = 0;
  try {
    for (const suite of SUITES) {
      console.log(`\n════ ${suite} ════`);
      try {
        await run('node', [resolve(HERE, suite), url]);
      } catch {
        failed++;
      }
    }
  } finally {
    if (server?.pid) {
      try {
        process.kill(-server.pid);
      } catch {
        server.kill();
      }
    }
  }

  if (failed > 0) {
    console.error(`\n${failed} batería(s) con fallos.`);
    process.exit(1);
  }
  console.log('\nTodas las baterías de navegador han pasado.');
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
