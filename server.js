const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { GapleEngine } = require('./js/game-engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*'
  }
});

const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname)));

function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getOrCreateUniqueRoomCode() {
  let code = makeRoomCode();
  while (rooms.has(code)) code = makeRoomCode();
  return code;
}

function createRoom(hostSocketId, hostName) {
  const hostKey = `host-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const code = getOrCreateUniqueRoomCode();
  const room = {
    code,
    hostSocketId,
    started: false,
    game: null,
    playersBySocket: new Map(),
    playersByKey: new Map(),
    playersByIndex: [null, null, null, null],
    aiPlayers: new Set(),
    createdAt: Date.now()
  };

  const player = {
    socketId: hostSocketId,
    name: hostName,
    playerIndex: 0,
    connected: true,
    playerKey: hostKey,
    disconnectedAt: null
  };
  room.playersBySocket.set(hostSocketId, player);
  room.playersByKey.set(hostKey, player);
  room.playersByIndex[0] = player;
  rooms.set(code, room);
  return room;
}

function makePlayerKey() {
  return `pk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function bindPlayerToSocket(room, player, socketId) {
  if (player.socketId && room.playersBySocket.has(player.socketId)) {
    room.playersBySocket.delete(player.socketId);
  }
  player.socketId = socketId;
  player.connected = true;
  player.disconnectedAt = null;
  room.playersBySocket.set(socketId, player);
}

function detachPlayerSocket(room, socketId) {
  const player = room.playersBySocket.get(socketId);
  if (!player) return null;
  room.playersBySocket.delete(socketId);
  player.socketId = null;
  player.connected = false;
  player.disconnectedAt = Date.now();
  return player;
}

function removePlayerFromRoom(room, player) {
  if (!player) return;
  if (player.socketId && room.playersBySocket.has(player.socketId)) {
    room.playersBySocket.delete(player.socketId);
  }
  if (player.playerKey && room.playersByKey.has(player.playerKey)) {
    room.playersByKey.delete(player.playerKey);
  }
  room.playersByIndex[player.playerIndex] = null;
}

function sanitizeLobby(room) {
  const host = room.hostSocketId ? room.playersBySocket.get(room.hostSocketId) : null;
  return {
    code: room.code,
    started: room.started,
    hostPlayerIndex: host ? host.playerIndex : null,
    players: room.playersByIndex.map((p, idx) => ({
      playerIndex: idx,
      name: p ? p.name : null,
      connected: p ? p.connected : false,
      isAI: room.aiPlayers.has(idx)
    }))
  };
}

function buildStateForPlayer(room, playerIndex) {
  const game = room.game;
  if (!game) return null;
  const players = game.players.map((hand, idx) => {
    if (idx === playerIndex) {
      return {
        count: hand.length,
        hand: hand.map(t => ({ top: t.top, bottom: t.bottom, id: t.id }))
      };
    }
    return { count: hand.length };
  });

  return {
    roomCode: room.code,
    started: room.started,
    me: playerIndex,
    currentPlayer: game.currentPlayer,
    leftEnd: game.leftEnd,
    rightEnd: game.rightEnd,
    board: game.board,
    moveHistory: game.moveHistory,
    passHistory: game.passHistory,
    gameOver: game.gameOver,
    winner: game.winner,
    players,
    isMyTurn: game.currentPlayer === playerIndex,
    aiPlayers: Array.from(room.aiPlayers),
    hostPlayerIndex: (() => {
      const host = room.hostSocketId ? room.playersBySocket.get(room.hostSocketId) : null;
      return host ? host.playerIndex : null;
    })()
  };
}

function emitLobby(room) {
  io.to(room.code).emit('lobby:update', sanitizeLobby(room));
}

function emitState(room) {
  for (const player of room.playersBySocket.values()) {
    const payload = buildStateForPlayer(room, player.playerIndex);
    io.to(player.socketId).emit('game:state', payload);
  }
}

function isHumanPlayer(room, playerIndex) {
  const p = room.playersByIndex[playerIndex];
  return !!p && !room.aiPlayers.has(playerIndex);
}

function chooseAiMove(game, playerIndex) {
  const validMoves = game.getValidMoves(playerIndex);
  if (validMoves.length === 0) return null;
  if (game.board.length === 0) {
    validMoves.sort((a, b) => (b.tile.top + b.tile.bottom) - (a.tile.top + a.tile.bottom));
    return validMoves[0];
  }
  const preferred = validMoves.find(m => m.tile.top === m.tile.bottom);
  return preferred || validMoves[0];
}

function runAiTurns(room) {
  if (!room.started || !room.game || room.game.gameOver) return;

  const step = () => {
    if (!room.started || !room.game || room.game.gameOver) {
      emitState(room);
      return;
    }

    const cp = room.game.currentPlayer;
    if (isHumanPlayer(room, cp)) {
      emitState(room);
      return;
    }

    const move = chooseAiMove(room.game, cp);
    if (!move) room.game.pass(cp);
    else room.game.placeTile(cp, move.tile, move.side);

    emitState(room);

    if (!room.game.gameOver) {
      setTimeout(step, 650);
    }
  };

  setTimeout(step, 650);
}

function tryAutoRemoveRoom(code) {
  const room = rooms.get(code);
  if (!room) return;

  const hasHumanSeat = room.playersByIndex.some((p, idx) => p && !room.aiPlayers.has(idx));
  if (room.started && hasHumanSeat) return;

  const hasConnectedHuman = room.playersByIndex.some((p, idx) => p && p.connected && !room.aiPlayers.has(idx));
  if (!hasConnectedHuman) rooms.delete(code);
}

io.on('connection', (socket) => {
  let joinedRoomCode = null;

  socket.on('room:create', ({ name, playerKey }, cb = () => {}) => {
    const cleanName = String(name || '').trim().slice(0, 24) || 'Pemain 1';
    const room = createRoom(socket.id, cleanName);
    const hostPlayer = room.playersByIndex[0];
    if (hostPlayer && playerKey) {
      room.playersByKey.delete(hostPlayer.playerKey);
      hostPlayer.playerKey = String(playerKey).trim().slice(0, 80);
      room.playersByKey.set(hostPlayer.playerKey, hostPlayer);
    }
    joinedRoomCode = room.code;
    socket.join(room.code);

    emitLobby(room);
    cb({ ok: true, roomCode: room.code, playerIndex: 0, playerKey: room.playersByIndex[0].playerKey });
  });

  socket.on('room:join', ({ roomCode, name, playerKey }, cb = () => {}) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) {
      cb({ ok: false, error: 'Room tidak ditemukan.' });
      return;
    }
    if (room.started) {
      cb({ ok: false, error: 'Permainan sudah dimulai.' });
      return;
    }

    const freeIndex = room.playersByIndex.findIndex(p => p === null);
    if (freeIndex === -1) {
      cb({ ok: false, error: 'Room sudah penuh.' });
      return;
    }

    const cleanName = String(name || '').trim().slice(0, 24) || `Pemain ${freeIndex + 1}`;
    const player = {
      socketId: socket.id,
      name: cleanName,
      playerIndex: freeIndex,
      connected: true,
      playerKey: String(playerKey || '').trim().slice(0, 80) || makePlayerKey(),
      disconnectedAt: null
    };
    room.playersBySocket.set(socket.id, player);
    room.playersByKey.set(player.playerKey, player);
    room.playersByIndex[freeIndex] = player;

    joinedRoomCode = room.code;
    socket.join(room.code);

    emitLobby(room);
    cb({ ok: true, roomCode: room.code, playerIndex: freeIndex, playerKey: player.playerKey });
  });

  socket.on('room:reconnect', ({ roomCode, name, playerKey }, cb = () => {}) => {
    const code = String(roomCode || '').trim().toUpperCase();
    const key = String(playerKey || '').trim();
    if (!code || !key) {
      cb({ ok: false, error: 'Data reconnect tidak lengkap.' });
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      cb({ ok: false, error: 'Room tidak ditemukan.' });
      return;
    }

    const player = room.playersByKey.get(key);
    if (!player) {
      cb({ ok: false, error: 'Seat reconnect tidak ditemukan.' });
      return;
    }

    const cleanName = String(name || '').trim().slice(0, 24);
    if (cleanName) player.name = cleanName;

    bindPlayerToSocket(room, player, socket.id);
    if (room.hostSocketId === null || room.hostSocketId === player.socketId) {
      room.hostSocketId = socket.id;
    }

    joinedRoomCode = room.code;
    socket.join(room.code);

    emitLobby(room);
    if (room.started) emitState(room);

    cb({ ok: true, roomCode: room.code, playerIndex: player.playerIndex, playerKey: player.playerKey, started: room.started });
  });

  socket.on('room:leave', (_, cb = () => {}) => {
    if (!joinedRoomCode) {
      cb({ ok: true });
      return;
    }

    const room = rooms.get(joinedRoomCode);
    if (!room) {
      joinedRoomCode = null;
      cb({ ok: true });
      return;
    }

    const player = room.playersBySocket.get(socket.id);
    if (player) {
      removePlayerFromRoom(room, player);
      if (room.hostSocketId === socket.id) {
        const nextHost = room.playersBySocket.values().next().value;
        room.hostSocketId = nextHost ? nextHost.socketId : null;
      }
    }

    socket.leave(room.code);
    joinedRoomCode = null;

    emitLobby(room);
    tryAutoRemoveRoom(room.code);
    cb({ ok: true });
  });

  socket.on('room:start', (_, cb = () => {}) => {
    const room = joinedRoomCode ? rooms.get(joinedRoomCode) : null;
    if (!room) {
      cb({ ok: false, error: 'Belum gabung room.' });
      return;
    }
    if (socket.id !== room.hostSocketId) {
      cb({ ok: false, error: 'Hanya host yang bisa memulai.' });
      return;
    }

    const humans = room.playersByIndex.filter(Boolean);
    if (humans.length < 2) {
      cb({ ok: false, error: 'Minimal 2 pemain manusia.' });
      return;
    }

    room.started = true;
    room.game = new GapleEngine();
    room.game.deal();
    room.aiPlayers.clear();
    for (let i = 0; i < 4; i++) {
      if (!room.playersByIndex[i]) room.aiPlayers.add(i);
    }

    emitLobby(room);
    emitState(room);
    runAiTurns(room);
    cb({ ok: true });
  });

  socket.on('game:play', ({ tileId, side }, cb = () => {}) => {
    const room = joinedRoomCode ? rooms.get(joinedRoomCode) : null;
    if (!room || !room.started || !room.game) {
      cb({ ok: false, error: 'Game belum dimulai.' });
      return;
    }

    const player = room.playersBySocket.get(socket.id);
    if (!player) {
      cb({ ok: false, error: 'Pemain tidak valid.' });
      return;
    }

    const cp = room.game.currentPlayer;
    if (cp !== player.playerIndex) {
      cb({ ok: false, error: 'Bukan giliran kamu.' });
      return;
    }

    const hand = room.game.players[player.playerIndex];
    const tile = hand.find(t => t.id === tileId);
    if (!tile) {
      cb({ ok: false, error: 'Kartu tidak ditemukan di tangan.' });
      return;
    }

    const result = room.game.placeTile(player.playerIndex, tile, side);
    if (!result.success) {
      cb({ ok: false, error: result.error || 'Langkah tidak valid.' });
      return;
    }

    emitState(room);
    runAiTurns(room);
    cb({ ok: true });
  });

  socket.on('game:pass', (_, cb = () => {}) => {
    const room = joinedRoomCode ? rooms.get(joinedRoomCode) : null;
    if (!room || !room.started || !room.game) {
      cb({ ok: false, error: 'Game belum dimulai.' });
      return;
    }

    const player = room.playersBySocket.get(socket.id);
    if (!player) {
      cb({ ok: false, error: 'Pemain tidak valid.' });
      return;
    }

    if (room.game.currentPlayer !== player.playerIndex) {
      cb({ ok: false, error: 'Bukan giliran kamu.' });
      return;
    }

    const validMoves = room.game.getValidMoves(player.playerIndex);
    if (validMoves.length > 0) {
      cb({ ok: false, error: 'Kamu masih punya langkah, tidak bisa PASS.' });
      return;
    }

    room.game.pass(player.playerIndex);
    emitState(room);
    runAiTurns(room);
    cb({ ok: true });
  });

  socket.on('disconnect', () => {
    if (!joinedRoomCode) return;
    const room = rooms.get(joinedRoomCode);
    if (!room) return;

    const player = detachPlayerSocket(room, socket.id);
    if (player && room.hostSocketId === socket.id) {
      const nextHost = room.playersBySocket.values().next().value;
      room.hostSocketId = nextHost ? nextHost.socketId : null;
    }

    emitLobby(room);
    tryAutoRemoveRoom(room.code);
  });
});

server.listen(PORT, () => {
  console.log(`Gaple multiplayer server running on http://localhost:${PORT}`);
});
