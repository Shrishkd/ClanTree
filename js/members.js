// js/members.js — Add / Edit / Delete member logic + photo & document upload

const Members = {

    // ── State ────────────────────────────────────────────────────────────────
    _pendingRelation: null,  // { sourceId, relationType, coParentId? }
    _editingId:       null,
    _photoPreview:    null,  // base64 string

    // ── Open Add Modal ───────────────────────────────────────────────────────
    async openAddModal(sourceId, relationType) {
        // For son/daughter: if the source person has multiple spouses,
        // we must ask which spouse is the co-parent before opening the form.
        if (sourceId != null && (relationType === 'son' || relationType === 'daughter')) {
            const srcRels  = await DB.getRelationsForMember(sourceId);
            const spouseIds = srcRels
                .filter(r => r.type === 'spouse')
                .map(r => r.fromId === sourceId ? r.toId : r.fromId);

            if (spouseIds.length > 1) {
                // Multiple spouses — ask user to pick the co-parent
                await this._pickCoParent(sourceId, relationType, spouseIds);
                return;
            }
        }

        this._openAddModalDirect(sourceId, relationType, null);
    },

    // ── Co-Parent Picker ─────────────────────────────────────────────────────
    // Shows a small modal asking "Which spouse is the other parent?"
    async _pickCoParent(sourceId, relationType, spouseIds) {
        // Fetch spouse names
        const spouses = await Promise.all(spouseIds.map(id => DB.getMember(id)));
        const sourceMember = await DB.getMember(sourceId);

        // Build and show the picker modal
        let modal = document.getElementById('coparent-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id        = 'coparent-modal';
            modal.className = 'modal-backdrop';
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.innerHTML = `
                <div class="modal-box" style="max-width:420px;">
                    <div class="modal-header">
                        <h2 class="modal-title" id="coparent-modal-title">Select Other Parent</h2>
                        <button class="modal-close" id="btn-close-coparent" aria-label="Close">×</button>
                    </div>
                    <div class="modal-body" id="coparent-modal-body"></div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" id="btn-cancel-coparent">Cancel</button>
                    </div>
                </div>`;
            document.body.appendChild(modal);

            modal.querySelector('#btn-close-coparent').addEventListener('click',  () => this._closeCoParentModal());
            modal.querySelector('#btn-cancel-coparent').addEventListener('click', () => this._closeCoParentModal());
            modal.addEventListener('click', (e) => { if (e.target === modal) this._closeCoParentModal(); });
        }

        const childLabel = relationType === 'son' ? 'son' : 'daughter';
        const body = modal.querySelector('#coparent-modal-body');
        body.innerHTML = `
            <p style="font-size:0.85rem;color:rgba(44,16,0,0.6);margin-bottom:16px;">
                <strong>${sourceMember?.name || 'This person'}</strong> has multiple spouses.
                Who is the mother/other parent of this ${childLabel}?
            </p>
            <div style="display:flex;flex-direction:column;gap:8px;">
                ${spouses.filter(Boolean).map(sp => `
                    <button class="btn btn-secondary coparent-choice"
                            data-spouse-id="${sp.id}"
                            style="text-align:left;padding:10px 14px;font-size:0.88rem;">
                        <strong>${sp.name}</strong>
                        ${sp.dob ? `<span style="color:rgba(44,16,0,0.5);font-size:0.78rem;margin-left:8px;">DOB: ${formatDate(sp.dob)}</span>` : ''}
                    </button>`).join('')}
                <button class="btn btn-secondary coparent-choice"
                        data-spouse-id="none"
                        style="text-align:left;padding:10px 14px;font-size:0.88rem;border-style:dashed;">
                    <em style="color:rgba(44,16,0,0.45);">Unknown / not in tree</em>
                </button>
            </div>`;

        modal.querySelectorAll('.coparent-choice').forEach(btn => {
            btn.addEventListener('click', () => {
                const spouseId = btn.dataset.spouseId;
                const coParentId = spouseId === 'none' ? null : parseInt(spouseId);
                this._closeCoParentModal();
                this._openAddModalDirect(sourceId, relationType, coParentId);
            });
        });

        modal.classList.add('open');
        document.body.classList.add('modal-open');
    },

    _closeCoParentModal() {
        const modal = document.getElementById('coparent-modal');
        if (modal) { modal.classList.remove('open'); document.body.classList.remove('modal-open'); }
    },

    // ── Internal: open the member add form (after co-parent has been resolved) ──
    _openAddModalDirect(sourceId, relationType, coParentId) {
        this._pendingRelation = sourceId != null
            ? { sourceId, relationType, coParentId }
            : null;
        this._editingId    = null;
        this._photoPreview = null;

        const titles = {
            'father':        'Add Father',
            'mother':        'Add Mother',
            'spouse':        'Add Spouse',
            'son':           'Add Son',
            'daughter':      'Add Daughter',
            'brother':       'Add Brother',
            'sister':        'Add Sister',
            'adopted-child': 'Add Adopted Child',
        };
        const title = sourceId != null ? (titles[relationType] || 'Add Member') : 'Add Root Member';
        document.getElementById('member-modal-title').textContent = title;
        this._resetForm();

        const genderMap = {
            father:  'male',
            mother:  'female',
            son:     'male',
            daughter:'female',
            brother: 'male',
            sister:  'female',
            spouse:  '',
        };
        if (genderMap[relationType]) {
            const radio = document.querySelector(`input[name="gender"][value="${genderMap[relationType]}"]`);
            if (radio) radio.checked = true;
        }

        this._openModal('member-modal');
    },

    // ── Open Edit Modal ──────────────────────────────────────────────────────
    async openEditModal(memberId) {
        this._editingId       = memberId;
        this._pendingRelation = null;

        const member = await DB.getMember(memberId);
        if (!member) return;

        document.getElementById('member-modal-title').textContent = 'Edit Member';
        this._resetForm();

        document.getElementById('member-name').value        = member.name        || '';
        document.getElementById('member-dob').value         = member.dob         || '';
        document.getElementById('member-description').value = member.description || '';
        document.getElementById('member-notes').value       = member.notes       || '';

        const isAliveChk = document.getElementById('member-isAlive');
        if (isAliveChk) {
            isAliveChk.checked = member.isAlive !== false;
            // Show/hide DOD field based on isAlive
            const dodGroup = document.getElementById('dod-group');
            if (dodGroup) dodGroup.style.display = isAliveChk.checked ? 'none' : 'block';
        }

        // Populate Date of Death if available
        const dodInput = document.getElementById('member-dod');
        if (dodInput) dodInput.value = member.dateOfDeath || '';

        // Gender
        const gRadio = document.querySelector(`input[name="gender"][value="${member.gender}"]`);
        if (gRadio) gRadio.checked = true;

        // Photo preview
        if (member.photo) {
            this._photoPreview = member.photo;
            this._setPhotoPreview(member.photo);
        }

        // Load documents tab
        await this._loadDocumentsList(memberId);

        this._openModal('member-modal');
    },

    // ── Save Member ──────────────────────────────────────────────────────────
    async saveMember() {
        const name = document.getElementById('member-name').value.trim();
        if (!name) {
            showToast('⚠️ Name is required!', 'warning');
            return;
        }

        const gender      = document.querySelector('input[name="gender"]:checked')?.value || 'male';
        const dob         = document.getElementById('member-dob').value || null;
        const isAlive     = document.getElementById('member-isAlive')?.checked !== false;
        const dateOfDeath = (!isAlive && document.getElementById('member-dod')?.value)
                            ? document.getElementById('member-dod').value
                            : null;
        const description = document.getElementById('member-description').value.trim();
        const notes       = document.getElementById('member-notes').value.trim();

        const memberData = { name, gender, dob, dateOfDeath, description, notes,
                             photo: this._photoPreview, isAlive };

        if (this._editingId) {
            // --- Edit existing ---
            await DB.updateMember(this._editingId, memberData);
            showToast(`✅ ${name} updated successfully!`, 'success');
        } else {
            // --- Add new ---
            let generation = 0;
            if (this._pendingRelation) {
                const { sourceId, relationType } = this._pendingRelation;
                const snapshot = await DB.getFullSnapshot();
                const gens     = Relations.assignGenerations(snapshot.members, snapshot.relations);
                const sourceGen = gens[sourceId] || 0;

                const genOffset = {
                    father:  -1, mother:  -1,
                    son:      1, daughter: 1, 'adopted-child': 1,
                    spouse:   0,
                    brother:  0, sister:   0,
                };
                generation = sourceGen + (genOffset[relationType] || 0);
            }
            memberData.generation = generation;

            const newId = await DB.addMember(memberData);

            // Create relationship
            if (this._pendingRelation) {
                const { sourceId, relationType } = this._pendingRelation;
                await this._createRelation(sourceId, newId, relationType);
            }

            showToast(`✅ ${name} added to the family tree!`, 'success');
        }

        this._closeModal('member-modal');
        await Tree.refresh();
    },

    // ── Create Relation ──────────────────────────────────────────────────────
    async _createRelation(sourceId, newId, relationType) {
        // coParentId is set when the user explicitly chose a co-parent
        const coParentId = this._pendingRelation?.coParentId ?? undefined;

        switch (relationType) {
            case 'father':
            case 'mother':
                // newId is parent, sourceId is child
                await DB.addRelation(newId, sourceId, 'parent-child');
                break;

            case 'son':
            case 'daughter': {
                // sourceId is parent, newId is child
                await DB.addRelation(sourceId, newId, 'parent-child');

                const srcRels    = await DB.getRelationsForMember(sourceId);
                const spouseIds  = srcRels
                    .filter(r => r.type === 'spouse')
                    .map(r => r.fromId === sourceId ? r.toId : r.fromId);

                if (coParentId !== undefined && coParentId !== null) {
                    // User explicitly picked a co-parent
                    await DB.addRelation(coParentId, newId, 'parent-child');
                } else if (spouseIds.length === 1) {
                    // Only one spouse — auto-link as co-parent
                    await DB.addRelation(spouseIds[0], newId, 'parent-child');
                }
                // If spouseIds.length > 1 and coParentId is null → unknown/not in tree, don't link any spouse
                break;
            }

            case 'adopted-child':
                await DB.addRelation(sourceId, newId, 'adopted-child');
                break;

            case 'spouse':
                await DB.addRelation(sourceId, newId, 'spouse');
                break;

            case 'brother':
            case 'sister': {
                // Share same parents — add as sibling relation
                await DB.addRelation(sourceId, newId, 'sibling');
                // Also propagate parents of source to new sibling
                const sibRels = await DB.getRelationsForMember(sourceId);
                for (const r of sibRels) {
                    if (r.type === 'parent-child' && r.toId === sourceId) {
                        await DB.addRelation(r.fromId, newId, 'parent-child');
                    }
                }
                break;
            }
        }
    },

    // ── Confirm Delete ───────────────────────────────────────────────────────
    async confirmDelete(memberId) {
        const member = await DB.getMember(memberId);
        if (!member) return;

        document.getElementById('delete-member-name').textContent = member.name;
        document.getElementById('confirm-delete-btn').onclick = async () => {
            await DB.deleteMember(memberId);
            this._closeModal('delete-modal');
            showToast(`🗑️ ${member.name} removed from the family tree.`, 'info');
            await Tree.refresh();
        };
        this._openModal('delete-modal');
    },

    // ── Photo Upload ─────────────────────────────────────────────────────────
    async handlePhotoUpload(input) {
        const file = input.files[0];
        if (!file) return;

        const base64 = await DB.uploadPhoto(file);
        if (!base64) return; // size warning shown inside DB.uploadPhoto

        this._photoPreview = base64;
        this._setPhotoPreview(base64);
    },

    _setPhotoPreview(src) {
        const preview = document.getElementById('photo-preview');
        const wrapper = document.getElementById('photo-preview-wrapper');
        if (preview) preview.src    = src;
        if (wrapper) wrapper.style.display = 'flex';
    },

    // ── Document Upload ──────────────────────────────────────────────────────
    async handleDocumentUpload(input, memberId) {
        const file = input.files[0];
        if (!file) return;

        const id = await DB.uploadDocument(memberId, file);
        if (!id) return;

        showToast(`📄 Document "${file.name}" uploaded!`, 'success');
        await this._loadDocumentsList(memberId);
    },

    async _loadDocumentsList(memberId) {
        const list = document.getElementById('documents-list');
        if (!list) return;
        const docs = await DB.getDocuments(memberId);
        list.innerHTML = docs.length === 0
            ? '<p class="no-docs">No documents uploaded yet.</p>'
            : docs.map(d => `
                <div class="doc-item" data-id="${d.id}">
                    <span class="doc-icon">📄</span>
                    <span class="doc-name">${d.filename}</span>
                    <a class="doc-download" href="${d.data}" download="${d.filename}">⬇ Download</a>
                    <button class="doc-delete btn-icon" onclick="Members._deleteDoc(${d.id}, ${memberId})">🗑️</button>
                </div>`).join('');
    },

    async _deleteDoc(docId, memberId) {
        await DB.deleteDocument(docId);
        showToast('Document deleted.', 'info');
        await this._loadDocumentsList(memberId);
    },

    // ── Member Detail Modal ──────────────────────────────────────────────────
    async openDetailModal(memberId) {
        const member = await DB.getMember(memberId);
        if (!member) return;

        const snapshot = await DB.getFullSnapshot();
        const rels     = snapshot.relations.filter(r => r.fromId === memberId || r.toId === memberId);
        const relMemberIds = [...new Set(rels.map(r => r.fromId === memberId ? r.toId : r.fromId))];
        const relMembers   = snapshot.members.filter(m => relMemberIds.includes(m.id));

        const relHtml = relMembers.map(rm => {
            const rel = rels.find(r =>
                (r.fromId === memberId && r.toId === rm.id) ||
                (r.toId === memberId && r.fromId === rm.id)
            );
            let label = rel?.type || '';
            if (label === 'parent-child') label = rel.fromId === memberId ? 'Child' : 'Parent';
            if (label === 'adopted-child') label = rel.fromId === memberId ? 'Adopted Child' : 'Adoptive Parent';
            if (label === 'spouse') label = 'Spouse';
            if (label === 'sibling') label = 'Sibling';
            return `<div class="relation-chip ${label.toLowerCase()}">${rm.name} <em>(${label})</em></div>`;
        }).join('');

        const docs  = await DB.getDocuments(memberId);
        const docsHtml = docs.map(d =>
            `<a href="${d.data}" download="${d.filename}" class="doc-badge">📄 ${d.filename}</a>`
        ).join('');

        const gens  = Relations.assignGenerations(snapshot.members, snapshot.relations);
        const genNum = gens[memberId] || member.generation || 0;

        document.getElementById('detail-photo').src          = member.photo || 'assets/default_avatar.svg';
        document.getElementById('detail-name').textContent   = member.name;
        document.getElementById('detail-dob').textContent    = member.dob  ? formatDate(member.dob) : 'Unknown';
        document.getElementById('detail-gender').textContent = member.gender ? capitalise(member.gender) : '—';
        document.getElementById('detail-gen').textContent    = `Generation ${genNum}`;
        document.getElementById('detail-alive').textContent  = member.isAlive ? 'Alive' : 'Deceased';
        document.getElementById('detail-desc').textContent   = member.description || '—';
        document.getElementById('detail-notes').textContent  = member.notes       || '—';
        document.getElementById('detail-relations').innerHTML = relHtml || '<p>No recorded relations.</p>';
        document.getElementById('detail-docs').innerHTML     = docsHtml || '<p>No documents.</p>';

        // Wire edit/delete buttons
        document.getElementById('detail-edit-btn').onclick   = () => { this._closeModal('detail-modal'); this.openEditModal(memberId); };
        document.getElementById('detail-delete-btn').onclick = () => { this._closeModal('detail-modal'); this.confirmDelete(memberId); };

        this._openModal('detail-modal');
    },

    // ── Relation Types Popup ─────────────────────────────────────────────────
    showRelationMenu(event, memberId) {
        event.stopPropagation();
        // Remove any existing menu
        document.querySelectorAll('.relation-menu').forEach(m => m.remove());

        const relations = [
            { key: 'father',        label: '👨 Add Father',         icon: '👨' },
            { key: 'mother',        label: '👩 Add Mother',         icon: '👩' },
            { key: 'spouse',        label: '💑 Add Spouse',         icon: '💑' },
            { key: 'son',           label: '👦 Add Son',            icon: '👦' },
            { key: 'daughter',      label: '👧 Add Daughter',       icon: '👧' },
            { key: 'brother',       label: '🧑 Add Brother',        icon: '🧑' },
            { key: 'sister',        label: '👩 Add Sister',         icon: '👩' },
            { key: 'adopted-child', label: '🤝 Add Adopted Child',  icon: '🤝' },
        ];

        const menu = document.createElement('div');
        menu.className = 'relation-menu';
        menu.innerHTML = relations.map(r =>
            `<button class="relation-option" data-key="${r.key}">${r.label}</button>`
        ).join('');

        // ── Position the menu near the + button ──────────────────────────────
        // The menu uses position:fixed (viewport-relative).
        // getBoundingClientRect() already returns viewport coords.
        // NEVER add window.scrollX/Y — that pushes it far off-screen.
        const btn  = event.currentTarget || event.target;
        const rect = btn.getBoundingClientRect();
        const menuW = 290;
        const menuH = 320;

        let left = rect.left;
        let top  = rect.bottom + 6;

        // Clamp within viewport so menu never clips off an edge
        if (left + menuW > window.innerWidth  - 8) left = window.innerWidth  - menuW - 8;
        if (top  + menuH > window.innerHeight - 8) top  = rect.top - menuH - 6;
        if (left < 8) left = 8;
        if (top  < 8) top  = 8;

        menu.style.left = `${left}px`;
        menu.style.top  = `${top}px`;
        menu.style.position = 'fixed';
        menu.style.zIndex   = '9000';

        document.body.appendChild(menu);

        menu.querySelectorAll('.relation-option').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const key = btn.dataset.key;
                menu.remove();
                this.openAddModal(memberId, key);
            });
        });

        // Close on outside click
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    },

    // ── Modal helpers ────────────────────────────────────────────────────────
    _openModal(id) {
        const el = document.getElementById(id);
        if (el) { el.classList.add('open'); document.body.classList.add('modal-open'); }
    },
    _closeModal(id) {
        const el = document.getElementById(id);
        if (el) { el.classList.remove('open'); document.body.classList.remove('modal-open'); }
    },

    _resetForm() {
        document.getElementById('member-form').reset();
        const wrapper = document.getElementById('photo-preview-wrapper');
        if (wrapper) wrapper.style.display = 'none';
        const list = document.getElementById('documents-list');
        if (list) list.innerHTML = '';
        // Hide DOD field — reset to default (living member)
        const dodGroup = document.getElementById('dod-group');
        if (dodGroup) dodGroup.style.display = 'none';
        this._photoPreview = null;
        // Switch to info tab
        this._switchTab('tab-info');
    },

    _switchTab(tabId) {
        document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.modal-tab-content').forEach(t => t.classList.remove('active'));
        const tab = document.querySelector(`[data-tab="${tabId}"]`);
        const content = document.getElementById(tabId);
        if (tab) tab.classList.add('active');
        if (content) content.classList.add('active');
    },

    closeAll() {
        ['member-modal', 'delete-modal', 'detail-modal', 'finder-modal'].forEach(id => this._closeModal(id));
        this._closeCoParentModal();
    }
};

// ── Utility ──────────────────────────────────────────────────────────────────
function formatDate(dob) {
    if (!dob) return 'Unknown';
    try { return new Date(dob).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch { return dob; }
}

function capitalise(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}
