const systemIncomingMessageHandler = ({ sendToMajorTom, emitTransition }) => {
  const handleSystemIncomingMessage = message => {
    const msgStr = message instanceof Buffer ? message.toString() : message;
    const asObj = typeof msgStr === 'string' ? JSON.parse(msgStr) : msgStr;
    const { command, type } = asObj;

    if (type === 'command_update' && command) {
      emitTransition(command.state, command);
    } else {
      sendToMajorTom(type)(asObj);
    }
  };

  return handleSystemIncomingMessage;
};

module.exports = systemIncomingMessageHandler;
