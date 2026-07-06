// js/search.js — Live search and tree focus logic

const Search = {

    _results: [],
    _debounceTimer: null,

    init() {
        const input = document.getElementById('search-input');
        if (!input) return;

        input.addEventListener('input', (e) => {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = setTimeout(() => this.performSearch(e.target.value), 250);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.clearSearch();
        });

        // Close dropdown on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-wrapper')) this.clearDropdown();
        });
    },

    async performSearch(query) {
        const dropdown = document.getElementById('search-dropdown');
        if (!query.trim()) {
            this.clearDropdown();
            return;
        }

        this._results = await DB.searchMembers(query);

        if (!dropdown) return;

        if (this._results.length === 0) {
            dropdown.innerHTML = '<div class="search-no-result">No members found</div>';
            dropdown.classList.add('visible');
            return;
        }

        dropdown.innerHTML = this._results.map(m => `
            <div class="search-result-item" data-id="${m.id}">
                <div class="search-avatar">
                    ${m.photo
                        ? `<img src="${m.photo}" alt="${m.name}">`
                        : `<div class="search-avatar-placeholder">${m.name.charAt(0).toUpperCase()}</div>`
                    }
                </div>
                <div class="search-info">
                    <span class="search-name">${this._highlight(m.name, query)}</span>
                    ${m.dob ? `<span class="search-dob">Born: ${formatDate(m.dob)}</span>` : ''}
                </div>
            </div>
        `).join('');

        dropdown.classList.add('visible');

        dropdown.querySelectorAll('.search-result-item').forEach(el => {
            el.addEventListener('click', () => {
                const id = parseInt(el.dataset.id);
                this.focusMember(id);
                this.clearDropdown();
                document.getElementById('search-input').value = '';
            });
        });
    },

    focusMember(id) {
        Tree.highlightAndCenter(id);
    },

    _highlight(text, query) {
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        if (idx === -1) return text;
        return (
            text.slice(0, idx) +
            `<mark>${text.slice(idx, idx + query.length)}</mark>` +
            text.slice(idx + query.length)
        );
    },

    clearDropdown() {
        const dropdown = document.getElementById('search-dropdown');
        if (dropdown) dropdown.classList.remove('visible');
    },

    clearSearch() {
        const input = document.getElementById('search-input');
        if (input) input.value = '';
        this.clearDropdown();
        Tree.clearHighlight();
    },

    // ── Relationship Finder ──────────────────────────────────────────────────
    async openRelFinder() {
        const modal = document.getElementById('finder-modal');
        if (!modal) return;

        const snapshot = await DB.getFullSnapshot();
        const options  = snapshot.members.map(m =>
            `<option value="${m.id}">${m.name}</option>`
        ).join('');

        document.getElementById('finder-person-a').innerHTML = `<option value="">— Select Person —</option>${options}`;
        document.getElementById('finder-person-b').innerHTML = `<option value="">— Select Person —</option>${options}`;
        document.getElementById('finder-result').innerHTML   = '';

        modal.classList.add('open');
        document.body.classList.add('modal-open');
    },

    async findRelationship() {
        const aId = parseInt(document.getElementById('finder-person-a').value);
        const bId = parseInt(document.getElementById('finder-person-b').value);
        const result = document.getElementById('finder-result');

        if (!aId || !bId) {
            result.innerHTML = '<p class="finder-error">Please select both people.</p>';
            return;
        }
        if (aId === bId) {
            result.innerHTML = '<p class="finder-error">Please select two different people.</p>';
            return;
        }

        const snapshot = await DB.getFullSnapshot();
        const rel = Relations.describeRelationship(aId, bId, snapshot.members, snapshot.relations);

        if (!rel) {
            result.innerHTML = `
                <div class="finder-no-connection">
                    <span class="finder-icon">🔗</span>
                    <p>No relationship found between these two members.<br>
                    They may be from different unconnected branches.</p>
                </div>`;
            return;
        }

        const memberMap = {};
        snapshot.members.forEach(m => memberMap[m.id] = m);

        let pathHtml = '';
        rel.path.forEach((id, idx) => {
            const m = memberMap[id];
            if (!m) return;
            pathHtml += `
                <div class="finder-node ${idx === 0 ? 'finder-start' : ''} ${idx === rel.path.length - 1 ? 'finder-end' : ''}">
                    <div class="finder-avatar">
                        ${m.photo ? `<img src="${m.photo}" alt="${m.name}">` : `<div class="finder-avatar-ph">${m.name.charAt(0)}</div>`}
                    </div>
                    <div class="finder-member-name">${m.name}</div>
                    ${m.dob ? `<div class="finder-member-dob">${formatDate(m.dob)}</div>` : ''}
                </div>`;
            if (idx < rel.labels.length) {
                pathHtml += `<div class="finder-arrow"><span>${rel.labels[idx]}</span></div>`;
            }
        });

        result.innerHTML = `
            <div class="finder-title">
                <span class="finder-badge">${rel.relationshipTitle}</span>
            </div>
            <div class="finder-path">${pathHtml}</div>`;
    }
};
