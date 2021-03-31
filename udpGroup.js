class UdpGroup extends Emitter {
  constructor() {
    super();

    this.pathways = {};
  }

  createPathway(config) {
    if (typeof config !== 'object' || !config.remote_address) {
      throw 'Pathway must be added using an object with remote_address property';
    }

    const { remote_address, remote_port } = config;
    const remote_port_value = !remote_port || remote_port === '*' ? '' : remote_port;
    const remote_id = `${remote_address}${remote_port_value ? `_${remote_port_value}` : ''}`;
    const pathwayStream = new PassThrough();
    const textDestination = `remote address ${remote_address}${remote_port_value ? ` and remote port ${remote_port_value}` : ''}`;

    this.emit(
      'info',
      `Creating a pathway listening for messages from ${textDestination}`
    );

    if (!pathways[remote_id]) {
      this.pathways[remote_id] = [pathwayStream];
    } else {
      this.emit('warning', `There are multiple pathways listening for messages from ${textDestination}`);
      this.pathways[remote_id].push(pathwayStream);
    }

    return [pathwayStream];
  }

  addPathway(config) {
    try {
      this.emit('pathway', ...createPathway(config));
    } catch (err) {
      this.emit('error', err);
    }
  };
}