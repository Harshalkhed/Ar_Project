#!/usr/bin/env node
// Asset pipeline: master GLBs in assets-src/projects/ → delivery files in apps/preview/public/projects/.
//
//   1. Every master .glb is compressed with glTF-Transform `optimize`: Meshopt geometry, KTX2 textures
//      (ETC1S for colour, UASTC for normal/data maps), textures capped at 2048 px. Written to the same
//      relative path under public/, which is what project.json already points at.
//   2. Every project with a model gets a pre-baked AR Quick Look file, public/projects/<p>/quicklook.usdz
//      (wall projects also get quicklook-floor.usdz: floor-anchored at hanging height, for undetectable walls),
//      exported in headless Chromium by the same code iPhones run (apps/preview/src/bake.ts), from the
//      masters, so the USDZ never inherits KTX2 compression loss.
//
// Outputs newer than their inputs are skipped; pass --force to rebuild everything (e.g. after changing
// the export code), --skip-usdz to only compress. Needs KTX-Software 4.4+ (`ktx`) and Playwright's
// Chromium (`pnpm exec playwright install chromium`). Run with `pnpm run build:assets`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const masters = join(root, 'assets-src', 'projects');
const published = join(root, 'apps', 'preview', 'public', 'projects');
const force = process.argv.includes('--force');
const skipUsdz = process.argv.includes('--skip-usdz');
const MB = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)]));
const isFresh = (output, inputs) => !force && existsSync(output) && inputs.every((input) => statSync(input).mtimeMs <= statSync(output).mtimeMs);

/** The Windows installer does not put `ktx` on PATH; add its default folder for our child process only. */
function toolEnvironment() {
  const ktxDefault = 'C:\\Program Files\\KTX-Software\\bin';
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  if (process.platform === 'win32' && existsSync(ktxDefault)) env[pathKey] = `${ktxDefault}${delimiter}${env[pathKey] ?? ''}`;
  return env;
}

function compressModels() {
  const cli = join(root, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js'); // Root dev dependency; its exports hide package.json.
  const env = toolEnvironment();
  for (const master of walk(masters).filter((file) => file.toLowerCase().endsWith('.glb'))) {
    const output = join(published, relative(masters, master));
    const name = relative(masters, master).split(sep).join('/');
    if (isFresh(output, [master])) {
      console.log(`  up to date  ${name}`);
      continue;
    }
    mkdirSync(dirname(output), { recursive: true });
    const started = Date.now();
    const result = spawnSync(process.execPath, [cli, 'optimize', master, output, '--compress', 'meshopt', '--texture-compress', 'ktx2', '--texture-size', '2048'], { env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`gltf-transform optimize failed for ${name}:\n${result.stderr || result.stdout}`);
    console.log(`  compressed  ${name}: ${MB(statSync(master).size)} → ${MB(statSync(output).size)} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
}

/** Projects with at least one model asset, with the master files their models come from. */
function projectsToBake() {
  return readdirSync(published, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(published, entry.name, 'project.json')))
    .map((entry) => {
      const projectFile = join(published, entry.name, 'project.json');
      const project = JSON.parse(readFileSync(projectFile, 'utf8'));
      const models = (project.assets ?? []).filter((asset) => asset.kind === 'model');
      const masterFiles = models.map((asset) => join(masters, relative(published, fileURLToPath(new URL(asset.uri, pathToFileURL(projectFile))))));
      const base = { name: entry.name, projectFile, masterFiles, hasModel: models.length > 0 };
      const bakes = [{ ...base, file: 'quicklook.usdz', mount: undefined }];
      // Wall pieces also get a floor-anchored copy at hanging height, for walls the phone cannot detect.
      if (project.placement?.surface === 'wall') bakes.push({ ...base, file: 'quicklook-floor.usdz', mount: 'wall-from-floor' });
      return bakes.map((bake) => ({ ...bake, output: join(published, entry.name, bake.file) }));
    })
    .flat()
    .filter((project) => project.hasModel);
}

async function bakeUsdz() {
  const projects = projectsToBake().filter((project) => {
    const missing = project.masterFiles.find((file) => !existsSync(file));
    if (missing) throw new Error(`Project ${project.name} uses a model with no master in assets-src: ${relative(root, missing)}`);
    if (!isFresh(project.output, [project.projectFile, ...project.masterFiles])) return true;
    console.log(`  up to date  ${project.name}/${project.file}`);
    return false;
  });
  if (projects.length === 0) return;

  const vite = await import(pathToFileURL(createRequire(join(root, 'apps', 'preview', 'package.json')).resolve('vite')).href);
  const { chromium } = await import('playwright');
  const server = await vite.createServer({ root: join(root, 'apps', 'preview'), configFile: join(root, 'apps', 'preview', 'vite.config.mjs'), server: { port: 0 }, logLevel: 'error' });
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    // Bake from masters: any published model URL that has a master is answered with the master instead.
    await page.route('**/projects/**/*.glb', async (route) => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/projects\//, '');
      const master = join(masters, ...path.split('/'));
      if (existsSync(master)) await route.fulfill({ body: readFileSync(master), contentType: 'model/gltf-binary' });
      else await route.continue();
    });
    let received;
    await page.route('**/__bake-result', async (route) => {
      received = route.request().postDataBuffer();
      await route.fulfill({ status: 204 });
    });
    await page.route('**/__bake', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>bake</title>' }));
    await page.goto(`${origin}/__bake`);
    for (const project of projects) {
      const started = Date.now();
      received = undefined;
      await page.evaluate(async ([projectPath, mount]) => {
        const { bakeUsdz } = await import('/src/bake.ts');
        await fetch('/__bake-result', { method: 'POST', body: await bakeUsdz(projectPath, mount ?? undefined) });
      }, [`/projects/${project.name}/project.json`, project.mount ?? null]);
      if (!received || received.length < 4 || received.readUInt32LE(0) !== 0x04034b50) throw new Error(`Bake for ${project.name}/${project.file} did not return a USDZ (zip) file.`);
      writeFileSync(project.output, received);
      console.log(`  baked       ${project.name}/${project.file}: ${MB(received.length)} in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

console.log('Compressing models (Meshopt + KTX2)…');
compressModels();
if (!skipUsdz) {
  console.log('Baking AR Quick Look files…');
  await bakeUsdz();
}
