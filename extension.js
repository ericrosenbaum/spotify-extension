(function(ext) {

    if (typeof Tone !== 'undefined') {
        console.log('Tone library is already loaded');
        startExtension();
    } else {
        $.getScript('https://rawgit.com/Tonejs/CDN/gh-pages/r8/Tone.min.js', startExtension);
    }

    function startExtension() { 

        console.log(location.search);

        // player for playing entire track
        var player = new Tone.Player().toMaster();

        // beat players for playing individual beat at a time
        var beatPlayers = [];
        var releaseDur = 0.01;
        for (var i=0; i<4; i++) {
            var beatPlayer = new Tone.Player();
            var ampEnv = new Tone.AmplitudeEnvelope({
                "attack": 0.01,
                "decay": 0,
                "sustain": 1.0,
                "release": releaseDur
            }).toMaster();
            beatPlayer.connect(ampEnv);
            beatPlayer.ampEnv = ampEnv;
            beatPlayers.push(beatPlayer);
        }
        currentBeatPlayerIndex = 0;

        // gain node
        var gain = new Tone.Gain();
        Tone.Master.chain(gain);

        var audioContext = Tone.context;

        var trackTimingData;
        var currentBeatNum = 0;
        var beatFlag = false;
        var barFlag = false;
        var beatTimeouts = [];
        var barTimeouts = [];
        var trackTimeout;

        var trackStartTime;

        var currentTrackDuration = 0;
        var trackTempo = 0;
        var currentArtistName = 'none';
        var currentTrackName = 'none';
        var currentAlbumName = 'none';
        var numBeats = 0;

        // Cleanup function when the extension is unloaded
        ext._shutdown = function() {};

        // Status reporting code
        // Use this to report missing hardware, plugin or unsupported browser
        ext._getStatus = function() {
            if (typeof AudioContext !== "undefined") {
                return {status: 2, msg: 'Ready'};
            } else {
                return {status: 1, msg: 'Browser not supported'};
            }
        };

        ext.searchAndPlayAndWait = function(query, callback) {
            requestSearchAndPlay(query, true, callback);
        };

        ext.searchAndPlay = function(query, callback) {
            requestSearchAndPlay(query, false, callback);
        };

        function requestSearchAndPlay(query, waitForTrackToEnd, callback) {

            if (player) {
                player.stop();
                clearTimeouts();
            }

            $.ajax({
                url: 'https://api.spotify.com/v1/search',
                data: {
                    q: query,
                    type: 'track'
                },
                success: function (response) {
                    var trackObjects = response['tracks']['items'];

                    // fail if there are no tracks
                    if (!trackObjects) {
                        resetTrackData();
                        callback();
                        return;
                    }

                    // find the first result without explicit lyrics
                    var trackObject;
                    for (var i=0; i<trackObjects.length; i++) {
                        if (!trackObjects[i].explicit) {
                            trackObject = trackObjects[i];
                            break;
                        }
                    }

                    // fail if there were none without explicit lyrics
                    if (!trackObject) {
                        resetTrackData();
                        callback();
                        return;
                    }

                    // store track name, artist, album
                    currentArtistName = trackObject.artists[0].name;
                    currentTrackName = trackObject.name;
                    currentAlbumName = trackObject.album.name;

                    currentBeatNum = 0;

                    // download track, get timing data, and play it

                    var trackURL = trackObject.preview_url;  
                    console.log('trackURL: ' + trackURL);

                    getTrackTimingData(trackURL, trackFinishedLoading);
            
                    function trackFinishedLoading() {
                        if (!waitForTrackToEnd) {
                            callback();
                        } else {
                            trackTimeout = window.setTimeout(function() {
                                callback();
                            }, currentTrackDuration*1000);
                        }
                    }

                },
                error: function() {
                }
            });
        
        };

        function setupTimeouts() {
            // events on each beat
            beatTimeouts = [];
            for (var i=0; i<numBeats; i++) {
                var t = window.setTimeout(function(i) {
                    beatFlag = true;
                    currentBeatNum = i;
                }, trackTimingData.beats[i] * 1000, i);
                beatTimeouts.push(t);
            }

            // events on each bar
            barTimeouts = [];
            for (var i=0; i<trackTimingData.downbeats.length; i++) {
                if (trackTimingData.downbeats[i] < trackTimingData.beats[numBeats-1]) {
                    var t = window.setTimeout(function() {
                        barFlag = true;
                    }, trackTimingData.downbeats[i] * 1000);
                    barTimeouts.push(t);
                }
            }
        }

        function resetTrackData() {
            currentArtistName = 'none';
            currentTrackName = 'none';
            currentAlbumName = 'none';
            trackTempo = 0;
        }              

        // code adapted from spotify
        function getTrackTimingData(url, callback) {

            function findString(buffer, string) {
              for (var i = 0; i < buffer.length - string.length; i++) {
                var match = true;
                for (var j = 0; j < string.length; j++) {
                  var c = String.fromCharCode(buffer[i + j]);
                  if (c !== string[j]) {
                    match = false;
                    break;
                  }
                }
                if (match) {
                  return i;
                }
              }
              return -1;
            }

            function getSection(buffer, start, which) {
              var sectionCount = 0;
              for (var i = start; i < buffer.length; i++) {
                if (buffer[i] == 0) {
                  sectionCount++;
                }
                if (sectionCount >= which) {
                  break;
                }
              }
              i++;
              var content = '';
              while (i < buffer.length) {
                if (buffer[i] == 0) {
                  break;
                }
                var c = String.fromCharCode(buffer[i]);
                content += c;
                i++;
              }
              var js = '';
              try {
                js = eval('(' + content + ')');
              } catch (e) {
                js = '';
              }
              return js;
            }

            function makeRequest(url, callback) {
                var request = new XMLHttpRequest();
                request.open('GET', url, true);
                request.responseType = 'arraybuffer';
                request.onload = function() {
                    var buffer = new Uint8Array(this.response); // this.response == uInt8Array.buffer
                    var idx = findString(buffer, 'GEOB');

                    trackTimingData = getSection(buffer, idx + 1, 8);

                    if (!trackTimingData) {
                        callback();
                        return;
                    }

                    console.log(trackTimingData);

                    // estimate the tempo using the average time interval between beats
                    var sum =0;
                    for (var i=0; i<trackTimingData.beats.length-1; i++) {
                        sum += trackTimingData.beats[i+1] - trackTimingData.beats[i];
                    }
                    var beatLength = sum / (trackTimingData.beats.length - 1);
                    trackTempo = 60 / beatLength;

                    // use the loop duration to set the number of beats
                    for (var i=0; i<trackTimingData.beats.length; i++) {
                        if (trackTimingData.loop_duration < trackTimingData.beats[i]) {
                            numBeats = i;
                            break;
                        }
                    }

                    // decode and play the audio
                    audioContext.decodeAudioData(request.response, function(buffer) {
                        setupTimeouts();
                        player.buffer.set(buffer);
                        currentTrackDuration = trackTimingData.loop_duration;
                        player.start(Tone.now(), 0, trackTimingData.loop_duration); 
                        trackStartTime = Tone.now();
                        for (var i=0; i<beatPlayers.length; i++) {
                            beatPlayers[i].buffer.set(buffer);
                        }
                        callback();   
                    }); 
                }
                request.send();
            }

            makeRequest(url, callback);
        }

        ext.trackData = function(dataType) {
            switch (dataType) {
                case 'track':
                    return currentTrackName;
                case 'artist':
                    return currentArtistName;
                case 'album':
                    return currentAlbumName;
                case 'full':
                    return currentTrackName + ' by ' + currentArtistName + ' from ' + currentAlbumName;
                default:
                    return '';                    
            }
        };

        ext.artistName = function() {
            return currentArtistName;
        };

        ext.albumName = function() {
            return currentAlbumName;
        };

        ext.trackTempo = function() {
            return trackTempo;
        };

        ext.playNextBeat = function() {
            setCurrentBeatNum(currentBeatNum + 1);
            playCurrentBeat();    
        };

        ext.playBeat = function(num) {
            setCurrentBeatNum(num);
            playCurrentBeat();
        };

        ext.playBeatAndWait = function(num, callback) {
            setCurrentBeatNum(num);
            playCurrentBeat(callback);
        };

        function setCurrentBeatNum(num) {
            num = Math.round(num);
            currentBeatNum = num % numBeats;
            if (currentBeatNum < 0) {
                currentBeatNum += numBeats;
            }
        }

        function playCurrentBeat(callback) {
            var startTime = trackTimingData.beats[currentBeatNum];
            var duration;
            if ((currentBeatNum + 1) < numBeats) {
                var endTime = trackTimingData.beats[currentBeatNum+1];
                duration = endTime - startTime;
            } else {
                duration = currentTrackDuration - startTime;
            }

            beatPlayers[currentBeatPlayerIndex].ampEnv.triggerRelease();
            beatPlayers[currentBeatPlayerIndex].stop(releaseDur);
            currentBeatPlayerIndex++;
            currentBeatPlayerIndex %= beatPlayers.length;
            beatPlayers[currentBeatPlayerIndex].ampEnv.triggerAttackRelease(duration-releaseDur);
            beatPlayers[currentBeatPlayerIndex].start('+0', startTime, duration);

            beatFlag = true;  
            if (callback) {
                window.setTimeout(function() {
                    callback();
                }, (duration - (1/30)) * 1000);
            } 
        }

        ext.currentBeat = function() {
            return currentBeatNum;
        };

        ext.stopMusic = function() {
            player.stop();
            clearTimeouts();
        };

        function clearTimeouts() {
            clearTimeout(trackTimeout);
            for (var i=0; i<beatTimeouts.length; i++) {
                clearTimeout(beatTimeouts[i]);
            }
            for (var i=0; i<barTimeouts.length; i++) {
                clearTimeout(barTimeouts[i]);
            }
        }

        ext.everyBeat = function() {
            if (beatFlag) {
                window.setTimeout(function() {
                    beatFlag = false;
                }, 10);
                return true;
            }
            return false;
        };

        ext.everyBar = function() {
            if (barFlag) {
                window.setTimeout(function() {
                    barFlag = false;
                }, 10);
                return true;
            }
            return false;
        };

        // Block and block menu descriptions
        var descriptor = {
            blocks: [
              ['w', '♫ play music like %s', 'searchAndPlay', 'pharrell happy'],
              ['w', '♫ play music like %s and wait', 'searchAndPlayAndWait', 'michael jackson'],
              [' ', '♫ stop the music', 'stopMusic'],
              ['r', '♫ %m.trackData name', 'trackData', 'track'],
              [' ', '♫ play next beat', 'playNextBeat'],
              [' ', '♫ play beat %n', 'playBeat', 4],
              ['w', '♫ play beat %n and wait', 'playBeatAndWait', 4],
              ['r', '♫ current beat', 'currentBeat'],
              ['h', '♫ every beat', 'everyBeat'],
              ['h', '♫ every bar', 'everyBar'],
            ],
            menus: {
                trackData: ['track', 'artist', 'album', 'full']
            }
        };

        // Register the extension
        ScratchExtensions.register('Spotify', descriptor, ext);
    }

})({});