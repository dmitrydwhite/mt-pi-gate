const { EventEmitter } = require('events');

const { newNodeGateway } = require('majortom-gateway');

const serviceConfig = require('./conf/serviceConfig.json');
const systemAndCommandMap = require('./conf/systemConfig.json');
const connectionProps = require('./conf/majorTomConfig.json');
const buildServices = require('./buildServices');

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
