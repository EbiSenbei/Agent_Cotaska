const fs = require('fs');
const path = require('path');
const source = path.dirname(require.resolve('pdfjs-dist/package.json'));
const output = path.join(__dirname, '../src/renderer/public/pdfjs');
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  fs.cpSync(path.join(source, folder), path.join(output, folder), { recursive: true });
}
