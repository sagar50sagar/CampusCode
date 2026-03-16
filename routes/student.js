const express = require('express');
const path = require('path');
const { requireRole } = require('../middleware/auth');

module.exports = (db) => {
    const router = express.Router();

    // ==========================================
    // DASHBOARD VIEW
    // ==========================================
    router.get('/dashboard', requireRole('student'), (req, res) => {
        // Make sure you eventually create a student/dashboard.html in your views folder!
        res.sendFile(path.join(__dirname, '../views/student/dashboard.html'));
    });

    // ==========================================
    // STUDENT APIs 
    // ==========================================
    // You can add student-specific API endpoints here later
    router.get('/api/profile', requireRole('student'), (req, res) => {
        res.json({ 
            success: true, 
            message: "Student profile data will go here",
            user: req.session.user 
        });
    });

    return router;
};