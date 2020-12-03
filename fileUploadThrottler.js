const fs = require('fs');
const { EventEmitter } = require('events');
const path = require('path');

const { TEMP_FILE_PATH } = require('./constants');

const NEXT_FILE = 'upload_next_file';

/**
 * Create a path for the individual file.
 * @param {String} system The name of the system
 * @param {String} fileName The file name
 */
const buildFilePath = (system, fileName) => {
  const systemFolder = path.join(TEMP_FILE_PATH, system);
  const fileDestination = path.join(TEMP_FILE_PATH, system, fileName);

  if (!fs.existsSync(systemFolder)) {
    fs.mkdirSync(systemFolder);
  }

  return fileDestination;
};

/**
 * When the Node Gateway library uploads a file to Major Tom, it necessarily reads the whole file
 * into memory as it uploads it. For this reason, we'll throttle file uploads to be one at a time.
 * This utility handles that for us. Call `upload` with an object containing all the information
 * about the file to upload, including its location in the file system. This will place that file in
 * line to be uploaded to Major Tom.
 * @param {NodeGateway} cx The gateway connection to Major Tom through the Node Gateway library majortom-gateway.
 */
const fileUploader = cx => {
  const scheduler = new EventEmitter();
  const uploadQueue = [];
  let majorTomConnection = cx;
  let busy = false;

  if (!fs.existsSync(TEMP_FILE_PATH)) {
    fs.mkdirSync(TEMP_FILE_PATH);
  }

  const receiveFileFromHttp = (passedData, fileData) => new Promise((resolve, reject) => {
    const { systemName: system, commandId, fileName } = passedData;
    const { name, data, mimeType: contentType } = fileData;
    const filePath = buildFilePath(system, fileName);

    fs.writeFile(filePath, data, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve({
          fileName: fileName || name || 'no_filename_provided',
          filePath,
          system,
          contentType,
          commandId,
        });
      }
    });
  });

  /**
   * Schedule a file to be uploaded to Major Tom.
   * @param {Object} fileData The needed information to upload the file
   * @param {String} fileData.fileName The name of the file
   * @param {String} fileData.filePath The path to the current location of the file
   * @param {String} fileData.system The name of the system associated with this file
   * @param {Number} [fileData.timestamp] The timestamp of the file
   * @param {String} [fileData.contentType] The file content type; defaults to binary/octet-stream
   * @param {Number} [fileData.commandId] The command associated with this file, if any
   * @param {String} [fileData.metadata] Additional information about this file
   */
  const upload = fileData => {
    uploadQueue.push(fileData);
    scheduler.emit(NEXT_FILE);
  };

  /**
   * Call this method after a connection to Major Tom through the Node Gateway library has been
   * established.
   * @param {NodeGateway} cx The established connection to Major Tom created with majortom-gateway
   */
  const unloadWaitingFiles = cx => {
    majorTomConnection = cx;
    scheduler.emit(NEXT_FILE);
  }

  const uploadNextToMt = () => {
    if (!(majorTomConnection && majorTomConnection.uploadDownlinkedFile)) return;

    const next = uploadQueue.shift();

    if (!next) {
      busy = false;
    } else if (majorTomConnection && majorTomConnection.uploadDownlinkedFile) {
        const { fileName, filePath, system, timestamp, contentType, commandId, metadata } = next;

        busy = true;
        majorTomConnection
          .uploadDownlinkedFile(
            fileName, filePath, system, timestamp, contentType, commandId, metadata
          )
          .catch(() => {
            // TODO: Handle file upload error.
          })
          .finally(() => {
            fs.rm(buildFilePath(system, fileName), () => {
              scheduler.emit(NEXT_FILE);
            });
          });
    }
  };

  scheduler.on(NEXT_FILE, () => {
    if (!busy) {
      uploadNextToMt();
    }
  });

  return {
    receiveFileFromHttp,
    upload,
    unloadWaitingFiles,
  };
};

module.exports = fileUploader;
