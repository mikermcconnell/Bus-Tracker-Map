// Phase 3: Connection Test (Fetch Static File + Visual State)
(function () {
    // --- Visual Status Box ---
    var statusBox = document.createElement('div');
    statusBox.style.position = 'absolute';
    statusBox.style.top = '50%';
    statusBox.style.left = '50%';
    statusBox.style.transform = 'translate(-50%, -50%)';
    statusBox.style.fontSize = '40px';
    statusBox.style.color = 'yellow';
    statusBox.style.backgroundColor = 'rgba(0,0,0,0.8)';
    statusBox.style.padding = '20px';
    statusBox.style.border = '2px solid white';
    statusBox.style.zIndex = '10000';
    statusBox.innerHTML = 'Phase 3: Init';
    document.body.appendChild(statusBox);

    function setStatus(msg, color) {
        statusBox.innerHTML = msg;
        if (color) statusBox.style.color = color;
    }

    try {
        setStatus('Starting XHR...', 'white');

        // --- Fetch Static File (styles.css) ---
        // asking for a file we KNOW exists relative to us
        var xhr = new XMLHttpRequest();
        // timestamp to prevent caching
        var url = 'styles.css?t=' + new Date().getTime();

        xhr.open('GET', url, true);

        xhr.onreadystatechange = function () {
            var state = xhr.readyState;
            var status = xhr.status;

            var stateText = 'Unknown';
            if (state === 0) stateText = 'UNSENT';
            if (state === 1) stateText = 'OPENED';
            if (state === 2) stateText = 'HEADERS';
            if (state === 3) stateText = 'LOADING';
            if (state === 4) stateText = 'DONE';

            setStatus('State: ' + stateText + '<br>Status: ' + status, 'yellow');

            if (state === 4) {
                if (status === 200 || status === 0) { // 0 sometimes ok for local files
                    setStatus('SUCCESS!<br>Read ' + xhr.responseText.length + ' bytes', 'lime');
                } else {
                    setStatus('FAILED: ' + status, 'red');
                }
            }
        };

        xhr.timeout = 10000;
        xhr.ontimeout = function () {
            setStatus('TIMEOUT (10s)', 'red');
        };

        xhr.onerror = function () {
            setStatus('NETWORK ERROR', 'red');
        };

        setStatus('Sending...', 'cyan');
        xhr.send();

    } catch (err) {
        setStatus('CRASH: ' + err.message, 'red');
    }
})();
