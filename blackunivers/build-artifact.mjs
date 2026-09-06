// --- Das Artefakt bauen ---------------------------------------------------
// Das Spiel besteht aus zwanzig Moduldateien, einer Formatvorlage und drei
// Hilfsskripten für die Anzeige. Ein Artefakt ist eine einzige Seite. Also
// wird alles zusammengelegt: die Module zu einem Bündel, die Vorlage in ein
// <style>, die Hilfsskripte in ein <script> davor - und der Rumpf des
// Startbilds dazwischen. Three.js bleibt draußen: es kommt vom CDN und wird
// vom Browser zwischengespeichert.
//
//   node build-artifact.mjs            -> dist/black-univers.html
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist');
fs.mkdirSync(out, { recursive: true });

const result = await esbuild.build({
  entryPoints: [path.join(here, 'js', 'main.js')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'none',
  charset: 'utf8',
});
const bundle = result.outputFiles[0].text;

const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
// Die Musik: ein Artefakt ist eine Datei, also muss die Aufnahme mit hinein.
const musicPath = path.join(here, 'audio', 'black-hull-directive.mp3');
const music = fs.existsSync(musicPath)
  ? `data:audio/mpeg;base64,${fs.readFileSync(musicPath).toString('base64')}`
  : null;
// Der Vorspann braucht keine Datei mehr: der Studio-Vorspann ist gezeichnet
// und steckt als SVG samt Bewegung im Dokument.
const css = fs.readFileSync(path.join(here, 'css', 'style.css'), 'utf8');
// Umgebungslicht, Farbverwaltung und Nachbearbeitung: einfache Skripte, die
// vor dem Spielcode laufen müssen. Im Artefakt stehen sie eingebettet.
const HELPERS = ['envmap', 'colorpipeline', 'postfx'];
const helpers = HELPERS
  .map((name) => fs.readFileSync(path.join(here, 'js', 'render', `${name}.js`), 'utf8'))
  .join('\n\n');

// Aus dem Dokument wird der Rumpf. Die Verweise auf eigene Dateien fallen
// weg, weil alles gleich eingebettet folgt - die Zeile für Three.js vom CDN
// bleibt stehen.
const body = html
  .slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>'))
  .replace(/\n\s*<script src="js\/[^"]*"><\/script>/g, '')
  .replace(/\n\s*<script type="module"[^>]*><\/script>/g, '')
  .replace(/\n\s*<link[^>]*>/g, '')
  .replace('src="audio/black-hull-directive.mp3"', music ? `src="${music}"` : '')
  .trim();

const page = `<title>Black Univers</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Barlow:wght@400;500;600&display=swap">
<style>
${css}
</style>

${body}

<script>
${helpers}
</script>
<script>
${bundle}
</script>
`;

const file = path.join(out, 'black-univers.html');
fs.writeFileSync(file, page, 'utf8');
const kb = (Buffer.byteLength(page) / 1024).toFixed(0);
console.log(`${file} geschrieben (${kb} KB${music ? ', mit Musik' : ''}, `
  + `mit Studio-Vorspann, Three.js vom CDN)`);
