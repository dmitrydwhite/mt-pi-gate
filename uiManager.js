const statusTexts = {
  acked_by_system: 'a command was acknowledged',
  done_on_system: 'finished executing a command',
  downlinking_from_system: 'sent a downlink packet',
  executing_on_system: 'executing a command',
  failed_on_system: 'a failure message was sent',
  uplinking_to_system: 'a command is uplinking',
};

const systems = {};
const commands = {};
let uiCxes = [];

const addUiConnection = (cx, messageCallback) => {
  cx.on('message', messageCallback);

  cx.on('error', () => {
    cx = null;
    uiCxes = uiCxes.filter(x => x);
  });

  cx.on('close', () => {
    cx = null;
    uiCxes = uiCxes.filter(x => x);
  });

  uiCxes.push(cx);

  sendUpdates();
};

const addSystemUi = (systemName, type) => {
  systems[systemName] = {
    lastStatus: 'created',
    timestamp: Date.now(),
    systemName,
    type,
  };

  sendUpdates();
};

const updateSystemUi = system => {
  const { systemName } = system;

  systems[systemName] = {
    ...(systems[systemName] || {}),
    ...system,
  };

  sendUpdates();
};

const sendUpdates = () => {
  const jsonUpdate = JSON.stringify({ systems, commands });

  uiCxes.forEach(connection => {
    if (connection && connection.readyState === 1) {
      connection.send(jsonUpdate);
    }
  });
};

const getLastStatus = state => {
  return statusTexts[state] || 'system sent a state that the gateway didn\'t recognize';
};

const removeCommand = id => {
  commands[id] = null;

  sendUpdates();
};

const updateUiWithTransition = (nextState, update, errors) => {
  const { id, system, state, type, fields } = update;
  const fieldProps = (fields || []).reduce((accum, curr) => {
    return { ...accum, [curr.name]: curr.value };
  }, {});
  const next = {
    id,
    lastStatus: state || nextState,
    timestamp: Date.now(),
  };

  if (system) next.system = system;
  if (type) next.description = type;
  if (fields) next.fields = fields;

  commands[id] = {
    ...(commands[id] || {}),
    ...next,
  };

  switch (nextState) {
    case 'waiting_for_system':
      systems[system] = {
        ...(systems[system] || {}),
        lastCommand: id,
        lastStatus: 'gateway can\'t find system',
        timestamp: Date.now(),
        systemName: system,
        type: 'unk',
      };
      break;
    case 'uplinking_to_system':
    case 'acked_by_system':
    case 'executing_on_system':
    case 'downlinking_from_system':
    case 'done_on_system':
    case 'failed_on_system':
      systems[system] = {
        ...(systems[system] || {}),
        lastCommand: id,
        lastStatus: getLastStatus(nextState),
        timestamp: Date.now(),
        errors,
      };
      break;

    default:
      break;
  }

  sendUpdates();
};

module.exports = {
  addUiConnection,
  addSystemUi,
  removeCommand,
  updateSystemUi,
  updateUiWithTransition,
};
