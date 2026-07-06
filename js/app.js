// js/app.js — Application bootstrap, toast notifications, and global events

// ── Toast notification system ────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-msg">${message}</span><button class="toast-close" onclick="this.parentElement.remove()">×</button>`;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 400);
    }, duration);
}

// ── Default avatar SVG (inline) ──────────────────────────────────────────────
function injectDefaultAvatar() {
    // Create a simple SVG as default avatar referenced by assets/default_avatar.svg
    // Since we can't write files in init, we use a data URL approach
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
        <circle cx="50" cy="38" r="22" fill="#C0392B" opacity="0.7"/>
        <circle cx="50" cy="100" r="38" fill="#C0392B" opacity="0.7"/>
    </svg>`;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
const DEFAULT_AVATAR = injectDefaultAvatar();

// ── App bootstrap ────────────────────────────────────────────────────────────
const App = {

    async init() {
        // Smooth scroll hero → app
        document.getElementById('enter-tree-btn')?.addEventListener('click', () => {
            document.getElementById('app-section')?.scrollIntoView({ behavior: 'smooth' });
        });

        // Init tree canvas
        Tree.init();

        // Init search
        Search.init();

        // Setup toolbar
        this._setupToolbar();

        // Setup modals
        this._setupModals();

        // Setup tabs in member modal
        this._setupTabs();

        // Load data and render tree
        await Tree.refresh();
        // Fit tree to screen after a brief DOM settle
        setTimeout(() => Tree.fitToScreen(), 350);

        // Show welcome toast on first load
        const isFirst = !localStorage.getItem('clan_visited');
        if (isFirst) {
            localStorage.setItem('clan_visited', '1');
            setTimeout(() => showToast('🌺 Welcome to Clan Family Tree! Click "Add Root Member" to get started.', 'info', 6000), 800);
        }
    },

    _setupToolbar() {
        // Add root member
        document.getElementById('btn-add-root')?.addEventListener('click', () => {
            Members.openAddModal(null, null);
        });

        // Relationship finder
        document.getElementById('btn-finder')?.addEventListener('click', () => {
            Search.openRelFinder();
        });

        // Find button inside finder modal
        document.getElementById('btn-find-relation')?.addEventListener('click', () => {
            Search.findRelationship();
        });

        // Close finder modal
        document.getElementById('btn-close-finder')?.addEventListener('click', () => {
            document.getElementById('finder-modal')?.classList.remove('open');
            document.body.classList.remove('modal-open');
        });
    },

    _setupModals() {
        // Member modal — save
        document.getElementById('btn-save-member')?.addEventListener('click', () => {
            Members.saveMember();
        });

        // Member modal — cancel
        document.getElementById('btn-cancel-member')?.addEventListener('click', () => {
            Members._closeModal('member-modal');
        });

        // Delete modal — cancel
        document.getElementById('btn-cancel-delete')?.addEventListener('click', () => {
            Members._closeModal('delete-modal');
        });

        // Detail modal — close
        document.getElementById('btn-close-detail')?.addEventListener('click', () => {
            Members._closeModal('detail-modal');
        });

        // Close modals on backdrop click
        document.querySelectorAll('.modal-backdrop').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target === el) Members.closeAll();
            });
        });

        // Close on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') Members.closeAll();
        });

        // Photo upload
        document.getElementById('photo-upload-input')?.addEventListener('change', (e) => {
            Members.handlePhotoUpload(e.target);
        });

        // Document upload (only in edit mode)
        document.getElementById('doc-upload-btn')?.addEventListener('click', () => {
            const input = document.getElementById('doc-upload-input');
            if (!input) return;
            input.onchange = async (e) => {
                if (Members._editingId) {
                    await Members.handleDocumentUpload(e.target, Members._editingId);
                } else {
                    showToast('Please save the member first before uploading documents.', 'warning');
                }
            };
            input.click();
        });
    },

    _setupTabs() {
        document.querySelectorAll('.modal-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const tabId = tab.dataset.tab;
                document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tabId)?.classList.add('active');
            });
        });
    }
};

// ── Start app when DOM ready ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
