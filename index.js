const { EventEmitter } = require('events');

const { newNodeGateway } = require('majortom-gateway');

const serviceConfig = require('./conf/serviceConfig.json');
const systemAndCommandMap = require('./conf/systemConfig.json');
const connectionProps = require('./conf/majorTomConfig.json');

const buildServices = require('./buildServices');
const { COMPLETED } = require('./constants');
const { Downloader, FILE_WRITTEN } = require('./downloaderTransform');
const { fileUplinker, UPLINK_STATE_CHANGE } = require('./fileServicer');

const controller = new EventEmitter();

const cancelledCommands = {};
const sentCommands = {};

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
    sentCommands[id] = { id, system, service };
    serviceMap[service].write(JSON.stringify(command));
    majortom.transmitCommandUpdate(command.id, 'uplinking_to_system', command);
  }
});

controller.on('uplink_file', (service, command) => {
  const { id, fields } = command;
  const fieldValues = {};
  const downloader = new Downloader();
  const { outbound, inbound, blocking, channel_id } = serviceMap.getFileService(service);

  fields.forEach(({ name, value }) => fieldValues[name] = value);

  const { gateway_download_path, path, mode } = fieldValues;

  downloader.on(FILE_WRITTEN, directory => {
    const uplinker = fileUplinker({
      id: channel_id,
      outbound,
      inbound,
      directory,
      path,
      mode,
    });

    uplinker.on(UPLINK_STATE_CHANGE, uplinkState => {
      majortom.transmitCommandUpdate(id, uplinkState, command);

      if (uplinkState === COMPLETED) {
        uplinker = null;
      }
    });
  });

  majortom.transmitCommandUpdate(id, 'preparing_on_gateway', command);

  majortom
    .downloadStagedFile(gateway_download_path, downloader)
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
    default:
      majortom.transmit(update);
      break;
  }
});

majortom.connect();
