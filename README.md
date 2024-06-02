# Video Conference (Group Call)

Signalling server build on node.js for Kurento Media Server to facilitate WebRTC protocol.

- The server runs on HTTPS protocol. To generate self-signed keys for testing, run the following script in root directory

```
mkdir keys
cd keys
openssl genrsa -out server.key 4096
openssl req -x509 -new -nodes -key server.key -sha512 -days 3650 -out server.crt
```

- To start developement server: run `npm start`
