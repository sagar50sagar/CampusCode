const express = require('express');
const path = require('path');
const { requireRole } = require('../middleware/auth');

module.exports = (db) => {
    const router = express.Router();

    // ==========================================
    // DASHBOARD VIEW
    // ==========================================
    router.get('/dashboard', requireRole('faculty'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/faculty/dashboard.html'));
    });

    // ==========================================
    // FACULTY APIs
    // ==========================================
    // Fetch students belonging to the faculty's college
    router.get('/api/students', requireRole('faculty'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        
        db.all(`SELECT id, fullName, email FROM users WHERE role = 'student' AND status = 'active' AND collegeName = ? ORDER BY fullName ASC`, 
        [collegeName], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, students: rows });
        });
    });

    return router;
};