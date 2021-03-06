const { EventEmitter } = require('events');

const { newNodeGateway } = require('majortom-gateway');

const serviceConfig = require('./configs/serviceConfig.json');
const systemAndCommandMap = require('./configs/systemConfig.json');
const connectionProps = require('./configs/majorTomConfig.json');

const buildServices = require('./buildServices');
const { COMPLETED, FAILED, PROCESSING_ON_GATEWAY } = require('./constants');
const { Downloader, FILE_WRITTEN } = require('./downloaderTransform');
const { DOWNLINKER_STATE_CHANGE, fileDownlinker } = require('./fileDownlinker');
const { fileUplinker, UPLINK_STATE_CHANGE, UPLINK_PROGRESS } = require('./fileServicer');

const controller = new EventEmitter();

const cancelledCommands = {};
const sentCommands = {};
const paused = {};

const systemJsonReceived = update => {
  controller.emit('received', update);
};

const serviceMap = buildServices({
  done: systemJsonReceived,
  serviceConfig,
});

const commandCallback = command => {
  controller.emit('command', command);
};

const cancelCallback = cancelId => {
  const cancelInfo = sentCommands[cancelId];

  if (!cancelInfo) {
    cancelledCommands[cancelId] = true;
  } else {
    serviceMap.cancel(cancelInfo);
  }
};

const serviceIsPaused = (service, command) => {
  if (paused[service]) {
    paused[service].push(command);
  }

  return !!paused[service];
};

const pauseService = service => {
  paused[service] = paused[service] || [];
};

const unpauseService = service => {
  if (paused[service]) {
    const toUnload = [...paused[service]];

    paused[service] = null;

    toUnload.forEach(command => {
      controller.emit('service_determined', command);
    });
  }
};

const majortom = newNodeGateway({ ...connectionProps, commandCallback, cancelCallback });

/**
 * Handles the "command" event that is emitted when we receive a command from Major Tom.
 */
controller.on('command', command => {
  // Find the appropriate service for this command
  const { id, system, type } = command;
  const systemConfig = systemAndCommandMap[system] || {};
  const typeConfig = systemAndCommandMap[type];

  // If this command type has an entry under the system block, use that.
  // Otherwise use the common entry for this command type.
  // Otherwise use the general entry for this system.
  const service = systemConfig[type] || typeConfig || systemConfig['*'] || systemAndCommandMap['*'];

  majortom.transmitCommandUpdate(id, 'preparing_on_gateway', command);

  if (type === 'uplink_file' || type === 'downlink_file') {
    return controller.emit(type, service, command);
  }

  if (service.indexOf('file.') >= 0) {
    return controller.emit('file_service', service, command);
  }

  if (!serviceMap[service]) {
    controller.emit('service_determination_error', command);
  } else {
    controller.emit('service_determined', service, command);
  }
});

controller.on('service_determination_error', command => {
  const { system, type, id } = command;

  majortom.failCommand(
    id, [new Error(`Could not find a service for the command ${type} sent to system ${system}`)]
  );
});

controller.on('service_determined', (service, command) => {
  const { id, system } = command;

  if (!cancelledCommands[id]) {
    if (!serviceIsPaused(service, command)) {
      sentCommands[id] = { id, system, service };
      serviceMap[service].write(JSON.stringify(command));
      majortom.transmitCommandUpdate(command.id, 'uplinking_to_system', command);
    }
  }
});

controller.on('downlink_file', (service, command) => {
  const { id, fields } = command;
  const { outbound, inbound, channel_id } = serviceMap.getFileService(service);
  const fieldVals = fields.reduce((accum, curr) => {
    return { ...accum, [curr.name]: curr.value };
  }, {});
  const { filename, metadata, content_type } = fieldVals;
  let downlinker = fileDownlinker({ id: channel_id, outbound, inbound, filename });

  downlinker.on(DOWNLINKER_STATE_CHANGE, (state, info) => {
    switch (state) {
      case FAILED:
        downlinker = null;
        majortom.failCommand(id, [info]);
        break;
      case PROCESSING_ON_GATEWAY:
        downlinker = null;
        majortom.uploadDownlinkedFile(filename, info, system, Date.now(), content_type, id, metadata)
          .then(result => {
            majortom.completeCommand(id, { output: JSON.stringify(result) });
          });
        break;
      default:
        majortom.transmitCommandUpdate(id, state);
      }
  });
});

controller.on('uplink_file', (service, command) => {
  const { id, fields } = command;
  const fieldValues = {};
  const downloader = new Downloader();
  const { outbound, inbound, blocking, channel_id } = serviceMap.getFileService(service);

  fields.forEach(({ name, value }) => fieldValues[name] = value);

  const { gateway_download_path, path, mode } = fieldValues;

  downloader.on(FILE_WRITTEN, directory => {
    let uplinker = fileUplinker({
      id: channel_id,
      outbound,
      inbound,
      directory,
      path,
      mode,
    });

    uplinker.on(UPLINK_PROGRESS, (state, progress) => {
      majortom.transmitCommandUpdate(id, state, { ...command, ...progress });
    });

    uplinker.on(UPLINK_STATE_CHANGE, uplinkState => {
      majortom.transmitCommandUpdate(id, uplinkState, command);

      if (uplinkState === COMPLETED) {
        if (blocking) {
          serviceMap.unblock(service);
          unpauseService(service);
        }

        uplinker = null;
      }
    });
  });

  majortom.transmitCommandUpdate(id, 'preparing_on_gateway', command);

  majortom
    .downloadStagedFile(gateway_download_path, downloader)
    .then(() => {
      if (blocking) {
        pauseService(service);
      }
    })
    .catch(error => {
      majortom.failCommand(id, [error]);
    });
});

controller.on('received', update => {
  const { type, command = {}, event, measurements } = update;
  const { id, state } = command;

  switch (type) {
    case 'command_update':
      majortom.transmitCommandUpdate(id, state, command);
      break;
    case 'measurements':
      majortom.transmitMetrics(measurements);
      break;
    case 'event':
      majortom.transmitEvents(event);
      break;
    case 'command_definitions_update':
    case 'file_list':
    case 'file_metadata_update':
      majortom.transmit(update);
      break;
    default:
      break;
  }
});

majortom.connect();
