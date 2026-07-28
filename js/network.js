class GapleNetwork {
    constructor() {
        this.socket = null;
        this.roomCode = null;
        this.playerIndex = null;
        this.playerKey = null;
        this.lobby = null;

        this.onLobbyUpdate = null;
        this.onGameState = null;
        this.onError = null;
        this.onConnected = null;
        this.onDisconnected = null;
    }

    connect() {
        if (this.socket) return;
        if (typeof io === 'undefined') {
            this._emitError('Socket.IO client tidak ditemukan. Jalankan via server Node.js.');
            return;
        }

        this.socket = io();
        this.socket.on('connect', () => {
            if (this.onConnected) this.onConnected();
        });

        this.socket.on('disconnect', () => {
            if (this.onDisconnected) this.onDisconnected();
        });

        this.socket.on('lobby:update', (payload) => {
            this.lobby = payload;
            if (this.onLobbyUpdate) this.onLobbyUpdate(payload);
        });

        this.socket.on('game:state', (payload) => {
            if (this.onGameState) this.onGameState(payload);
        });
    }

    createRoom(name, playerKey, done) {
        this.connect();
        if (!this.socket) return;
        this.socket.emit('room:create', { name, playerKey }, (res) => {
            if (!res || !res.ok) {
                this._emitError((res && res.error) || 'Gagal membuat room.');
                if (done) done(res || { ok: false });
                return;
            }
            this.roomCode = res.roomCode;
            this.playerIndex = res.playerIndex;
            this.playerKey = res.playerKey || playerKey || this.playerKey;
            if (done) done(res);
        });
    }

    joinRoom(roomCode, name, playerKey, done) {
        this.connect();
        if (!this.socket) return;
        this.socket.emit('room:join', { roomCode, name, playerKey }, (res) => {
            if (!res || !res.ok) {
                this._emitError((res && res.error) || 'Gagal join room.');
                if (done) done(res || { ok: false });
                return;
            }
            this.roomCode = res.roomCode;
            this.playerIndex = res.playerIndex;
            this.playerKey = res.playerKey || playerKey || this.playerKey;
            if (done) done(res);
        });
    }

    reconnectRoom(roomCode, name, playerKey, done) {
        this.connect();
        if (!this.socket) return;
        this.socket.emit('room:reconnect', { roomCode, name, playerKey }, (res) => {
            if (!res || !res.ok) {
                if (done) done(res || { ok: false });
                return;
            }
            this.roomCode = res.roomCode;
            this.playerIndex = res.playerIndex;
            this.playerKey = res.playerKey || playerKey || this.playerKey;
            if (done) done(res);
        });
    }

    leaveRoom(done) {
        if (!this.socket) return;
        this.socket.emit('room:leave', {}, () => {
            this.roomCode = null;
            this.playerIndex = null;
            if (done) done({ ok: true });
        });
    }

    startGame() {
        if (!this.socket) return;
        this.socket.emit('room:start', {}, (res) => {
            if (!res || !res.ok) this._emitError((res && res.error) || 'Gagal memulai game.');
        });
    }

    playTile(tileId, side) {
        if (!this.socket) return;
        this.socket.emit('game:play', { tileId, side }, (res) => {
            if (!res || !res.ok) this._emitError((res && res.error) || 'Langkah ditolak server.');
        });
    }

    pass() {
        if (!this.socket) return;
        this.socket.emit('game:pass', {}, (res) => {
            if (!res || !res.ok) this._emitError((res && res.error) || 'Pass ditolak server.');
        });
    }

    _emitError(message) {
        if (this.onError) this.onError(message);
    }
}

window.GapleNetwork = GapleNetwork;
