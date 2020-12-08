const { Transform } = require('stream');
const udpPacket = require('udp-packet');

class UDPParser extends Transform {
  constructor() {
    this.dataBuffer = Buffer.alloc(0);
    this.packetLength = 0;
  }

  understandNextPacket(chunk) {
    const { data, length } = udpPacket.decode(chunk);
    const currentData = Buffer.from(data.slice(0, length));
    const overflowData = Buffer.from(data.slice(length));

    if (currentData.length === length) {
      this.packetLength = 0;
      this.push(currentData);
    } else {
      this.packetLength = length;
      this.dataBuffer = currentData;
    }

    if (overflowData.length > 0) {
      this.understandNextPacket(overflowData);
    }
  }

  _transform(chunk, encoding, cb) {
    if (this.packetLength > 0) {
      this.understandNextPacket(chunk)
    } else {
      const allWeHave = Buffer.concat([this.dataBuffer, chunk]);
      const currentData = Buffer.from(allWeHave.slice(0, this.packetLength));
      const overflowData = Buffer.from(allWeHave.slice(this.packetLength));

      if (currentData.length === this.packetLength) {
        this.packetLength = 0;
        this.push(currentData);
      } else {
        this.dataBuffer = currentData;
      }

      if (overflowData.length) {
        this.understandNextPacket(overflowData);
      }
    }

    cb();
  }
}

module.exports = UDPParser;
