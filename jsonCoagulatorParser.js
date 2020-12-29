const { Transform } = require('stream');
const BUFFER = 'BUFFER';
const STRING = 'STRING';
const OBJECT = 'OBJECT';

class JSONCoagulator extends Transform {
  constructor(options = {}) {
    super({ readableObjectMode: true });
    const outputType = (options.output || '').toUpperCase();

    switch (outputType) {
      case OBJECT:
        this.outputType = OBJECT;
        break;
      case STRING:
        this.outputType = STRING;
        break;
      default:
        this.outputType = BUFFER;
        break;
    }

    this.dataField = options.dataField || 'data';

    this.workingString = '';
  }

  _transform(chunk, encoding, cb) {
    const received = `${chunk[this.dataField] || ''}`;

    this.workingString += received;

    try {
      const output = JSON.parse(`${this.workingString}${received}`);

      if (this.outputType === OBJECT) {
        this.push(output);
      } else if (this.outputType === STRING) {
        this.push(this.workingString);
      } else {
        this.push(Buffer.from(this.workingString));
      }

      this.workingString = '';

      cb();
    } catch (ignore) {
      cb();
    }
  }

  _flush(cb) {
    if (this.outputType === BUFFER) {
      this.push(Buffer.from(this.workingString));
    } else {
      this.push(this.workingString);
    }

    cb();
  }
}

module.exports = JSONCoagulator;
