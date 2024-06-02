const divRoomSelection = document.getElementById('roomSelection');
const divMeeting = document.getElementById('meetingRoom');
const divMeetingRoom = document.getElementById('allVideos');
const inputRoom = document.getElementById('room');
const inputName = document.getElementById('name');
const btnRegister = document.getElementById('register');
const title = document.getElementById('room-title');

var roomName;
var userName;
var participants = {};

var myUser;

var socket = io();

window.addEventListener("unload", () => {
    socket.disconnect();
});

btnRegister.onclick = function () {
    roomName = inputRoom.value;
    userName = inputName.value;


    title.innerText = `Room: ${roomName}`;

    if (roomName === '' || userName === '') {
        alert('Room and Name are required!');
    } else {
        document.body.style.display = 'block';
        var message = {
            event: 'joinRoom',
            userName: userName,
            roomName: roomName
        }
        sendMessage(message);
        divRoomSelection.style = "display: none";
        divMeeting.style = "display: block";
    }
}

// messages handlers
socket.on('message', message => {
    console.log('Message received: ' + message.event);

    switch (message.event) {
        case 'newParticipantArrived':
            receiveVideo(message.userid, message.username);
            break;
        case 'existingParticipants':
            onExistingParticipants(message.userid, message.existingUsers);
            break;
        case 'receiveVideoAnswer':
            onReceiveVideoAnswer(message.senderid, message.sdpAnswer);
            break;
        case 'candidate':
            addIceCandidate(message.userid, message.candidate);
            break;
        case 'userDisconnected':
            removeUser(message.userid);
    }
});

const removeUser = (userid) => {
    console.log(userid);
    users = document.getElementsByName(userid);
    console.log(users);
    Array.from(users).forEach(element => {
        element.remove();
    })
}


const muteButton = document.getElementById('mute');
muteButton.addEventListener('click', () => {
    console.log(document.getElementById(muteButton.name));
    var val = document.getElementById(muteButton.name).getAudioTracks()[0].enabled;
    if (!val) {
        muteButton.innerText = "Mute";
        val = true;
        return
    }
    muteButton.innerText = "Unmute";
    val = false
});

// handlers functions
const receiveVideo = (userid, username) => {
    var video = document.createElement('video');
    var div = document.createElement('div');
    div.className = "videoContainer";
    div.setAttribute("name", userid);
    var name = document.createElement('div');
    video.id = userid;
    video.autoplay = true;
    name.appendChild(document.createTextNode(username));
    div.appendChild(video);
    div.appendChild(name);
    divMeetingRoom.appendChild(div);

    var user = {
        id: userid,
        username: username,
        video: video,
        rtcPeer: null
    }

    participants[user.id] = user;

    var options = {
        remoteVideo: video,
        onicecandidate: onIceCandidate
    }

    user.rtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerRecvonly(options,
        function (err) {
            if (err) {
                return console.error(err);
            }
            this.generateOffer(onOffer);
        }
    );

    var onOffer = function (err, offer, wp) {
        console.log('sending offer');
        var message = {
            event: 'receiveVideoFrom',
            userid: user.id,
            roomName: roomName,
            sdpOffer: offer
        }
        sendMessage(message);
    }

    function onIceCandidate(candidate, wp) {
        console.log('sending ice candidates');
        var message = {
            event: 'candidate',
            userid: user.id,
            roomName: roomName,
            candidate: candidate
        }
        sendMessage(message);
    }
}

const onExistingParticipants = (userid, existingUsers) => {
    muteButton.setAttribute('name', userid);
    var video = document.createElement('video');
    var div = document.createElement('div');
    div.className = "videoContainer";
    var name = document.createElement('div');
    video.id = userid;
    video.autoplay = true;
    name.appendChild(document.createTextNode(userName));
    div.appendChild(video);
    div.appendChild(name);
    divMeetingRoom.appendChild(div);

    var user = {
        id: userid,
        username: userName,
        video: video,
        rtcPeer: null
    }

    participants[user.id] = user;

    var constraints = {
        audio: true,
        video: {
            mandatory: {
                maxWidth: 320,
                maxFrameRate: 15,
                minFrameRate: 15
            }
        }
    };

    var options = {
        localVideo: video,
        mediaConstraints: constraints,
        onicecandidate: onIceCandidate
    }

    user.rtcPeer = kurentoUtils.WebRtcPeer.WebRtcPeerSendonly(options,
        function (err) {
            if (err) {
                return console.error(err);
            }
            this.generateOffer(onOffer)
        }
    );

    existingUsers.forEach(function (element) {
        receiveVideo(element.id, element.name);
    });

    var onOffer = function (err, offer, wp) {
        console.log('sending offer');
        var message = {
            event: 'receiveVideoFrom',
            userid: user.id,
            roomName: roomName,
            sdpOffer: offer
        }
        sendMessage(message);
    }

    function onIceCandidate(candidate, wp) {
        console.log('sending ice candidates');
        var message = {
            event: 'candidate',
            userid: user.id,
            roomName: roomName,
            candidate: candidate
        }
        sendMessage(message);
    }
}

const onReceiveVideoAnswer = (senderid, sdpAnswer) => {
    participants[senderid].rtcPeer.processAnswer(sdpAnswer);
}

const addIceCandidate = (userid, candidate) => {
    participants[userid].rtcPeer.addIceCandidate(candidate);
}

// utilities
const sendMessage = (message) => {
    console.log('sending ' + message.event + ' message to server');
    socket.emit('message', message);
}
