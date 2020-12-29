const dgram = require('dgram');
const EventEmitter = require('events');
const { PassThrough, Transform, Writable } = require('stream');

const cors = require('cors');
const express = require('express');
const SerialPort = require("serialport");
const udpPacket = require('udp-packet');

const {
  newStringToSpacePacket,
  newStringToUDPToSpacePacket,
  newStringToUdp,
} = require('./spacePacketFramers');
const { KISSSender } = require('./kissTncParser');

class HttpDestination extends Writable {
  constructor(opts = {}) {
    const { isJson } = opts;

    super({ objectMode: !!isJson });

    this.store = isJson ? [] : Buffer.alloc(0);
  }

  resetStore() {
    this.store = this.writableObjectMode ? [] : Buffer.alloc(0);
  }

  _write(chunk, enc, next) {
    if (this.writableObjectMode) {
      this.store.push(chunk);
    } else {
      const toStore = chunk instanceof Buffer ? chunk : Buffer.from(chunk);

      this.store = Buffer.concat([this.store, toStore]);
    }

    next();
  }

  unload() {
    const ret = this.writableObjectMode ? [...this.store] : Buffer.from(this.store);

    this.resetStore();

    return ret;
  }
}

class UdpSender extends Writable {
  constructor(socketObj) {
    super();
    const { socket, connected, offset, maxLength, port, ip } = socketObj;
    this.socket = socket;
    this.connected = !!connected;
    this.offset = offset || 0;
    this.maxLength = maxLength;
    this.port = port;
    this.ip = ip;
  }

  _write(chunk, encoding, next) {
    if (this.connected) {
      const sendArgs = [chunk, this.port, this.ip];

      if (this.offset || this.maxLength) {
        sendArgs.splice(1, 0, this.offset, this.maxLength || chunk.length);
      }

      this.socket.send(...sendArgs);
    } else {
      const { destinationPort, destination, data } = udpPacket.decode(chunk);
      const sendArgs = [data, destinationPort, destination];

      if (this.offset || this.maxLength) {
        sendArgs.splice(1, 0, this.offset, this.maxLength || data.length);
      }

      this.socket.send(...sendArgs);
    }

    next();
  }
}

const parserMap = {
  string_to_spacepacket: newStringToSpacePacket,
  udp_to_spacepacket: newStringToUDPToSpacePacket,
  kiss_tnc: configs => new KISSSender(configs),
};

const getUdpAddressInfo = serviceStr => {
  if (!serviceStr) return;

  let [address, port] = `${serviceStr}`.split(':');

  if (!port) {
    port = address;
  }

  return { address, port };
};

const createServiceChain = (serviceNames, serviceConfigs, destination) => {
  if (serviceNames === null) {
    return null;
  }

  const start = parserMap[serviceNames[0]](serviceConfigs[0] || {});
  let lastPipe = start;
  let i = 1;

  while (i < serviceNames.length) {
    const nextStream = parserMap[serviceNames[i]](serviceConfigs[i] || {});

    lastPipe = lastPipe.pipe(nextStream);
    i += 1;
  }

  lastPipe.pipe(destination);

  return start;
};

const createInboundChain = (receivers, configs, destination) => {
  if (receivers === null) {
    return null;
  }

  if (receivers.length === 0) {
    return destination;
  }

  const firstStream = parserMap[receivers[0]](configs[0] || {});
  let lastPipe = destination.pipe(firstStream);
  let i = 1;

  while (i < receivers.length) {
    const nextStream = parserMap[receivers[i]](configs[i] || {});

    lastPipe = lastPipe.pipe(nextStream);
    i += 1;
  }

  return lastPipe;
};

