## Message Service Types

### Top-Level Settings
#### For HTTP(S)
The server allows only two HTTP servers: one for HTTP and one for HTTPS. Multiple services can listen for connections on different paths, but they will all be handled by the same server for secure and non-secure. If a service with HTTP or HTTPS mode is described, the corresponding top-level port setting is required.
* `"http_listen_port" :` The port for the HTTP server
* `"https_listen_port" :` The port for the HTTPS server

#### For UDP
The default UDP send port can be specified at top level; even if specified an individual UDP service can use a different port. Similarly, max length and offset can also be overridden by individual UDP services.
* `"udp_send_port" :` The port number
* `"offset" :` The number of bytes the UDP message is offset
* `"max_length" :` The max length for a sent UDP message

### USB

* `"mode" : "USB"`
* `"service_destination" :` The file location on the server computer where the USB interface for this device is, usually found under `/dev/tty*` on Linux & OSX systems
* `"baud_rate" :` Determined by the connected device

### UDP
* `"mode" : "UDP"`
* `"service_destination" :`  (Optional) If specified, the UDP socket indicated by this service will be bound to the ip and port indicated
* `"rinfo" :` (Optional) Array of objects with "ip" and "port" properties; cannot be present if "service_destination" is present, and vice-versa; if set, this service will accept messages on any of these ip/port combinations
* `"udp_send_port" :` (Optional) The port from which to send messages on this service if different from the top-level setting
* `"max_length": ` The number of bytes that is the max length of the message to send over this service
* `"offset" :` The number of bytes to offset the sent UDP Buffer; overrides the top-level setting
* `"udp_version" :` Either "udp4" or "udp6"; overrides the top-level setting if set here


### HTTP(S)
* `"mode" : "HTTP or HTTPS"`
* `"service_destination" :` The url path where this service can be reached
* `"method" :` The HTTP Request method that the device will use to connect to the server
* `"accept_content" :` (Optional) The content the device expects for the response body; defaults to `"application/json"`
* `"cors_origin" :` The origin where the requests to the server will come from; all others will be blocked; set to `"*"` to allow requests from any origin
* `"message_name" :` (Optional) The server requires that any messages sent to the server from the HTTP(S)-connected device be in a JSON object with a single key; this field allows the user to specify that key; defaults to messages

#### Example request format:

##### Here we use the defaults
Config file excerpt:
```json
{
  "http_service_one": {
    "mode": "HTTP",
    "service_destination": "/http_service_one",
    "method": "GET",
  }
}
```
HTTP Request:
```
GET http://192.168.5.82:3003/http_service_one
Content-Type: application/json
Accept: application/json

{
  "messages": [
    {
      "type": "command_update",
      "command": {
        "id": 1,
        "state": "acked_by_system"
      }
    }
  ]
}
```
##### Here we'll change a few things
Config file excerpt:
```json
{
  "http_service_two": {
    "mode": "HTTPS",
    "service_destination": "gateOne/services/http2",
    "method": "GET",
    "message_name": "inbound_http2",
    "accept_content": "binary/octet-stream",
    "cors_origin": "localhost:3000"
  }
}
```
HTTPS Request:
```
GET https://192.168.5.82:3003/gateOne/services/http2
Content-Type: application/json
Accept: binary/octet-stream

{
  "inbound_http2": [
    {
      "type": "command_update",
      "command": {
        "id": 1,
        "state": "acked_by_system"
      }
    }
  ]
}
```