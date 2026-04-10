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
            if (req.session.user.role === 'hod') return res.redirect('/college/hod/dashboard');
            if (req.session.user.role === 'hos') return res.redirect('/hos/dashboard');
            if (req.session.user.role === 'faculty') return res.redirect('/faculty/dashboard');
            if (req.session.user.role === 'individual') return res.redirect('/individual/dashboard');
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

    // Landing page live metrics (no hardcoded numbers)
    router.get('/api/public/landing-data', (req, res) => {
        const out = {
            success: false,
            stats: {
                activeCoders: 0,
                campusesJoined: 0,
                acceptedRuns: 0
            },
            topCoders: []
        };

        db.get(
            `SELECT COUNT(*) AS count
             FROM account_users
             WHERE LOWER(COALESCE(role, '')) = 'student'
               AND LOWER(COALESCE(status, 'active')) != 'inactive'`,
            [],
            (err, studentsRow) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                out.stats.activeCoders = Number(studentsRow?.count || 0);

                db.get(
                    `SELECT COUNT(*) AS count
                     FROM colleges
                     WHERE LOWER(COALESCE(status, 'active')) = 'active'`,
                    [],
                    (err2, collegesRow) => {
                        if (err2) return res.status(500).json({ success: false, error: err2.message });
                        out.stats.campusesJoined = Number(collegesRow?.count || 0);

                        db.get(
                            `SELECT COUNT(*) AS count
                             FROM submissions
                             WHERE LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass')`,
                            [],
                            (err3, acceptedRow) => {
                                if (err3) return res.status(500).json({ success: false, error: err3.message });
                                out.stats.acceptedRuns = Number(acceptedRow?.count || 0);

                                db.all(
                                    `SELECT
                                        fullName,
                                        collegeName,
                                        COALESCE(solvedCount, 0) AS solved,
                                        COALESCE(points, 0) AS points
                                     FROM account_users
                                     WHERE LOWER(COALESCE(role, '')) = 'student'
                                       AND LOWER(COALESCE(status, 'active')) != 'inactive'
                                     ORDER BY COALESCE(solvedCount, 0) DESC, COALESCE(points, 0) DESC, id ASC
                                     LIMIT 3`,
                                    [],
                                    (err4, topRows) => {
                                        if (err4) return res.status(500).json({ success: false, error: err4.message });
                                        out.topCoders = Array.isArray(topRows) ? topRows : [];
                                        out.success = true;
                                        return res.json(out);
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });

    return router;
};
