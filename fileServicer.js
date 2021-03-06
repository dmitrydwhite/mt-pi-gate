const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');

const cbor = require('cbor-x');

const { UPLINKING_TO_SYSTEM, TRANSMITTED_TO_SYSTEM, COMPLETED } = require('./constants');
const removeDir = require('./removeDir');

const AWAITING_FIRST_NACK = 0;
const SENDING = 1;
const WAITING_ACK = 2;
const RESOLVING = 3;
const DONE = 4;
const VALIDATED = 5;

const UPLINK_STATE_CHANGE = 'uplinker_state_changed';
const UPLINK_PROGRESS = 'uplink_progress_update';
const CHUNKS_TRANSMITTED = 'Chunks Sent';
const CHUNKS_RESENT = 'Missed Chunks Re-Sent';

/**
 * Interprets a received file storage location and provides the hash from the directory name,
 * as well as the number of chunks. Expects this path to be the path to the last (highest numbered)
 * chunk of the stored file.
 * @param {String} lastFileChunkPath The path to the last (highest numbered) chunk of the file
 */
const getHashAndLengthFromDirectory = lastFileChunkPath => {
  const pathParts = lastFileChunkPath.split(path.sep);
  const lastChunk = pathParts.pop();
  const hash = pathParts.pop();

  return { hash, chunkLength: Number(lastChunk.replace('.txt', '')) + 1 };
};

const fileUplinker = ({
  id, directory, path: inputPath, mode, inbound, outbound, waitTime = 2000,
}) => {
  const scheduler = new EventEmitter();
  const externalEmitter = new EventEmitter();
  const { hash, chunkLength } = getHashAndLengthFromDirectory(directory);
  const missingChunks = [];
  let phase = AWAITING_FIRST_NACK;
  let isResending = false;
  let missingCount = 0;
  let resendCount = 0;
  let finishAnyway;

  const compare = (received, expected) => {
    for (let i = 0; i < expected.length; i += 1) {
      if (received[i] !== expected[i]) {
        return false;
      }
    }

    return true;
  }

  const isExpectedNack = nack => {
    const expected = [id, hash, false, 0, chunkLength];

    return compare(nack, expected);
  };

  const isSuccess = ack => {
    const expected = [id, hash, true, chunkLength];

    return compare(ack, expected);
  };

  const isValidated = msg => {
    const expected = [id, true];

    return compare(msg, expected);
  };

  const addDataToMissingArray = data => {
    const pairs = data.slice(2);
    let pairIndex = 0;

    while (pairIndex < pairs.length) {
      const m = pairs.slice(pairIndex, pairIndex + 2);

      missingChunks.push(m);
      missingCount += m[1] - m[0];
      pairIndex += 2;
    }
  };

  const addMissingChunks = data => {
    scheduler.emit('next_phase', RESOLVING);
    addDataToMissingArray(data);
  };

  const getRootPath = directory => {
    const parts = directory.split(path.sep);

    parts.splice(-1);
    parts.unshift(path.sep);

    return path.join(...parts);
  };

  const getFileChunkFrom = (num, dir) => {
    return path.join(getRootPath(dir), `${num}.txt`);
  };

  const emitChunkSent = current => {
    if (phase === RESOLVING) {
      resendCount += 1;

      externalEmitter.emit(
        UPLINK_PROGRESS,
        UPLINKING_TO_SYSTEM,
        {
          progress_1_current: chunkLength,
          progress_1_max: chunkLength,
          progress_1_label: CHUNKS_TRANSMITTED,
          progress_2_current: resendCount,
          progress_2_max: missingCount,
          progress_2_label: CHUNKS_RESENT,
        }
      );
    }

    if (phase === SENDING) {
      externalEmitter.emit(
        UPLINK_PROGRESS,
        UPLINKING_TO_SYSTEM,
        {
          progress_1_current: current + 1,
          progress_1_max: chunkLength,
          progress_1_label: CHUNKS_TRANSMITTED,
        }
      );
    }
  };

  const sendFileChunks = (startChunk, endChunk) => {
    const arrLen = endChunk - startChunk;
    const parallels = [...Array(arrLen)].map((_, idx) => idx + startChunk);

    parallels.forEach(chunkIdx => {
      const rdStrm = fs.createReadStream(getFileChunkFrom(chunkIdx, directory));
      let chk = Buffer.alloc(0);

      rdStrm.on('data', chunk => {
        chk = Buffer.concat([chk, chunk]);
      });

      rdStrm.on('end', () => {
        outbound.write(cbor.encode([id, hash, chunkIdx, chunk]));
      });
    });
  };

  const resendMissingFileChunks = () => {
    if (isResending) { return; }

    isResending = true;

    let missingChunkIndices = missingChunks.shift();

    while (missingChunkIndices) {
      sendFileChunks(...missingChunkIndices);
      missingChunkIndices = missingChunks.shift();
    }

    isResending = false;
  };

  const cleanupStoredFileChunks = () => {
    removeDir(getRootPath(directory));
  };

  const handleInboundMessage = data => {
    switch (phase) {
      case AWAITING_FIRST_NACK:
        if (isExpectedNack(data)) {
          clearTimeout(startSendingAnyway);
          scheduler.emit('next_phase', SENDING);
        }
        break;
      case WAITING_ACK:
      case RESOLVING:
        clearTimeout(finishAnyway);

        if (isSuccess(data)) {
          scheduler.emit('next_phase', DONE);

          finishAnyway = setTimeout(() => {
            scheduler.emit('next_phase', VALIDATED);
          }, waitTime);
        } else {
          addMissingChunks(data);
        }
        break;
      case DONE:
        if (isValidated(data)) {
          clearTimeout(finishAnyway);
          scheduler.emit('next_phase', VALIDATED);
        }
        break;
      default:
        break;
    }
  };

  const sendInitialChunks = () => {
    sendFileChunks(0, chunkLength);
    scheduler.emit('next_phase', WAITING_ACK);
    outbound.write(cbor.encode([id, true]));

    finishAnyway = setTimeout(() => {
      scheduler.emit('next_phase', VALIDATED);
    }, waitTime);
  };

  const startSendingAnyway = setTimeout(() => {
    scheduler.emit('next_phase', SENDING);
  }, waitTime);

  scheduler.on('next_phase', nextPhase => {
    phase = nextPhase;

    switch (phase) {
      case SENDING:
        externalEmitter.emit(UPLINK_STATE_CHANGE, UPLINKING_TO_SYSTEM);
        sendInitialChunks();
        break;
      case WAITING_ACK:
        externalEmitter.emit(UPLINK_STATE_CHANGE, TRANSMITTED_TO_SYSTEM);
      case RESOLVING:
        resendMissingFileChunks();
        break;
      case VALIDATED:
        cleanupStoredFileChunks();
        externalEmitter.emit(UPLINK_STATE_CHANGE, COMPLETED);
        break;
      default:
        break;
    }
  });

  inbound.on('data', handleInboundMessage);

  outbound.write(cbor.encode([id, hash, chunkLength]));
  outbound.write(cbor.encode([id, 'export', hash, inputPath, mode]));

  return externalEmitter;
};

module.exports = {
  UPLINK_PROGRESS,
  UPLINK_STATE_CHANGE,
  fileUplinker,
};
