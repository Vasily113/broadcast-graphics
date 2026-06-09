import net from 'net';

/** Unix socket path for native playoutd on a channel (must match playoutd/main.cpp). */
export function playoutControlSocketPath(channelId) {
  let n = 'bgv13_playout_';
  for (const c of channelId || 'default') {
    if (/[a-zA-Z0-9]/.test(c)) n += c;
    else if (c === '-' || c === '_') n += '_';
  }
  if (n.length <= 14) n += 'default';
  return `/tmp/${n}.sock`;
}

/** Best-effort forward of control commands to playoutd (no-op if socket absent). */
export function forwardToPlayoutd(channelId, command) {
  const payload = `${JSON.stringify(command)}\n`;
  const socketPath = playoutControlSocketPath(channelId);
  const legacyPath = socketPath.replace(/\.sock$/, '');

  const tryWrite = (path) => {
    const client = net.createConnection(path, () => {
      client.write(payload);
      client.end();
    });
    client.on('error', () => {});
  };

  // Primary path (.sock) + legacy fallback (without suffix).
  tryWrite(socketPath);
  if (legacyPath !== socketPath) tryWrite(legacyPath);
}