const buildServices = ({ done, serviceConfig }) => {
  const receiver = new EventEmitter();
  const {
    file = {},
    presets = {},
    channel_id,
    http_listen_port,
    https_listen_port,
    udp_send_port,
    udp_version,
    ...services
  } = serviceConfig;
  const fileIntakes = {};
  const activeFileIntakes = {};
  const serviceMap = {};
  const cancelStrings = {};
  const udpFilters = {};
  const udpSocket = udp_send_port
    ? { bindPort: udp_send_port, socket: dgram.createSocket({ type: udp_version }) }
    : false;
  const udpSockets = udpSocket ? [udpSocket] : [];
  const httpApp = http_listen_port && express();
  const httpsApp = https_listen_port && express();

  if (httpApp) { httpApp.use(express.json()); }
  if (httpsApp) { httpsApp.use(express.json()); };

  const getCancelStringForService = serviceName => {
    const serviceCancel = cancelStrings[serviceName];

    if (typeof serviceCancel === 'string') {
      return serviceCancel;
    }

    if (Array.isArray(serviceCancel)) {
      return serviceCancel.map(char => {
        if (typeof char === 'string') {
          return ['${id', '${system}'].includes(char.toLowerCase()) ? char : parseInt(char, 16);
        }

        return char;
      });
    }

    return JSON.stringify(serviceCancel);
  };

  const getMatchingUdpStream = ({ address, port }) => {
    return udpFilters[address] || udpFilters[`${address}_${port}`];
  };

  Object.keys(file).forEach(fileServiceKey => {
    const enhancedKey = `file.${fileServiceKey}`;

    file[enhancedKey] = { ...file[fileServiceKey] };

    delete file[fileServiceKey];
  });

  console.log({ ...services, ...file });

  Object.entries({ ...file, ...services}).forEach(([serviceName, configObj]) => {
    const {
      mode,
      baud_rate,
      accept_content,
      cors_origin,
      message_name,
      method,
      rinfo,
      udp_send_port,
      offset,
      max_length,
      udp_version: config_udp_version,
      channel_id: file_channel_id,
      blocking,
      shared,
      service_destination,
      service_chain,
      service_configs,
      receive_chain,
      receive_configs,
      cancel_string,
    } = configObj;

    const mappedConfigs = (service_configs || []).map(configName => (presets[configName] || configName));

    cancelStrings[serviceName] = cancel_string;

    if (serviceName.startsWith('file.')) {
      if (!file_channel_id || channel_id) {
        throw new Error('Creating a file service requires a channel_id');
      }

      fileIntakes[serviceName] = {
        inbound: new PassThrough(),
        blocking,
        shared,
        channel_id: file_channel_id || channel_id,
      };

      if (!(shared && blocking)) {
        activeFileIntakes[serviceName] = true;
      }

      if (shared) {
        serviceMap[serviceName] = shared;
        return;
      }
    }

    switch (mode) {
      case 'USB': {
        const destination = new SerialPort(service_destination, { baudRate: baud_rate });
        const receiveStream = createInboundChain(receive_chain, receive_configs, destination);

        serviceMap[service_name] = createServiceChain(service_chain, mappedConfigs, destination);

        if (receiveStream) {
          receiveStream.on('data', data => {
            receiver.emit('data', serviceName, data);
          });
        }

        break;
      }
      case 'HTTP':
      case 'HTTPS': {
        const isJson = accept_content === 'application/json';
        const destination = new HttpDestination({ isJson });
        const httpReceiver = new PassThrough({ objectMode: true });
        const receiveStream = createInboundChain(receive_chain, receive_configs, httpReceiver);
        const app = mode === 'HTTP' ? httpApp : httpsApp;
        const routeHandler = (req, res) => {
          const messages = req.body[message_name || 'messages'] || [];

          messages.forEach(message => {
            httpReceiver.write(message);
          });

          if (accept_content) {
            res.set('Content', accept_content);
          }

          res[isJson ? 'json' : 'send'](serviceMap[service_name].unload());
        };
        const methodArgs = [service_destination, routeHandler];

        if (cors_origin) {
          methodArgs.splice(1, 0, (req, next) => {
            next(null, cors({ origin: req.header('Origin') === cors_origin }));
          });
        }

        if (receiveStream) {
          receiveStream.on('data', data => {
            receiver.emit('data', serviceName, data);
          });
        }

        serviceMap[serviceName] = createServiceChain(service_chain, mappedConfigs, destination);

        app[method.toLowerCase()](...methodArgs);
        break;
      }
      case 'UDP': {
        const foundSocket = udpSockets.find(({ port }) => port === udp_send_port);
        const newSocket = udp_send_port && !foundSocket
          ? {
              port: udp_send_port,
              socket: dgram.createSocket({ type: config_udp_version || udp_version }),
              maxLength: max_length,
              offset,
            }
          : null;
        const workingSocket = foundSocket || newSocket || udpSockets[0];
        const connect = getUdpAddressInfo(service_destination)

        if (connect && !workingSocket.connected) {
          workingSocket.port = connect.port;
          workingSocket.ip = connect.address;
          workingSocket.connected = true;
        } else {
          throw new Error(`Attempted to connect UDP service ${service_name} to a socket that has already been connected`);
        }

        const destination = new UdpSender(workingSocket);

        if (newSocket) {
          udpSockets.push(workingSocket)
        }

        (rinfo || []).forEach(rinfoConfig => {
          if (connect) {
            throw new Error(`Error creating UDP service ${service_name}; cannot specify both connect and rinfo properties`);
          }

          const { ports, port, ip } = rinfoConfig;

          if (!ports && !port) {
            const p = new PassThrough();
            const inbound = createInboundChain(receive_chain, receive_configs, p);

            udpFilters[port === '*' || !port ? ip : `${ip}_${port}`] = p;
            inbound.on('data', data => {
              receiver.emit('data', serviceName, data);
            });
          } else {
            ports.forEach(portNumber => {
              const q = new PassThrough();
              const inbound = createInboundChain(receive_chain, receive_configs, q);

              udpFilters[`${ip}_${portNumber}`] = q;
              inbound.on('data', data => {
                receiver.emit('data', serviceName, data);
              });
            });
          }
        });

        if (connect) {
          const p = new PassThrough();
          const inbound = createInboundChain(receive_chain, receive_configs, p);

          udpFilters[`${connect.address || 'localhost'}_${connect.port}`] = p;
          inbound.on('data', data => {
            receiver.emit('data', serviceName, data);
          });
        }

        serviceMap[serviceName] = createServiceChain(service_chain, service_configs, destination);
        break;
      }
      default:
        throw new Error(`Did not recognize mode ${mode} for service ${serviceName} in serviceConf.json`);
    }
  });

  const getFileService = serviceName => {
    const fileServiceName = serviceName.startsWith('file.') ? serviceName : `file.${serviceName}`;
    const service = serviceMap[fileServiceName];
    const outbound = typeof service === 'string' ? serviceMap[service] : service;
    const { inbound, blocking, shared } = fileIntakes[fileServiceName];

    if (blocking && shared) {
      activeFileIntakes[fileServiceName] = true;
    }

    return { inbound, outbound, blocking };
  };

  const unblock = serviceName => {
    const fileServiceName = serviceName.startsWith('file.') ? serviceName : `file.${serviceName}`;
    const { blocking, shared } = fileIntakes[fileServiceName] || {};

    if (blocking && shared) {
      activeFileIntakes[fileServiceName] = false;
    }
  }

  const cancel = ({ id, system, service }) => {
    const cancelString = getCancelStringForService(servcice)
      .replace(
        /\$\{id\}|\$\{system\}/gi,
        match => (match.toLowerCase() === '${id}' ? `${id}` : system)
      );

    serviceMap[service].write(cancelString);
  };

  const handleIncomingMessage = (serviceName, data) => {
    const { blocking, shared } = fileIntakes[serviceName] || {};

    if (activeFileIntakes[serviceName]) {
      fileIntakes[serviceName].inbound.write(data);

      // This is the case where a file service is sharing a connection endpoint with regular, non-file
      // messaging AND the file service hasn't been marked as blocking.
      if (shared && !blocking) {
        done(data);
      }
    } else {
      done(data);
    }
  };

  receiver.on('data', handleIncomingMessage);

  udpSockets.forEach(({ socket, bindPort }) => {
    socket.bind(bindPort);
    socket.on('message', (message, rinfo) => {
      getMatchingUdpStream(rinfo).write(message);
    });
  });

  return {
    ...serviceMap,
    cancel,
    getFileService,
    unblock,
  };
};

module.exports = buildServices;
