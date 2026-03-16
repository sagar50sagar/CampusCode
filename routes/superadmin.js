const express = require('express');
const path = require('path');
const { requireRole } = require('../middleware/auth');

module.exports = (db) => {
    const router = express.Router();

    // ==========================================
    // DASHBOARD VIEW
    // ==========================================
    router.get('/dashboard', requireRole('superadmin'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/superadmin/dashboard.html'));
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

    return router;
};