const systemIncomingMessageHandler = ({ sendToMajorTom, emitTransition }) => {
  const handleSystemIncomingMessage = (message, system) => {
    const msgStr = message instanceof Buffer ? message.toString() : message;
    const asObj = typeof msgStr === 'string' ? JSON.parse(msgStr) : msgStr;
    const { command, type } = asObj;

    if (type === 'command_update' && command) {
      emitTransition(command.state, { ...command, system });
    } else if (type === 'start_chunked_file') {
      emitTransition('start_file_receive', { ...asObj, system });
    } else if (type === 'file_chunk') {
      // TODO: Figure out the api for file chunk
      emitTransition('receive_file_chunk', { ...asObj, system });
    } else if (type === 'file_done', { ...asObj, system }) {
      // TODO: Figure out the api for file done
      emitTransition('receive_file_done');
    } else {
      sendToMajorTom(type)(asObj);
    }
  };

  return handleSystemIncomingMessage;
};

module.exports = systemIncomingMessageHandler;
