(function() {
    const engine = new GapleEngine();
    const ai = new GapleAI(engine);
    const analysis = new GapleAnalysis(engine);
    const ui = new GapleUI();
    const network = new GapleNetwork();

    const STORAGE_KEY = 'gaple_online_session_v1';

    let selectedTile = null;
    let isPlayerTurn = false;
    let gameStarted = false;
    let humanPlayers = 1;
    let activeHuman = 0;
    let gameMode = 'local';

    let onlineLobby = null;
    let onlineState = null;
    let aiPlayersOnline = [];
    let isAttemptingReconnect = false;

    const aiSpeed = 1000;
    const handoverDelay = 120;
    let playerDisplayNames = ['Pemain 1', 'Pemain 2', 'Pemain 3', 'Pemain 4'];

    const elMode = document.getElementById('select-game-mode');
    const elHuman = document.getElementById('select-human-players');
    const elLocalSettings = document.getElementById('local-mode-settings');
    const elOnlineControls = document.getElementById('online-controls');
    const elOnlineName = document.getElementById('online-name');
    const elOnlineRoomCode = document.getElementById('online-room-code');
    const elOnlineLobbyInfo = document.getElementById('online-lobby-info');

    bindEvents();
    bindNetworkEvents();
    hydrateFromUrl();
    initializeMode();

    function bindEvents() {
        document.getElementById('btn-new-game').addEventListener('click', startNewGame);
        elMode.addEventListener('change', onModeChange);

        elHuman.addEventListener('change', (e) => {
            const n = parseInt(e.target.value, 10);
            humanPlayers = Number.isFinite(n) ? Math.max(1, Math.min(4, n)) : 1;
            updatePlayerLabels();
            if (gameMode === 'local') {
                ui.setStatus('Mode lokal diubah: ' + humanPlayers + ' pemain manusia.', 'info');
            }
        });

        document.getElementById('btn-online-create').addEventListener('click', createOnlineRoom);
        document.getElementById('btn-online-join').addEventListener('click', joinOnlineRoom);
        document.getElementById('btn-online-start').addEventListener('click', startOnlineGame);
        document.getElementById('btn-online-leave').addEventListener('click', leaveOnlineRoom);
        document.getElementById('btn-online-copy-code').addEventListener('click', copyRoomCode);
        document.getElementById('btn-online-copy-link').addEventListener('click', copyRoomLink);

        document.getElementById('btn-toggle-analysis').addEventListener('click', () => ui.toggleAnalysisPanel());
        document.getElementById('btn-help').addEventListener('click', () => ui.showModal('help-modal'));
        document.getElementById('btn-close-help').addEventListener('click', () => ui.hideModal('help-modal'));
        document.getElementById('btn-close-result').addEventListener('click', () => ui.hideModal('result-modal'));
        document.getElementById('btn-play-again').addEventListener('click', () => {
            ui.hideModal('result-modal');
            if (gameMode === 'local') startNewGame();
            else ui.setStatus('Mode online: host bisa klik Start untuk ronde baru.', 'info');
        });
        document.getElementById('btn-close-analysis').addEventListener('click', () => ui.hideAnalysisPanel());
        document.getElementById('btn-pass').addEventListener('click', handlePass);
        document.getElementById('btn-handover-continue').addEventListener('click', () => {
            ui.hideModal('handover-modal');
            renderAll();
            updateAnalysis();
        });

        ui.onTileClick = handleTileClick;
        ui.onPlacement = handlePlacement;
        ui.onSuggestionClick = null;
    }

    function bindNetworkEvents() {
        network.onConnected = function() {
            if (gameMode === 'online') {
                ui.setStatus('Terhubung ke server multiplayer.', 'success');
                tryReconnectSeat();
            }
        };

        network.onDisconnected = function() {
            if (gameMode === 'online') {
                ui.setStatus('Terputus dari server. Mencoba reconnect...', 'warning');
            }
        };

        network.onError = function(message) {
            ui.setStatus(message, 'warning');
        };

        network.onLobbyUpdate = function(lobby) {
            if (gameMode !== 'online') return;
            onlineLobby = lobby;
            applyLobbyToNames(lobby);
            syncHumanPlayersFromLobby(lobby);
            renderOnlineLobby(lobby);
            updateOnlineButtons(lobby);
            updatePlayerLabels();
            renderAll();
        };

        network.onGameState = function(state) {
            if (gameMode !== 'online') return;
            onlineState = state;
            gameStarted = !!state.started;
            activeHuman = state.me;
            isPlayerTurn = !!state.isMyTurn && !state.gameOver;
            aiPlayersOnline = Array.isArray(state.aiPlayers) ? state.aiPlayers.slice() : [];

            applyOnlineStateToEngine(state);
            applyLobbyToNames(onlineLobby);

            selectedTile = null;
            renderAll();
            updateAnalysis();

            if (state.gameOver) {
                endGame();
                return;
            }

            if (state.isMyTurn) {
                ui.setStatus('Giliran kamu (' + getPlayerName(state.me) + ').', 'info');
                ui.setTurnIndicator('Giliran ' + getPlayerName(state.me));
            } else {
                ui.setStatus('Menunggu giliran. Sekarang: ' + getPlayerName(state.currentPlayer) + '.', 'info');
                ui.setTurnIndicator('Giliran ' + getPlayerName(state.currentPlayer));
            }
        };
    }

    function initializeMode() {
        gameMode = elMode.value === 'online' ? 'online' : 'local';
        applyModeUI();

        if (gameMode === 'online') {
            network.connect();
            ui.setStatus('Mode online aktif. Buat room, join room, atau tunggu reconnect.', 'info');
            tryReconnectSeat();
        } else {
            ui.setStatus('Klik "Permainan Baru" untuk mode lokal atau ubah ke mode online.', 'info');
        }

        updatePlayerLabels();
        updateOnlineButtons(onlineLobby);
        renderAll();
        updateAnalysis();
    }

    function hydrateFromUrl() {
        try {
            const params = new URLSearchParams(window.location.search);
            const mode = params.get('mode');
            const room = params.get('room');
            if (mode === 'online') elMode.value = 'online';
            if (room) elOnlineRoomCode.value = String(room).trim().toUpperCase().slice(0, 6);
        } catch (e) {}
    }

    function onModeChange() {
        gameMode = elMode.value === 'online' ? 'online' : 'local';
        selectedTile = null;
        isPlayerTurn = false;
        ui.showPassButton(false);
        ui.hideInlineSuggestions();
        ui.hideModal('handover-modal');

        if (gameMode === 'online') {
            network.connect();
            ui.setStatus('Mode online aktif. Buat room, join room, atau tunggu reconnect.', 'info');
            tryReconnectSeat();
        } else {
            resetOnlineState(false);
            ui.setStatus('Mode lokal aktif. Klik "Permainan Baru".', 'info');
        }

        applyModeUI();
        updateOnlineButtons(onlineLobby);
        updatePlayerLabels();
        renderAll();
        updateAnalysis();
    }

    function applyModeUI() {
        if (gameMode === 'online') {
            elLocalSettings.classList.add('hidden');
            elOnlineControls.classList.remove('hidden');
            document.getElementById('btn-new-game').disabled = true;
        } else {
            elLocalSettings.classList.remove('hidden');
            elOnlineControls.classList.add('hidden');
            document.getElementById('btn-new-game').disabled = false;
        }
    }

    function startNewGame() {
        if (gameMode !== 'local') {
            ui.setStatus('Mode online: pakai Create/Join/Start di panel online.', 'warning');
            return;
        }

        humanPlayers = getHumanPlayersFromUI();
        engine.deal();
        selectedTile = null;
        isPlayerTurn = false;
        activeHuman = 0;
        gameStarted = true;
        aiPlayersOnline = [];

        ui.showPassButton(false);
        ui.hideInlineSuggestions();
        updatePlayerLabels();
        renderAll();
        updateAnalysis();
        ui.setStatus('Permainan dimulai! Mode lokal: ' + humanPlayers + ' pemain manusia.', 'info');
        nextTurnLocal();
    }

    function nextTurnLocal() {
        if (gameMode !== 'local') return;
        if (engine.gameOver) {
            endGame();
            return;
        }

        const cp = engine.currentPlayer;
        const validMoves = engine.getValidMoves(cp);

        if (isHumanPlayer(cp)) {
            activeHuman = cp;
            isPlayerTurn = true;
            updatePlayerLabels();

            if (validMoves.length === 0) {
                ui.setStatus(getPlayerName(cp) + ': tidak ada kartu yang bisa dimainkan. Harus PASS.', 'warning');
                ui.showPassButton(true);
                ui.setTurnIndicator('Giliran ' + getPlayerName(cp) + ' — PASS');
            } else {
                ui.setStatus('Giliran ' + getPlayerName(cp) + '! Pilih kartu.', 'info');
                ui.showPassButton(false);
                ui.setTurnIndicator('Giliran ' + getPlayerName(cp));
            }

            showHandoverIfNeeded(cp);
            return;
        }

        isPlayerTurn = false;
        updatePlayerLabels();
        ui.setStatus(getPlayerName(cp) + ' (AI) sedang berpikir...', 'info');
        ui.setTurnIndicator('Giliran ' + getPlayerName(cp) + ' (AI)');
        ui.showPassButton(false);
        ui.hideInlineSuggestions();
        renderAll();

        setTimeout(() => {
            if (engine.gameOver || gameMode !== 'local') return;
            const move = ai.chooseMove(cp);
            if (!move) {
                engine.pass(cp);
                ui.setStatus(getPlayerName(cp) + ' PASS.', 'warning');
            } else {
                engine.placeTile(cp, move.tile, move.side);
                ui.setStatus(getPlayerName(cp) + ' memainkan [' + move.tile.top + '|' + move.tile.bottom + '].', 'info');
            }

            renderAll();
            updateAnalysis();

            if (engine.gameOver) endGame();
            else setTimeout(() => nextTurnLocal(), 300);
        }, aiSpeed);
    }

    function handleTileClick(tile) {
        if (!isPlayerTurn || engine.gameOver) return;
        if (engine.currentPlayer !== activeHuman) return;

        const validMoves = engine.getValidMoves(activeHuman);
        const movesForTile = validMoves.filter(m => m.tile.id === tile.id);
        if (movesForTile.length === 0) return;

        if (engine.board.length === 0) {
            selectedTile = tile;
            executePlacement('first');
            return;
        }

        if (movesForTile.length === 1) {
            selectedTile = tile;
            executePlacement(movesForTile[0].side);
        } else {
            selectedTile = tile;
            renderAll();
        }
    }

    function handlePlacement(side) {
        if (!isPlayerTurn || !selectedTile || engine.gameOver) return;
        executePlacement(side);
    }

    function executePlacement(side) {
        if (!selectedTile) return;

        if (gameMode === 'online') {
            const validMoves = engine.getValidMoves(activeHuman);
            const isValid = validMoves.some(m => m.tile.id === selectedTile.id && m.side === side);
            if (!isValid) {
                ui.setStatus('Langkah tidak valid.', 'warning');
                return;
            }
            network.playTile(selectedTile.id, side);
            selectedTile = null;
            renderAll();
            return;
        }

        const result = engine.placeTile(activeHuman, selectedTile, side);
        if (result.success) {
            selectedTile = null;
            isPlayerTurn = false;
            ui.showPassButton(false);
            ui.hideInlineSuggestions();
            renderAll();
            updateAnalysis();
            if (engine.gameOver) endGame();
            else setTimeout(() => nextTurnLocal(), aiSpeed);
        }
    }

    function handlePass() {
        if (!isPlayerTurn || engine.gameOver) return;

        if (gameMode === 'online') {
            network.pass();
            return;
        }

        engine.pass(activeHuman);
        isPlayerTurn = false;
        ui.showPassButton(false);
        ui.hideInlineSuggestions();
        renderAll();
        updateAnalysis();
        if (engine.gameOver) endGame();
        else setTimeout(() => nextTurnLocal(), aiSpeed);
    }

    function endGame() {
        gameStarted = false;
        isPlayerTurn = false;
        ui.showPassButton(false);

        const winnerName = getPlayerName(engine.winner);
        const isWinnerHuman = !isAiPlayer(engine.winner);
        ui.setStatus('Permainan selesai! ' + winnerName + ' menang!', isWinnerHuman ? 'success' : 'error');

        ui.renderResult(engine, playerDisplayNames);
        const post = analysis.getPostGameAnalysis(activeHuman, playerDisplayNames);
        ui.renderPostGameAnalysis(post);
        ui.showModal('result-modal');
        updateAnalysis();
    }

    function renderAll() {
        const isSingleLocal = gameMode === 'local' && humanPlayers === 1;
        const showActiveHand = gameMode === 'online' || isSingleLocal || (isPlayerTurn && engine.currentPlayer === activeHuman);
        const validMoves = isPlayerTurn && engine.currentPlayer === activeHuman ? engine.getValidMoves(activeHuman) : [];

        ui.renderOpponentHands(engine.players, activeHuman, playerDisplayNames, humanPlayers, aiPlayersOnline);
        ui.renderPlayerHand(showActiveHand ? engine.players[activeHuman] : [], validMoves, selectedTile ? selectedTile.id : null, null);
        ui.renderBoard(engine.board, engine.leftEnd, engine.rightEnd, selectedTile, validMoves);
        ui.renderEndpoints(engine.leftEnd, engine.rightEnd);
        ui.renderMoveHistory(engine.moveHistory);

        const myVisibleHand = showActiveHand ? engine.players[activeHuman] : [];
        ui.renderUnseenPanel(engine.allTiles, myVisibleHand, engine.getPlayedTileIds());

        if (gameMode === 'local') ui.renderNotesPanel(analysis.getStrategicNotes(activeHuman, playerDisplayNames));
        else ui.renderNotesPanel([]);
    }

    function updateAnalysis() {
        if (gameMode === 'online') {
            ui.renderProbabilities({});
            ui.renderGamePlan(['Analisis probabilitas dimatikan di mode online untuk menjaga informasi tersembunyi.']);
            ui.renderTileTracker([]);
            ui.hideInlineSuggestions();
            return;
        }

        try {
            const probs = analysis.getOpponentProbabilities(activeHuman);
            ui.renderProbabilities(probs);

            ui.hideInlineSuggestions();

            ui.renderGamePlan(analysis.getGamePlan(activeHuman));
            ui.renderTileTracker(analysis.getTileTracker(activeHuman));
        } catch (e) {
            console.error('Analysis error:', e);
        }
    }

    function createOnlineRoom() {
        if (gameMode !== 'online') return;
        const name = getOnlineName();
        const key = ensurePlayerKey();

        network.createRoom(name, key, (res) => {
            if (!res || !res.ok) return;
            elOnlineRoomCode.value = res.roomCode;
            saveOnlineSession({ roomCode: res.roomCode, playerKey: res.playerKey || key, name });
            ui.setStatus('Room dibuat: ' + res.roomCode, 'success');
        });
    }

    function joinOnlineRoom() {
        if (gameMode !== 'online') return;
        const roomCode = String(elOnlineRoomCode.value || '').trim().toUpperCase();
        if (!roomCode) {
            ui.setStatus('Masukkan kode room dulu.', 'warning');
            return;
        }

        const name = getOnlineName();
        const key = ensurePlayerKey();
        network.joinRoom(roomCode, name, key, (res) => {
            if (!res || !res.ok) return;
            saveOnlineSession({ roomCode: res.roomCode, playerKey: res.playerKey || key, name });
            ui.setStatus('Berhasil join room ' + res.roomCode + '.', 'success');
        });
    }

    function startOnlineGame() {
        if (gameMode !== 'online') return;
        if (!isCurrentUserHost()) {
            ui.setStatus('Hanya host yang bisa menekan Start.', 'warning');
            return;
        }
        network.startGame();
    }

    function leaveOnlineRoom() {
        if (gameMode !== 'online') return;
        network.leaveRoom(() => {
            clearOnlineSession();
            resetOnlineState(true);
            ui.setStatus('Keluar dari room online.', 'info');
        });
    }

    function copyRoomCode() {
        const code = getActiveRoomCode();
        if (!code) {
            ui.setStatus('Belum ada room code untuk disalin.', 'warning');
            return;
        }

        copyText(code, 'Room code disalin: ' + code);
    }

    function copyRoomLink() {
        const code = getActiveRoomCode();
        if (!code) {
            ui.setStatus('Belum ada room code untuk membuat link.', 'warning');
            return;
        }

        const url = buildRoomLink(code);
        copyText(url, 'Link join room disalin.');
    }

    function copyText(value, successMessage) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(value)
                .then(() => ui.setStatus(successMessage, 'success'))
                .catch(() => fallbackCopyText(value, successMessage));
            return;
        }
        fallbackCopyText(value, successMessage);
    }

    function fallbackCopyText(value, successMessage) {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
            document.execCommand('copy');
            ui.setStatus(successMessage, 'success');
        } catch (e) {
            ui.setStatus('Gagal menyalin otomatis. Salin manual: ' + value, 'warning');
        }
        document.body.removeChild(ta);
    }

    function tryReconnectSeat() {
        if (gameMode !== 'online' || isAttemptingReconnect) return;
        const session = loadOnlineSession();
        if (!session || !session.roomCode || !session.playerKey) return;

        isAttemptingReconnect = true;
        if (session.name) elOnlineName.value = session.name;
        elOnlineRoomCode.value = session.roomCode;

        network.reconnectRoom(session.roomCode, session.name || getOnlineName(), session.playerKey, (res) => {
            isAttemptingReconnect = false;
            if (!res || !res.ok) {
                clearOnlineSession();
                return;
            }

            saveOnlineSession({
                roomCode: res.roomCode,
                playerKey: res.playerKey || session.playerKey,
                name: getOnlineName()
            });
            ui.setStatus('Reconnect berhasil ke room ' + res.roomCode + '.', 'success');
        });
    }

    function loadOnlineSession() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            return {
                roomCode: String(parsed.roomCode || '').trim().toUpperCase().slice(0, 6),
                playerKey: String(parsed.playerKey || '').trim().slice(0, 80),
                name: String(parsed.name || '').trim().slice(0, 24)
            };
        } catch (e) {
            return null;
        }
    }

    function saveOnlineSession(session) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        } catch (e) {}
    }

    function clearOnlineSession() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch (e) {}
    }

    function ensurePlayerKey() {
        const existing = loadOnlineSession();
        if (existing && existing.playerKey) return existing.playerKey;

        const key = 'pk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
        saveOnlineSession({
            roomCode: getActiveRoomCode() || '',
            playerKey: key,
            name: getOnlineName()
        });
        return key;
    }

    function getActiveRoomCode() {
        if (onlineLobby && onlineLobby.code) return onlineLobby.code;
        if (network.roomCode) return network.roomCode;
        const typed = String(elOnlineRoomCode.value || '').trim().toUpperCase();
        return typed || '';
    }

    function buildRoomLink(code) {
        const cleanCode = String(code || '').trim().toUpperCase();
        const base = window.location.origin + window.location.pathname;
        return base + '?mode=online&room=' + encodeURIComponent(cleanCode);
    }

    function applyLobbyToNames(lobby) {
        if (!lobby || !Array.isArray(lobby.players)) {
            playerDisplayNames = ['Pemain 1', 'Pemain 2', 'Pemain 3', 'Pemain 4'];
            return;
        }

        playerDisplayNames = lobby.players.map((p, idx) => {
            if (!p || !p.name) return 'Pemain ' + (idx + 1);
            return p.name;
        });
    }

    function syncHumanPlayersFromLobby(lobby) {
        if (!lobby || !Array.isArray(lobby.players)) return;
        const humans = lobby.players.filter(p => p && p.name && !p.isAI).length;
        humanPlayers = Math.max(1, Math.min(4, humans || 1));
    }

    function renderOnlineLobby(lobby) {
        if (!lobby || !Array.isArray(lobby.players)) {
            elOnlineLobbyInfo.innerHTML = '<div class="online-empty">Belum ada room aktif.</div>';
            return;
        }

        const rows = lobby.players.map((p, idx) => {
            if (!p || !p.name) return '<div class="online-player-row">Slot ' + (idx + 1) + ': kosong</div>';
            const role = p.isAI ? 'AI' : 'Human';
            const me = (network.playerIndex === idx) ? ' (kamu)' : '';
            const state = p.connected ? 'online' : 'offline';
            const isHost = lobby.hostPlayerIndex === idx;
            return '<div class="online-player-row' + (isHost ? ' online-player-host' : '') + '">' +
                getPlayerName(idx) + me + (isHost ? ' [host]' : '') + ' · ' + role + ' · ' + state + '</div>';
        }).join('');

        const roomCode = lobby.code;
        const roomLink = buildRoomLink(roomCode);
        const qrSrc = 'https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=' + encodeURIComponent(roomLink);

        elOnlineLobbyInfo.innerHTML =
            '<div class="online-meta">Room: <b>' + roomCode + '</b></div>' +
            '<div class="online-meta">Status: ' + (lobby.started ? 'Sedang bermain' : 'Menunggu start') + '</div>' +
            '<div class="online-link">Link: ' + roomLink + '</div>' +
            '<img class="online-qr" src="' + qrSrc + '" alt="QR Join Room">' +
            rows;
    }

    function resetOnlineState(clearInputCode) {
        onlineLobby = null;
        onlineState = null;
        aiPlayersOnline = [];
        gameStarted = false;
        isPlayerTurn = false;
        selectedTile = null;
        applyLobbyToNames(null);
        humanPlayers = getHumanPlayersFromUI();
        activeHuman = 0;
        engine.reset();
        if (clearInputCode) elOnlineRoomCode.value = '';
        renderOnlineLobby(null);
        updateOnlineButtons(null);
        updatePlayerLabels();
        renderAll();
        updateAnalysis();
    }

    function updateOnlineButtons(lobby) {
        const btnStart = document.getElementById('btn-online-start');
        const btnCopyCode = document.getElementById('btn-online-copy-code');
        const btnCopyLink = document.getElementById('btn-online-copy-link');
        const hasRoom = !!(lobby && lobby.code);
        const iAmHost = hasRoom && isCurrentUserHost();

        btnStart.disabled = !hasRoom || !iAmHost || !!lobby.started;
        btnCopyCode.disabled = !hasRoom;
        btnCopyLink.disabled = !hasRoom;
    }

    function isCurrentUserHost() {
        if (!onlineLobby) return false;
        return onlineLobby.hostPlayerIndex === network.playerIndex;
    }

    function applyOnlineStateToEngine(state) {
        if (!state) return;

        engine.players = state.players.map((p, idx) => {
            if (!p) return [];
            if (idx === state.me) {
                return (p.hand || []).map(t => ({ top: t.top, bottom: t.bottom, id: t.id }));
            }
            const count = p.count || 0;
            const hidden = [];
            for (let i = 0; i < count; i++) hidden.push({ top: -1, bottom: -1, id: 'hidden-' + idx + '-' + i });
            return hidden;
        });

        engine.board = (state.board || []).map(t => ({
            top: t.top,
            bottom: t.bottom,
            id: t.id,
            placedBy: t.placedBy,
            placedSide: t.placedSide
        }));

        engine.leftEnd = state.leftEnd;
        engine.rightEnd = state.rightEnd;
        engine.currentPlayer = state.currentPlayer;
        engine.moveHistory = (state.moveHistory || []).map(m => ({ ...m }));
        engine.passHistory = state.passHistory || { 0: [], 1: [], 2: [], 3: [] };
        engine.gameOver = !!state.gameOver;
        engine.winner = state.winner;
    }

    function updatePlayerLabels() {
        ui.renderPlayerIdentity(activeHuman, playerDisplayNames, humanPlayers);
    }

    function getOnlineName() {
        const raw = String(elOnlineName.value || '').trim();
        return raw.slice(0, 24) || 'Pemain';
    }

    function getHumanPlayersFromUI() {
        const n = parseInt(elHuman.value, 10);
        if (!Number.isFinite(n)) return 1;
        return Math.max(1, Math.min(4, n));
    }

    function isHumanPlayer(playerIndex) {
        return playerIndex >= 0 && playerIndex < humanPlayers;
    }

    function isAiPlayer(playerIndex) {
        return aiPlayersOnline.includes(playerIndex) || (!onlineState && playerIndex >= humanPlayers);
    }

    function getPlayerName(index) {
        return playerDisplayNames[index] || ('Pemain ' + (index + 1));
    }

    function showHandoverIfNeeded(playerIndex) {
        renderAll();
        updateAnalysis();
        if (humanPlayers <= 1) return;

        const message = getPlayerName(playerIndex) + ', ini giliranmu. Siap?';
        ui.setHandoverMessage(message);
        setTimeout(() => ui.showModal('handover-modal'), handoverDelay);
    }
})();
