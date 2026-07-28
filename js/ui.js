class GapleUI {
    constructor() {
        this.onTileClick = null;
        this.onPlacement = null;
        this.onSuggestionClick = null;
    }

    // ── Opponent hands (back side) ──────────────────────────────────────
    renderOpponentHands(players, activePlayerIndex, playerDisplayNames, humanPlayers, aiPlayerIndexes) {
        const slots = [1, 2, 3];
        const aiSet = new Set(aiPlayerIndexes || []);
        const boardOpponents = [];
        for (let offset = 1; offset <= 3; offset++) {
            boardOpponents.push((activePlayerIndex + offset) % 4);
        }

        for (let i = 0; i < slots.length; i++) {
            const handNodeId = 'p' + (slots[i] + 1) + '-hand';
            const el = document.getElementById(handNodeId);
            if (!el) continue;
            const realPlayer = boardOpponents[i];
            const countEl = document.getElementById('p' + (slots[i] + 1) + '-count');
            if (countEl) countEl.textContent = players[realPlayer].length + ' kartu';

            const labelEl = document.getElementById('p' + (slots[i] + 1) + '-label');
            if (labelEl) {
                const roleSuffix = (aiSet.has(realPlayer) || realPlayer >= humanPlayers) ? ' (AI)' : '';
                labelEl.innerHTML = '<span class="player-dot dot-p' + slots[i] + '"></span>' +
                    this._escapeHtml((playerDisplayNames[realPlayer] || ('Pemain ' + (realPlayer + 1))) + roleSuffix) +
                    ' <span class="tile-count" id="p' + (slots[i] + 1) + '-count">' + players[realPlayer].length + ' kartu</span>';
            }

            el.innerHTML = '';
            for (let j = 0; j < players[realPlayer].length; j++) {
                const tb = document.createElement('div');
                tb.className = 'tile-back player-' + slots[i] + '-color';
                el.appendChild(tb);
            }
        }
    }

    // ── Player hand ─────────────────────────────────────────────────────
    renderPlayerHand(hand, validMoves, selectedTileId, coachMoves) {
        const el = document.getElementById('player-1-hand');
        if (!el) return;
        const countEl = document.getElementById('p1-count');
        if (countEl) countEl.textContent = hand.length + ' kartu';
        el.innerHTML = '';

        // Build coach lookup by tile id for badges
        const coachLookup = {};
        if (coachMoves && coachMoves.length > 0) {
            coachMoves.forEach((m, idx) => {
                if (!coachLookup[m.tile.id]) coachLookup[m.tile.id] = { rank: idx + 1, isBest: m.isBest, winRate: m.winRate };
            });
        }

        const validIds = new Set(validMoves.map(m => m.tile.id));
        for (const tile of hand) {
            const div = document.createElement('div');
            div.className = 'tile tile-playable' + (validIds.has(tile.id) ? ' valid-move' : '') +
                (tile.id === selectedTileId ? ' selected' : '');
            div.dataset.tileId = tile.id;
            div.innerHTML = this._renderTileDots(tile.top, tile.bottom);

            const coach = coachLookup[tile.id];
            if (coach) {
                const badge = document.createElement('div');
                badge.className = 'tile-rank-badge' + (coach.isBest ? ' badge-best' : '');
                badge.textContent = coach.isBest ? '★' : '#' + coach.rank;
                div.appendChild(badge);

                const tooltip = document.createElement('div');
                tooltip.className = 'tile-tooltip';
                tooltip.textContent = (coach.isBest ? 'Rekomendasi Coach ' : 'Opsi #' + coach.rank + ' ') + '(win ' + coach.winRate + '%)';
                div.appendChild(tooltip);
            }

            if (validIds.has(tile.id) && this.onTileClick) {
                div.addEventListener('click', () => this.onTileClick(tile));
            }
            el.appendChild(div);
        }
    }

    _renderTileDots(top, bottom, orientation) {
        if (orientation === 'horizontal') {
            return '<div class="tile-left">' + this._dotsHtml(top) + '</div>' +
                   '<div class="tile-divider tile-divider-vertical"></div>' +
                   '<div class="tile-right">' + this._dotsHtml(bottom) + '</div>';
        }

        return '<div class="tile-top">' + this._dotsHtml(top) + '</div>' +
               '<div class="tile-divider"></div>' +
               '<div class="tile-bottom">' + this._dotsHtml(bottom) + '</div>';
    }

    _dotsHtml(num) {
        const patterns = {
            0: [],
            1: ['c'],
            2: ['tl', 'br'],
            3: ['tl', 'c', 'br'],
            4: ['tl', 'tr', 'bl', 'br'],
            5: ['tl', 'tr', 'c', 'bl', 'br'],
            6: ['tl', 'ml', 'bl', 'tr', 'mr', 'br']
        };
        let html = '<div class="pip-face">';
        for (const pos of (patterns[num] || [])) {
            html += '<span class="pip pip-' + pos + '"></span>';
        }
        html += '</div>';
        return html;
    }

    // ── Board ────────────────────────────────────────────────────────────
    renderBoard(board, leftEnd, rightEnd, selectedTile, validMoves) {
        const el = document.getElementById('board');
        if (!el) return;
        el.innerHTML = '';

        if (board.length === 0) {
            el.innerHTML = '<div class="board-empty">Taruh kartu pertama di sini</div>';
            return;
        }

        const playerColors = ['tile-p0', 'tile-p1', 'tile-p2', 'tile-p3'];

        // Left placement zone
        if (selectedTile && validMoves.some(m => m.side === 'left')) {
            const zone = document.createElement('div');
            zone.className = 'drop-zone';
            zone.textContent = '← Kiri';
            zone.addEventListener('click', () => this.onPlacement && this.onPlacement('left'));
            el.appendChild(zone);
        }

        for (const t of board) {
            const div = document.createElement('div');
            const isDouble = t.top === t.bottom;
            const orientation = isDouble ? 'vertical' : 'horizontal';
            div.className = 'tile tile-board board-orient-' + orientation + ' ' + (playerColors[t.placedBy] || '');
            div.innerHTML = this._renderTileDots(t.top, t.bottom, orientation);
            el.appendChild(div);
        }

        // Right placement zone
        if (selectedTile && validMoves.some(m => m.side === 'right')) {
            const zone = document.createElement('div');
            zone.className = 'drop-zone';
            zone.textContent = 'Kanan →';
            zone.addEventListener('click', () => this.onPlacement && this.onPlacement('right'));
            el.appendChild(zone);
        }
    }

    renderEndpoints(leftEnd, rightEnd) {
        const el = document.getElementById('endpoints');
        if (!el) return;
        if (leftEnd === null) { el.textContent = ''; return; }
        el.textContent = '← ' + leftEnd + '  |  ' + rightEnd + ' →';
    }

    // ── Status & Controls ────────────────────────────────────────────────
    setStatus(msg, type) {
        const el = document.getElementById('game-status');
        if (!el) return;
        el.textContent = msg;
        el.className = 'game-status status-' + (type || 'info');
    }

    setTurnIndicator(msg) {
        const el = document.getElementById('turn-indicator');
        if (el) el.textContent = msg;
    }

    showPassButton(show) {
        const btn = document.getElementById('btn-pass');
        if (btn) btn.style.display = show ? '' : 'none';
    }

    // ── Move History ────────────────────────────────────────────────────
    renderMoveHistory(history) {
        const el = document.getElementById('move-history');
        if (!el) return;
        el.innerHTML = '';
        const names = ['Kamu', 'P2', 'P3', 'P4'];
        const recent = [...history].reverse().slice(0, 20);
        for (const m of recent) {
            const div = document.createElement('div');
            div.className = 'history-entry player-' + m.playerIndex + '-color';
            if (m.type === 'pass') {
                div.textContent = 'G' + m.turnNumber + ' ' + names[m.playerIndex] + ': PASS';
            } else {
                div.textContent = 'G' + m.turnNumber + ' ' + names[m.playerIndex] + ': [' + m.tile.top + '|' + m.tile.bottom + '] ' + m.side;
            }
            el.appendChild(div);
        }
    }

    // ── Probabilities ────────────────────────────────────────────────────
    renderProbabilities(probs) {
        const el = document.getElementById('probabilities');
        if (!el) return;
        el.innerHTML = '';
        const names = ['', 'Pemain 2', 'Pemain 3', 'Pemain 4'];
        for (let p = 1; p <= 3; p++) {
            if (!probs[p]) continue;
            const section = document.createElement('div');
            section.className = 'prob-section';
            section.innerHTML = '<div class="prob-player">' + names[p] + '</div>';
            const grid = document.createElement('div');
            grid.className = 'prob-grid';
            for (let n = 0; n <= 6; n++) {
                const data = probs[p][n];
                if (!data) continue;
                const cell = document.createElement('div');
                cell.className = 'prob-cell';
                const pct = data.probability || 0;
                const color = pct === 0 ? 'var(--accent-red)' : pct >= 70 ? 'var(--accent-green)' : 'var(--accent-orange)';
                cell.innerHTML = '<div class="prob-num">' + n + '</div><div class="prob-bar"><div class="prob-fill" style="width:' + pct + '%;background:' + color + '"></div></div><div class="prob-pct">' + pct + '%</div>';
                grid.appendChild(cell);
            }
            section.appendChild(grid);
            el.appendChild(section);
        }
    }

    // ── Game Plan ────────────────────────────────────────────────────────
    renderGamePlan(plans) {
        const el = document.getElementById('game-plan');
        if (!el) return;
        el.innerHTML = '';
        for (const plan of plans) {
            const div = document.createElement('div');
            div.className = 'plan-item';
            div.textContent = plan;
            el.appendChild(div);
        }
    }

    // ── Tile Tracker ────────────────────────────────────────────────────
    renderTileTracker(tiles) {
        const el = document.getElementById('tile-tracker');
        if (!el) return;
        el.innerHTML = '';
        for (const t of tiles) {
            const div = document.createElement('div');
            div.className = 'tracker-tile status-' + t.status;
            div.textContent = '[' + t.top + '|' + t.bottom + ']';
            el.appendChild(div);
        }
    }

    // ── Suggestions (legacy analysis panel) ─────────────────────────────
    renderSuggestions(suggestions) {
        const el = document.getElementById('move-suggestions');
        if (!el) return;
        el.innerHTML = '';
        if (!suggestions || suggestions.length === 0) return;
        for (const s of suggestions) {
            const card = document.createElement('div');
            card.className = 'suggestion-card' + (s.isBest ? ' best' : '');
            card.innerHTML = '<div class="move-tile">[' + s.tile.top + '|' + s.tile.bottom + '] → ' + this._escapeHtml(s.sideLabel) + '</div>' +
                '<div class="move-score">Win rate: ' + s.score + '%</div>' +
                '<div class="move-reason">' + s.reasons.map(r => this._escapeHtml(r)).join(' · ') + '</div>';
            el.appendChild(card);
        }
    }

    // ── AI Coach Panel (inline below hand) ───────────────────────────────
    renderCoachAdvice(coach) {
        const wrapper = document.getElementById('inline-suggestions');
        const body = document.getElementById('inline-suggestions-body');
        if (!wrapper || !body) return;
        body.innerHTML = '';

        if (!coach) { wrapper.classList.add('hidden'); return; }
        wrapper.classList.remove('hidden');

        if (coach.strategy === 'pass') {
            body.innerHTML = '<div class="inline-sug-pass">' + this._escapeHtml(coach.message) + '</div>';
            return;
        }

        // Strategy banner
        const banner = document.createElement('div');
        banner.className = 'coach-strategy coach-strategy-' + coach.strategy;
        banner.textContent = coach.message;
        body.appendChild(banner);

        // Cards row
        const row = document.createElement('div');
        row.className = 'coach-cards-row';

        for (const m of coach.moves) {
            const card = document.createElement('div');
            const ctype = m.classification.type;
            card.className = 'coach-card' + (m.isBest ? ' best' : '') + ' coach-type-' + ctype;

            let tagsHtml = '<div class="coach-tags">';
            for (const tag of m.classification.tags)
                tagsHtml += '<span class="coach-tag coach-tag-' + ctype + '">' + this._escapeHtml(tag) + '</span>';
            tagsHtml += '</div>';

            const barColor = m.winRate >= 50 ? 'var(--accent-green)' : m.winRate >= 30 ? 'var(--accent-orange)' : 'var(--accent-red)';
            const winBar = '<div class="coach-winbar"><div class="coach-winbar-fill" style="width:' + m.winRate + '%;background:' + barColor + '"></div><span class="coach-winbar-label">' + m.winRate + '% win</span></div>';

            let reasonsHtml = '<ul class="coach-reasons">';
            for (const r of m.classification.reasons)
                reasonsHtml += '<li>' + this._escapeHtml(r) + '</li>';
            reasonsHtml += '</ul>';

            card.innerHTML =
                '<div class="coach-card-header">' +
                    '<div class="coach-tile-name">[' + m.tile.top + '|' + m.tile.bottom + ']</div>' +
                    '<div class="coach-side">' + this._escapeHtml(m.sideLabel) + '</div>' +
                '</div>' +
                tagsHtml + winBar + reasonsHtml +
                (m.isBest ? '<div class="coach-best-badge">⭐ Rekomendasi Coach</div>' : '');

            if (this.onSuggestionClick) {
                card.addEventListener('click', () => this.onSuggestionClick(m));
            }
            row.appendChild(card);
        }
        body.appendChild(row);
    }

    renderInlineSuggestions(coachOrSuggestions) {
        // Always delegate to renderCoachAdvice
        this.renderCoachAdvice(coachOrSuggestions && coachOrSuggestions.strategy !== undefined
            ? coachOrSuggestions
            : null);
    }

    hideInlineSuggestions() {
        const el = document.getElementById('inline-suggestions');
        if (el) el.classList.add('hidden');
    }

    // ── Side Panels ──────────────────────────────────────────────────────
    renderUnseenPanel(allTiles, myHand, playedIds) {
        const el = document.getElementById('unseen-panel-body');
        if (!el) return;
        el.innerHTML = '';
        const myIds = new Set(myHand.map(t => t.id));
        const playedSet = new Set(playedIds);
        const groups = {};
        for (let n = 0; n <= 6; n++) groups[n] = [];
        for (const t of allTiles) {
            if (!myIds.has(t.id) && !playedSet.has(t.id)) {
                groups[t.top].push(t);
                if (t.top !== t.bottom) groups[t.bottom].push(t);
            }
        }
        for (let n = 0; n <= 6; n++) {
            const unique = [...new Map(groups[n].map(t => [t.id, t])).values()];
            const row = document.createElement('div');
            row.className = 'unseen-row';
            row.innerHTML = '<span class="unseen-num">' + n + '</span><span class="unseen-count">' + unique.length + '</span>';
            el.appendChild(row);
        }
    }

    renderNotesPanel(notes) {
        const el = document.getElementById('notes-panel-body');
        if (!el) return;
        el.innerHTML = '';
        if (!notes || notes.length === 0) {
            el.innerHTML = '<div class="note-empty">Belum ada catatan</div>';
            return;
        }
        for (const note of notes) {
            const div = document.createElement('div');
            div.className = 'note-entry ' + (note.type || '');
            div.innerHTML = '<div class="note-turn">' + this._escapeHtml(note.turn || '') + '</div>' +
                '<div class="note-text">' + this._escapeHtml(note.text) + '</div>';
            el.appendChild(div);
        }
    }

    // ── Result Modal ─────────────────────────────────────────────────────
    renderResult(engine, playerNames) {
        const el = document.getElementById('result-body');
        if (!el) return;
        const names = playerNames || ['Pemain 1', 'Pemain 2', 'Pemain 3', 'Pemain 4'];
        const rows = [];
        for (let p = 0; p < 4; p++) {
            const pips = engine.players[p].reduce((s, t) => s + t.top + t.bottom, 0);
            rows.push({ name: names[p], pips, isWinner: engine.winner === p, tilesLeft: engine.players[p].length });
        }
        rows.sort((a, b) => a.pips - b.pips);
        el.innerHTML = rows.map(r =>
            '<div class="result-row' + (r.isWinner ? ' winner' : '') + '">' +
                (r.isWinner ? '🏆 ' : '') + r.name + ' — ' + r.tilesLeft + ' kartu, ' + r.pips + ' pip' +
            '</div>'
        ).join('');
    }

    renderPostGameAnalysis(results) {
        const el = document.getElementById('post-analysis');
        if (!el) return;
        el.innerHTML = results.map(r =>
            '<div class="post-row">' +
                '<b>' + this._escapeHtml(r.name) + '</b>: ' + r.tilesLeft + ' kartu tersisa, ' +
                r.pips + ' pip, pass ' + r.passCount + 'x' +
                (r.isWinner ? ' 🏆' : '') +
            '</div>'
        ).join('');
    }

    renderPlayerIdentity(activePlayerIndex, playerDisplayNames, humanPlayers) {
        const activeLabel = document.getElementById('active-player-label');
        if (activeLabel) {
            const activeName = playerDisplayNames[activePlayerIndex] || ('Pemain ' + (activePlayerIndex + 1));
            activeLabel.innerHTML = '<span class="player-dot dot-p0"></span> ' + this._escapeHtml(activeName) +
                ' <span class="tile-count" id="p1-count"></span>';
        }

        const modeSelect = document.getElementById('select-human-players');
        if (modeSelect) modeSelect.value = String(humanPlayers);
    }

    setHandoverMessage(message) {
        const el = document.getElementById('handover-message');
        if (el) el.textContent = message;
    }

    // ── Analysis Panel ───────────────────────────────────────────────────
    toggleAnalysisPanel() {
        const el = document.getElementById('analysis-panel');
        if (el) el.classList.toggle('hidden');
    }

    hideAnalysisPanel() {
        const el = document.getElementById('analysis-panel');
        if (el) el.classList.add('hidden');
    }

    // ── Modals ───────────────────────────────────────────────────────────
    showModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.remove('hidden');
    }

    hideModal(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }
}
window.GapleUI = GapleUI;
