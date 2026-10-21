// Собирает узел в один самодостаточный HTML (для стенда claude.ai / офлайн-просмотра):
//   node tools/build-artifact.js esd-ball-rp   → dist/esd-ball-rp.html и dist/esd-ball-rp.artifact.html
const fs = require('fs'), path = require('path');
const id = process.argv[2];
if (!id) { console.error('usage: node tools/build-artifact.js <unit-id>'); process.exit(1); }
const dir = path.join(__dirname, '..', 'units', id);
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const read = (rel) => fs.readFileSync(path.resolve(dir, rel), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, h) => `<style>\n${read(h)}\n</style>`);
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, s) => `<script>\n${read(s)}\n</script>`);
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '').replace(/<script>if\('serviceWorker'[^<]*<\/script>\n?/, '');
html = html.replace(/<a class="back"[^>]*>[^<]*<\/a>\n?/, '');
fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'dist', id + '.html'), html);
// вариант без <html>/<head>/<body> — для публикации артефактом
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\n?|<meta name="viewport"[^>]*>\n?/g, '');
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
fs.writeFileSync(path.join(__dirname, '..', 'dist', id + '.artifact.html'), head.trim() + '\n' + body.trim() + '\n');
console.log('dist/' + id + '.html', (html.length / 1024).toFixed(1), 'KB');
