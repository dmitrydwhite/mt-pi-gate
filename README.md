# `majortom-gateway-server` Usage Guide

## What is `majortom-gateway-server`?
This is an opinionated Gateway App that allows you easily to connect your systems to Major Tom over HTTP, WebSocket, or USB/Serial. It's designed to integrate with `majortom-gateway-ui` to provide simple user interface. It can run on any machine, but is particularly designed to be run on a simple dedicated device like a Raspberry Pi.

```
System1 ◄────HTTP───────────┐
                            ▼
                      ┌────────────────┐             ┌───────────┐
System2 ◄─WebSocket──►│ gateway-server │◄─WebSocket─►│ MAJOR TOM │
                      └────────────────┘             └───────────┘
                            ▲
System3 ◄────USB────────────┘
```

## Use on Raspberry Pi
1. Set up your Raspberry Pi for ssh.
2. Install Node JS version 14:

```sh
$ sudo apt-get update
$ sudo apt-get dist-upgrade`
$ curl -sL https://deb.nodesource.com/setup_14.x | sudo -E bash -
$ sudo apt-get install -y nodejs
$ node -v #should output version 14
```

## Use Anywhere

3. Clone this repo

```sh
$ git clone https://github.com/dmitrydwhite/mt-pi-gate.git
```
4. In the newly created directory, install the dependencies

```sh
$ cd mt-pi-gate
$ npm install
```
5. Optional: Configure your port (defaults to 3003):
```sh
$ npm run config_port 5000
```
6. Highly encouraged: Configure your server's handshake that systems will use to securely connect:
```sh
$ npm run set_handshake my super secure handshake
```

The `port` and `systemHandshake` configuration options can be viewed at `./conf/gatewayConf.json` in the repo.

7. Start the server
```sh
$ npm start
```

## System Connection API

### Messaging Generally
The gateway expects that most of the messages it receives from systems will be measurements or command updates. For measurements, the gateway server will largely just act as a pass-through.

#### The Command Lifecycle for the Gateway Server

The Gateway Server handles commands from Major Tom in Four Phases:

#### Phase I: Initial Gateway Phase (Still in Development)
This phase begins when Major Tom sends a Command message to the gateway. When this feature is complete, the command and its fields will be passed to a custom, user-provided evaluator function that can reject the command if the function fails. If the evaluator function reports that the command is not valid, the command will automatically transition to the `failed` state. Otherwise, the command will transition to the `preparing_on_gateway` state.

During the `preparing_on_gateway` event, the Gateway Server will checks to see if this command type has a custom handler, added in a way still under development. Again, if this method returns an `<Error>` then the command will be transitioned to the `failed` state.

When a handler has completed, signified by calling the `done` callback, or if there is no handler, then the Command will be transitioned to the custom state _`gateway_prep_complete`_. During this state, the Gateway server confirms that the Command's destination system is valid and known by the Manager. If it's not, the server will assume that the system hasn't been connected yet, and will transition it to the custom gateway state _`waiting_for_system`_. If the system is connected and available, then the Command will transition to the final state of this phase, `uplinking_to_system`.

#### Phase II: The System Phase
During this phase, the Gateway Manager is concerned with checking the state of command updates received from the system. The system can, of course, send any state; but the ones the Gateway Manager expects during this phase are `acked_by_system`, `executing_on_system`, `downlinking_from_system`, and _`done_on_system`_.

If the system needs to downlink a file and cannot connect to the gateway over HTTP, then the gateway server provides an API for downlinking the file in chunks. See Downlinking File By Chunks below.

As noted, the system can also send other states like `failed` or `cancelled`.

When a system updates the command to the gateway-specific _`done_on_system`_ state, that will trigger the next phase.

#### Phase III: Final Gateway Phase (Still in Development)
This phase allows the gateway to perform any final processing based on any information received from the system. This manner of allowing users to customize gateway handling is still under development.

#### Phase IV: Failure and Cancellation Phase
This phase can be triggered at any time by any system updating a command's status to `failed`, or (eventually) by a handler returning an `<Error>`, either of which will trigger the `failed` event. The Gateway Manager will automatically send the `failed` message on to Major Tom.

This phase can also be triggered by Major Tom sending a `cancel` message to the gateway for the Command to be canceled.

### Downlinking File By Chunks

To begin downlinking a file in chunks, first send the following message to the gateway server:
```json
{
  "type": "start_chunked_file",
  "fileName": "unique_file_name",
  "commandId": "optional command ID associated with this file downlink",
  "contentType": "optional content type; defaults to binary/octet-stream",
  "metadata": {
    "optional": "optional metadata about the file"
  }
}
```
Once that message has been sent, start sending the file chunks as objects with the following structure:
```json
{
  "type": "file_chunk",
  "sequence": "zero-based index of this chunk",
  "fileName": "unique_file_name",
  "chunk": "a string or buffer of the file contents"
}
```
When the file is finished, send the following message to indicate that it's done:
```json
{
  "type": "file_done",
  "fileName": "unique_file_name"
}
```
Because this system is designed to operate on small single-board computers, the design of file downlinks and uploads is to minimize the amount of data in NodeJS memory at once. For that reason, files are stored to the server computer's file system, writing them as quickly as possible. For that reason, it is best to send the file chunks in order; though the file receiving system can handle chunks out of order.

Once the file has finished downlinking, it is put in a queue, and uploaded to Major Tom one at a time over HTTPS-again primarily to minimize the amount of potential file data in NodeJS's memory at one time.

### Connecting a system over HTTP
---
#### `POST /system/add-system`
---
Use this request to add a new system
##### Headers
```
Content-Type: application/json
Accept: application/json
System-Handshake: <system handshake code>
```
##### Body
```json
{ "systemName": "<unique system name>" }
```
##### Response
```json
{ "messages": [] }
```
The Response will be an Array of messages from Major Tom to this system.

#### `GET /system/<system name>`
---
Use this request to send messages from the system to Major Tom; or send without a body to check for messages from Major Tom.
##### Headers
```
Content-Type: application/json
Accept: application/json
System-Handshake: <system handshake code>
```
##### Body
```json
{ "<system name>": ["Array of messages to send to Major Tom"] }
```
##### Response
```json
{ "messages": [] }
```
The Response will be an Array of messages from Major Tom to this system.

#### `POST /system/<system name>/file?fileName=<file name>&commandId=<optional command id>`
---
Use this request to upload a file to Major Tom
##### Headers
```
Content-Type: multipart/form-data
Accept: application/json
System-Handshake: <system handshake code>
```
##### Query String
```
fileName: string to name the file, required
commandId: the command this file is associated to, optional
```
##### Body
```
fileUpload: {
  name: <file name>
  data: the File
  mimeType: the file type
}
```
##### Response
200 if the file was successfully stored on the gateway server for upload to Major Tom, 500 if there was a problem storing the file.
##### Example
```js
/**
 * A function to upload a file from "thisSystem"
 * @param {File} File The file object using this interface: https://developer.mozilla.org/en-US/docs/Web/API/File
 * @param {String} fileName The name of the file
 * @param {Number} [commandId] The command this file is associated with
 */
