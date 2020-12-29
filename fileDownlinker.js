const EventEmitter = require('events');
const fs = require('fs');
const { Writable } = require('stream');

const Blake2s = require('blake2s-js');
const cbor = require('cbor-sync');
const uniqid = require('uniqid');

const {
  TRANSMITTED_TO_SYSTEM,
  ACKED_BY_SYSTEM,
  DOWNLINKING_FROM_SYSTEM,
  PROCESSING_ON_GATEWAY,
} = require('./constants');

const SILENCE_TIME = 2000;
const DOWNLINKER_STATE_CHANGE = 'downlinker_state_change';

const AWAITING_METADATA = 0;
const SEND_FIRST_NACK = 1;
const RECEIVING_CHUNKS = 2;
const RECONCILING = 3;
const CHUNKS_COMPLETE = 4;

class FileReceiver extends Writable {
  constructor({ channel, hash, len, storagePath = '/fileStore/store' }) {
    super();
    this.channel = channel;
    this.hash = hash;
    this.len = len;
    this.store = {};
    this.nextExpected = 0;
    this.hasher = new Blake2s(16);

    this.tempFile = fs.createWriteStream(path.join(storagePath, uniqid()));
  }

  calculateMissingChunks() {
    const missingPairs = [];
    let i = 1;
    let infill = !!this.store[0];

    if (!infill) {
      missingPairs.push(0);
    }

    for (i; i < this.len; i += 1) {
      if (!!this.store[i] !== infill) {
        missingPairs.push(i);
        infill = !infill;
      }
    }

    if (!this.store[i - 1]) {
      missingPairs.push(this.len);
    }

    this.emit('missing_chunks', missingPairs);
  }

  updateFileAndHash(data) {
    this.tempFile.write(data);
    this.hasher.update(data);
    this.store[this.nextExpected] = true;
    this.nextExpected += 1;

    if (this.nextExpected === this.len) {
      this.tempFile.end();
      this.emit('done');
      this._destroy();
    } else {
      this.calculateMissingChunks();
    }
  }

  _write(chunk, encoding, next) {
    const received = cbor.decode(chunk);

    if (!Array.isArray(received)) return next();

    const [id, hash, index, data] = received;

    if (!(hash === this.hash && id === this.channel)) return next();

    if (index === this.nextExpected) {
      this.updateFileAndHash(data);

      while (this.store[this.nextExpected] instanceof Buffer) {
        this.updateFileAndHash(this.store[this.nextExpected]);
      }
    } else {
      this.store[index] = data;
    }

    next();
  }
}

const fileDownlinker = ({ id, filename, outbound, inbound, storagePath }) => {
  const scheduler = new EventEmitter();
  const externalEmitter = new EventEmitter();
  let phase = AWAITING_METADATA;
  let missingChunks = [];
  let downlinkReceiver;
  let nackTimer;

  const createDownlinkerFromCorrectMetadata = data => {
    if (!Array.isArray(data)) {
      return false;
    }

    const [recId, isTrue, hash, len, mode] = data;

    if (recId === id && isTrue === true) {
      downlinkReceiver = new FileReceiver({ channel: id, hash, len, storagePath });
    }

    return !!downlinkReceiver;
  };

  const prepareToReceive = () => {
    downlinkReceiver.on('missing_chunks', missing => {
      missingChunks = missing;
    });

    downlinkReceiver.on('file_received', fileStoragePath => {
      scheduler.emit('next_phase', CHUNKS_COMPLETE, fileStoragePath);
    });
  };

  const receiveChunk = data => {
    downlinkReceiver && downlinkReceiver.write(data);

    clearTimeout(nackTimer);
    nackTimer = setTimeout(() => {
      sendCurrentDownlinkState();
    }, SILENCE_TIME);
  };

  const sendCurrentDownlinkState = () => {
    scheduler.emit('next_phase', missingChunks.length < 2 ? CHUNKS_COMPLETE : RECONCILING);
  };

  inbound.on('data', data => {
    switch (phase) {
      case AWAITING_METADATA:
        if (createDownlinkerFromCorrectMetadata(data)) {
          prepareToReceive();
          scheduler.emit('next_phase', SEND_FIRST_NACK);
        }
        break;
      case SEND_FIRST_NACK:
      case RECEIVING_CHUNKS:
        externalEmitter.emit(DOWNLINKER_STATE_CHANGE, DOWNLINKING_FROM_SYSTEM);
        receiveChunk(data);
        break;
      default:
        break;
    }
  });

  scheduler.on('next_phase', (nextPhase, info) => {
    phase = nextPhase;

    switch (phase) {
      case SEND_FIRST_NACK:
        externalEmitter.emit(DOWNLINKER_STATE_CHANGE, ACKED_BY_SYSTEM);
        outbound.write(cbor.encode([id, expectedHash, false, 0, expectedChunks]));
        break;
      case RECONCILING:
        outbound.write(cbor.encode([id, hash, false, ...missingChunks]));
        break;
      case CHUNKS_COMPLETE:
        outbound.write(cbor.encode([id, hash, true]));
        externalEmitter.emit(DOWNLINKER_STATE_CHANGE, PROCESSING_ON_GATEWAY, info);
        break;
      default:
        break;
    }
  });

  outbound.write([id, 'import', filename]);
  externalEmitter.emit(DOWNLINKER_STATE_CHANGE, TRANSMITTED_TO_SYSTEM);

  return externalEmitter;
};

module.exports = {
  DOWNLINKER_STATE_CHANGE,
  fileDownlinker,
};
