// js/db.js — Database layer using Dexie.js (IndexedDB wrapper)
// All data is stored permanently in the browser's IndexedDB

const MAX_PHOTO_SIZE  = 2 * 1024 * 1024; // 2 MB
const MAX_DOC_SIZE    = 5 * 1024 * 1024; // 5 MB

const db = new Dexie('ClanFamilyTreeDB');

db.version(1).stores({
    members:   '++id, name, gender, dob, generation, isAlive, createdAt',
    relations: '++id, fromId, toId, type',
    documents: '++id, memberId, filename, uploadedAt'
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ─── DB API ─────────────────────────────────────────────────────────────────

const DB = {

    // ── Members ─────────────────────────────────────────────────────────────

    async addMember(data) {
        return await db.members.add({
            name:        data.name        || 'Unknown',
            gender:      data.gender      || 'male',
            dob:         data.dob         || null,
            dateOfDeath: data.dateOfDeath || null,
            description: data.description || '',
            notes:       data.notes       || '',
            photo:       data.photo       || null,
            generation:  data.generation  !== undefined ? data.generation : 0,
            isAlive:     data.isAlive     !== undefined ? data.isAlive    : true,
            createdAt:   new Date().toISOString()
        });
    },

    async updateMember(id, data) {
        return await db.members.update(id, data);
    },

    async deleteMember(id) {
        await db.transaction('rw', db.members, db.relations, db.documents, async () => {
            await db.members.delete(id);
            await db.relations.where('fromId').equals(id).delete();
            await db.relations.where('toId').equals(id).delete();
            await db.documents.where('memberId').equals(id).delete();
        });
    },

    async getMember(id) {
        return await db.members.get(id);
    },

    async getAllMembers() {
        return await db.members.toArray();
    },

    async searchMembers(query) {
        const q = query.toLowerCase().trim();
        if (!q) return [];
        return await db.members.filter(m =>
            m.name.toLowerCase().includes(q) ||
            (m.description || '').toLowerCase().includes(q)
        ).toArray();
    },

    // ── Relations ───────────────────────────────────────────────────────────

    async addRelation(fromId, toId, type) {
        // Avoid duplicates
        const exists = await db.relations.filter(r =>
            r.fromId === fromId && r.toId === toId
        ).first();
        if (exists) return exists.id;
        return await db.relations.add({ fromId, toId, type });
    },

    async deleteRelation(id) {
        return await db.relations.delete(id);
    },

    async getRelationsForMember(memberId) {
        const asFrom = await db.relations.where('fromId').equals(memberId).toArray();
        const asTo   = await db.relations.where('toId').equals(memberId).toArray();
        return [...asFrom, ...asTo];
    },

    async getAllRelations() {
        return await db.relations.toArray();
    },

    // ── Documents ───────────────────────────────────────────────────────────

    async addDocument(memberId, filename, dataUrl) {
        return await db.documents.add({
            memberId,
            filename,
            data:       dataUrl,
            uploadedAt: new Date().toISOString()
        });
    },

    async getDocuments(memberId) {
        return await db.documents.where('memberId').equals(memberId).toArray();
    },

    async deleteDocument(id) {
        return await db.documents.delete(id);
    },

    // ── Photo upload helper ─────────────────────────────────────────────────

    async uploadPhoto(file) {
        if (file.size > MAX_PHOTO_SIZE) {
            showFileSizeWarning('Photo', MAX_PHOTO_SIZE);
            return null;
        }
        return await fileToBase64(file);
    },

    async uploadDocument(memberId, file) {
        if (file.size > MAX_DOC_SIZE) {
            showFileSizeWarning('Document', MAX_DOC_SIZE);
            return null;
        }
        const dataUrl = await fileToBase64(file);
        return await this.addDocument(memberId, file.name, dataUrl);
    },

    // ── Graph snapshot ──────────────────────────────────────────────────────

    async getFullSnapshot() {
        const [members, relations] = await Promise.all([
            db.members.toArray(),
            db.relations.toArray()
        ]);
        return { members, relations };
    }
};

function showFileSizeWarning(type, maxBytes) {
    const maxMB = (maxBytes / (1024 * 1024)).toFixed(0);
    showToast(`⚠️ ${type} file too large! Maximum allowed size is ${maxMB} MB. Please compress the file and try again.`, 'warning', 5000);
}
