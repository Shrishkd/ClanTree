// js/relations.js — Relationship finder using BFS on the family graph

const Relations = {

    /**
     * Build adjacency maps from members + relations arrays.
     * Returns { parentOf, childOf, spouseOf, adoptedChildOf }
     */
    buildGraph(members, relations) {
        const parentOf  = {};  // pid -> [cid, ...]  (bio parent)
        const childOf   = {};  // cid -> [pid, ...]
        const spouseOf  = {};  // mid -> [sid, ...]
        const adopted   = {};  // pid -> [cid, ...]  (adopted)

        members.forEach(m => {
            parentOf[m.id] = [];
            childOf[m.id]  = [];
            spouseOf[m.id] = [];
            adopted[m.id]  = [];
        });

        relations.forEach(r => {
            const { fromId, toId, type } = r;
            if (type === 'parent-child') {
                if (!parentOf[fromId]) parentOf[fromId] = [];
                if (!childOf[toId])   childOf[toId]    = [];
                parentOf[fromId].push(toId);
                childOf[toId].push(fromId);
            } else if (type === 'adopted-child') {
                if (!adopted[fromId])  adopted[fromId]  = [];
                if (!childOf[toId])    childOf[toId]    = [];
                adopted[fromId].push(toId);
                childOf[toId].push(fromId);
            } else if (type === 'spouse') {
                if (!spouseOf[fromId]) spouseOf[fromId] = [];
                if (!spouseOf[toId])   spouseOf[toId]   = [];
                if (!spouseOf[fromId].includes(toId)) spouseOf[fromId].push(toId);
                if (!spouseOf[toId].includes(fromId)) spouseOf[toId].push(fromId);
            }
        });

        return { parentOf, childOf, spouseOf, adopted };
    },

    /**
     * BFS to find shortest path between two members.
     * The graph is undirected for path finding (we traverse all edges).
     */
    findPath(startId, endId, members, relations) {
        if (startId === endId) return [startId];

        const graph = this.buildGraph(members, relations);

        // Build undirected adjacency list for BFS
        const adj = {};
        members.forEach(m => adj[m.id] = new Set());

        relations.forEach(r => {
            const { fromId, toId } = r;
            if (!adj[fromId]) adj[fromId] = new Set();
            if (!adj[toId])   adj[toId]   = new Set();
            adj[fromId].add(toId);
            adj[toId].add(fromId);
        });

        // BFS
        const visited = new Set([startId]);
        const queue   = [[startId]];

        while (queue.length > 0) {
            const path = queue.shift();
            const last = path[path.length - 1];

            for (const neighbor of (adj[last] || [])) {
                if (neighbor === endId) return [...path, endId];
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push([...path, neighbor]);
                }
            }
        }

        return null; // No connection found
    },

    /**
     * Determine how two consecutive nodes in a path are related.
     * Returns a string like "Father of", "Son of", "Spouse of" etc.
     */
    getEdgeLabel(fromId, toId, graph) {
        const { parentOf, childOf, spouseOf } = graph;

        if ((spouseOf[fromId] || []).includes(toId)) return 'Spouse of';
        if ((parentOf[fromId] || []).includes(toId)) return 'Parent of';
        if ((childOf[fromId]  || []).includes(toId)) return 'Child of';
        return 'Related to';
    },

    /**
     * Full relationship description between two people.
     * Returns { path: [ids], labels: [strings], relationshipTitle: string }
     */
    describeRelationship(personAId, personBId, members, relations) {
        const path = this.findPath(personAId, personBId, members, relations);
        if (!path) return null;

        const graph  = this.buildGraph(members, relations);
        const labels = [];

        for (let i = 0; i < path.length - 1; i++) {
            labels.push(this.getEdgeLabel(path[i], path[i + 1], graph));
        }

        const title = this.calculateRelationshipTitle(path, graph);

        return { path, labels, relationshipTitle: title };
    },

    /**
     * Calculate a human-readable relationship title.
     * e.g. "1st Cousin", "Uncle", "Grandfather" etc.
     */
    calculateRelationshipTitle(path, graph) {
        const { parentOf, childOf, spouseOf } = graph;

        if (path.length === 2) {
            const [a, b] = path;
            if ((spouseOf[a] || []).includes(b))   return 'Spouse';
            if ((parentOf[a] || []).includes(b))   return 'Parent → Child';
            if ((childOf[a]  || []).includes(b))   return 'Child → Parent';
        }

        if (path.length === 3) {
            const [a, mid, b] = path;
            if ((parentOf[a] || []).includes(mid) && (parentOf[mid] || []).includes(b)) return 'Grandparent → Grandchild';
            if ((childOf[a]  || []).includes(mid) && (childOf[mid]  || []).includes(b)) return 'Grandchild → Grandparent';
            if ((parentOf[a] || []).includes(mid) && (childOf[b]    || []).includes(mid)) return 'Siblings';
            if ((childOf[a]  || []).includes(mid) && (spouseOf[mid] || []).includes(b))   return 'Child & Spouse';
            if ((spouseOf[a] || []).includes(mid) && (parentOf[mid] || []).includes(b))   return 'Step-Parent';
        }

        return `Related (${path.length - 1} steps)`;
    },

    /**
     * Assign generation numbers to all members.
     *
     * Rules (in priority order):
     *   1. A child must always be at gen = max(parent gens) + 1.
     *   2. Spouses are aligned to the same generation (higher wins).
     *   3. Rule 1 is re-enforced after every spouse alignment pass so a
     *      spouse-sync can never pull a child up onto its parent's row.
     *
     * We iterate until stable (or a hard cap) to handle cycles / long chains.
     */
    assignGenerations(members, relations) {
        const graph = this.buildGraph(members, relations);
        const { childOf, spouseOf, parentOf } = graph;
        const gen = {};

        members.forEach(m => { gen[m.id] = undefined; });

        // Seed: true roots (no parents at all)
        const roots = members.filter(m => (childOf[m.id] || []).length === 0);
        if (roots.length === 0 && members.length > 0) roots.push(members[0]);
        roots.forEach(m => { gen[m.id] = 0; });

        // BFS downward from each root to give a decent initial assignment
        const bfsQueue = [...roots.map(m => m.id)];
        const visited  = new Set(bfsQueue);
        while (bfsQueue.length) {
            const pid = bfsQueue.shift();
            const pg  = gen[pid] ?? 0;
            (parentOf[pid] || []).forEach(cid => {
                const needed = pg + 1;
                if (gen[cid] === undefined || gen[cid] < needed) gen[cid] = needed;
                if (!visited.has(cid)) { visited.add(cid); bfsQueue.push(cid); }
            });
        }

        // Iterative fixup — converges quickly for typical family trees
        const maxPasses = Math.max(members.length * 4, 8);
        for (let pass = 0; pass < maxPasses; pass++) {
            let changed = false;

            // Step A: children must be strictly below every known parent
            members.forEach(m => {
                const parents = childOf[m.id] || [];
                if (!parents.length) return;
                const knownParentGens = parents.map(p => gen[p]).filter(g => g !== undefined);
                if (!knownParentGens.length) return;
                const required = Math.max(...knownParentGens) + 1;
                if (gen[m.id] === undefined || gen[m.id] < required) {
                    gen[m.id] = required;
                    changed = true;
                }
            });

            // Step B: spouses share the same generation (higher value wins)
            members.forEach(m => {
                (spouseOf[m.id] || []).forEach(sid => {
                    if (gen[m.id] === undefined && gen[sid] === undefined) return;
                    const aligned = Math.max(gen[m.id] ?? 0, gen[sid] ?? 0);
                    if (gen[m.id] !== aligned) { gen[m.id] = aligned; changed = true; }
                    if (gen[sid] !== aligned) { gen[sid] = aligned; changed = true; }
                });
            });

            // Step C: re-enforce parent-child after spouse alignment
            //         (spouse sync must never raise a child to a parent's row)
            members.forEach(m => {
                const parents = childOf[m.id] || [];
                if (!parents.length) return;
                const knownParentGens = parents.map(p => gen[p]).filter(g => g !== undefined);
                if (!knownParentGens.length) return;
                const required = Math.max(...knownParentGens) + 1;
                if (gen[m.id] === undefined || gen[m.id] < required) {
                    gen[m.id] = required;
                    changed = true;
                }
            });

            // Fallback: any still-undefined member goes to gen 0
            members.forEach(m => {
                if (gen[m.id] === undefined) { gen[m.id] = 0; changed = true; }
            });

            if (!changed) break;
        }

        return gen;
    }
};
