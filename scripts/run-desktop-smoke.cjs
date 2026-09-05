const { spawnSync } = require('node:child_process');
const path = require('node:path');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const child = spawnSync(require('electron'), [path.resolve(__dirname, '../desktop/main.cjs'), '--smoke-test'], { env, windowsHide: true, stdio: 'inherit', timeout: 45000 });
process.exit(child.status ?? 1);
