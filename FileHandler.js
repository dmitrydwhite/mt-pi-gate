const { EventEmitter } = require('events');
const fs = require('fs');
const { Transform } = require('stream');

const { TEMP_FILE_PATH } = require('./constants');
const CHUNK_RECEIVED = 'chunk_received';
const CHUNKS_MISSING = 'file_chunks_missing';
const FILE_COMPLETE = 'file_receive_complete';
const FINISH_CALLED = 'file_done';

class FileChunker extends Transform {
  constructor() {
    super({ objectMode: true });
    this.bagOfHolding = {};
    this.expectingSeq = 0;
  }

  _transform(received, encoding, cb) {
    const { chunk } = received;
    let { sequence } = received;

    if (sequence === this.expectingSeq) {
      this.bagOfHolding[sequence] = true;
      this.push(chunk);
      sequence += 1;

      while (this.bagOfHolding[sequence] && this.bagOfHolding[sequence] instanceof Buffer) {
        this.push(this.bagOfHolding[sequence]);
        this.bagOfHolding[sequence] = true;
        sequence += 1;
      }

      this.expectingSeq = sequence;
    } else {
      this.bagOfHolding[sequence] = chunk;
    }

    cb();
  }

  _flush(cb) {
    const remaining = Object.keys(this.bagOfHolding);

    if (remaining.length === 0) {
      this.emit(FILE_COMPLETE);
    } else {
      const holes = [];
      const workingChunk = Math.max(...remaining) - 1;

      for (let i = workingChunk; i >= 0; i--) {
        if (!this.bagOfHolding[i] || this.bagOfHolding[workingChunk] === true) {
          holes.push(i);
        }
      }

      this.emit(CHUNKS_MISSING, holes);
    }

    cb();
  }
}

const fileReceiver = (system, fileName) => {
  const sequencer = new EventEmitter();
  const fileLocation = path.join(TEMP_FILE_PATH, system, fileName);
  const systemLocation = path.join(TEMP_FILE_PATH, system);
  const chunker = new FileChunker();
  let isDone;
  let onDoneCb;

  if (!fs.existsSync(systemLocation)) {
    fs.mkdirSync(systemLocation);
  }

  const destination = fs.createWriteStream(fileLocation);

  chunker.pipe(destination);

  sequencer.on(CHUNK_RECEIVED, chunk => {
    chunker.write(chunk);
  });

  sequencer.on(FINISH_CALLED, () => {
    chunker.end();
  });

  chunker.on(CHUNKS_MISSING, missing => {
    isDone = [missing];

    if (onDoneCb) {
      onDoneCb(...isDone);
    }
  });

  chunker.on(FILE_COMPLETE, () => {
    isDone = [null, fileLocation];

    if (onDoneCb) {
      onDoneCb(...isDone);
    }
  });

  const writeChunk = chunk => {
    sequencer.emit(CHUNK_RECEIVED, chunk);
  };

  const finishFile = () => {
    sequencer.emit(FINISH_CALLED);
  };

  const onFinish = cb => {
    if (typeof cb === 'function') {
      onDoneCb = cb;

      if (isDone) {
        onDoneCb(...isDone);
      }
    }
  };

  return {
    writeChunk,
    finishFile,
    onFinish,
  };
};

const newFileHandler = () => {
  const working = {};

  const start = (system, fileName) => {
    working[`${system}_${fileName}`] = fileReceiver(system, fileName);
  };

  const writeChunk = (system, fileName, chunkObj) => {
    const target = `${system}_${fileName}`;

    if (!working[target]) {
      working[target] = fileReceiver(system, fileName);
    }

    working[target].writeChunk(chunkObj);
  };

  const finish = (system, fileName) => {
    const target = `${system}_${fileName}`;

    if (working[target]) {
      working[target].finishFile();
    }
  };

  const onDone = (system, fileName) => cb => {
    const target = `${system}_${fileName}`;

    if (!working[target]) {
      working[target] = fileReceiver(system, fileName);
    }

    working[target].onFinish(cb);
    delete working[target];
  };

  return {
    start,
    writeChunk,
    finish,
    onDone,
  }
}

module.exports = newFileHandler;
