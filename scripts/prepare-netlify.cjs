/**
 * Copy dist/ into netlify/ for manual upload to Netlify.
 * Run from project root: npm run build:netlify
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const out = path.join(root, 'netlify');

if (!fs.existsSync(dist)) {
  console.error('Run npm run build first. dist/ not found.');
  process.exit(1);
}

if (fs.existsSync(out)) {
  fs.rmSync(out, { recursive: true });
}
fs.mkdirSync(out, { recursive: true });

function copyRecursive(src, dest) {
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) {
      fs.mkdirSync(d, { recursive: true });
      copyRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

copyRecursive(dist, out);

const readme = `This folder is ready to upload to Netlify.

To deploy: Drag this folder to Netlify (Site → Deploys → "Drag and drop your site output folder here").

Or connect your repo: build command = npm run build:netlify, publish directory = netlify.

After you have your Netlify URL, set it in Open Playout (Web).bat and in FRAMEFLOW_APP_URL for the Electron app.
`;
fs.writeFileSync(path.join(out, 'README.txt'), readme, 'utf8');

console.log('netlify/ folder ready. Drag this folder to Netlify (Deploys → Deploy manually) to upload.');
console.log('Contents:', fs.readdirSync(out).join(', '));
