(function(ext) {

    if (typeof Tone !== 'undefined') {
        console.log('Tone library is already loaded');
        startTone();
    } else {
        $.getScript('https://rawgit.com/Tonejs/CDN/gh-pages/r7/Tone.min.js', startTone);
    }

    function startTone() {

        var player;
        var currentTrackDuration = 0;
        var currentArtistName = 'none';
        var currentTrackName = 'none';
        var currentAlbumName = 'none';

        // Cleanup function when the extension is unloaded
        ext._shutdown = function() {};

        // Status reporting code
        // Use this to report missing hardware, plugin or unsupported browser
        ext._getStatus = function() {
            return {status: 2, msg: 'Ready'};
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
            }

            $.ajax({
                url: 'https://api.spotify.com/v1/search',
                data: {
                    q: query,
                    type: 'track',
                    limit: '1'
                },
                success: function (response) {
                    var trackObject = response['tracks']['items'][0];

                    if (!trackObject) {
                        currentArtistName = 'none';
                        currentTrackName = 'none';
                        currentAlbumName = 'none';
                        callback();
                        return;
                    }

                    currentArtistName = trackObject.artists[0].name;
                    currentTrackName = trackObject.name;
                    currentAlbumName = trackObject.album.name;

                    if (trackObject.explicit) {
                        console.log('sorry, ' + currentTrackName + ' by ' + currentArtistName + ' has explicit lyrics.');
                        currentTrackName += " (explicit lyrics, not played)"
                        callback();
                        return;
                    }
                    
                    var trackURL = trackObject.preview_url;
                    player = new Tone.Player(trackURL, startPlayer).toMaster(); 
                    
                    if (!waitForTrackToEnd) {
                        callback();
                        return;
                    }

                    function startPlayer() {
                        player.start();
                        currentTrackDuration = player.buffer.duration;
                        if (waitForTrackToEnd) {
                            window.setTimeout(function() {
                                callback();
                            }, currentTrackDuration*1000);
                        }
                    }                   
                },
                error: function() {
                }
            });
        
        };

        ext.trackName = function() {
            return currentTrackName;
        };

        ext.artistName = function() {
            return currentArtistName;
        };

        ext.albumName = function() {
            return currentAlbumName;
        };

        ext.stopMusic = function() {
            player.stop();
        };

        // Block and block menu descriptions
        var descriptor = {
            blocks: [
              ['w', 'play music like %s', 'searchAndPlay', 'the beatles'],
              ['w', 'play music like %s and wait', 'searchAndPlayAndWait', 'michael jackson'],
              ['r', 'track name', 'trackName'],
              ['r', 'artist name', 'artistName'],
              ['r', 'album name', 'albumName'],
              [' ', 'stop the music', 'stopMusic']
            ]
        };

        // Register the extension
        ScratchExtensions.register('Spotify', descriptor, ext);
    }

})({});