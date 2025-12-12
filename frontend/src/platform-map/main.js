// Minimal Test
(function () {
    var d = document.createElement('div');
    d.innerHTML = 'External JS <b>LOADED</b>';
    d.style.color = 'lime';
    d.style.fontSize = '24px';
    d.style.position = 'absolute';
    d.style.top = '100px';
    d.style.left = '50px';
    d.style.zIndex = '9999';
    document.body.appendChild(d);

    // Log to inline debug console if it exists
    var consoleDiv = document.getElementById('debug-console');
    if (consoleDiv) {
        var line = document.createElement('div');
        line.textContent = 'External JS Execution Confirmed';
        line.style.color = 'lime';
        consoleDiv.appendChild(line);
    }
})();
