const { Transform } = require('stream');

const udpPacket = require('udp-packet');

const spCreator = require('./spacePacketManager')();

class StringToUdp extends Transform {
  constructor(config) {
    const { destinationIp, destinationPort, sourceIp, sourcePort } = config;

    super();
    this.destinationIp = destinationIp;
    this.destinationPort = destinationPort;
    this.sourceIp = sourceIp;
    this.sourcePort = sourcePort;

    ['destinationIp', 'destinationPort', 'sourceIp', 'sourcePort'].forEach(prop => {
      if (!this[prop]) {
        throw new Error(`Config property ${prop} is required for building UDP packet`);
      }
    });
  }

  _transform(data, _, next) {
    const udp = udpPacket.encode({
      sourceIp: this.sourceIp,
      sourcePort: this.sourcePort,
      destinationIp: this.destinationIp,
      destinationPort: this.destinationPort,
      data,
    });

    this.push(udp);
    next();
  }
}


class StringToSpacePacket extends Transform {
  constructor(opts = {}) {
    super();
    this.spacePacketCreator = opts.creator;
    this.apid = opts.apid;

    if (!this.spacePacketCreator) {
      throw new Error('Config property creator is required to be an object with a create function to build stateful and sequential space packets');
    }
  }

  _transform(chunk, _, next) {
    // We're going to operate on the assumption that we won't be working with a string that is
    // larger than buffer.constants.MAX_LENGTH (1,073,741,823 on RaspberryPi 4).
    const spacePackets = this.spacePacketCreator.create({ apid: this.apid }, chunk);

    spacePackets.forEach(packet => {
      this.push(packet);
    });

    next();
  }
}


const newStringToUDPToSpacePacket = configs => {
  const str2udp = new StringToUdp(configs);
  const udp2sp = new StringToSpacePacket({ creator: spCreator, ...configs });
  const piped = str2udp.pipe(udp2sp);

  class Surface extends Transform {
    constructor() {
      super();
      piped.on('data', data => {
        this.push(data);
      });
    }

    _transform(chunk, _, next) {
      str2udp.write(chunk);
      next();
    }
  }

  return new Surface();
};

const newStringToSpacePacket = configs => {
  return new StringToSpacePacket({ creator: spCreator, ...configs });
};

const newStringToUdp = configs => new StringToUdp(configs);

module.exports = {
  newStringToUDPToSpacePacket,
  newStringToSpacePacket,
  newStringToUdp,
};
