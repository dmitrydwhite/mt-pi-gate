const { EventEmitter } = require('events');
const http = require('http');
// const https = require('https'); // Todo: figure out how to configure for a secure WS

const cors = require('cors');
const express = require('express');
const SerialPort = require('serialport');
const WebSocket = require('ws');

const { newNodeGateway } = require('majortom-gateway');
const systemIncomingMessageHandler = require('./systemIncomingMessageHandler');
const {
  addSystem,
  queueDataForSystem,
  setSystemFree,
  sendNextIfAble,
  emptySystemCommandQ,
  pendForMajorTom,
  unloadForMajorTom,
} = require('./systemManager');
const { HTTP, SEND_NEXT_IF_ABLE, SYSTEM_ADDED, WEBSOCKET } = require('./constants');
const { addSystemUi, addUiConnection, updateUiWithTransition, removeCommand } = require('./uiManager');

const eventBus = new EventEmitter();
const app = express();

// TODO: Make port configurable
const port = 3003;

// Load any data that's been saved to our config file...
// Create a log file...
// If the config file isn't there, create it...

// These two are for future use potentially allowing users to add custom handlers
// by command, or custom listeners to gateway state changes.
const commandHandlers = {};
const userListeners = {};

// This will eventually be a place where we can store the info needed to run a lambda on a command
// after it has finished:
// const idMap = {};

// TODO: Need to figure out how we can safely run JavaScript received from elsewhere...?
let checkCommandValid = () => true;

let savedToken = `generate random placeholder value ${Date.now()}`;
let validHandshake = '12345';
let majorTomCx;


eventBus.on(SYSTEM_ADDED, (system, type, cx) => {
  addSystem(system, type, cx);
  addSystemUi(system, type);
  eventBus.emit(SEND_NEXT_IF_ABLE, system);
});

eventBus.on(SEND_NEXT_IF_ABLE, system => {
  sendNextIfAble(system)
    .then(next => eventBus.emit('transition', 'uplinking_to_system', next))
    .catch(ignore => {
      return ignore;
    });
});

eventBus.on('transition', (nextState, ...data) => {
  updateUiWithTransition(nextState, ...data);
  listeners(nextState)(...data);
});

const triggerCommandFinish = (system, id) => {
  setSystemFree(system);
  removeCommand(id);
  eventBus.emit(SEND_NEXT_IF_ABLE, system);
};

const defaultListeners = {
  received_from_mt: data => {
    const valid = checkCommandValid(data);

    if (valid instanceof Error) {
      eventBus.emit('transition', 'failed', data, valid);
    } else {
      majorTomCx.transmitCommandUpdate(data.id, 'preparing_on_gateway', data);
      setImmediate(() => {
        eventBus.emit('transition', 'preparing_on_gateway', data);
      });
    }
  },
  preparing_on_gateway: data => {
    const { id, type } = data;
    // This is for enabling the ability to have certain work be done on the gateway before sending
    // the command on to the system;
    const handlerFn = commandHandlers[type];

    // This is for allowing access to the original command for potential use later
    // idMap[id] = data;

    if (!handlerFn) {
      return eventBus.emit('transition', 'gateway_prep_complete', data);
    }

    // The rest of this function is for future capabilities of possibly allowing
    // users to customize the gateway handling.
    // const makeCb = next => arg => {
    //   let errorArg;

    //   if (typeof arg === 'function') {
    //     idProcessors[data.id] = arg;
    //   } else if (arg instanceof Error) {
    //     errorArg = arg;
    //   }

    //   setImmediate(() => eventBus.emit('transition', next, data, errorArg));
    // };

    // const done = makeCb('gateway_prep_complete');
    // const completeCommand = makeCb('completed');
    // const failCommand = makeCb('failed');

    // handlerFn(data, done, completeCommand, failCommand);
  },
  gateway_prep_complete: data => {
    eventBus.emit('transition', 'ready_for_system', data);
  },
  ready_for_system: data => {
    const { system } = data;

    queueDataForSystem(data, system)
      .then(() => eventBus.emit(SEND_NEXT_IF_ABLE, system))
      .catch(() => eventBus.emit('transition', 'waiting_for_system', data));
  },
  waiting_for_system: data => {
    const { id, system } = data;

    sendToMajorTom('event')({
      type: 'event',
      event: {
        command_id: id,
        level: 'warning',
        message: `Gateway received a command for ${system} but it has not been connected to the gateway yet`,
        system,
      },
    });
  },
  uplinking_to_system: data => {
    majorTomCx.transmitCommandUpdate(data.id, 'uplinking_to_system', data);
  },
  acked_by_system: data => {
    majorTomCx.transmitCommandUpdate(data.id, 'acked_by_system', data);
  },
  executing_on_system: data => {
    majorTomCx.transmitCommandUpdate(data.id, 'executing_on_system', data);
  },
  downlinking_from_system: data => {
    majorTomCx.transmitCommandUpdate(data.id, 'downlinking_from_system', data);

    if (commandHandlers.downlinking_from_system) {
      commandHandlers.downlinking_from_system(data);
    }
  },
  done_on_system: data => {
    // const { id, system } = data;

    eventBus.emit('transition', 'processing_on_gateway', data);
    // triggerCommandFinish(data.system);
  },
  failed_on_system: (data, ...errors) => {
    const errorArgs = errors.length > 1
      ? errors
      : [new Error('Received a failure message from the system')];

    eventBus.emit('failed', data, ...errorArgs);
  },
  processing_on_gateway: data => {
    const { id, type } = data;
    // This next line, and the commented code below, is to allow for custom operations to be done
    // at the gateway layer when a command finishes. We'll bypass it for now.
    // const processerFn = idProcessors[id] || typeProcessors[type || idMap[id].type];
    const processerFn = false;

    majorTomCx.transmitCommandUpdate(id, 'processing_on_gateway', data);

    if (!processerFn) {
      return eventBus.emit('transition', 'complete_on_gateway', data);
    }

    // const makeCb = next => arg => {
    //   let errorArg;

    //   if (arg instanceof Error) {
    //     errorArg = arg;
    //   }

    //   setImmediate(() => eventBus.emit('transition', next, data, errorArg));
    // };

    // const done = makeCb('complete_on_gateway');
    // const failCommand = makeCb('failed');

    // processerFn(data, done, failCommand);
  },
  complete_on_gateway: data => {
    eventBus.emit('transition', 'completed', data);
  },
  cancel_on_gateway: data => {
    const { system } = data;

    commandQueuer.removeFromQueue(system, data);

    if (commandHandlers.cancelled) {
      commandHandlers.cancelled(data);
      setImmediate(() => {
        eventBus.emit('transition', 'cancelled', data);
      });
    } else {
      eventBus.emit('transition', 'cancelled', data);
    }
  },
  cancelled: data => {
    majorTomCx.cancelCommand(data.id);
    triggerCommandFinish(data.system, data.id);
  },
  completed: data => {
    majorTomCx.completeCommand(data.id, data.output);
    triggerCommandFinish(data.system, data.id);
  },
  failed: (data, ...errors) => {
    majorTomCx.failCommand(data.id, errors.map(err => err.toString()));
    triggerCommandFinish(data.system, data.id);
  },
};

