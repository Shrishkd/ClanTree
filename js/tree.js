// js/tree.js — D3.js family tree: SVG for edges, HTML overlay for interactive cards

const Tree = {

    // ── Config ───────────────────────────────────────────────────────────────
    CARD_W:     200,
    CARD_H:     230,
    H_GAP:      70,
    V_GAP:      130,
    _svg:       null,
    _g:         null,
    _cardsEl:   null,
    _zoom:      null,
    _data:      { members: [], relations: [] },
    _lastNodes: [],
    _collapsed: new Set(),
    _highlighted: null,

    GEN_PALETTE: [
        { border: '#C0392B', bg: '#FFF0ED', badge: '#C0392B' },
        { border: '#8B0000', bg: '#FDE8E8', badge: '#8B0000' },
        { border: '#2E7D32', bg: '#EDF7EE', badge: '#2E7D32' },
        { border: '#1565C0', bg: '#E8F0FD', badge: '#1565C0' },
        { border: '#6A1B9A', bg: '#F3E8FD', badge: '#6A1B9A' },
        { border: '#E65100', bg: '#FFF3E0', badge: '#E65100' },
        { border: '#00695C', bg: '#E0F2F1', badge: '#00695C' },
        { border: '#AD1457', bg: '#FCE4EC', badge: '#AD1457' },
    ],

    getColor(gen) {
        return this.GEN_PALETTE[gen % this.GEN_PALETTE.length];
    },

    // ── Init ─────────────────────────────────────────────────────────────────
    init() {
        const container = document.getElementById('tree-container');
        if (!container) return;

        this._svg = d3.select('#tree-svg').attr('width', '100%').attr('height', '100%');
        this._g   = this._svg.append('g').attr('id', 'tree-root');
        this._cardsEl = document.getElementById('cards-overlay');

        this._zoom = d3.zoom()
            .scaleExtent([0.05, 5])
            .on('zoom', (event) => {
                const { x, y, k } = event.transform;
                this._g.attr('transform', event.transform);
                if (this._cardsEl) {
                    this._cardsEl.style.transform = `translate(${x}px,${y}px) scale(${k})`;
                }
            });
        this._svg.call(this._zoom);

        // Card buttons use inline onclick — no delegation needed
        document.getElementById('btn-zoom-in') ?.addEventListener('click', () => this.zoomBy(1.3));
        document.getElementById('btn-zoom-out')?.addEventListener('click', () => this.zoomBy(0.77));
        document.getElementById('btn-fit')     ?.addEventListener('click', () => this.fitToScreen());
        document.getElementById('btn-reset')   ?.addEventListener('click', () => this.resetZoom());
    },

    // ── Public ───────────────────────────────────────────────────────────────
    async refresh() {
        this._data = await DB.getFullSnapshot();
        this.render();
        setTimeout(() => { if (this._lastNodes.length > 0) this.fitToScreen(); }, 220);
    },

    // ── Layout ───────────────────────────────────────────────────────────────
    _buildLayout() {
        const { members, relations } = this._data;
        if (members.length === 0) return { nodes: [], edges: [], spouseOf: {}, childOf: {} };

        const graph = Relations.buildGraph(members, relations);
        const gens  = Relations.assignGenerations(members, relations);

        members.forEach(m => { m._gen = gens[m.id] !== undefined ? gens[m.id] : 0; });

        const byGen = {};
        members.forEach(m => {
            byGen[m._gen] = byGen[m._gen] || [];
            byGen[m._gen].push(m);
        });

        const hidden    = this._getHiddenMembers(members, graph);
        const positions = this._layoutPositions(members, graph, byGen, hidden);

        const nodes = members
            .filter(m => !hidden.has(m.id))
            .map(m => ({
                ...m,
                x:           positions[m.id]?.x || 0,
                y:           positions[m.id]?.y || 0,
                gen:         m._gen,
                color:       this.getColor(m._gen),
                isCollapsed: this._collapsed.has(m.id),
                hasChildren: (graph.parentOf[m.id] || []).length > 0,
            }));

        const visibleIds = new Set(nodes.map(n => n.id));
        const edges = [];
        relations.forEach(r => {
            if (!visibleIds.has(r.fromId) || !visibleIds.has(r.toId)) return;
            const fromPos = positions[r.fromId];
            const toPos   = positions[r.toId];
            if (!fromPos || !toPos) return;
            edges.push({ ...r, fromPos, toPos });
        });

        return { nodes, edges, spouseOf: graph.spouseOf, childOf: graph.childOf };
    },

    _getHiddenMembers(members, graph) {
        const hidden = new Set();
        for (const id of this._collapsed) {
            const queue = [...(graph.parentOf[id] || [])];
            while (queue.length) {
                const cid = queue.shift();
                if (!hidden.has(cid)) {
                    hidden.add(cid);
                    (graph.parentOf[cid] || []).forEach(kid => queue.push(kid));
                    (graph.spouseOf[cid] || []).forEach(sid => {
                        hidden.add(sid);
                        (graph.parentOf[sid] || []).forEach(kid => queue.push(kid));
                    });
                }
            }
        }
        return hidden;
    },

    _layoutPositions(members, graph, byGen, hidden) {
        const { parentOf, spouseOf } = graph;
        const NODE_W = this.CARD_W + this.H_GAP;
        const NODE_H = this.CARD_H + this.V_GAP;
        const positions = {};

        const visibleMembers = members.filter(m => !hidden.has(m.id));
        const visByGen = {};
        visibleMembers.forEach(m => {
            visByGen[m._gen] = visByGen[m._gen] || [];
            visByGen[m._gen].push(m);
        });

        const genKeys = Object.keys(visByGen).map(Number).sort((a, b) => a - b);

        // ── Pass 1: assign initial x positions by grouping spouses ──────────
        // For a hub with 2 spouses: [wife1, hub, wife2]  (hub is centred)
        // For a simple pair:        [person, spouse]
        const groupedByGen = {}; // gen → array of groups, each group = [member, ...]

        genKeys.forEach(g => {
            const row     = this._sortRowByAge(visByGen[g] || [], graph.childOf, spouseOf);
            visByGen[g]   = row;
            const grouped = this._groupSpouses(row, spouseOf);
            groupedByGen[g] = grouped;

            let xCursor = 0;
            grouped.forEach(group => {
                group.forEach((m, idx) => {
                    positions[m.id] = { x: xCursor + idx * NODE_W, y: g * NODE_H };
                });
                xCursor += group.length * NODE_W;
            });
        });

        // ── Pass 2: slide each couple-group to centre above their children ───
        // We iterate bottom-up (reverse gen order) so children are already placed.
        [...genKeys].reverse().forEach(g => {
            const grouped = groupedByGen[g] || [];

            grouped.forEach(group => {
                // Collect all children of every member in this group
                const allChildIds = [];
                group.forEach(m => {
                    (parentOf[m.id] || []).forEach(cid => {
                        if (positions[cid] && !hidden.has(cid) && !allChildIds.includes(cid))
                            allChildIds.push(cid);
                    });
                });
                if (!allChildIds.length) return;

                const childXs = allChildIds.map(cid => positions[cid].x);
                const centerX = (Math.min(...childXs) + Math.max(...childXs)) / 2;

                // Ideal left edge of the group so the group's centre aligns with children
                const idealGroupLeft = centerX - ((group.length - 1) * NODE_W) / 2;
                const currentLeft    = positions[group[0].id].x;

                if (Math.abs(idealGroupLeft - currentLeft) > 5) {
                    group.forEach((m, idx) => {
                        if (positions[m.id]) positions[m.id].x = idealGroupLeft + idx * NODE_W;
                    });
                }
            });

            // Fix any overlaps between groups on this row
            const row = visByGen[g] || [];
            this._fixOverlaps(row, positions, NODE_W, hidden);
        });

        // ── Pass 3: shift everything so min-x ≥ 20 ──────────────────────────
        const allX = Object.values(positions).map(p => p.x);
        if (allX.length > 0) {
            const minX = Math.min(...allX);
            if (minX < 20) {
                const shift = 20 - minX;
                Object.values(positions).forEach(p => { p.x += shift; });
            }
        }

        return positions;
    },

    _sortRowByAge(row, childOf, spouseOf) {
        if (!row || row.length <= 1) return row;

        // Returns a numeric sort key: smallest (oldest DOB) = leftmost (eldest first)
        const dobTime = (m) => {
            if (!m.dob) return Infinity;
            const t = new Date(m.dob).getTime();
            return Number.isNaN(t) ? Infinity : t;
        };

        // Identify "hub" members: those who have 2+ spouses in this row.
        // They will be handled by _groupSpouses (centre placement), not sorted here.
        const spouseCountInRow = {};
        row.forEach(m => {
            spouseCountInRow[m.id] = (spouseOf[m.id] || [])
                .filter(sid => row.some(r => r.id === sid)).length;
        });
        const hubIds = new Set(
            row.filter(m => spouseCountInRow[m.id] >= 2).map(m => m.id)
        );

        // Build spouse-units: a "unit" is one person + their spouse (if in same row)
        // Skip people who are spouses OF a hub (they'll be placed by groupSpouses)
        const processed = new Set();
        const units     = [];

        row.forEach(m => {
            if (processed.has(m.id)) return;

            const unit = [m];
            processed.add(m.id);

            // Only bundle a single spouse here; multi-spouse hubs are handled separately
            if (!hubIds.has(m.id)) {
                (spouseOf[m.id] || []).forEach(sid => {
                    const spouse = row.find(r => r.id === sid);
                    if (spouse && !processed.has(sid) && !hubIds.has(sid)) {
                        unit.push(spouse);
                        processed.add(sid);
                    }
                });
            }

            // Sort key = oldest member in the unit
            unit.sortKey = Math.min(...unit.map(dobTime));
            // Parent-key: canonical sorted parent IDs → groups biological siblings together
            const parents = childOf[m.id] || [];
            unit.parentKey = parents.length
                ? parents.slice().sort((a, b) => a - b).join(',')
                : `solo-${m.id}`;
            units.push(unit);
        });

        // Group units by their parent-set
        const byParents = new Map();
        units.forEach(unit => {
            if (!byParents.has(unit.parentKey)) byParents.set(unit.parentKey, []);
            byParents.get(unit.parentKey).push(unit);
        });

        // Within each sibling group: sort oldest-first (smallest DOB = leftmost)
        byParents.forEach(group => group.sort((a, b) => a.sortKey - b.sortKey));

        // Sort sibling groups by the age of their eldest member
        const sortedGroups = [...byParents.values()]
            .sort((ga, gb) => ga[0].sortKey - gb[0].sortKey);

        return sortedGroups.flatMap(group => group.flat());
    },

    _groupSpouses(row, spouseOf) {
        // Build spouse groups.
        // For a person with 2+ spouses: put the person in the CENTRE flanked by spouses.
        //   [Wife1]  [Husband]  [Wife2]
        // For a person with 1 spouse: keep them together as a pair.
        //   [Wife]  [Husband]
        const processed = new Set();
        const groups    = [];

        // ── Step 1: identify "hub" members (2+ spouses in the same row) ────
        // Process hubs first so their wives don't form incorrect pairs before
        // the hub is encountered.
        const hubsFirst = [...row].sort((a, b) => {
            const aCount = (spouseOf[a.id] || []).filter(sid => row.some(r => r.id === sid)).length;
            const bCount = (spouseOf[b.id] || []).filter(sid => row.some(r => r.id === sid)).length;
            return bCount - aCount; // descending: hubs first
        });

        hubsFirst.forEach(m => {
            if (processed.has(m.id)) return;

            // Find all unprocessed spouses of m that are in the same row
            const rowSpouses = (spouseOf[m.id] || [])
                .map(sid => row.find(r => r.id === sid))
                .filter(Boolean)
                .filter(s => !processed.has(s.id));

            if (rowSpouses.length === 0) {
                processed.add(m.id);
                groups.push([m]);
                return;
            }

            if (rowSpouses.length === 1) {
                // Simple pair
                const sp = rowSpouses[0];
                processed.add(m.id);
                processed.add(sp.id);
                groups.push([m, sp]);
                return;
            }

            // Multiple spouses → hub in centre: [wife1, hub, wife2, ...]
            rowSpouses.forEach(s => processed.add(s.id));
            processed.add(m.id);
            const [leftSpouse, ...rightSpouses] = rowSpouses;
            groups.push([leftSpouse, m, ...rightSpouses]);
        });

        // ── Step 2: preserve the original row order within the groups list ──
        // Re-sort groups so they appear in the order their first member
        // appears in the original row.
        const rowIndex = new Map(row.map((m, i) => [m.id, i]));
        groups.sort((ga, gb) => (rowIndex.get(ga[0].id) ?? 0) - (rowIndex.get(gb[0].id) ?? 0));

        return groups;
    },

    _fixOverlaps(row, positions, nodeW, hidden) {
        const sorted = row
            .filter(m => !hidden.has(m.id) && positions[m.id])
            .sort((a, b) => positions[a.id].x - positions[b.id].x);
        for (let i = 1; i < sorted.length; i++) {
            const minX = positions[sorted[i - 1].id].x + nodeW;
            if (positions[sorted[i].id].x < minX) {
                const shift = minX - positions[sorted[i].id].x;
                for (let j = i; j < sorted.length; j++) positions[sorted[j].id].x += shift;
            }
        }
    },

    // ── Render ───────────────────────────────────────────────────────────────
    render() {
        if (!this._g) return;
        const { nodes, edges, spouseOf, childOf } = this._buildLayout();
        this._lastNodes = nodes;

        this._g.selectAll('*').remove();
        if (this._cardsEl) this._cardsEl.innerHTML = '';

        this._renderEdges(edges, spouseOf, childOf);
        this._renderCards(nodes);

        const emptyEl = document.getElementById('tree-empty');
        if (emptyEl) emptyEl.style.display = nodes.length === 0 ? 'flex' : 'none';
    },

    // ── Edge rendering ────────────────────────────────────────────────────────
    // Rendering modes:
    //   1. Spouse   — double horizontal lines + ♥ heart (left/right sides)
    //   2. Couple→children — individual lines from EACH parent to each child
    //   3. Single parent   — classic elbow connector
    //   4. Siblings — green dotted curved arc over the top
    _renderEdges(edges, spouseOf, childOf) {
        const CW     = this.CARD_W;
        const CH     = this.CARD_H;
        const edgesG = this._g.append('g').attr('class', 'edges-group');
        spouseOf = spouseOf || {};
        childOf  = childOf  || {};

        const spouseEdges = edges.filter(e => e.type === 'spouse');
        const parentEdges = edges.filter(e => e.type === 'parent-child' || e.type === 'adopted-child');
        const sibEdges    = edges.filter(e => e.type === 'sibling');

        // ── 1. Spouse double lines + ♥ heart (same row only) ───────────────────
        spouseEdges.forEach(({ fromPos, toPos }) => {
            if (!fromPos || !toPos) return;
            if (Math.abs(fromPos.y - toPos.y) > 5) return;
            const midY = fromPos.y + CH / 2;
            const lx   = Math.min(fromPos.x + CW, toPos.x + CW);
            const rx   = Math.max(fromPos.x, toPos.x);
            if (rx <= lx) return;

            edgesG.append('line').attr('class', 'edge-spouse edge-line')
                .attr('x1', lx).attr('y1', midY - 5).attr('x2', rx).attr('y2', midY - 5);
            edgesG.append('line').attr('class', 'edge-spouse edge-line')
                .attr('x1', lx).attr('y1', midY + 5).attr('x2', rx).attr('y2', midY + 5);
            edgesG.append('text').attr('class', 'edge-heart')
                .attr('x', (lx + rx) / 2)
                .attr('y', midY + 6)
                .text('♥');
        });

        // ── 2. Group parent→child edges by child ────────────────────────────────
        const parentsOfChild = {};
        parentEdges.forEach(e => {
            if (!parentsOfChild[e.toId]) parentsOfChild[e.toId] = [];
            parentsOfChild[e.toId].push(e);
        });

        // ── 3. Detect coupled parents (both spouses) ────────────────────────────
        const coupleKey    = (a, b) => [a, b].sort((x, y) => x - y).join(':');
        const coupleGroups = new Map();
        const handled      = new Set();

        Object.entries(parentsOfChild).forEach(([childIdStr, pEdges]) => {
            const childId = parseInt(childIdStr);
            for (let i = 0; i < pEdges.length; i++) {
                for (let j = i + 1; j < pEdges.length; j++) {
                    const p1 = pEdges[i], p2 = pEdges[j];
                    if ((spouseOf[p1.fromId] || []).includes(p2.fromId)) {
                        const key = coupleKey(p1.fromId, p2.fromId);
                        if (!coupleGroups.has(key)) {
                            coupleGroups.set(key, {
                                p1: { id: p1.fromId, pos: p1.fromPos },
                                p2: { id: p2.fromId, pos: p2.fromPos },
                                children: []
                            });
                        }
                        coupleGroups.get(key).children.push({
                            pos: p1.toPos, type: p1.type, id: childId
                        });
                        handled.add(`${p1.fromId}-${childId}`);
                        handled.add(`${p2.fromId}-${childId}`);
                        break;
                    }
                }
            }
        });

        // ── 4. Draw lines from EACH parent to each child ────────────────────────
        //
        //   [Father] ══♥══ [Mother]
        //      \             /        ← individual lines from each parent
        //       \           /
        //        \    |    /
        //       [C1] [C2] [C3]
        //
        coupleGroups.forEach(({ p1, p2, children }) => {
            if (!p1.pos || !p2.pos || !children.length) return;

            // Bottom-center of each parent card
            const p1x = p1.pos.x + CW / 2;
            const p1y = p1.pos.y + CH;
            const p2x = p2.pos.x + CW / 2;
            const p2y = p2.pos.y + CH;

            children.forEach(({ pos, type }) => {
                const cx      = pos.x + CW / 2;
                const cy      = pos.y;
                const midY1   = p1y + (cy - p1y) * 0.5;
                const midY2   = p2y + (cy - p2y) * 0.5;
                const adopted = type === 'adopted-child';
                const cls     = adopted ? 'edge-adopted' : 'edge-parent-child';

                // Line from parent 1 → child
                edgesG.append('path')
                    .attr('class', `edge-line ${cls}`)
                    .attr('d', `M ${p1x} ${p1y} L ${p1x} ${midY1} L ${cx} ${midY1} L ${cx} ${cy}`)
                    .attr('fill', 'none');

                // Line from parent 2 → child
                edgesG.append('path')
                    .attr('class', `edge-line ${cls}`)
                    .attr('d', `M ${p2x} ${p2y} L ${p2x} ${midY2} L ${cx} ${midY2} L ${cx} ${cy}`)
                    .attr('fill', 'none');

                // Arrow at child
                edgesG.append('polygon').attr('class', 'edge-arrow')
                    .attr('points', `${cx - 5},${cy - 10} ${cx + 5},${cy - 10} ${cx},${cy}`)
                    .attr('fill', adopted ? '#8B6914' : '#C0392B');
            });
        });

        // ── 5. Elbow connector for single-parent edges ─────────────────────────
        parentEdges.forEach(({ fromId, toId, fromPos, toPos, type }) => {
            if (handled.has(`${fromId}-${toId}`)) return;
            if (!fromPos || !toPos) return;
            const px      = fromPos.x + CW / 2;
            const py      = fromPos.y + CH;
            const cx      = toPos.x  + CW / 2;
            const cy      = toPos.y;
            const my      = py + (cy - py) / 2;
            const adopted = type === 'adopted-child';
            edgesG.append('path')
                .attr('class', `edge-line edge-${adopted ? 'adopted' : 'parent-child'}`)
                .attr('d', `M ${px} ${py} L ${px} ${my} L ${cx} ${my} L ${cx} ${cy}`)
                .attr('fill', 'none');
            edgesG.append('polygon').attr('class', 'edge-arrow')
                .attr('points', `${cx - 5},${cy - 10} ${cx + 5},${cy - 10} ${cx},${cy}`)
                .attr('fill', adopted ? '#8B6914' : '#C0392B');
        });

        // ── 6. Sibling & step-sibling arcs ─────────────────────────────────────
        //
        // Full siblings  (share ALL parents) = GREEN dotted arc over the top
        // Step-siblings  (share SOME parents) = RED dotted arc over the top
        //
        const visiblePositions = {};
        edges.forEach(e => {
            if (e.fromPos) visiblePositions[e.fromId] = e.fromPos;
            if (e.toPos)   visiblePositions[e.toId]   = e.toPos;
        });
        this._lastNodes.forEach(n => { visiblePositions[n.id] = { x: n.x, y: n.y }; });

        const drawnSibPairs = new Set();

        // Auto-detect via shared parents — classify full vs step
        const memberIds = Object.keys(childOf).map(Number);
        for (let i = 0; i < memberIds.length; i++) {
            const aId      = memberIds[i];
            const aParents = childOf[aId] || [];
            if (aParents.length === 0) continue;
            const aSet = new Set(aParents);
            for (let j = i + 1; j < memberIds.length; j++) {
                const bId      = memberIds[j];
                const bParents = childOf[bId] || [];
                if (bParents.length === 0) continue;

                const sharedCount = bParents.filter(p => aSet.has(p)).length;
                if (sharedCount === 0) continue;

                const key = coupleKey(aId, bId);
                if (drawnSibPairs.has(key)) continue;

                const aPos = visiblePositions[aId];
                const bPos = visiblePositions[bId];
                if (!aPos || !bPos) continue;
                if (Math.abs(aPos.y - bPos.y) > 5) continue;

                drawnSibPairs.add(key);

                // Full sibling = share ALL parents, step = share only SOME
                const allA = aParents.length;
                const allB = bParents.length;
                const isFull = (sharedCount === allA && sharedCount === allB && allA > 0);

                this._drawSiblingArc(edgesG, aPos, bPos, CW, isFull);
            }
        }

        // Explicit sibling edges (fallback — draw as full sibling green)
        sibEdges.forEach(({ fromId, toId, fromPos, toPos }) => {
            if (!fromPos || !toPos) return;
            const key = coupleKey(fromId, toId);
            if (drawnSibPairs.has(key)) return;
            drawnSibPairs.add(key);
            this._drawSiblingArc(edgesG, fromPos, toPos, CW, true);
        });
    },

    // Helper: draw a sibling arc above two cards
    //   isFull=true  → green dotted (full siblings)
    //   isFull=false → red dotted   (step-siblings)
    _drawSiblingArc(edgesG, posA, posB, CW, isFull) {
        const x1   = posA.x + CW / 2;
        const x2   = posB.x + CW / 2;
        const y    = Math.min(posA.y, posB.y);
        const arcH = Math.min(55, Math.abs(x2 - x1) * 0.25 + 22);
        const cpY  = y - arcH;
        edgesG.append('path')
            .attr('class', `edge-line ${isFull ? 'edge-sibling' : 'edge-step-sibling'}`)
            .attr('d', `M ${x1} ${y} Q ${(x1 + x2) / 2} ${cpY} ${x2} ${y}`)
            .attr('fill', 'none');
    },

    // ── Card rendering (HTML overlay) ────────────────────────────────────────
    _renderCards(nodes) {
        if (!this._cardsEl) return;
        const frag = document.createDocumentFragment();
        nodes.forEach(node => {
            const wrapper = document.createElement('div');
            wrapper.className = 'card-wrapper';
            wrapper.style.cssText =
                `position:absolute;left:${node.x}px;top:${node.y}px;` +
                `width:${this.CARD_W}px;height:${this.CARD_H}px;`;
            wrapper.innerHTML = this._cardHTML(node);
            frag.appendChild(wrapper);
        });
        this._cardsEl.appendChild(frag);

        requestAnimationFrame(() => {
            this._cardsEl.querySelectorAll('.card-wrapper').forEach(w => {
                w.style.opacity = '1';
            });
        });
    },

    // ── Age helper ───────────────────────────────────────────────────────────
    _calcAge(dob, dateOfDeath, isAlive) {
        if (!dob) return null;
        const birth = new Date(dob);
        const end   = isAlive !== false
            ? new Date()
            : (dateOfDeath ? new Date(dateOfDeath) : null);
        if (!end || isNaN(birth)) return null;
        let age = end.getFullYear() - birth.getFullYear();
        const m = end.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && end.getDate() < birth.getDate())) age--;
        return age >= 0 ? age : null;
    },

    // ── Collapse toggle (called by inline onclick) ────────────────────────────
    _toggleCollapse(id) {
        if (this._collapsed.has(id)) this._collapsed.delete(id);
        else this._collapsed.add(id);
        this.render();
    },

    // ── Card HTML ────────────────────────────────────────────────────────────
    _cardHTML(node) {
        const { color, name, photo, dob, dateOfDeath, description, gen, id,
                isCollapsed, hasChildren, isAlive, gender } = node;
        const initial     = (name || '?').charAt(0).toUpperCase();
        const photoSrc    = photo || '';
        const dobStr      = dob ? formatDate(dob) : '';
        const isHighlight = id === this._highlighted;
        const descStr     = description
            ? description.substring(0, 36) + (description.length > 36 ? '…' : '')
            : '';

        const age   = this._calcAge(dob, dateOfDeath, isAlive);
        const alive = isAlive !== false;
        const ageStr = age !== null
            ? (alive ? `Age ${age}` : `Lived ${age} yrs`)
            : (!alive ? 'Deceased' : '');

        const deadStyle = !alive ? 'opacity:0.82;filter:grayscale(25%);' : '';

        const genderLabel = gender === 'female' ? 'Female'
            : gender === 'other'  ? 'Other'
            : 'Male';

        return `<div class="member-card${isHighlight ? ' card-highlighted' : ''}"
                     style="--card-border:${color.border};--card-bg:${color.bg};--card-badge:${color.badge};${deadStyle}"
                     data-id="${id}"
                     ondblclick="if(!event.target.closest('.card-btn')&&!event.target.closest('.card-collapse-btn'))Members.openDetailModal(${id})">

            <div class="card-gen-badge" style="background:${color.badge};">Gen ${gen}</div>

            <div class="card-photo-ring" style="border-color:${color.border};">
                ${photoSrc
                    ? `<img class="card-photo" src="${photoSrc}" alt="${name}">`
                    : `<div class="card-photo-placeholder" style="background:${color.border};">${initial}</div>`
                }
            </div>

            <div class="card-name">${name}</div>
            <div class="card-gender">${genderLabel}</div>
            ${dobStr  ? `<div class="card-dob">DOB: ${dobStr}</div>` : ''}
            ${ageStr  ? `<div class="card-age${alive ? '' : ' card-deceased'}">${ageStr}</div>` : ''}
            ${descStr ? `<div class="card-desc">${descStr}</div>` : ''}

            <div class="card-actions">
                <button class="card-btn btn-add"
                        title="Add relation"
                        onclick="event.stopPropagation();Members.showRelationMenu(event,${id})">+</button>
                <button class="card-btn btn-view"
                        title="View profile"
                        onclick="event.stopPropagation();Members.openDetailModal(${id})">&#128065;</button>
                <button class="card-btn btn-edit"
                        title="Edit member"
                        onclick="event.stopPropagation();Members.openEditModal(${id})">&#9998;</button>
                <button class="card-btn btn-delete"
                        title="Delete member"
                        onclick="event.stopPropagation();Members.confirmDelete(${id})">&#128465;</button>
            </div>

            ${hasChildren ? `
            <button class="card-collapse-btn${isCollapsed ? ' collapsed' : ''}"
                    title="${isCollapsed ? 'Expand' : 'Collapse'}"
                    onclick="event.stopPropagation();Tree._toggleCollapse(${id})">
                ${isCollapsed ? '&#9660;' : '&#9650;'}
            </button>` : ''}

            <div class="card-corner tl"></div>
            <div class="card-corner tr"></div>
            <div class="card-corner bl"></div>
            <div class="card-corner br"></div>
        </div>`;
    },

    // ── Zoom controls ────────────────────────────────────────────────────────
    zoomBy(factor) {
        this._svg.transition().duration(300).call(this._zoom.scaleBy, factor);
    },

    fitToScreen() {
        const container = document.getElementById('tree-container');
        if (!container || !this._lastNodes.length) return;

        const xs   = this._lastNodes.map(n => n.x);
        const ys   = this._lastNodes.map(n => n.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs) + this.CARD_W;
        const maxY = Math.max(...ys) + this.CARD_H;
        const bW   = (maxX - minX) || 1;
        const bH   = (maxY - minY) || 1;
        const W    = container.clientWidth;
        const H    = container.clientHeight;
        const PAD  = 80;

        const scale = Math.min((W - PAD * 2) / bW, (H - PAD * 2) / bH, 1.5);
        const tx    = (W - bW * scale) / 2 - minX * scale;
        const ty    = (H - bH * scale) / 2 - minY * scale;

        this._svg.transition().duration(600)
            .call(this._zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
    },

    resetZoom() {
        this._svg.transition().duration(400)
            .call(this._zoom.transform, d3.zoomIdentity.translate(60, 60).scale(1));
    },

    // ── Highlight & center ───────────────────────────────────────────────────
    highlightAndCenter(memberId) {
        this._highlighted = memberId;
        this.render();

        const node = this._lastNodes.find(n => n.id === memberId);
        if (!node) return;

        const container = document.getElementById('tree-container');
        const W  = container.clientWidth;
        const H  = container.clientHeight;
        const t  = d3.zoomTransform(this._svg.node());
        const cx = node.x + this.CARD_W / 2;
        const cy = node.y + this.CARD_H / 2;

        this._svg.transition().duration(600).call(
            this._zoom.transform,
            d3.zoomIdentity.translate(W / 2 - cx * t.k, H / 2 - cy * t.k).scale(t.k)
        );

        setTimeout(() => { this._highlighted = null; this.render(); }, 3000);
    },

    clearHighlight() {
        this._highlighted = null;
        this.render();
    }
};
