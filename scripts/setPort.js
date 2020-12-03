const fs = require('fs');
const path = require('path');
const process = require('process');

const confPath = path.join('conf', 'gatewayConf.json');
const port = Number(process.argv[2]);

// Do some validation on the passed port
if (!Number.isInteger(port)) {
  process.stderr.write('Port must be set to a Number');
  process.exit(1);
}

if (port < 1024 || port > 49190) {
  process.stderr.write('Port out of range');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(confPath, { encuding: 'utf8' }).toString());
const newConfig = { ...config, port };

fs.writeFileSync(confPath, '');

fs.writeFileSync(confPath, JSON.stringify(newConfig, null, 2));
process.stdout.write(`SUCCESS: Gateway server port changed to ${port}\n`);
process.exit(0);