function uploadMyFileToGateway(File, fileName, commandId) {
  const myUploadForm = new FormData();
  const gatewayReq = new XMLHttpRequest();
  let myUploadUrlString = `https://myServerLocation:3003/system/thisSystem/file`;

  myUploadUrlString += `?fileName=${fileName}`;

  if (commandId) {
    myUploadUrlString += `&commandId=${commandId}`;
  }

  myUploadForm.append('fileUpload', File);

  gatewayReq.open('POST', myUploadUrlString);
  gatewayReq.send(myUploadForm);
}
```

##### Notes
While we have provided a way for files to be sent to the gateway server over WebSocket, if your system has the capability to upload a file over HTTP, we recommend that you use this request to do so.

---

### Connecting a system over WebSocket
---
#### WebSocket `/<system name>/<one-time system pin>`
---

##### Secure-Protocol
In the list of secure protocols passed during the creation of the WebSocket connection, include a string constructed in the following way:
1. Concatenate the system name, the one-time system pin, and the server's system handshake value into a single string.
2. Base-64 encode that string.
3. Remove any of the following characters from that string: `"="`, `"|"`, or `"/"` (those characters are not allowed in WebSocket protocol strings).

Messages to the Gateway Server should be sent as a properly formatted JSON string using the `WebSocket.send` method. Be sure to include the system's name in the message.

Once created, this WebSocket connection will receive update messages in the following structure:
```json
{
  "systems": {
    "systemName": {
      "lastCommand": "number",
      "lastStatus": "string",
      "timestamp": "number",
      "systemName": "string",
      "type": "string",
      "errors": ["string"]
    }
  },
  "commands": {
    "id": {
      "id": "number",
      "lastStatus": "string",
      "timestamp": "number",
      "system": "string",
      "type": "string",
      "fields": { "fieldName": "fieldValue" }
    }
  },
  "pendingSystems": {
    "path": {
      "path": "string",
      "type": "USB"
    }
  },
  "logs": ["string"]
}
```

`pendingSystems` are systems that have been detected by the gateway server as having been connected physically to the gateway over USB, but that don't have the data necessary to connect them to Major Tom.