const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const settings = fs.readFileSync(path.join(root, 'extension', 'settings.js'), 'utf8');
let vendor = fs.readFileSync(path.join(root, 'vendor', 'darkreader.js'), 'utf8').replace(/\r\n/g, '\n');
// The upstream embedding API inserts its main-world proxy even when both proxy
// features are disabled. Skip that unused inline script under Manifest V3 CSP.
const proxyBlock = '        {\n            const proxyScript = createOrUpdateScript("darkreader--proxy");';
if (!vendor.includes(proxyBlock)) throw new Error('Upstream proxy block changed; review the build patch');
vendor = vendor.replace(proxyBlock, '        if (enableStyleSheetsProxy || enableCustomElementRegistryProxy) {\n            const proxyScript = createOrUpdateScript("darkreader--proxy");');
const source = fs.readFileSync(path.join(root, 'src', 'content.js'), 'utf8');
const bundle = `// Night Sites. Bundled Dark Reader is MIT licensed; see licenses/DarkReader-MIT.txt.\n(() => {\n` +
  `if (globalThis.__nightSitesInstalled) { void globalThis.__nightSitesInstalled.refresh(); return; }\n` +
  `${settings}\nconst engine = {};\n` +
  `(function(exports, module, chrome) {\n${vendor}\n})(engine, { exports: engine }, { runtime: {}, dom: chrome.dom });\n` +
  `${source}\n})();\n`;
fs.writeFileSync(path.join(root, 'extension', 'content.js'), bundle);
console.log(`Built self-contained content.js (${Buffer.byteLength(bundle)} bytes)`);
