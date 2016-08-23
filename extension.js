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

        // Cleanup function when the extension is unloaded
        ext._shutdown = function() {};

        // Status reporting code
        // Use this to report missing hardware, plugin or unsupported browser
        ext._getStatus = function() {
            return {status: 2, msg: 'Ready'};
        };

        ext.searchAndPlay = function(query) {

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
                    trackURL = response['tracks']['items'][0].preview_url;
                    player = new Tone.Player(trackURL, startPlayer).toMaster(); 
                    
                    function startPlayer() {
                        player.start();
                        currentTrackDuration = player.buffer.duration;
                    }                   
                },
                error: function() {
                }
            });
        
        };

        ext.stopMusic = function() {
            player.stop();
        }

        // Block and block menu descriptions
        var descriptor = {
            blocks: [
              [' ', 'play music like %s', 'searchAndPlay', 'the beatles'],
              [' ', 'stop the music', 'stopMusic']
            ]
        };

        // Register the extension
        ScratchExtensions.register('Sample extension', descriptor, ext);
    }

})({});