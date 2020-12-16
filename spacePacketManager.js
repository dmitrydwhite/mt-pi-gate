const toBinary = reqWidth => num => {
  let asStr = Number(num).toString(2);

  if (!reqWidth)  {
    return asStr;
  }

  if (asStr.length > reqWidth) {
    throw new Error(`Cannot convert ${num} to a binary string with width ${reqWidth}; it would overflow`);
  }

  while (asStr.length < reqWidth) {
    asStr = `0${asStr}`;
  }

  return asStr;
};

const SpacePacketCreator = () => {
  const MAX_LENGTH = 65536;
  const counters = {};

  const getApidCount = apid => {
    if (counters[apid] === undefined) {
      counters[apid] = 0;
    } else {
      counters[apid] += 1;
    }

    return counters[apid];
  };

  const setApidCount = (apid, count) => {
    if (Number.isInteger(count)) {
      counters[apid] = count;
    } else {
      counters[apid] = 0;
    }

    return counters[apid];
  };

  const buildPacket = opts => {
    const { data, apidString, packetName, secondaryHeader, sequenceFlags } = opts;
    const { timeCode = [], ancillaryData = [] } = secondaryHeader || {};
    const headerString =  `0001${
      secondaryHeader ? '1' : '0'
    }${apidString}${sequenceFlags}${toBinary(14)(packetName)}${toBinary(16)(data.length - 1)}`;
    const headerArray = [];

    let i = 0;

    while (i < headerString.length) {
      const octet = headerString.slice(i, i + 8);
      headerArray.push(parseInt(octet, 2));
      i += 8;
    }

    return Buffer.concat(
      [Buffer.from(headerArray), Buffer.from(timeCode), Buffer.from(ancillaryData), Buffer.from(data)]
    );
  };

  const convertSecondaryHeaderFieldToUIntArray = fieldVal => {
    if (typeof fieldVal === 'undefined' || fieldVal === null) {
      return [];
    }

    if (typeof fieldVal === 'string') {
      return fieldVal.split().map(char => char.charCodeAt(0));
    }

    if (Array.isArray(fieldVal)) {
      return fieldVal.map(item => typeof item === 'string' ? item.charCodeAt(0) : item);
    }

    if (Number.isInteger(fieldVal)) {
      return Number(fieldVal).toString(2).split('').map(char => char === '1' ? 1 : 0);
    }

    throw new Error('Secondary Header field values must be strings, arrays, or integers');
  };

  const create = (opts, buffer) => {
    const { apid, packetName, secondaryHeader } = opts;
    const { timeCode, ancillaryData } = secondaryHeader || {};
    const [timeCodeBuf, ancillaryDataBuf] = [timeCode, ancillaryData].map(convertSecondaryHeaderFieldToUIntArray);
    const secondaryHeaderObj = !!(timeCodeBuf.length + ancillaryDataBuf.length) &&
      { timeCode: timeCodeBuf, ancillaryData: ancillaryDataBuf };
    const data = Array.from(buffer);
    const packetMax = MAX_LENGTH - timeCodeBuf.length - ancillaryDataBuf.length;
    const packetsToCreate = Math.ceil(data.length / packetMax);
    const unsegmented = packetsToCreate === 1 ? '11' : '';
    const apidString = toBinary(11)(apid);
    const packetsArr = [];

    for (let i = 0; i < packetsToCreate; i++) {
      const sequence = (i === 0 && '01') || (i === packetsToCreate - 1 && '10') || '00';
      const packet = buildPacket({
        apidString,
        sequenceFlags: unsegmented || sequence,
        data: data.slice(i * packetMax, (i * packetMax) + packetMax),
        packetName: packetName || getApidCount(apid),
        secondaryHeader: secondaryHeaderObj,
      });

      packetsArr.push(packet);
    }

    return packetsArr;
  };

  return {
    create,
    getApidCount,
    setApidCount,
  };
};

module.exports = SpacePacketCreator;
