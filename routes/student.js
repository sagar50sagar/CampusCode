const express = require('express');
const path = require('path');
const { requireRole } = require('../middleware/auth');

module.exports = (db) => {
    const router = express.Router();

    // ==========================================
    // DASHBOARD VIEW
    // ==========================================
    router.get('/dashboard', requireRole('student'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/student/dashboard.html'));
    });

    // ==========================================
    // STUDENT APIs 
    // ==========================================
    router.get('/api/profile', requireRole('student'), (req, res) => {
        res.json({ 
            success: true, 
            message: "Student profile data will go here",
            user: req.session.user 
        });
    });

    // ==========================================
    // CONTESTS — Scoped Visibility
    // Admin-created → full college
    // Others       → student's own department
    // ==========================================
    router.get('/api/contests', requireRole('student'), (req, res) => {
        const user = req.session.user;
        const { year, section } = req.query;

        let query = `
            SELECT c.*, u.fullName as creatorName, u.role as creatorRole
            FROM contests c
            JOIN users u ON c.createdBy = u.id
            WHERE c.status = 'accepted'
              AND (
                  (u.role = 'admin' AND u.collegeName = ?)
                  OR (u.role != 'admin' AND c.department = ? AND u.collegeName = ?)
              )
        `;
        const params = [user.collegeName, user.department, user.collegeName];

        // Optional year/section filter (for future scoping)
        if (year) { query += ` AND (c.eligibility LIKE ? OR c.eligibility IS NULL)`; params.push(`%${year}%`); }

        query += ` ORDER BY c.startDate DESC`;

        db.all(query, params, (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, contests: rows || [] });
        });
    });

    return router;
};