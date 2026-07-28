class GapleAI {
    constructor(engine) {
        this.engine = engine;
        this.simulations = 200;
    }

    // Pilih langkah terbaik untuk AI (dipakai saat giliran AI)
    chooseMove(playerIndex) {
        const moves = this.engine.getValidMoves(playerIndex);
        if (moves.length === 0) return null;
        if (moves.length === 1) return moves[0];

        const results = [];
        for (const move of moves) {
            let wins = 0;
            const simsPerMove = Math.max(20, Math.floor(this.simulations / moves.length));
            for (let s = 0; s < simsPerMove; s++) {
                const result = this._simulate(playerIndex, move);
                if (result.winner === playerIndex) wins++;
            }
            results.push({ ...move, winRate: Math.round((wins / simsPerMove) * 100), simsRun: simsPerMove });
        }
        results.sort((a, b) => b.winRate - a.winRate);
        return results[0];
    }

    _simulate(playerIndex, move) {
        const sim = this.engine.clone();
        this._randomizeUnknownCards(sim, playerIndex);
        sim.placeTile(playerIndex, move.tile, move.side);
        let safety = 0;
        while (!sim.gameOver && safety++ < 100) {
            const cp = sim.currentPlayer;
            const validMoves = sim.getValidMoves(cp);
            if (validMoves.length === 0) { sim.pass(cp); }
            else { const m = this._pickPlayoutMove(sim, cp, validMoves); sim.placeTile(cp, m.tile, m.side); }
        }
        const pips = {};
        for (let p = 0; p < 4; p++) pips[p] = sim.players[p].reduce((s, t) => s + t.top + t.bottom, 0);
        return { winner: sim.winner, pips };
    }

    _randomizeUnknownCards(sim, myIndex) {
        const unknownCards = [];
        const handSizes = [];
        for (let p = 0; p < 4; p++) {
            if (p === myIndex) continue;
            handSizes.push({ player: p, size: sim.players[p].length });
            for (const t of sim.players[p]) unknownCards.push({ ...t });
        }
        for (let i = unknownCards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [unknownCards[i], unknownCards[j]] = [unknownCards[j], unknownCards[i]];
        }
        let idx = 0;
        for (const hs of handSizes) {
            sim.players[hs.player] = unknownCards.slice(idx, idx + hs.size);
            idx += hs.size;
        }
    }

    _pickPlayoutMove(sim, playerIndex, moves) {
        if (moves.length === 1) return moves[0];
        const weights = moves.map(m => {
            let w = 1;
            if (m.tile.top === m.tile.bottom) w += 2;
            w += (m.tile.top + m.tile.bottom) * 0.3;
            return w;
        });
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (let i = 0; i < moves.length; i++) { r -= weights[i]; if (r <= 0) return moves[i]; }
        return moves[moves.length - 1];
    }

    // =====================================================
    // COACH: Analisis mendalam berbasis Monte Carlo
    // =====================================================
    getCoachAdvice(playerIndex) {
        const moves = this.engine.getValidMoves(playerIndex);
        if (moves.length === 0) {
            return { strategy: 'pass', message: '⏭️ Tidak ada kartu yang bisa dimainkan. Kamu harus PASS.', moves: [] };
        }

        const hand = this.engine.players[playerIndex];
        const simsPerMove = Math.max(40, Math.floor(this.simulations / moves.length));
        const results = [];

        for (const move of moves) {
            let wins = 0, opBlockCount = 0;
            for (let s = 0; s < simsPerMove; s++) {
                const sim = this.engine.clone();
                this._randomizeUnknownCards(sim, playerIndex);
                sim.placeTile(playerIndex, move.tile, move.side);
                let safety = 0;
                while (!sim.gameOver && safety++ < 100) {
                    const cp = sim.currentPlayer;
                    const vm = sim.getValidMoves(cp);
                    if (vm.length === 0) { sim.pass(cp); if (cp !== playerIndex) opBlockCount++; }
                    else { const m = this._pickPlayoutMove(sim, cp, vm); sim.placeTile(cp, m.tile, m.side); }
                }
                if (sim.winner === playerIndex) wins++;
            }

            const winRate = Math.round((wins / simsPerMove) * 100);
            const blockRate = Math.round((opBlockCount / simsPerMove) * 100);

            // Hitung ujung baru setelah langkah ini
            const simCheck = this.engine.clone();
            simCheck.placeTile(playerIndex, move.tile, move.side);
            const newLeft = simCheck.leftEnd;
            const newRight = simCheck.rightEnd;

            const classification = this._classifyMove(playerIndex, move, winRate, blockRate, newLeft, newRight, hand);

            results.push({
                tile: move.tile,
                side: move.side,
                sideLabel: move.side === 'left' ? 'Kiri' : (move.side === 'right' ? 'Kanan' : 'Pertama'),
                winRate,
                blockRate,
                classification
            });
        }

        results.sort((a, b) => b.winRate - a.winRate);
        if (results.length > 0) results[0].isBest = true;

        const overallStrategy = this._determineOverallStrategy(playerIndex, results[0], results);
        return { strategy: overallStrategy.type, message: overallStrategy.message, moves: results };
    }

    _classifyMove(playerIndex, move, winRate, blockRate, newLeft, newRight, hand) {
        const tags = [];
        const reasons = [];
        const tile = move.tile;
        const passHistory = this.engine.passHistory;
        const pips = tile.top + tile.bottom;
        const remainingAfter = hand.filter(t => t.id !== tile.id);

        if (remainingAfter.length === 0) {
            return { tags: ['🏆 MENANG'], reasons: ['Ini kartu terakhir — langsung menang!'], type: 'finish' };
        }

        // Cek apakah langkah ini memblok lawan
        let blocksOpponent = false;
        for (let op = 0; op < 4; op++) {
            if (op === playerIndex) continue;
            const opPassed = passHistory[op] || [];
            if (opPassed.includes(newLeft) && opPassed.includes(newRight)) {
                const opName = op === 1 ? 'P2' : op === 2 ? 'P3' : 'P4';
                tags.push('🔒 Kunci ' + opName);
                reasons.push('Kedua ujung (' + newLeft + ' & ' + newRight + ') tidak dimiliki lawan');
                blocksOpponent = true;
            } else if (opPassed.includes(newLeft) || opPassed.includes(newRight)) {
                const blocked = opPassed.includes(newLeft) ? newLeft : newRight;
                tags.push('⚔️ Blok ujung ' + blocked);
                reasons.push('Ujung ' + blocked + ' memblok lawan yang sudah pass angka ini');
                blocksOpponent = true;
            }
        }

        if (blockRate >= 40 && !blocksOpponent) {
            tags.push('⚔️ Serangan');
            reasons.push('Simulasi: ' + blockRate + '% lawan terblok setelah langkah ini');
        }

        // Fleksibilitas kartu sisa
        const connectCount = remainingAfter.filter(t =>
            GapleEngine.tileHasNumber(t, newLeft) || GapleEngine.tileHasNumber(t, newRight)
        ).length;
        const flexibility = remainingAfter.length > 0 ? Math.round((connectCount / remainingAfter.length) * 100) : 0;

        if (flexibility >= 70) {
            tags.push('🛡️ Aman');
            reasons.push(connectCount + '/' + remainingAfter.length + ' sisa kartu cocok — tetap bisa jalan');
        } else if (flexibility <= 30 && remainingAfter.length > 1) {
            tags.push('⚠️ Risiko');
            reasons.push('Hanya ' + connectCount + '/' + remainingAfter.length + ' sisa kartu cocok — bisa stuck');
        }

        if (pips >= 9) {
            tags.push('📉 Buang besar');
            reasons.push('Pip ' + pips + ' — kurangi risiko jika game tutup');
        }

        if (tile.top === tile.bottom) {
            reasons.push('Double [' + tile.top + '|' + tile.bottom + '] — mainkan sekarang sebelum terperangkap');
        }

        if (winRate >= 60) reasons.push('Win rate tinggi: ' + winRate + '%');
        else if (winRate <= 25) reasons.push('Win rate rendah: ' + winRate + '% — pertimbangkan langkah lain');
        else reasons.push('Win rate: ' + winRate + '%');

        let type = 'neutral';
        if (blocksOpponent || blockRate >= 40) type = 'attack';
        else if (flexibility >= 70) type = 'defense';
        else if (pips >= 9) type = 'reduce';

        if (tags.length === 0) tags.push('📊 Standar');

        return { tags, reasons, type };
    }

    _determineOverallStrategy(playerIndex, best, allResults) {
        const hand = this.engine.players[playerIndex];
        const opponentCards = [1, 2, 3].map(i => this.engine.players[(playerIndex + i) % 4].length);
        const minOpCards = Math.min(...opponentCards);

        if (hand.length <= 2) {
            return { type: 'finish', message: '🏁 Kamu tinggal ' + hand.length + ' kartu! Fokus habiskan kartu secepat mungkin.' };
        }
        if (minOpCards <= 2) {
            const idx = opponentCards.indexOf(minOpCards);
            const name = ['Pemain 2', 'Pemain 3', 'Pemain 4'][(idx)];
            return { type: 'block', message: '🚨 ' + name + ' tinggal ' + minOpCards + ' kartu! Blok dia — tutup angka yang dibutuhkan.' };
        }
        if (best && best.classification.type === 'attack') {
            return { type: 'attack', message: '⚔️ SERANG! Blok lawan dengan menutup ujung yang mereka tidak punya.' };
        }
        if (best && best.winRate >= 50) {
            return { type: 'confident', message: '💪 Posisi bagus (win rate ' + best.winRate + '%). Pertahankan kontrol permainan.' };
        }
        return { type: 'defense', message: '🛡️ Bertahan — jaga fleksibilitas kartu dan buang pip besar untuk kurangi risiko.' };
    }
}
window.GapleAI = GapleAI;
