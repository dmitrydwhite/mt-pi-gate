const {
  CREATED,
  HTTP,
  WEBSOCKET,
} = require('./constants');

const commandQs = {};
const orphanedCommands = {};
const systemCxs = {};
const systemInTxRx = {};
let waitingForMajorTom = [];

const addSystem = (systemName, type, cx) => {
  commandQs[systemName] = orphanedCommands[systemName] || [];

  if (type === HTTP) {
    systemCxs[systemName] = { http: true };
  }

  if (type === WEBSOCKET) {
    systemCxs[systemName] = null;
    systemCxs[systemName] = cx;
  }

  setSystemFree(systemName);
};

const emptySystemCommandQ = system => {
  const ret = [...commandQs[system] || []];

  commandQs[system] = [];

  return ret;
};

const pendForMajorTom = obj => {
  waitingForMajorTom.push(obj);
};

const queueDataForSystem = (data, system) => new Promise((resolve, reject) => {
  if (commandQs[system]) {
    commandQs[system].push(data);
    resolve(system);
  } else {
    if (orphanedCommands[system]) {
      orphanedCommands[system].push(data);
    } else {
      orphanedCommands[system] = [data];
    }
    reject()
  }
});

const sendNextIfAble = system => new Promise((resolve, reject) => {
  const connection = systemCxs[system] || {};

  if (!systemCxs[system]) { return reject(); }

  if (Number.isFinite(connection.readyState) && connection.readyState !== 1) {
    return reject();
  }

  if (connection.readableFlowing === false) {
    return reject();
  }

  if (connection.http) { return reject(); }

  if (!systemIsBusy(system)) {
    const [next] = commandQs[system];

    if (!next) { return reject(); }

    commandQs[system] = commandQs[system].slice(1);
    setSystemBusy(system);
    connection.send(JSON.stringify(next));

    return resolve(next);
  }

  reject();
});

const setSystemBusy = system => {
  if (systemInTxRx[system]) {
    systemInTxRx[system].isBusy = true;
  } else {
    systemInTxRx[system] = { isBusy: true };
  }
};

const setSystemFree = system => {
  if (systemInTxRx[system]) {
    systemInTxRx[system].isBusy = false;
  } else {
    systemInTxRx[system] = { isBusy: false };
  }
};

const systemIsBusy = system => {
  if (!systemInTxRx[system]) {
    setSystemFree(system);
  }

  return systemInTxRx[system].isBusy;
};

const unloadForMajorTom = () => {
  const ret = [...waitingForMajorTom];

  waitingForMajorTom = [];

  return ret;
};

module.exports = {
  addSystem,
  emptySystemCommandQ,
  pendForMajorTom,
  queueDataForSystem,
  sendNextIfAble,
  setSystemBusy,
  setSystemFree,
  systemIsBusy,
  unloadForMajorTom,
};
