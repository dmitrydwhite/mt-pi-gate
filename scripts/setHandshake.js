const fs = require('fs');
const path = require('path');
const process = require('process');

const confPath = path.join('conf', 'gatewayConf.json');
const systemHandshake = Array.prototype.slice.call(process.argv, 2).join(' ');

const config = JSON.parse(fs.readFileSync(confPath, { encuding: 'utf8' }).toString());
const newConfig = { ...config, systemHandshake };

fs.writeFileSync(confPath, '');

fs.writeFileSync(confPath, JSON.stringify(newConfig, null, 2));
process.stdout.write(`SUCCESS: Gateway system handshake changed to "${systemHandshake}"\n`);
process.exit(0);