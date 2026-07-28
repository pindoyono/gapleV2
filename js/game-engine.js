class GapleEngine {
    constructor() {
        this.allTiles = [];
        for (let i = 0; i <= 6; i++)
            for (let j = i; j <= 6; j++)
                this.allTiles.push({ top: i, bottom: j, id: i + '-' + j });
        this.reset();
    }

    reset() {
        this.players = [[], [], [], []];
        this.board = [];
        this.leftEnd = null;
        this.rightEnd = null;
        this.currentPlayer = 0;
        this.gameOver = false;
        this.winner = null;
        this.turnNumber = 0;
        this.consecutivePasses = 0;
        this.moveHistory = [];
        this.passHistory = {};
        for (let i = 0; i < 4; i++) this.passHistory[i] = [];
    }

    deal() {
        this.reset();
        const deck = [...this.allTiles];
        // Fisher-Yates shuffle
        for (let i = deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        for (let p = 0; p < 4; p++)
            this.players[p] = deck.slice(p * 7, (p + 1) * 7).map(t => ({ ...t }));
        this.currentPlayer = this.determineFirstPlayer();
    }

    determineFirstPlayer() {
        // Random starting player
        return Math.floor(Math.random() * 4);
    }

    getValidMoves(playerIndex) {
        const hand = this.players[playerIndex];
        const moves = [];
        if (this.board.length === 0) {
            for (const tile of hand) moves.push({ tile, side: 'first' });
            return moves;
        }
        for (const tile of hand) {
            const canLeft = this._canPlaceOnSide(tile, this.leftEnd);
            const canRight = this._canPlaceOnSide(tile, this.rightEnd);
            if (canLeft) moves.push({ tile, side: 'left' });
            if (canRight && this.leftEnd !== this.rightEnd) moves.push({ tile, side: 'right' });
            if (canRight && this.leftEnd === this.rightEnd && !canLeft) moves.push({ tile, side: 'right' });
        }
        return moves;
    }

    _canPlaceOnSide(tile, endValue) {
        return tile.top === endValue || tile.bottom === endValue;
    }

    placeTile(playerIndex, tile, side) {
        const hand = this.players[playerIndex];
        const idx = hand.findIndex(t => t.id === tile.id);
        if (idx === -1) return { success: false, error: 'Tile not in hand' };
        hand.splice(idx, 1);
        this.consecutivePasses = 0;

        let placedTile;
        if (this.board.length === 0) {
            placedTile = { top: tile.top, bottom: tile.bottom, id: tile.id, placedSide: 'first', placedBy: playerIndex };
            this.leftEnd = tile.top;
            this.rightEnd = tile.bottom;
        } else if (side === 'left') {
            if (tile.bottom === this.leftEnd) {
                placedTile = { top: tile.top, bottom: tile.bottom, id: tile.id, placedSide: 'left', placedBy: playerIndex };
                this.leftEnd = tile.top;
            } else {
                placedTile = { top: tile.bottom, bottom: tile.top, id: tile.id, placedSide: 'left', placedBy: playerIndex };
                this.leftEnd = tile.bottom;
            }
            this.board.unshift(placedTile);
        } else {
            if (tile.top === this.rightEnd) {
                placedTile = { top: tile.top, bottom: tile.bottom, id: tile.id, placedSide: 'right', placedBy: playerIndex };
                this.rightEnd = tile.bottom;
            } else {
                placedTile = { top: tile.bottom, bottom: tile.top, id: tile.id, placedSide: 'right', placedBy: playerIndex };
                this.rightEnd = tile.top;
            }
            this.board.push(placedTile);
        }

        if (this.board.length === 1) this.board[0] = placedTile;

        const move = {
            turnNumber: this.turnNumber,
            playerIndex,
            tile: { top: tile.top, bottom: tile.bottom, id: tile.id },
            side,
            leftEnd: this.leftEnd,
            rightEnd: this.rightEnd,
            type: 'place'
        };
        this.moveHistory.push(move);
        this.turnNumber++;
        if (hand.length === 0) { this.gameOver = true; this.winner = playerIndex; }
        this.currentPlayer = (playerIndex + 1) % 4;
        return { success: true, move };
    }

    pass(playerIndex) {
        if (this.leftEnd !== null && !this.passHistory[playerIndex].includes(this.leftEnd))
            this.passHistory[playerIndex].push(this.leftEnd);
        if (this.rightEnd !== null && this.rightEnd !== this.leftEnd && !this.passHistory[playerIndex].includes(this.rightEnd))
            this.passHistory[playerIndex].push(this.rightEnd);
        const move = {
            turnNumber: this.turnNumber,
            playerIndex,
            type: 'pass',
            passedOn: [this.leftEnd, this.rightEnd].filter(v => v !== null),
            leftEnd: this.leftEnd,
            rightEnd: this.rightEnd
        };
        this.moveHistory.push(move);
        this.turnNumber++;
        this.consecutivePasses++;
        if (this.consecutivePasses >= 4) { this.gameOver = true; this.winner = this._determineWinnerByPips(); }
        this.currentPlayer = (playerIndex + 1) % 4;
        return { success: true, move };
    }

    _determineWinnerByPips() {
        let minPips = Infinity, winner = 0;
        for (let p = 0; p < 4; p++) {
            const total = this.players[p].reduce((sum, t) => sum + t.top + t.bottom, 0);
            if (total < minPips) { minPips = total; winner = p; }
        }
        return winner;
    }

    getUnseenTiles(playerIndex) {
        const myIds = new Set(this.players[playerIndex].map(t => t.id));
        const playedIds = new Set(this.board.map(t => t.id));
        return this.allTiles.filter(t => !myIds.has(t.id) && !playedIds.has(t.id));
    }

    getPlayedTileIds() {
        return this.board.map(t => t.id);
    }

    static tileHasNumber(tile, num) { return tile.top === num || tile.bottom === num; }

    clone() {
        const c = new GapleEngine();
        c.players = this.players.map(hand => hand.map(t => ({ ...t })));
        c.board = this.board.map(t => ({ ...t }));
        c.leftEnd = this.leftEnd;
        c.rightEnd = this.rightEnd;
        c.currentPlayer = this.currentPlayer;
        c.gameOver = this.gameOver;
        c.winner = this.winner;
        c.turnNumber = this.turnNumber;
        c.consecutivePasses = this.consecutivePasses;
        c.moveHistory = this.moveHistory.map(m => ({ ...m }));
        c.passHistory = {};
        for (let i = 0; i < 4; i++) c.passHistory[i] = [...(this.passHistory[i] || [])];
        return c;
    }
}

if (typeof window !== 'undefined') {
    window.GapleEngine = GapleEngine;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { GapleEngine };
}
