class GapleAnalysis {
    constructor(engine) {
        this.engine = engine;
    }

    // Probabilitas lawan memiliki tiap angka (hypergeometric)
    getOpponentProbabilities(myPlayerIndex) {
        const unseenTiles = this.engine.getUnseenTiles(myPlayerIndex);
        const totalUnseen = unseenTiles.length;
        const results = {};
        for (let p = 0; p < 4; p++) {
            if (p === myPlayerIndex) continue;
            const opCount = this.engine.players[p].length;
            const passedNums = this.engine.passHistory[p] || [];
            results[p] = {};
            for (let num = 0; num <= 6; num++) {
                const tilesWithNum = unseenTiles.filter(t => GapleEngine.tileHasNumber(t, num));
                if (passedNums.includes(num)) {
                    results[p][num] = { probability: 0, certain: true, reason: 'Pass saat angka ' + num };
                } else if (tilesWithNum.length === 0) {
                    results[p][num] = { probability: 0, certain: true, reason: 'Semua kartu angka ' + num + ' sudah terlihat' };
                } else {
                    const prob = this._probHasNumber(tilesWithNum.length, totalUnseen, opCount);
                    results[p][num] = { probability: Math.round(prob * 100), tilesAvailable: tilesWithNum.length };
                }
            }
        }
        return results;
    }

    _probHasNumber(k, n, draw) {
        if (draw <= 0 || k <= 0 || n <= 0) return 0;
        if (k >= n) return 1;
        if (draw > n) return 1;
        let logProb = 0;
        for (let i = 0; i < draw; i++) logProb += Math.log((n - k - i) / (n - i));
        return Math.max(0, Math.min(1, 1 - Math.exp(logProb)));
    }

    // Rencana permainan berdasarkan situasi
    getGamePlan(playerIndex) {
        const hand = this.engine.players[playerIndex];
        const plans = [];
        const numberCounts = {};
        for (let n = 0; n <= 6; n++) {
            numberCounts[n] = hand.filter(t => GapleEngine.tileHasNumber(t, n)).length;
        }
        const strongNums = Object.entries(numberCounts).filter(([, c]) => c >= 3).map(([n]) => parseInt(n));
        if (strongNums.length > 0) plans.push('Dominasi angka ' + strongNums.join(', ') + ' — kamu punya banyak kartu dengan angka ini.');
        const doubles = hand.filter(t => t.top === t.bottom);
        if (doubles.length >= 3) plans.push('Banyak double (' + doubles.length + ') — mainkan lebih awal agar tidak terjebak.');
        const totalPips = hand.reduce((s, t) => s + t.top + t.bottom, 0);
        if (totalPips > 50) plans.push('Total pip tinggi (' + totalPips + ') — buang kartu besar dulu untuk kurangi risiko jika game tutup.');
        if (hand.length <= 3) plans.push('Tinggal ' + hand.length + ' kartu — fokus habiskan kartu!');
        if (plans.length === 0) plans.push('Posisi seimbang. Ikuti arahan Coach AI untuk setiap langkah.');
        return plans;
    }

    // Analisis pasca pertandingan
    getPostGameAnalysis(playerIndex, playerNames) {
        const results = [];
        const names = playerNames || ['Pemain 1', 'Pemain 2', 'Pemain 3', 'Pemain 4'];
        for (let p = 0; p < 4; p++) {
            const pips = this.engine.players[p].reduce((s, t) => s + t.top + t.bottom, 0);
            const passed = this.engine.passHistory[p] || [];
            results.push({
                name: names[p],
                pips,
                isWinner: this.engine.winner === p,
                passCount: passed.length,
                tilesLeft: this.engine.players[p].length
            });
        }
        return results;
    }

    // Tracker kartu — kartu yang sudah turun, di tangan, dan belum terlihat
    getTileTracker(playerIndex) {
        const played = new Set(this.engine.getPlayedTileIds());
        const myHand = new Set(this.engine.players[playerIndex].map(t => t.id));
        return this.engine.allTiles.map(t => ({
            id: t.id, top: t.top, bottom: t.bottom,
            status: played.has(t.id) ? 'played' : (myHand.has(t.id) ? 'in-hand' : 'remaining')
        }));
    }

    // Catatan strategis — hanya pass, double informatif, dan peringatan hampir menang
    getStrategicNotes(myIndex, playerNames) {
        const notes = [];
        const history = this.engine.moveHistory;
        const names = playerNames || ['Pemain 1', 'Pemain 2', 'Pemain 3', 'Pemain 4'];

        for (const move of history) {
            const p = move.playerIndex;
            const name = names[p];
            if (p === myIndex) continue;

            if (move.type === 'pass') {
                const nums = move.passedOn || [];
                notes.push({
                    turn: 'Giliran ' + move.turnNumber,
                    text: '🚫 ' + name + ' PASS — tidak punya angka ' + nums.join(' & '),
                    type: 'note-danger'
                });
            } else if (move.type === 'place') {
                const t = move.tile;
                // Jika main double dan ujung board berbeda → kemungkinan tidak punya ujung lainnya
                if (t.top === t.bottom && move.leftEnd !== move.rightEnd) {
                    const otherEnd = (move.side === 'left') ? move.rightEnd : move.leftEnd;
                    notes.push({
                        turn: 'Giliran ' + move.turnNumber,
                        text: '🔍 ' + name + ' main double [' + t.top + '|' + t.bottom + '] — kemungkinan tidak punya angka ' + otherEnd,
                        type: 'note-warning'
                    });
                }
            }
        }

        // Ringkasan pass per lawan di bagian atas
        const summary = [];
        for (let p = 0; p < 4; p++) {
            if (p === myIndex) continue;
            const passed = this.engine.passHistory[p] || [];
            if (passed.length > 0) {
                summary.push({
                    turn: '📌 Ringkasan',
                    text: names[p] + ' tidak punya: ' + passed.join(', ') + ' — blok di angka ini!',
                    type: 'note-success'
                });
            }
        }

        // Peringatan lawan hampir menang
        for (let p = 0; p < 4; p++) {
            if (p === myIndex) continue;
            const rem = this.engine.players[p].length;
            if (rem <= 2 && rem > 0) {
                summary.push({
                    turn: '⚠️ Peringatan',
                    text: names[p] + ' tinggal ' + rem + ' kartu!',
                    type: 'note-danger'
                });
            }
        }

        return [...summary, ...notes.reverse()];
    }
}
window.GapleAnalysis = GapleAnalysis;
