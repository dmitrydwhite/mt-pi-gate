const dgram = require('dgram');
const SerialPort = require('serialport');
const SpacePacketParser = require('@serialport/parser-spacepacket');
const { Writable } = require('stream');
const { Emitter } = require('events');

const spParser = new SpacePacketParser();

/**
 * Builds the pathways for this gateway based off the provided config.
 * @param {Object} param0 The needed config and callback
 * @param {Function} param0.done The function to call when inbound data is received over the pathways
 * @param {Object} param0.pathwayConfig The object representation of the pathway configuration file
 * @returns {PathwayDirectory}
 */
const buildPathways = ({ done, pathwayConfig }) => {
  const { udp, usb } = pathwayConfig;
  const udpSendPorts = {};
  const usbSerialLocations = [];
  const pathways = {};

  Object.entries(udp).forEach(([pathwayName, pathwayConf]) => {
    if (pathways[pathwayName]) {
      throw new Error(`Cannot create duplicate pathway ${pathwayName}`);
    }

    const { mode } = pathwayConf;

    switch (mode) {
      case 'UDP': {
        const { udp_version, export_port, import_port, import_ip } = pathwayConf;
        const socketData = udpSendPorts[export_port];

        if (socketData.udp_version && socketData.udp_version !== udp_version) {
          throw new Error(`Cannot open ${pathwayName} on port ${export_port} using version ${udp_version} because another pathway is using a different version on the same port.`);
        }

        socketData.udp_version = udp_version;
        socketData[pathwayName] = {
          listen_ip: import_ip,
          listen_port: import_port,
        };
        break;
      }
      case "USB": {
        const { baud_rate, serial_location } = pathwayConf;
        const spacePacketTransform = new SpacePacketBuilder();

        if (usbSerialLocations.includes(serial_location)) {
          throw new Error(`Cannot open a serial connection for ${pathwayName} at ${serial_location} because another pathway has already opened a connection there.`);
        }

        // Keep track of the usb destinations we've already connected
        usbSerialLocations.push(serial_location);

        // We want the app to write messages to a stream that converts JSON into space packets
        pathways[pathwayName] = spacePacketTransform;
        // That stream then pipes the prepared space packets on to the serial connection
        spacePacketTransform.pipe(new SerialPort(serial_location, { baudRate: baud_rate }));
        // All data received from the serial connection will be converted into a space packet
        pathways[pathwayName].pipe(spParser);
        break;
      }
      default:
        throw new Error(`Cannot create pathway ${pathwayName} because received mode "${mode}" is unrecognized or invalid.`);
    }
  });

  // Now our pathways object contains an entry for USB, but not for UDP.
  // We need to de-duplicate the UDP ports
  Object.entries(udpSendPorts).forEach(([port, pathways]) => {
    const spacePacketTransform = new SpacePacketBuilder();
    const { udp_version, ...rest } = pathways;
    const socket = dgram.createSocket(udp_version);

    socket.bind(port);
    spacePacketTransform.on('data', data => {
      this.socket.send(data);
    });


  });

  return {
    buildPathways,
  };
};

const buildUdpPathways = config => {
  const { common_listen_port, common_send_port, udp_version = 'v4', ...pathwayObjs } = config;

  
};

class UdpPathway extends Writable {
  constructor(config) {
    const {
      remote_port,
      remote_ip,
      offset,
      max_length,
      udp_version = 'udp4',
    } = config;
    const socket = dgram.createSocket(udp_version);

    super();

    this.offset = offset || 0;
    this.maxLength = max_length || 0;
    this.socket = socket;

    this.destinationArgs = [remote_port, remote_ip];
    this.multiSendCount = 0;
  }

  _write(chunk, encoding, next) {
    this.send(chunk, next);
  }

  send(buf, cb) {
    const sendArgs = [buf, ...this.destinationArgs];

    if (this.offset || this.maxLength) {
      sendArgs.splice(1, 0, this.offset, this.maxLength || buf.length);
    }

    return this.socket.send(sendArgs, err => {
      if (cb) {
        cb(err);
      } else {
        this.emit('error', err);
      }
    });
  }

  isFor(rinfo) {
    if (!rinfo) { return false; }

    const { address, port } = rinfo;

    if (Number(port) !== Number(this.remote_port)) { return false; }

    if (['127.0.0.1', '0.0.0.0', 'localhost'].includes(address)) {
      return !this.remote_address || this.remote_address === address;
    }

    return this.remote_address === address;
  }
}

const UdpGroup = config => {
  const { listen_port, udp_version = 'udp4' } = config;
  const internalW = new Writable();
  const emitter = new Emitter();

  const socket = dgram.createSocket(udp_version)

  // Service and event maps
  const onCbs = {};
  const pathways = {};

  // Internal methods
  
  const createPathway = config => {
    if (typeof config !== 'object' || !config.remote_address) {
      throw 'Pathway must be added using an object with remote_address property';
    }

    const { remote_address, remote_port } = config;
    const remote_port_value = !remote_port || remote_port === '*' ? '' : remote_port;
    const remote_id = `${remote_address}${remote_port_value ? `_${remote_port_value}` : ''}`;
    const pathwayStream = new PassThrough();
    const textDestination = `remote address ${remote_address}${remote_port_value ? ` and remote port ${remote_port_value}` : ''}`;

    emitter.emit(
      'info',
      `Creating a pathway listening for messages from ${textDestination}`
    );

    if (!pathways[remote_id]) {
      pathways[remote_id] = [pathwayStream];
    } else {
      emitter.emit('warning', `There are multiple pathways listening for messages from ${textDestination}`);
      pathways[remote_id].push(pathwayStream);
    }

    return pathwayStream;
  };
  
  const getPathwayFor = rinfo => {

  };

  const handleIncomingMessage = (data, rinfo) => {
    getPathwayFor(rinfo).write(data);
  };

  // Exposed methods
  
  /**
   * Attach callbacks to events emitted by UdpGroup.
   * @param  {String} eventName The name of the event to listen for
   * @param  {Function} cb The function to run when the event is heard
   * @return {Boolean} True if the listener was successfully attached, false if not
   */
  const on = (eventName, cb) => {
    if (typeof cb !== 'function') {
      emitter.emit('error', new Error('Must add a function as a callback to event listeners.'));

      return false;
    }

    if (typeof eventName !== 'string') {
      emitter.emit('error', new Error('Must provide a string event name to listen for'));

      return false;
    }

    const existing = onCbs[eventName];

    if (!existing) {
      onCbs[eventName] = cb;
    } else if (typeof existing === 'function') {
      onCbs[eventName] = [existing, cb]
    } else {
      existing.push(cb);
    }

    return true;
  };

  const addPathway = config => {
    try {
      emitter.emit('pathway', ...createPathway(config));
    } catch (err) {
      emitter.emit('error', err);
    }
  };

  // Internal configuration code
  socket.bind(listen_port);
  socket.on('message', handleIncomingMessage);

  return {
    addPathway,
    on,
    send,
  };
}