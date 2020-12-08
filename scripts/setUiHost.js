const fs = require('fs');
const path = require('path');
const process = require('process');

const confPath = path.join('conf', 'gatewayConf.json');
const uiHost = Array.prototype.slice.call(process.argv, 2).join(' ');

const config = JSON.parse(fs.readFileSync(confPath, { encuding: 'utf8' }).toString());
const newConfig = { ...config, uiHost };

fs.writeFileSync(confPath, '');

fs.writeFileSync(confPath, JSON.stringify(newConfig, null, 2));
process.stdout.write(`SUCCESS: Cross-origin host set to "${uiHost}"\n`);
process.exit(0);