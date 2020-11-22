const { PassThrough, Writable, Duplex } = require('stream');

const SerialPort = require('serialport');

const createSystemOutboundQueuer = require("./createSystemOutbound");

const objectMode = true;

const createWsWriteStream = cx => new Writable({
  objectMode,
  write(chunk, _, callback) {
    if (cx.readyState !== 1) {
      this.emit('lostCx', chunk);

      const error = new Error('WebSocket connection closed');

      error.type = 'lostCx';

      callback(error);
    } else {
      cx.send(JSON.stringify(chunk));
      callback();
    }
  },
});

class SystemPassThrough extends Duplex {
  constructor(opts) {
    super(opts);
    this.data = [];
  }

  _read() {
    const next = this.data.shift();

    if (next) {
      this.push(next);
    } else {
      this.pause();
    }
  }

  _write(chunk, encoding, callback) {
    if (chunk) {
      this.data.push(chunk);

      if (this.isPaused()) {
        this.resume();
      }
    }

    callback();
  }

  handleLostCx(chunk) {
    this.pause();

    if (chunk) {
      this.data.unshift(chunk);
    }
  }
}

const createWsPassThrough = () => {
  const passThrough = new PassThrough({
    objectMode,
  });

  passThrough.handleLostCx = function(chunk) {
    this.unshift(chunk);
  }.bind(passThrough);

  return passThrough;
};

const commandQueuer = () => {
  const http = {};
  const usb = {};
  const ws = {};

  const getObj = system => ({ ...http, ...usb, ...ws }[system]) || {};

  // const inboundCx = system => {
  //   const streamSys = ws[system] || usb[system];

  //   if (streamSys) {
  //     const isStream = () => true;
  //     const send = data => {
  //       streamSys.passToSystem.write(data);
  //     };

  //     return { isStream, send };

  //   }

  //   return { isStream: () => false, send: () => false };
  // };

  const addSystemHttp = system => {
    if (http[system]) {
      throw new Error(`Attempted to create an HTTP-connected system named ${system} but it already exists.`);
    }

    const base = createSystemOutboundQueuer();
    const isStream = () => false;
    const isReady = () => false;
    const awaitReady = cb => cb();
    const send = data => base.queueForSystem(data);
    const cancelledIds = {};
    const passToSystem = new Writable({
      objectMode,
      write(chunk, _, callback) {
        base.queueForSystem(chunk);
        callback();
      },
    });

    http[system] = {
      ...base,
      isStream,
      isReady,
      awaitReady,
      send,
      cancelledIds,
      passToSystem,
    };
  };

  const addSystemUsb = (system, usbDest, opts, onDataCb, onErrorCb) => {
    if (usb[system]) {
      throw new Error(`Attempted to create a USB-connected system named ${system} but it already exists.`);
    }

    if (!usbDest || typeof usbDest !== 'string') {
      throw new Error('You must provide a string describing the usb destination port location.');
    }

    if (!onDataCb || typeof onDataCb !== 'function') {
      throw new Error('The third argument to addSystemUsb must be a callback function for handling data from the serial port.');
    }

    if (onErrorCb && typeof onErrorCb !== 'function') {
      throw new Error('The fourth argument to addSystemUsb must be a callback function for handling an error event from the serial port.');
    }

    const { baudRate, parser, byteLength, delimiter, interval, regex } = opts;
    const passToSystem = new PassThrough({ objectMode });
    const usbCx = new SerialPort(usbDest, { baudRate });

    if (parser && SerialPort.parsers[parser]) {
      const parser = new SerialPort.parsers[parser]({ byteLength, delimiter, interval, regex });

      usbCx.pipe(parser);
      parser.on('data', onDataCb);
    } else {
      usbCx.on('data', onDataCb);
    }

    usbCx.on('error', error => {
      return (errorCb && onErrorCb(error)) || passToSystem.unpipe();
    });

    passToSystem.pipe(usbCx);

    usb[system] = { ...createSystemOutboundQueuer(), passToSystem };
  };

  const addSystemWebSocket = (system, wsCx) => {
    const isReady = () => wsCx && wsCx.readyState === 1;
    const passToSystem = createWsPassThrough();
    const wsCxAsStream = createWsWriteStream(wsCx);
    const waitingCbs = [];
    let readyStateInterval;

    const awaitReady = cb => {
      waitingCbs.push(cb);
      readyStateInterval = readyStateInterval || setInterval(() => {
        if (isReady()) {
          let next = waitingCbs.unshift();

          clearInterval(readyStateInterval);

          while (next) {
            next();
            next = waitingCbs.unshift();
          }
        }
      }, 250);
    };

    const send = data => {
      passToSystem.write(data);
    };

    wsCxAsStream.on('lostCx', chunk => {
      passToSystem.handleLostCx(chunk);
    });

    wsCxAsStream.on('error', err => {
      if (error.type === 'lostCx') {
        passToSystem.pause();
      }
    })

    passToSystem.pipe(wsCxAsStream);

    ws[system] = {
      ...ws[system] || createSystemOutboundQueuer(),
      passToSystem,
      isStream: () => true,
      isReady,
      awaitReady,
      cancelledIds: {},
      send,
    };
  };

  const has = system => !!(Object.keys(getObj(system)).length);

  const get = system => getObj(system);

  const removeFromQueue = (system, id) => {
    const obj = getObj(system);

    obj.cancelledIds[id] = true;
  };

  const removeSystem = system => {
    if (http[system]) {
      delete http[system];
    }

    if (usb[system]) {
      delete usb[system];
    }

    if (ws[system]) {
      delete ws[system];
    }
  };

  // const replaceSystemInboundCx = (system, cx) => {
  //   const streamSys = ws[system] || usb[system];

  //   if (streamSys) {
  //     const nextCx = ws[system] ? createWsWriteStream(cx) : cx;
  //     const isReady = () => ws[system] ? cx && cx.readyState === 1;

  //     streamSys.passToSystem.unpipe();

  //     nextCx.on('lostCx', chunk => {
  //       streamSys.passToSystem.handleLostCx(chunk);
  //     });

  //     streamSys.passToSystem.pipe(nextCx);
  //   }
  // };

  return {
    addSystemHttp,
    addSystemUsb,
    addSystemWebSocket,
    get,
    has,
    removeFromQueue,
    removeSystem,
    // replaceSystemInboundCx,
  }
};

// get = {
//   getNextForSystem, *
//   queueForSystem, *
//   getAllForSystem, *
//   getNextForSystem, *
//   isStream,
//   isReady,
//   awaitReady,
//   send,
//   cancelledIds,
//   passToSystem
// }

module.exports = commandQueuer;
