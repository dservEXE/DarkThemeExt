// Reproduce the bundled engine without npm or remote code at runtime.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const root = path.resolve(__dirname, '..');
const VERSION = '4.9.134';
const INTEGRITY = 'HAyEz97vK/UFLO6kcjxojji5OKr0+pwgGLrBzyg67xD2p6ySrSyCBvNxb+0KTSMYk9qNz9Hq85JR3TaKyqEV1w==';

(async () => {
  const response = await fetch(`https://registry.npmjs.org/darkreader/-/darkreader-${VERSION}.tgz`);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha512').update(archive).digest('base64') !== INTEGRITY) {
    throw new Error('Dark Reader package integrity mismatch');
  }
  const tar = zlib.gunzipSync(archive);
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8) || 0;
    files.set(name, tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  const script = files.get('package/darkreader.js');
  const license = files.get('package/LICENSE');
  if (!script || !license) throw new Error(`Missing expected files: ${[...files.keys()].join(', ')}`);
  await fs.mkdir(path.join(root, 'vendor'), { recursive: true });
  await fs.mkdir(path.join(root, 'extension', 'licenses'), { recursive: true });
  await fs.writeFile(path.join(root, 'vendor', 'darkreader.js'), script);
  await fs.writeFile(path.join(root, 'extension', 'licenses', 'DarkReader-MIT.txt'), license);
  await fs.writeFile(path.join(root, 'vendor', 'provenance.json'), JSON.stringify({
    package: 'darkreader', version: VERSION, integrity: `sha512-${INTEGRITY}`,
    source: 'https://github.com/darkreader/darkreader', license: 'MIT'
  }, null, 2) + '\n');
  console.log(`Vendored Dark Reader ${VERSION}; SHA-512 verified`);
  console.log(script.toString().slice(0, 1500));
})();
