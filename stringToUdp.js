const { Transform } = require('stream');

const udpPacket = require('udp-packet');

class StringToUdp extends Transform {
  constructor(opts = {}) {
    const { sourceIp, sourcePort, destinationIp, destinationPort } = opts;

    this.sourceIp = sourceIp;
    this.sourcePort = sourcePort;
    this.destinationIp = destinationIp;
    this.destinationPort = destinationPort;

    ['sourceIp', 'sourcePort', 'destinationIp', 'destinationPort'].forEach(prop => {
      if (!this[prop]) {
        throw new Error(`Configuration option ${prop} is required to instantiate StringToUdp stream`);
      }
    });
  }

  _transform(chunk, encoding, cb) {
    const data = chunk instanceof Buffer ? chunk.toString() : chunk;
    const isValidString = typeof data === 'string' || data instanceof String;
    const { sourceIp, sourcePort, destinationIp, destinationPort } = this;

    if (!isValidString) {
      throw new Error('StringToUdp.write called with invalid data type; you must write a String or a Buffer');
    }

    const udpBuffer = udpPacket.encode({
      sourceIp, sourcePort, destinationIp, destinationPort, data,
    });

    this.push(udpBuffer);
    cb();
  }
}

module.exports = StringToUdp;
