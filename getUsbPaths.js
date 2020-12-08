const { EventEmitter } = require('events');
const fs = require('fs');

const BASE_USB_PATH = '/dev';

const generateDrives = () => new Promise((resolve, reject) => {
  fs.readdir(BASE_USB_PATH, (err, results) => {
    if (err) reject(err);

    resolve(
      results.reduce((accum, curr) => ({ ...accum, [curr]: true }), {})
    );
  });
});

const getDriveDiffs = baselineRef => {
  const baseline = { ...baselineRef };

  return generateDrives().then(updated => {
    const updateds = Object.keys(updated);
    const added = [];

    while (updateds.length) {
      const next = updateds.shift();

      if (!baseline[next]) {
        added.push(next);
      } else {
        delete baseline[next];
      }
    }

    return { added, removed: Object.keys(baseline) };
  });
}

const usbPathChanges = () => {
  const emitter = new EventEmitter();
  let baselineDrives;
  let pollInterval;

  const startPolling = (delay = 1000) => {
    clearInterval(pollInterval);
    baselineDrives = null;
    emitter.emit('pollstart');

    emitter.on('inserted', insertedPaths => {
      insertedPaths.forEach(insertedPath => {
        baselineDrives = { ...baselineDrives, [insertedPath]: true };
      });
    });

    emitter.on('removed', removedPaths => {
      removedPaths.forEach(removedPath => {
        delete baselineDrives[removedPath];
      });
    });

    generateDrives().then(baseline => {
      baselineDrives = baseline;
      emitter.emit('pollstart');
      pollInterval = setInterval(() => {
        getDriveDiffs(baselineDrives)
          .then(({ added, removed }) => {
            if (added.length) {
              emitter.emit('inserted', added);
            }

            if (removed.length) {
              emitter.emit('removed', removed);
            }
          })
      }, delay);
    });
  };

  const stopPolling = () => {
    clearInterval(pollInterval);
    emitter.emit('pollstop');
  };

  emitter.startPolling = startPolling;
  emitter.stopPolling = stopPolling;
  emitter.basePath = () => '/dev';

  return emitter;
};

module.exports = usbPathChanges;
