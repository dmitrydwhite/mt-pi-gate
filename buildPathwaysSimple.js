const dgram = require('dgram');
const SerialPort = require('serialport');
const SpacePacketParser = require('@serialport/parser-spacepacket');
const { Writable } = require('stream');

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