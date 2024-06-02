const express = require('express');
const socketio = require('socket.io');
const minimist = require('minimist');
const { URL } = require('url');
const kurento = require('kurento-client');
const fs = require('fs');
const https = require('https');


var kurentoClient = null;
const iceCandidateQueues = {};

const argv = minimist(process.argv.slice(2), {
    default: {
        as_uri: 'http://localhost:3000/',
        ws_uri: 'ws://localhost:8888/kurento'
    }
});

const options =
{
    key: fs.readFileSync('keys/server.key'),
    cert: fs.readFileSync('keys/server.crt')
};
const app = express();
app.use(express.static('public'));

const asUrl = new URL(argv.as_uri);
const port = asUrl.port;
const server = https.createServer(options, app).listen(port, function () {
    console.log(`Server started at ${asUrl}`);
});

const socket = socketio(server);


socket.on('connection', (sock) => {

    sock.on('disconnecting', () => {
        const rooms = Object.values(sock.rooms);
        rooms.forEach(element => {
            const participants = socket.sockets.adapter.rooms[element].participants
            if (participants) {
                delete participants[sock.id]
            }
            sock.to(element).emit('message', {
                event: 'userDisconnected',
                userid: sock.id
            })
        });
    })

    sock.on('message', (message) => {

        switch (message.event) {
            case 'joinRoom':
                joinRoom(sock, message.userName, message.roomName, err => {
                    if (err) {
                        console.log(err);
                    }
                });
                break;

            case 'receiveVideoFrom':
                receiveVideoFrom(sock, message.userid, message.roomName, message.sdpOffer, err => {
                    if (err) {
                        console.log(err);
                    }
                });
                break;

            case 'candidate':
                addIceCandidate(sock, message.userid, message.roomName, message.candidate, err => {
                    if (err) {
                        console.log(err);
                    }
                });
                break;
        }

    });
});

const joinRoom = (sock, username, roomName, callback) => {
    getRoom(sock, roomName, (err, room) => {
        if (err) {
            return callback(err);
        }

        room.pipeline.create('WebRtcEndpoint', (err, outgoingMedia) => {
            if (err) {
                return callback(err);
            }

            const user = {
                id: sock.id,
                name: username,
                outgoingMedia: outgoingMedia,
                incomingMedia: {}
            }

            const iceCandidateQueue = iceCandidateQueues[user.id];
            if (iceCandidateQueue) {
                while (iceCandidateQueue.length) {
                    const ice = iceCandidateQueue.shift();
                    console.error(`user: ${user.name} collect candidate for outgoing media`);
                    user.outgoingMedia.addIceCandidate(ice.candidate);
                }
            }

            user.outgoingMedia.on('IceCandidateFound', event => {
                const candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
                sock.emit('message', {
                    event: 'candidate',
                    userid: user.id,
                    candidate: candidate
                });
            });

            sock.to(roomName).emit('message', {
                event: 'newParticipantArrived',
                userid: user.id,
                username: user.name
            });

            const existingUsers = [];
            for (let i in room.participants) {
                if (room.participants[i].id != user.id) {
                    existingUsers.push({
                        id: room.participants[i].id,
                        name: room.participants[i].name
                    });
                }
            }
            sock.emit('message', {
                event: 'existingParticipants',
                existingUsers: existingUsers,
                userid: user.id
            });

            room.participants[user.id] = user;
        });
    });
}

const receiveVideoFrom = (sock, userid, roomName, sdpOffer, callback) => {
    getEndpointForUser(sock, roomName, userid, (err, endpoint) => {
        if (err) {
            return callback(err);
        }

        endpoint.processOffer(sdpOffer, (err, sdpAnswer) => {
            if (err) {
                return callback(err);
            }

            sock.emit('message', {
                event: 'receiveVideoAnswer',
                senderid: userid,
                sdpAnswer: sdpAnswer
            });

            endpoint.gatherCandidates(err => {
                if (err) {
                    return callback(err);
                }
            });
        });
    })
}

const addIceCandidate = (sock, senderid, roomName, iceCandidate, callback) => {
    let user = socket.sockets.adapter.rooms[roomName].participants[sock.id];
    if (user != null) {
        let candidate = kurento.register.complexTypes.IceCandidate(iceCandidate);
        if (senderid == user.id) {
            if (user.outgoingMedia) {
                user.outgoingMedia.addIceCandidate(candidate);
            } else {
                iceCandidateQueues[user.id].push({ candidate: candidate });
            }
        } else {
            if (user.incomingMedia[senderid]) {
                user.incomingMedia[senderid].addIceCandidate(candidate);
            } else {
                if (!iceCandidateQueues[senderid]) {
                    iceCandidateQueues[senderid] = [];
                }
                iceCandidateQueues[senderid].push({ candidate: candidate });
            }
        }
        callback(null);
    } else {
        callback(new Error("addIceCandidate failed"));
    }
}

// useful functions
const getRoom = (sock, roomName, callback) => {
    var myRoom = socket.sockets.adapter.rooms[roomName] || { length: 0 };
    var numClients = myRoom.length;

    console.log(roomName, ' has ', numClients, ' clients');

    if (numClients == 0) {
        sock.join(roomName, () => {
            myRoom = socket.sockets.adapter.rooms[roomName];
            getKurentoClient((error, kurento) => {
                kurento.create('MediaPipeline', (err, pipeline) => {
                    if (error) {
                        return callback(err);
                    }

                    myRoom.pipeline = pipeline;
                    myRoom.participants = {};
                    callback(null, myRoom);
                });
            });
        });
    } else {
        sock.join(roomName);
        callback(null, myRoom);
    }
}

function getEndpointForUser(sock, roomName, senderid, callback) {
    var myRoom = socket.sockets.adapter.rooms[roomName];
    var asker = myRoom.participants[sock.id];
    var sender = myRoom.participants[senderid];

    if (asker.id === sender.id) {
        return callback(null, asker.outgoingMedia);
    }

    if (asker.incomingMedia[sender.id]) {
        sender.outgoingMedia.connect(asker.incomingMedia[sender.id], err => {
            if (err) {
                return callback(err);
            }
            callback(null, asker.incomingMedia[sender.id]);
        });
    } else {
        myRoom.pipeline.create('WebRtcEndpoint', (err, incoming) => {
            if (err) {
                return callback(err);
            }

            asker.incomingMedia[sender.id] = incoming;

            let iceCandidateQueue = iceCandidateQueues[sender.id];
            if (iceCandidateQueue) {
                while (iceCandidateQueue.length) {
                    let ice = iceCandidateQueue.shift();
                    console.error(`user: ${sender.name} collect candidate for outgoing media`);
                    incoming.addIceCandidate(ice.candidate);
                }
            }

            incoming.on('IceCandidateFound', event => {
                let candidate = kurento.register.complexTypes.IceCandidate(event.candidate);
                sock.emit('message', {
                    event: 'candidate',
                    userid: sender.id,
                    candidate: candidate
                });
            });

            sender.outgoingMedia.connect(incoming, err => {
                if (err) {
                    return callback(err);
                }
                callback(null, incoming);
            });
        });
    }
}

const getKurentoClient = (callback) => {
    if (kurentoClient !== null) {
        return callback(null, kurentoClient);
    }

    kurento(argv.ws_uri, function (error, _kurentoClient) {
        if (error) {
            console.log("Could not find media server at address " + argv.ws_uri);
            return callback("Could not find media server at address" + argv.ws_uri
                + ". Exiting with error " + error);
        }

        kurentoClient = _kurentoClient;
        callback(null, kurentoClient);
    });
}