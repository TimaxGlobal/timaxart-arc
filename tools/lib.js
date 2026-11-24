// Shared helpers for the painting tools. No dependencies; Node 18+.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PAINTINGS = path.join(ROOT, 'offer', 'paintings');
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));   // tolerate the BOM PowerShell adds
const writeJson = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n', 'utf8');
const settings = () => { try { return readJson(path.join(ROOT, 'painting-settings.json')); } catch (e) { return {}; } };
const paintingDir = code => path.join(PAINTINGS, code);
const paintingFile = code => path.join(paintingDir(code), 'painting.json');
module.exports = { fs, path, ROOT, PAINTINGS, readJson, writeJson, settings, paintingDir, paintingFile };
