const express = require('express');
const path = require('path');

module.exports = (db) => {
    const router = express.Router();

    // ==========================================
    // PUBLIC VIEWS
    // ==========================================
    router.get('/', (req, res) => {
        // Redirect if already logged in
        if (req.session.user) {
            if (req.session.user.role === 'superadmin') return res.redirect('/superadmin/dashboard');
            if (req.session.user.role === 'admin') return res.redirect('/college/dashboard');
            if (req.session.user.role === 'faculty') return res.redirect('/faculty/dashboard');
            if (req.session.user.role === 'student') return res.redirect('/student/dashboard');
        }
        res.sendFile(path.join(__dirname, '../views/public/index.html'));
    });

    router.get('/college-register', (req, res) => {
        res.sendFile(path.join(__dirname, '../views/public/college-register.html'));
    });

    // ==========================================
    // PUBLIC APIs
    // ==========================================
    // Get list of active colleges for the dropdown
    router.get('/api/public/colleges', (req, res) => {
        db.all(`SELECT id, name FROM colleges WHERE status = 'active' ORDER BY name ASC`, [], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, colleges: rows });
        });
    });

    return router;
};