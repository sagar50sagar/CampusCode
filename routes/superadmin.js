const express = require('express');
const path = require('path');
const { requireRole } = require('../middleware/auth');
const { checkScope } = require('../middleware/authMiddleware');

module.exports = (db) => {
    const router = express.Router();

    // ==========================================
    // DASHBOARD VIEW
    // ==========================================
    router.get('/dashboard', requireRole('superadmin'), checkScope, (req, res) => {
        res.render('superadmin/dashboard', { user: req.session.user, currentPage: 'dashboard' });
    });

    // ==========================================
    // SUPERADMIN APIs (Manage Colleges)
    // ==========================================
    // Fetch all colleges
    router.get('/api/colleges', requireRole('superadmin'), (req, res) => {
        db.all(`SELECT * FROM colleges ORDER BY id DESC`, [], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, colleges: rows });
        });
    });

    // Add a new college
    router.post('/api/colleges', requireRole('superadmin'), (req, res) => {
        const { name } = req.body;
        db.run(`INSERT INTO colleges (name) VALUES (?)`, [name], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(400).json({ success: false, error: 'College already exists' });
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, id: this.lastID, message: 'College added successfully' });
        });
    });

    // Delete a college
    router.delete('/api/colleges/:id', requireRole('superadmin'), (req, res) => {
        db.run(`DELETE FROM colleges WHERE id = ?`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, message: 'College deleted successfully' });
        });
    });

    // ==========================================
    // SUPERADMIN APIs (Manage Admin Approvals)
    // ==========================================
    
    // 1. Fetch all pending college admins
    router.get('/api/pending-admins', requireRole('superadmin'), (req, res) => {
        db.all(`SELECT id, fullName, email, collegeName FROM users WHERE role = 'admin' AND status = 'pending' ORDER BY id DESC`, [], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, pendingAdmins: rows });
        });
    });

    // 2. Approve a pending admin
    router.post('/api/approve-admin/:id', requireRole('superadmin'), (req, res) => {
        db.run(`UPDATE users SET status = 'active' WHERE id = ? AND role = 'admin'`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (this.changes === 0) return res.status(404).json({ success: false, message: 'Admin not found or already active' });
            res.json({ success: true, message: 'College Admin approved successfully' });
        });
    });

    // 3. Reject (delete) a pending admin
    router.delete('/api/reject-admin/:id', requireRole('superadmin'), (req, res) => {
        db.run(`DELETE FROM users WHERE id = ? AND role = 'admin' AND status = 'pending'`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, message: 'College Admin registration rejected' });
        });
    });

    return router;
};