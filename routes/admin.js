const express = require('express');
const path = require('path');
const { requireRole } = require('../middleware/auth');

module.exports = (db) => {
    const router = express.Router();

    // ==========================================
    // DASHBOARD VIEW
    // ==========================================
    router.get('/dashboard', requireRole('admin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/admin/dashboard.html'));
    });

    // ==========================================
    // ADMIN APIs (Manage Users in their College)
    // ==========================================
    // Fetch pending faculty for approval
    router.get('/api/pending-faculty', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.all(`SELECT id, fullName, email FROM users WHERE collegeName = ? AND role = 'faculty' AND status = 'pending'`, 
        [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, pending: rows });
        });
    });

    // Approve a pending faculty
    router.post('/api/approve-faculty/:id', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.run(`UPDATE users SET status = 'active' WHERE id = ? AND collegeName = ? AND role = 'faculty'`, 
        [req.params.id, collegeName], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true });
        });
    });

    // Fetch active students and faculty
    router.get('/api/users', requireRole('admin'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.all(`SELECT id, role, fullName, email FROM users WHERE role IN ('student', 'faculty') AND status = 'active' AND collegeName = ? ORDER BY role ASC, id DESC`, 
        [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, users: rows });
        });
    });

    // Add a user directly
    router.post('/api/users', requireRole('admin'), (req, res) => {
        const { role, fullName, email, password } = req.body;
        const collegeName = req.session.user.collegeName;
        db.run(`INSERT INTO users (role, fullName, email, password, collegeName, status) VALUES (?, ?, ?, ?, ?, 'active')`, 
            [role, fullName, email, password, collegeName], function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, id: this.lastID, message: 'User added successfully' });
            });
    });

    // Update an existing user
    router.put('/api/users/:id', requireRole('admin'), (req, res) => {
        const { fullName, email, role, password } = req.body;
        const query = password 
            ? `UPDATE users SET fullName = ?, email = ?, role = ?, password = ? WHERE id = ?`
            : `UPDATE users SET fullName = ?, email = ?, role = ? WHERE id = ?`;
        const params = password ? [fullName, email, role, password, req.params.id] : [fullName, email, role, req.params.id];

        db.run(query, params, function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, message: 'User updated successfully' });
        });
    });

    // Delete a user
    router.delete('/api/users/:id', requireRole('admin'), (req, res) => {
        db.run(`DELETE FROM users WHERE id = ?`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, message: 'User deleted successfully' });
        });
    });

    return router;
};