const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const readdir = promisify(fs.readdir);
const rmdir = promisify(fs.rmdir);
const unlink = promisify(fs.unlink);

module.exports.rmdirs = function rmdirs(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  entries.forEach(entry => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      rmdirs(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }
  });

  fs.rmdirSync(dir);
};