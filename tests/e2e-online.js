const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const TEST_PORT = 3210;
const BASE_URL = `http://localhost:${TEST_PORT}`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, timeoutMs, message) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result) return result;
    await sleep(50);
  }
  throw new Error(message || 'waitFor timeout');
}

function onceSocket(socket, event, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for socket event: ${event}`));
    }, timeoutMs);

    const handler = (payload) => {
      cleanup();
      resolve(payload);
    };

    function cleanup() {
      clearTimeout(timer);
      socket.off(event, handler);
    }

    socket.on(event, handler);
  });
}

function emitAck(socket, event, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting ack for ${event}`)), timeoutMs);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

function canLeft(tile, leftEnd) {
  return tile.top === leftEnd || tile.bottom === leftEnd;
}

function canRight(tile, rightEnd) {
  return tile.top === rightEnd || tile.bottom === rightEnd;
}

function pickPlayableMove(state) {
  const hand = state.players[state.me].hand || [];
  if (state.board.length === 0) {
    if (hand.length === 0) return null;
    return { tileId: hand[0].id, side: 'first' };
  }

  for (const tile of hand) {
    if (canLeft(tile, state.leftEnd)) return { tileId: tile.id, side: 'left' };
    if (canRight(tile, state.rightEnd)) return { tileId: tile.id, side: 'right' };
  }

  return null;
}

async function createClient(name) {
  const socket = io(BASE_URL, {
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000
  });

  await onceSocket(socket, 'connect', 5000);

  const events = {
    lobby: null,
    state: null
  };

  socket.on('lobby:update', (payload) => {
    events.lobby = payload;
  });

  socket.on('game:state', (payload) => {
    events.state = payload;
  });

  return { name, socket, events };
}

async function main() {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const server = spawn(process.execPath, [serverPath], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      OFFLINE_SEAT_TIMEOUT_MS: '1200'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverOut = '';
  server.stdout.on('data', (d) => { serverOut += d.toString(); });
  server.stderr.on('data', (d) => { serverOut += d.toString(); });

  try {
    await waitFor(async () => {
      try {
        const res = await fetch(BASE_URL);
        return res.ok;
      } catch {
        return false;
      }
    }, 8000, 'Server did not start in time');

    const html = await (await fetch(BASE_URL)).text();
    assert(html.includes('btn-online-copy-code'), 'Expected copy-code button in HTML');
    assert(html.includes('btn-online-copy-link'), 'Expected copy-link button in HTML');
    assert(html.includes('select-game-mode'), 'Expected mode selector in HTML');

    const host = await createClient('Host');
    const joiner = await createClient('Joiner');

    const hostKey = 'pk-host-e2e';
    const joinerKey = 'pk-joiner-e2e';

    const createRes = await emitAck(host.socket, 'room:create', { name: 'Host', playerKey: hostKey });
    assert(createRes && createRes.ok, 'room:create failed');
    assert(createRes.roomCode, 'room:create missing roomCode');

    const roomCode = createRes.roomCode;

    await waitFor(() => host.events.lobby && host.events.lobby.code === roomCode, 3000, 'Host lobby update missing');

    const joinRes = await emitAck(joiner.socket, 'room:join', {
      roomCode,
      name: 'Joiner',
      playerKey: joinerKey
    });
    assert(joinRes && joinRes.ok, 'room:join failed');

    await waitFor(() => {
      const l = host.events.lobby;
      if (!l || !Array.isArray(l.players)) return false;
      const humans = l.players.filter((p) => p && p.name && !p.isAI);
      return humans.length === 2;
    }, 3000, 'Expected 2 human players in lobby');

    const nonHostStart = await emitAck(joiner.socket, 'room:start', {});
    assert(!nonHostStart.ok, 'Non-host should not be able to start');

    const hostStart = await emitAck(host.socket, 'room:start', {});
    assert(hostStart.ok, 'Host failed to start game');

    await waitFor(() => host.events.state && joiner.events.state, 5000, 'Missing initial game state');

    let actingClient = null;
    await waitFor(() => {
      const hs = host.events.state;
      const js = joiner.events.state;
      if (!hs || !js) return false;
      if (hs.isMyTurn) {
        actingClient = host;
        return true;
      }
      if (js.isMyTurn) {
        actingClient = joiner;
        return true;
      }
      return false;
    }, 12000, 'Did not reach a human turn');

    const current = actingClient.events.state;
    const move = pickPlayableMove(current);

    if (move) {
      const badPass = await emitAck(actingClient.socket, 'game:pass', {});
      assert(!badPass.ok, 'Pass should fail when player has valid moves');

      const playRes = await emitAck(actingClient.socket, 'game:play', move);
      assert(playRes.ok, 'Valid play was rejected by server');

      await waitFor(() => {
        const s = actingClient.events.state;
        return s && s.moveHistory && s.moveHistory.length >= 1 && Array.isArray(s.board) && s.board.length >= 1;
      }, 5000, 'Move history did not update after play');
    } else {
      const passRes = await emitAck(actingClient.socket, 'game:pass', {});
      assert(passRes.ok, 'Pass should succeed when no valid moves');
    }

    joiner.socket.disconnect();

    const reconnectClient = await createClient('JoinerReconnect');
    const reconnectRes = await emitAck(reconnectClient.socket, 'room:reconnect', {
      roomCode,
      name: 'JoinerReload',
      playerKey: joinerKey
    });

    assert(reconnectRes.ok, 'Reconnect failed');
    assert.strictEqual(reconnectRes.playerIndex, joinRes.playerIndex, 'Reconnect seat index mismatch');

    reconnectClient.socket.disconnect();

    await waitFor(() => {
      const l = host.events.lobby;
      if (!l || !Array.isArray(l.players)) return false;
      const slot = l.players[joinRes.playerIndex];
      return slot && slot.isAI === true && slot.name === null;
    }, 4000, 'Offline seat timeout did not convert slot to AI');

    host.socket.disconnect();

    console.log('E2E OK: online multiplayer flow passed');
  } finally {
    server.kill('SIGTERM');
    await sleep(150);
    if (!server.killed) server.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error('E2E FAILED:', err.message);
  process.exitCode = 1;
});
