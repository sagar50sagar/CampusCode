const express = require('express');
const path = require('path');
const { requireRole } = require('../middleware/auth');
const { checkScope } = require('../middleware/authMiddleware');

module.exports = (db) => {
    const router = express.Router();

    // ==========================================
    // HELPER: Build common template data
    // ==========================================
    function buildUser(req) {
        return req.session.user;
    }

    // ==========================================
    // DASHBOARD
    // ==========================================
    const runQuery = (query, params) => new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    const getSingle = (query, params) => new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    router.get('/dashboard', requireRole(['faculty', 'hos', 'hod']), checkScope, async (req, res) => {
        const user = buildUser(req);
        
        try {
            const studentCountRow = await getSingle(`SELECT COUNT(id) as count FROM users WHERE role = 'student' AND status = 'active' AND collegeName = ?`, [user.collegeName]);
            const problemsCountRow = await getSingle(`SELECT COUNT(id) as count FROM problems WHERE faculty_id = ?`, [user.id]);
            const contestsCountRow = await getSingle(
                `SELECT COUNT(c.id) as count 
                 FROM contests c 
                 LEFT JOIN users u ON c.createdBy = u.id 
                 WHERE (u.collegeName = ? AND c.status = 'accepted') OR (c.createdBy = ? AND c.status = 'accepted')`, 
                [user.collegeName, user.id]
            );
            
            // Calculate Subjects Taught/Managed
            let subjectsTaught = 0;
            if (user.role === 'hod') {
                // HOD implicitly manages all subjects in their branch
                const branchRow = await getSingle(`SELECT id FROM branches WHERE name = ? OR abbreviation = ?`, [user.department, user.department]);
                if (branchRow) {
                    const subjectCountRow = await getSingle(`
                        SELECT COUNT(DISTINCT s.name) as count 
                        FROM subjects s
                        JOIN sections sec ON s.section_id = sec.id
                        WHERE sec.branch_id = ?
                    `, [branchRow.id]);
                    subjectsTaught = subjectCountRow ? subjectCountRow.count : 0;
                }
            } else {
                // Faculty/HOS count from explicit assignments
                const assignmentCountRow = await getSingle(`SELECT COUNT(DISTINCT subject) as count FROM user_assignments WHERE user_id = ?`, [user.id]);
                subjectsTaught = assignmentCountRow ? assignmentCountRow.count : 0;
            }
            
            const rawDraftProblems = await runQuery(`SELECT * FROM problems WHERE faculty_id = ? AND is_public = 0 ORDER BY createdAt DESC LIMIT 3`, [user.id]);
            
            const difficultyRows = await runQuery(`SELECT difficulty, COUNT(id) as count FROM problems WHERE faculty_id = ? GROUP BY difficulty`, [user.id]);
            let easyCount = 0, mediumCount = 0, hardCount = 0;
            difficultyRows.forEach(row => {
                if (row.difficulty === 'Easy') easyCount = row.count;
                if (row.difficulty === 'Medium') mediumCount = row.count;
                if (row.difficulty === 'Hard') hardCount = row.count;
            });
            const difficultySpread = [easyCount, mediumCount, hardCount];
            // Provide a visual fallback if no problems exist
            if (easyCount + mediumCount + hardCount === 0) {
                difficultySpread[0] = 1; // Just so the doughnut isn't completely empty visually, or leave [0,0,0]
            }

            const draftProblems = rawDraftProblems.map(p => ({
                title: p.title,
                lastEdited: new Date(p.createdAt).toLocaleDateString(),
                icon: 'pen',
                iconColor: 'blue',
                status: 'Draft',
                statusColor: 'gray'
            }));
            
            const recentActivity = [];
            
            const stats = {
                problemsCreated: problemsCountRow ? problemsCountRow.count : 0,
                activeContests: contestsCountRow ? contestsCountRow.count : 0,
                totalStudents: studentCountRow ? studentCountRow.count : 0,
                subjectsTaught: subjectsTaught
            };

            res.render('faculty/dashboard', { user, stats, draftProblems, recentActivity, difficultySpread, currentPage: 'dashboard', pageTitle: 'Dashboard' });
        } catch (error) {
            console.error("Dashboard DB Error:", error);
            res.render('faculty/dashboard', { 
                user, 
                stats: { problemsCreated: 0, activeContests: 0, totalStudents: 0, subjectsTaught: 0 }, 
                draftProblems: [], 
                recentActivity: [],
                difficultySpread: [0, 0, 0],
                currentPage: 'dashboard',
                pageTitle: 'Dashboard'
            });
        }
    });

    // ==========================================
    // PROBLEMS
    // ==========================================
    router.get('/problem', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        // Fetch globally approved problems from the entire college, plus all problems belonging to this faculty
        db.all(
            `SELECT p.* FROM problems p 
             JOIN users u ON p.faculty_id = u.id 
             WHERE (u.collegeName = ? AND p.status = 'accepted' AND LOWER(p.visibility_scope) = 'global') OR p.faculty_id = ? 
             ORDER BY p.createdAt DESC`,
            [user.collegeName, user.id],
            (err, problems) => {
                if (err) problems = [];
                
                db.all(`SELECT subject FROM user_assignments WHERE user_id = ?`, [user.id], (err, assignments) => {
                    const assignedSubjects = assignments ? assignments.map(a => a.subject) : [];
                    res.render('faculty/problem', { 
                        user, 
                        problems, 
                        assignedSubjects,
                        currentPage: 'problem', 
                        pageTitle: 'Manage Problems' 
                    });
                });
            }
        );
    });

    // ==========================================
    // CREATE PROBLEM
    // ==========================================
    router.get('/problem/create', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        // Re-fetch isVerified from DB to avoid stale session data
        // (admin may have approved the faculty after they logged in)
        db.get(`SELECT isVerified FROM users WHERE id = ?`, [user.id], (err, row) => {
            if (!err && row) {
                const freshIsVerified = row.isVerified === 1 || row.isVerified === true;
                // Sync the session so other pages also see the updated value
                req.session.user.isVerified = freshIsVerified;
                user.isVerified = freshIsVerified;
            }
            
            db.all(`SELECT subject FROM user_assignments WHERE user_id = ?`, [user.id], (err, assignments) => {
                const assignedSubjects = assignments ? assignments.map(a => a.subject) : [];
                res.render('faculty/create-problem', { 
                    user, 
                    currentPage: 'problem',
                    pageTitle: 'Create New Problem',
                    dropdownData: res.locals.dropdownData,
                    assignedSubjects
                });
            });
        });
    });

    router.post('/problem/create', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        const user = buildUser(req);
        let { title, subject, difficulty, input_format, output_format, constraints, sample_input, sample_output, hidden_test_cases, description, is_public, visibility_scope } = req.body;
        
        let isPublicVal = (is_public === 'on' || is_public === 'true' || is_public === '1') ? 1 : 0;
        if (!user.isVerified) { isPublicVal = 0; }
        
        const scope = visibility_scope || 'global';

        console.log("[Create Problem] created_by:", user.id, "| title:", title, "| isPublic:", isPublicVal, "| scope:", scope);

        db.run(`INSERT INTO problems (title, description, subject, difficulty, input_format, output_format, constraints, sample_input, sample_output, hidden_test_cases, faculty_id, is_public, department, visibility_scope, status) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, description, subject, difficulty, input_format, output_format, constraints, sample_input, sample_output, hidden_test_cases, user.id, isPublicVal, user.department, scope, 'pending'],
            function(err) {
                if (err) {
                    console.error("[Create Problem] DB Error:", err.message);
                    return res.status(500).send("Database error while creating problem: " + err.message);
                }
                if (user.role === 'hod') {
                    res.redirect('/college/hod/problem');
                } else if (user.role === 'hos') {
                    res.redirect('/hos/problem');
                } else {
                    res.redirect('/faculty/dashboard'); 
                }
            }
        );
    });

    // ==========================================
    // VIEW PROBLEM
    // ==========================================
    router.get('/problem/view/:id', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        db.get(`SELECT * FROM problems WHERE id = ? AND faculty_id = ?`, [req.params.id, user.id], (err, problem) => {
            if (err || !problem) return res.status(404).send("Problem not found.");
            res.render('faculty/view-problem', { user, problem, currentPage: 'problem', pageTitle: 'Problem Details' });
        });
    });

    // ==========================================
    // EDIT & DELETE PROBLEM
    // ==========================================
    router.get('/problem/edit/:id', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        db.get(`SELECT * FROM problems WHERE id = ? AND faculty_id = ?`, [req.params.id, user.id], (err, problem) => {
            if (err || !problem) return res.status(404).send("Problem not found.");
            res.render('faculty/edit-problem', { user, problem, currentPage: 'problem', pageTitle: 'Edit Problem' });
        });
    });

    router.post('/problem/edit/:id', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        const user = buildUser(req);
        const problemId = req.params.id;
        let { title, subject, difficulty, input_format, output_format, constraints, sample_input, sample_output, hidden_test_cases, description, is_public } = req.body;
        
        let isPublicVal = (is_public === 'on' || is_public === 'true' || is_public === '1') ? 1 : 0;
        if (!user.isVerified) { isPublicVal = 0; }

        db.run(`UPDATE problems SET title = ?, description = ?, subject = ?, difficulty = ?, input_format = ?, output_format = ?, constraints = ?, sample_input = ?, sample_output = ?, hidden_test_cases = ?, is_public = ? WHERE id = ? AND faculty_id = ?`,
            [title, description, subject, difficulty, input_format, output_format, constraints, sample_input, sample_output, hidden_test_cases, isPublicVal, problemId, user.id],
            function(err) {
                if (err) {
                    console.error("[Edit Problem] DB Error:", err.message);
                    return res.status(500).send("Database error while updating problem: " + err.message);
                }
                res.redirect('/faculty/problem'); 
            }
        );
    });

    router.delete('/problem/delete/:id', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        const user = buildUser(req);
        db.run(`DELETE FROM problems WHERE id = ? AND faculty_id = ?`, [req.params.id, user.id], function(err) {
            if (err) {
                console.error("[Delete Problem] DB Error:", err);
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true });
        });
    });

    // = :
    // CONTESTS
    // = :
    // ** Duplicate /contest route removed to favor the async one below **

    router.post('/contest/create', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        const user = buildUser(req);
        const { title, startDate, endDate, subject, year, section, visibility_scope } = req.body;
        
        const status = 'pending';
        const isVerified = 0;
        const scope = visibility_scope || 'global';

        db.run(`INSERT INTO contests (title, createdBy, status, isVerified, startDate, endDate, department, subject, visibility_scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, user.id, status, isVerified, startDate, endDate, user.department, subject, scope],
            function(err) {
                if (err) {
                    console.error("[Create Contest] DB Error:", err.message);
                    return res.status(500).send("Database error while creating contest: " + err.message);
                }
                if (user.role === 'hod') {
                    res.redirect('/college/hod/contest');
                } else if (user.role === 'hos') {
                    res.redirect('/hos/contest');
                } else {
                    res.redirect('/faculty/contest'); 
                }            }
        );
    });

    // ==========================================
    // STUDENTS
    // ==========================================
    router.get('/student', requireRole(['faculty', 'hos', 'hod']), checkScope, async (req, res) => {
        const user = buildUser(req);
        let query = `SELECT id, fullName, email, role, status, points, solvedCount, rank, year, section FROM users WHERE role = 'student' AND status = 'active' AND collegeName = ?`;
        let params = [user.collegeName];

        if (user.role === 'hod') {
            query += ` AND department = ?`;
            params.push(user.department);
        }

        query += ` ORDER BY fullName ASC`;

        try {
            const students = await runQuery(query, params);
            res.render('faculty/student', { user, students, currentPage: 'student', pageTitle: 'Students' });
        } catch (err) {
            console.error("Student Fetch Error:", err);
            res.render('faculty/student', { user, students: [], currentPage: 'student', pageTitle: 'Students' });
        }
    });

    // ==========================================
    // COMMUNITY
    // ==========================================
    router.get('/community', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        res.render('faculty/community', { user, currentPage: 'community', pageTitle: 'Community' });
    });

    // ==========================================
    // REPORTS
    // ==========================================
    router.get('/report', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        res.render('faculty/report', { user, currentPage: 'report', pageTitle: 'Reports' });
    });

    // ==========================================
    // HELP & SUPPORT
    // ==========================================
    router.get('/help', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        res.render('faculty/help', { user, currentPage: 'help', pageTitle: 'Help & Support' });
    });

    // ==========================================
    // SETTINGS
    // ==========================================
    router.get('/settings', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const userSession = buildUser(req);
        db.get(`SELECT * FROM users WHERE id = ?`, [userSession.id], (err, row) => {
            if (err || !row) return res.redirect('/auth/login');
            
            // Fetch subjects
            db.all(`SELECT subject FROM user_assignments WHERE user_id = ?`, [userSession.id], (err, subjects) => {
                // Template expects some mapped aliases
                row.name = row.fullName;
                row.college = row.collegeName;
                row.assignedSubjects = subjects ? subjects.map(s => s.subject) : [];
                
                res.render('faculty/settings', { user: row, success: req.query.success === 'true', currentPage: 'settings', pageTitle: 'Settings' });
            });
        });
    });

    router.post('/settings/update', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        const userSession = buildUser(req);
        const { name, email, gender, mobile } = req.body;
        
        db.run(`UPDATE users SET fullName = ?, email = ?, gender = ?, mobile = ? WHERE id = ?`,
            [name, email, gender, mobile, userSession.id],
            function(err) {
                if (err) {
                    console.error("Settings Update Error:", err);
                    return res.status(500).send("Error updating settings.");
                }
                // Update session memory to reflect changes
                req.session.user.fullName = name;
                req.session.user.name = name;
                req.session.user.email = email;
                
                res.redirect('/faculty/settings?success=true');
            }
        );
    });

    // Fetch students belonging to the faculty's college / department
    router.get('/api/students', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        const user = req.session.user;
        let query = `SELECT id, fullName, email FROM users WHERE role = 'student' AND status = 'active' AND collegeName = ?`;
        let params = [user.collegeName];

        if (user.role === 'hod') {
            query += ` AND department = ?`;
            params.push(user.department);
        }

        query += ` ORDER BY fullName ASC`;

        db.all(query, params, (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, students: rows });
        });
    });

    // ==========================================
    // CONTEST PAGE + APIs
    // ==========================================
    router.get('/contest', requireRole(['faculty', 'hos', 'hod']), checkScope, async (req, res) => {
        const user = req.session.user;
        try {
            const contests = await runQuery(
                `SELECT c.*, u.fullName as creatorName, u.role as creatorRole
                 FROM contests c
                 LEFT JOIN users u ON c.createdBy = u.id
                 WHERE (
                     c.status IN ('accepted', 'upcoming') AND 
                     (c.collegeName = ? OR u.collegeName = ?) AND
                     (
                         LOWER(c.visibility_scope) = 'global' OR 
                         LOWER(c.scope) = 'global' OR 
                         c.department = ? OR
                         u.role IN ('admin', 'superadmin')
                     )
                 ) OR c.createdBy = ?
                 ORDER BY c.startDate DESC`,
                [user.collegeName, user.collegeName, user.department, user.id]
            );

            const problems = await runQuery(
                `SELECT p.id, p.title 
                 FROM problems p 
                 JOIN users u ON p.faculty_id = u.id 
                 WHERE p.faculty_id = ? OR (p.status = 'accepted' AND u.collegeName = ? AND LOWER(p.visibility_scope) = 'global')`,
                [user.id, user.collegeName]
            );

            // Parse problems JSON for each contest
            contests.forEach(c => {
                try { c.problems = JSON.parse(c.problems || '[]'); } catch { c.problems = []; }
                c.startDate = c.startDate || '';
                c.endDate = c.endDate || '';
                c.registrationEndDate = c.registrationEndDate || '';
            });

            res.render('faculty/contest', {
                user,
                contests,
                problems,
                currentPage: 'contest',
                pageTitle: 'Manage Contests'
            });
        } catch (err) {
            console.error('Faculty Contest Error:', err);
            res.status(500).send(err.message);
        }
    });

    // JSON API for faculty/HOS contest.ejs JS fetch
    router.get('/api/contests', requireRole(['faculty', 'hos', 'hod']), checkScope, async (req, res) => {
        const user = req.session.user;
        try {
            const contests = await runQuery(
                `SELECT c.*, u.fullName as creatorName, u.role as creatorRole
                 FROM contests c
                 LEFT JOIN users u ON c.createdBy = u.id
                 WHERE (
                     c.status IN ('accepted', 'upcoming') AND 
                     (c.collegeName = ? OR u.collegeName = ?) AND
                     (
                         LOWER(c.visibility_scope) = 'global' OR 
                         LOWER(c.scope) = 'global' OR 
                         c.department = ? OR
                         u.role IN ('admin', 'superadmin')
                     )
                 ) OR c.createdBy = ?
                 ORDER BY c.id DESC`,
                [user.collegeName, user.collegeName, user.department, user.id]
            );
            contests.forEach(c => {
                try { c.problems = JSON.parse(c.problems || '[]'); } catch { c.problems = []; }
            });
            res.json({ success: true, data: contests });
        } catch (err) {
            res.status(500).json({ success: false, message: err.message });
        }
    });

    router.post('/api/create-contest', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = req.session.user;
        const { title, startDate, endDate, registrationEndDate, duration, eligibility, description, problems } = req.body;
        if (!title || !startDate || !endDate) return res.json({ success: false, message: 'Title, start date and end date are required.' });
        db.run(
            `INSERT INTO contests (title, startDate, endDate, registrationEndDate, duration, eligibility, description, problems, createdBy, collegeName, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming')`,
            [title, startDate, endDate, registrationEndDate || null, duration || null, eligibility || null, description || null,
             JSON.stringify(problems || []), user.id, user.collegeName],
            function(err) {
                if (err) { console.error('Create Contest Error:', err); return res.json({ success: false, message: err.message }); }
                res.json({ success: true, id: this.lastID });
            }
        );
    });

    router.post('/api/update-contest', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = req.session.user;
        const { id, title, startDate, endDate, registrationEndDate, duration, eligibility, description, problems } = req.body;
        db.run(
            `UPDATE contests SET title=?, startDate=?, endDate=?, registrationEndDate=?, duration=?, eligibility=?, description=?, problems=?
             WHERE id=? AND createdBy=?`,
            [title, startDate, endDate, registrationEndDate || null, duration || null, eligibility || null, description || null,
             JSON.stringify(problems || []), id, user.id],
            function(err) {
                if (err) { console.error('Update Contest Error:', err); return res.json({ success: false, message: err.message }); }
                if (this.changes === 0) return res.json({ success: false, message: 'Contest not found or not authorized.' });
                res.json({ success: true });
            }
        );
    });

    router.post('/api/delete-contest', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = req.session.user;
        const { id } = req.body;
        db.run(`DELETE FROM contests WHERE id=? AND createdBy=?`, [id, user.id], function(err) {
            if (err) { console.error('Delete Contest Error:', err); return res.json({ success: false, message: err.message }); }
            if (this.changes === 0) return res.json({ success: false, message: 'Contest not found or not authorized.' });
            res.json({ success: true });
        });
    });

    return router;
};