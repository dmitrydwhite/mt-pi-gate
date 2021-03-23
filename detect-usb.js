const fs = require('fs');
const path = require('path');

const INTERVAL = 500;
const MAX_MS_WAIT = 20 * 1000;

const devContents = {};

let timeWaited = 0;

function checkForTimeWaited() {
  if (timeWaited >= MAX_MS_WAIT) {
    process.stdout.write(
      `\nNo new serial connections detected after ${MAX_MS_WAIT / 1000} seconds; exiting...\n`
    );
    process.exit();
  }
}

function checkForNew() {
  const newPorts = fs.readdirSync('/dev').filter(filename => !devContents[filename]);

  checkForTimeWaited();

  if (newPorts.length > 0) {
    timeWaited = 0;
    process.stdout.write(`\nDetected new serial connection${newPorts.length > 1 ? 's' : ''}:`);
    newPorts.forEach(newPort => {
      process.stdout.write(`\n  > ${path.sep}dev${path.sep}${newPort}`);
      devContents[newPort] = true;
    });
  } else {
    timeWaited += INTERVAL;
  }

  setTimeout(checkForNew, INTERVAL);
}

fs.readdirSync('/dev').forEach(filename => devContents[filename] = true);

process.stdout.write('Connect your serial connection to a usb port now.');

checkForNew();