const commandCallback = cmd => {
  eventBus.emit('transition', 'received_from_mt', cmd);
};

const cancelCallback = cmd => {
  eventBus.emit('transition', 'cancel_on_gateway', cmd.id);
};

// TODO: Figure out: do we need rate limit callback, transit event callbacks?

const listeners = state => (...args) => {
  if (!userListeners[state] && !defaultListeners[state]) {
    return defaultListeners
      .failed(args[0], new Error(`Gateway did not understand state ${state}`));
  }

  return (
    userListeners[state] &&
    userListeners[state](...args)
  ) || defaultListeners[state](...args);
};

const validateSystemHttp = req => {
  const { headers } = req;
  const hs = (headers || {})['system-handshake'];

  return hs === validHandshake;
};

const validateSystemWs = req => {
  const { url, headers } = req;
  const [systemName, hashTime] = url.split('/').filter(x => x);
  const hashCheck = Buffer.from(`${systemName}${hashTime}`).toString('base64').replace(/=|\//g, '');
  console.log(hashCheck);
  const protocolHeader = Object.keys(headers)
    .find(key => key.toLowerCase() === 'sec-websocket-protocol');
  console.log(headers[protocolHeader]);

  if (
    Date.now() - headers[protocolHeader].replace(validHandshake, '') < 3000
  ) {
    return { ui: true };
  }

  if (headers[protocolHeader].indexOf(hashCheck) === -1) {
    return new Error(`Received a connection request that could not be validated from ${url}`);
  }

  return systemName;
};

const sendToMajorTom = type => obj => {
  const {
    command_definitions = {},
    event,
    events,
    file_list = {},
    measurements = [{}],
  } = obj;
  const argMaps = {
    command_definitions: ['updateCommandDefinitions', command_definitions.system, command_definitions.definitions],
    event: ['transmitEvents', event],
    events: ['transmitEvents', events],
    file_list: ['updateFileList', file_list.system, file_list.files, file_list.timestamp],
    file_metadata_update: ['transmit', obj],
    measurements: ['transmitMetrics', measurements],
  };
  const args = argMaps[type];
  const method = args.shift();

  if (majorTomCx) {
    majorTomCx[method](...args);
  } else {
    pendForMajorTom({ [method]: args });
  }
};

const emitTransition = (state, command) => {
  eventBus.emit('transition', state, command);
};

const handleSystemIncomingMessage = systemIncomingMessageHandler({ emitTransition, sendToMajorTom });

// Get stuff set up for the WebSocket handling

const server = http.createServer(app);
const wss = new WebSocket.Server({ clientTracking: false, noServer: true });

server.on('upgrade', (req, socket, head) => {
  const systemName = validateSystemWs(req);

  // TODO: Handle an invalidated websocket upgrade request

  if (systemName.ui === true) {
    wss.handleUpgrade(req, socket, head, wsCx => {
      wss.emit('uiConnect', wsCx);
    });
  } else {
    wss.handleUpgrade(req, socket, head, wsCx => {
      wss.emit('connection', wsCx, systemName);
    });
  }
});

wss.on('uiConnect', uiCx => {
  addUiConnection(uiCx, handleSystemIncomingMessage);
});

wss.on('connection', (wsCx, systemName) => {
  wsCx.on('message', data => {
    handleSystemIncomingMessage(data, systemName);
  });

  eventBus.emit(SYSTEM_ADDED, systemName, WEBSOCKET, wsCx);
});


// TODO: Update this appropriately for use on a local network situation
app.use(cors({ origin: 'http://localhost:3000' }));

app.use(express.json());
app.use(express.query());

app.post('/add-system', (req, res) => {
  const { systemName } = req.body;
  const handshake = req.headers['system-handshake'];

  eventBus.emit(SYSTEM_ADDED, systemName, HTTP);

  const inbound = req.body[systemName] || [];
  const inboundArray = (Array.isArray(inbound) && inbound) || [inbound];
  const messages = emptySystemCommandQ(systemName);

  inboundArray.forEach(msg => {
    handleSystemIncomingMessage(msg, systemName);
  });

  messages.forEach(command => {
    eventBus.emit('transition', 'uplinking_to_system', command);
  });

  res.json({ messages });
});

app.post('/add-system-usb', (req, res) => {
  const {
    system: {
      name, portPath, baudRate = 9600, parser, byteLength, delimiter, interval, regex,
    }
  } = req.body;
  // TODO: Handle invalid args as needed
  const usbCx = new SerialPort(portPath, { baudRate });

  systemCxs[name] = { send: data => { usbCx.write(data); } }

  if (parser && SerialPort.parsers[parser]) {
    const parsedOutput = new SerialPort.parsers[parser]({ byteLength, delimiter, interval, regex });

    usbCx.pipe(parsedOutput);
    parsedOutput.on('data', data => {
      const asStr = data.toString();
      const asObj = JSON.parse(asStr);

      // TODO: This handling is explicitly opinionated based on my current Arduino test system. I
      // need to figure out a good happy medium where the serial messaging can be parsed in a
      // meaningful but configurable way.
      if (!asObj.type) {
        const typeMaps = { metric: 'measurements', message: 'events', state: 'command_update' };
        const type = typeMaps[['metric', 'message', 'state'].find(prop => !!asObj[prop])];

        if (type === 'measurements' || type === 'event') {
          handleSystemIncomingMessage({ type, [type]: [{ ...asObj, system: name }]}, name);
        } else if (type === 'command_update') {
          handleSystemIncomingMessage({ type, command: { ...asObj, system: name } }, name);
        }
      } else {
        handleSystemIncomingMessage(data, name);
      }
    });
  } else {
    usbCx.on('data', data => {
      handleSystemIncomingMessage(data, name);
    });
  }

  commandQs[name] = orphanedCommands[name] || [];
  setSystemFree(name);

  if (commandQs[name].length > 0) {
    eventBus.emit(SEND_NEXT_IF_ABLE, name);
  }

  eventBus.emit('systemAdded', name, 'usb');

  res.sendStatus(200);
});

app.post('/upload-file-to-mt', (req, res) => {

});

app.get('/system/:systemName/', (req, res) => {
  const { systemName } = req.params;

  if (!validateSystemHttp(req)) {
    return res.sendStatus(403);
  }

  const inbound = req.body[systemName] || [];
  const inboundArray = (Array.isArray(inbound) && inbound) || [inbound];
  const messages = emptySystemCommandQ(systemName);

  inboundArray.forEach(msg => {
    handleSystemIncomingMessage(msg, systemName);
  });

  messages.forEach(command => {
    eventBus.emit('transition', 'uplinking_to_system', command);
  });

  res.json({ messages });
});

app.get('/connect', (req, res) => {
  const { host, sslVerify, basicAuth, http, sslCaBundle, verbose } = req.query;
  const gatewayToken = req.headers['x-gateway-token'];
  const gotNewToken = gatewayToken !== savedToken;

  if (host && gatewayToken) {
    savedToken = gatewayToken;

    if (!majorTomCx || gotNewToken) {
      majorTomCx = newNodeGateway({
        host,
        gatewayToken,
        sslVerify,
        basicAuth,
        http,
        sslCaBundle,
        verbose,
        commandCallback,
        cancelCallback,
      })

      majorTomCx.connect();

      unloadForMajorTom().forEach(waiting => {
        const [[method, args]] = Object.entries(waiting);

        majorTomCx[method](...args);
      });
    }

    res.sendStatus(200);
  } else {
    res.sendStatus(403);
  }
});

server.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
});
