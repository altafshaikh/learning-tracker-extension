#!/usr/bin/env node
// Reminder: Chrome does not hot-reload unpacked extensions; click Reload on chrome://extensions.

console.log(
  '\n\x1b[36m[Learning Tracker]\x1b[0m Source changed.\n' +
    '  → Open \x1b[1mchrome://extensions\x1b[0m and click \x1b[1mReload\x1b[0m on this extension.\n' +
    '  → Settings stay in \x1b[1mchrome.storage.local\x1b[0m (no need to re-enter Form URL / key after Reload).\n'
);
