const express = require('express');
const { requireRole } = require('../middleware/auth');
const { checkScope } = require('../middleware/authMiddleware');

module.exports = (db) => {
    const router = express.Router();

    // Helper: Get HOS's assigned subjects
    const getAssignedSubjects = (userId) => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT DISTINCT subject FROM user_assignments WHERE user_id = ?`, [userId], (err, rows) => {
                if (err) return reject(err);
                resolve(rows.map(r => r.subject));
            });
        });
    };

    // Middleware: Ensure subjects are available for all HOS views (profile overlay)
    router.use('/hos', requireRole('hos'), checkScope, async (req, res, next) => {
        try {
            const subjects = await getAssignedSubjects(req.session.user.id);
            res.locals.subjects = subjects || [];
            next();
        } catch (err) {
            console.error('Error fetching subjects for HOS locals:', err);
            res.locals.subjects = [];
            next();
        }
    });

    // HOS Dashboard
    router.get('/hos/dashboard', requireRole('hos'), checkScope, async (req, res) => {
        try {
            const hosId = req.session.user.id;
            const college = req.session.user.collegeName;
            const subjects = await getAssignedSubjects(hosId);

            if (subjects.length === 0) {
                return res.render('hos/dashboard', {
                    user: req.session.user,
                    stats: { studentCount: 0, facultyCount: 0, sectionsCount: 0, subjectCount: 0 },
                    pendingQuestions: [],
                    pendingContests: [],
                    recentActivity: [],
                    graphData: { difficultySpread: { Easy: 0, Medium: 0, Hard: 0 }, trendLabels: [], trendCounts: [] },
                    currentPage: 'dashboard'
                });
            }

            const subjectPlaceholders = subjects.map(() => '?').join(',');

            // Stats Queries
            const stats = {};
            
            // 1. Subject Count
            stats.subjectCount = subjects.length;

            // 2. Faculty Count (Unique teachers teaching these subjects)
            const facultyCountRow = await new Promise((resolve, reject) => {
                db.get(`SELECT COUNT(DISTINCT user_id) as count FROM user_assignments WHERE subject IN (${subjectPlaceholders})`, subjects, (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });
            stats.facultyCount = facultyCountRow.count;

            // 3. Students Count (College & Department scoped)
            const studentCountRow = await new Promise((resolve, reject) => {
                db.get(`SELECT COUNT(*) as count FROM users WHERE role = 'student' AND collegeName = ? AND department = ?`, [college, req.session.user.department], (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });
            stats.studentCount = studentCountRow.count;

            // 4. Sections Count (Unique sections across all assigned subjects)
            const sectionsCountRow = await new Promise((resolve, reject) => {
                db.get(`SELECT COUNT(DISTINCT section) as count FROM user_assignments WHERE subject IN (${subjectPlaceholders})`, subjects, (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });
            stats.sectionsCount = sectionsCountRow.count;

            // Recently Pending Items
            const pendingQuestions = await new Promise((resolve, reject) => {
                db.all(`SELECT p.*, u.fullName as facultyName FROM problems p JOIN users u ON p.faculty_id = u.id WHERE (p.subject IN (${subjectPlaceholders}) OR p.faculty_id = ?) AND p.status = 'pending' ORDER BY p.id DESC LIMIT 5`, [...subjects, hosId], (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });

            const pendingContests = await new Promise((resolve, reject) => {
                db.all(`SELECT c.*, u.fullName as creatorName FROM contests c JOIN users u ON c.createdBy = u.id WHERE (c.subject IN (${subjectPlaceholders}) OR c.createdBy = ?) AND c.status = 'pending' ORDER BY c.id DESC LIMIT 5`, [...subjects, hosId], (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });

            // Graphs Logic (Similar to HOD but subject-scoped)
            const diffRows = await new Promise((resolve, reject) => {
                db.all(`SELECT difficulty, COUNT(*) as count FROM problems WHERE subject IN (${subjectPlaceholders}) GROUP BY difficulty`, subjects, (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });
            const difficultySpread = { Easy: 0, Medium: 0, Hard: 0 };
            diffRows.forEach(r => { if (r.difficulty in difficultySpread) difficultySpread[r.difficulty] = r.count; });

            const trendRows = await new Promise((resolve, reject) => {
                db.all(`SELECT strftime('%m', createdAt) as month, COUNT(*) as count FROM problems WHERE subject IN (${subjectPlaceholders}) AND createdAt >= date('now', '-6 months') GROUP BY month ORDER BY month ASC`, subjects, (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });

            const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            const now = new Date();
            const trendLabels = [];
            const trendCounts = [];
            for (let i = 5; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const row = trendRows.find(r => r.month === mm);
                trendLabels.push(monthNames[d.getMonth()]);
                trendCounts.push(row ? row.count : 0);
            }

            // Recent Activity (last 5 problems + contests, any status)
            const recentProblems = await new Promise((resolve, reject) => {
                db.all(`SELECT p.title, p.status, p.createdAt, 'problem' as type, u.fullName as author FROM problems p JOIN users u ON p.faculty_id = u.id WHERE (p.subject IN (${subjectPlaceholders}) OR p.faculty_id = ?) ORDER BY p.createdAt DESC LIMIT 5`, [...subjects, hosId], (err, rows) => {
                    if (err) reject(err); else resolve(rows || []);
                });
            });
            const recentContestsAll = await new Promise((resolve, reject) => {
                db.all(`SELECT c.title, c.status, c.createdAt, 'contest' as type, u.fullName as author FROM contests c JOIN users u ON c.createdBy = u.id WHERE (c.subject IN (${subjectPlaceholders}) OR c.createdBy = ?) ORDER BY c.createdAt DESC LIMIT 5`, [...subjects, hosId], (err, rows) => {
                    if (err) reject(err); else resolve(rows || []);
                });
            });
            const recentActivity = [...recentProblems, ...recentContestsAll]
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 5);

            res.render('hos/dashboard', {
                user: req.session.user,
                stats,
                pendingQuestions,
                pendingContests,
                recentActivity,
                graphData: { difficultySpread, trendLabels, trendCounts },
                subjects, // Pass subjects for profile overlay
                currentPage: 'dashboard'
            });

        } catch (error) {
            console.error("HOS Dashboard Error:", error);
            res.status(500).send("Internal Server Error");
        }
    });

    // Content Approval Routes
    router.post('/hos/approve-question', requireRole('hos'), async (req, res) => {
        const { problemId, status, comments } = req.body;
        const hosId = req.session.user.id;
        try {
            const subjects = await getAssignedSubjects(hosId);
            db.get(`SELECT subject FROM problems WHERE id = ?`, [problemId], (err, row) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (!row || !subjects.includes(row.subject)) {
                    return res.status(403).json({ success: false, error: "Access Denied: You can only approve questions for your assigned subjects." });
                }
                let updateSql = `UPDATE problems SET status = ?, hod_comments = ? WHERE id = ?`;
                let params = [status, comments || '', problemId];
                
                if (status === 'accepted' || status === 'approved') {
                    updateSql = `UPDATE problems SET status = ?, hod_comments = ?, hos_verified = 1, is_public = 1, visibility_scope = 'global' WHERE id = ?`;
                }

                db.run(updateSql, params, function(err) {
                    if (err) return res.status(500).json({ success: false, error: err.message });
                    res.json({ success: true, message: `Question ${status} successfully.` });
                });
            });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // Approve Contest POST Route
    router.post('/hos/approve-contest', requireRole('hos'), async (req, res) => {
        const { contestId, status, comments } = req.body;
        const hosId = req.session.user.id;
        try {
            const subjects = await getAssignedSubjects(hosId);
            db.get(`SELECT subject FROM contests WHERE id = ?`, [contestId], (err, row) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (!row || !subjects.includes(row.subject)) {
                    return res.status(403).json({ success: false, error: "Access Denied: You can only approve contests for your assigned subjects." });
                }
                db.run(`UPDATE contests SET status = ? WHERE id = ?`, [status, contestId], function(err) {
                    if (err) return res.status(500).json({ success: false, error: err.message });
                    res.json({ success: true, message: `Contest ${status} successfully.` });
                });
            });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // Other HOS pages
    router.get('/hos/problem', requireRole('hos'), checkScope, async (req, res) => {
        try {
            const hosId = req.session.user.id;
            const college = req.session.user.collegeName;
            const subjects = await getAssignedSubjects(hosId);
            
            // Fetch all global accepted problems from the college, HOS's own problems, and accepted problems from assigned subjects
            let problemSql = `SELECT p.*, u.fullName as facultyName 
                               FROM problems p 
                               JOIN users u ON p.faculty_id = u.id 
                               WHERE (p.status = 'accepted' AND u.collegeName = ? AND LOWER(p.visibility_scope) = 'global') 
                               OR p.faculty_id = ?`;
            let sqlParams = [college, hosId];

            if (subjects && subjects.length > 0) {
                const placeholders = subjects.map(() => '?').join(',');
                problemSql += ` OR (p.status = 'accepted' AND p.subject IN (${placeholders}) AND u.collegeName = ?)`;
                sqlParams.push(...subjects, college);
            }
            problemSql += ` ORDER BY p.createdAt DESC`;
            
            db.all(problemSql, sqlParams, (err, problems) => {
                if (err) return res.status(500).send(err.message);
                
                // Separate personal problems - important for "Created Problems" tab
                const myProblems = problems.filter(p => p.faculty_id === hosId);
                // "All Problems" tab should show accepted problems from college or own problems
                const globalProblems = problems;

                res.render('hos/problem', { 
                    user: req.session.user, 
                    problems: globalProblems, 
                    myProblems,
                    subjects, // For create problem modal dropdown
                    currentPage: 'problem' 
                });
            });
        } catch (e) { res.status(500).send(e.message); }
    });

    router.get('/hos/contest', requireRole('hos'), checkScope, async (req, res) => {
        try {
            const hosId = req.session.user.id;
            const college = req.session.user.collegeName;
            const subjects = await getAssignedSubjects(hosId);
            
            const placeholders = subjects.length > 0 ? subjects.map(() => '?').join(',') : null;
            let query = `SELECT c.*, u.fullName as creatorName FROM contests c JOIN users u ON c.createdBy = u.id WHERE (u.collegeName = ? AND c.status = 'accepted') OR c.createdBy = ?`;
            let params = [college, hosId];

            if (placeholders) {
                query += ` OR c.subject IN (${placeholders})`;
                params.push(...subjects);
            }
            query += ` ORDER BY c.createdAt DESC`;

            const contests = await new Promise((resolve, reject) => {
                db.all(query, params, (err, rows) => {
                    if (err) reject(err); else resolve(rows || []);
                });
            });

            // Also fetch problems for the problem selection dropdown in contest form
            let problemsQuery = `
                SELECT p.id, p.title, p.difficulty, p.subject 
                FROM problems p 
                JOIN users u ON p.faculty_id = u.id 
                WHERE p.status = 'accepted' 
                  AND (
                      (u.collegeName = ? AND LOWER(p.visibility_scope) = 'global')
            `;
            let problemsParams = [college];
            
            if (subjects.length > 0) {
                const ph = subjects.map(() => '?').join(',');
                problemsQuery += ` OR p.subject IN (${ph}) OR p.faculty_id = ?`;
                problemsParams.push(...subjects, hosId);
            } else {
                problemsQuery += ` OR p.faculty_id = ?`;
                problemsParams.push(hosId);
            }
            problemsQuery += ` )`;

            const problems = await new Promise((resolve, reject) => {
                db.all(problemsQuery, problemsParams, (err, rows) => {
                    if (err) reject(err); else resolve(rows || []);
                });
            });

            res.render('hos/contest', { 
                user: req.session.user, 
                contests, 
                problems,
                currentPage: 'contest' 
            });
        } catch (e) { 
            console.error("HOS Contest Error:", e);
            res.status(500).send(e.message); 
        }
    });
    router.get('/hos/faculty', requireRole('hos'), checkScope, async (req, res) => {
        try {
            const hosId = req.session.user.id;
            const subjects = await getAssignedSubjects(hosId);
            const placeholders = subjects.map(() => '?').join(',');
            
            db.all(`SELECT u.id, u.fullName, u.email, u.post, u.department, u.status, u.joiningDate,
                       (SELECT COUNT(*) FROM problems WHERE faculty_id = u.id) AS problems_created,
                       GROUP_CONCAT(DISTINCT sa.subject) as teaching_subjects
                    FROM users u 
                    JOIN user_assignments sa ON u.id = sa.user_id 
                    WHERE sa.subject IN (${placeholders}) AND u.collegeName = ? AND u.role = 'faculty'
                    GROUP BY u.id`, 
                [...subjects, req.session.user.collegeName], (err, faculty) => {
                    if (err) return res.status(500).send(err.message);
                    res.render('hos/faculty', { user: req.session.user, faculty: faculty || [], subjects, currentPage: 'faculty' });
                });
        } catch (e) { res.status(500).send(e.message); }
    });
    router.get('/hos/student', requireRole('hos'), checkScope, async (req, res) => {
        const college = req.session.user.collegeName;
        const department = req.session.user.department;
        try {
            const students = await new Promise((resolve, reject) => {
                db.all(`SELECT id, fullName, email, course, department, joiningDate 
                        FROM users 
                        WHERE role = 'student' AND collegeName = ? AND department = ? 
                        ORDER BY fullName ASC`,
                    [college, department], (err, rows) => {
                        if (err) reject(err); else resolve(rows || []);
                    });
            });

            const years = await new Promise((resolve) => {
                db.all(`SELECT DISTINCT section as year_name FROM user_assignments WHERE 1=0`, [], (e, r) => resolve([]));
            });
            const sections = await new Promise((resolve) => {
                db.all(`SELECT DISTINCT section as section_name FROM user_assignments WHERE 1=0`, [], (e, r) => resolve([]));
            });

            res.render('hos/student', {
                user: req.session.user,
                students,
                dropdownData: { years, sections },
                currentPage: 'student'
            });
        } catch (err) {
            console.error("HOS Students Error:", err);
            res.status(500).send("Internal Server Error");
        }
    });
    router.get('/hos/community', requireRole('hos'), checkScope, (req, res) => res.render('hos/community', { user: req.session.user, currentPage: 'community' }));
    router.get('/hos/report', requireRole('hos'), checkScope, async (req, res) => {
        try {
            const hosId = req.session.user.id;
            const college = req.session.user.collegeName;
            const department = req.session.user.department;
            const subjects = await getAssignedSubjects(hosId);

            let problems = [], contests = [], faculty = [];
            
            if (subjects.length > 0) {
                const placeholders = subjects.map(() => '?').join(',');
                
                problems = await new Promise((resolve) => {
                    db.all(`SELECT p.*, u.fullName as facultyName FROM problems p JOIN users u ON p.faculty_id = u.id WHERE p.subject IN (${placeholders})`, subjects, (err, rows) => resolve(rows || []));
                });

                contests = await new Promise((resolve) => {
                    db.all(`SELECT c.*, u.fullName as creatorName FROM contests c JOIN users u ON c.createdBy = u.id WHERE c.subject IN (${placeholders})`, subjects, (err, rows) => resolve(rows || []));
                });
                
                faculty = await new Promise((resolve) => {
                    db.all(`SELECT u.id, u.fullName, u.email, u.post, u.department, u.status, u.joiningDate,
                               (SELECT COUNT(*) FROM problems WHERE faculty_id = u.id) AS problems_created
                            FROM users u 
                            JOIN user_assignments sa ON u.id = sa.user_id 
                            WHERE sa.subject IN (${placeholders}) AND u.collegeName = ?
                            GROUP BY u.id`, [...subjects, college], (err, rows) => resolve(rows || []));
                });
            }

            const students = await new Promise((resolve) => {
                db.all(`SELECT id, fullName, email, course, department, joiningDate 
                        FROM users 
                        WHERE role = 'student' AND collegeName = ? AND department = ?`, [college, department], (err, rows) => resolve(rows || []));
            });

            res.render('hos/report', { 
                user: req.session.user, 
                currentPage: 'report',
                reportData: JSON.stringify({ problems, contests, faculty, students })
            });
        } catch (e) {
            console.error('HOS Report Error:', e);
            res.status(500).send("Internal Server Error");
        }
    });
    router.get('/hos/help', requireRole('hos'), checkScope, (req, res) => res.render('hos/help', { user: req.session.user, currentPage: 'help' }));
    router.get('/hos/settings', requireRole('hos'), checkScope, (req, res) => res.render('hos/settings', { user: req.session.user, currentPage: 'settings' }));

    router.post('/hos/settings/update', requireRole('hos'), checkScope, (req, res) => {
        const { fullName, email, gender, mobile } = req.body;
        const userId = req.session.user.id;
        db.run(
            `UPDATE users SET fullName = ?, email = ?, gender = ?, mobile = ? WHERE id = ?`,
            [fullName, email, gender, mobile, userId],
            (err) => {
                if (err) {
                    console.error('HOS Settings Update Error:', err);
                    return res.render('hos/settings', { user: req.session.user, currentPage: 'settings', error: 'Failed to update settings.' });
                }
                // Refresh session
                req.session.user.fullName = fullName;
                req.session.user.email = email;
                req.session.user.gender = gender;
                req.session.user.mobile = mobile;
                res.render('hos/settings', { user: req.session.user, currentPage: 'settings', success: true });
            }
        );
    });

    // Pending Questions - Full Dynamic Data
    router.get('/hos/pending-questions', requireRole('hos'), checkScope, async (req, res) => {
        try {
            const hosId = req.session.user.id;
            const subjects = await getAssignedSubjects(hosId);

            if (subjects.length === 0) {
                return res.render('hos/pending_questions', {
                    user: req.session.user, currentPage: 'pending-questions',
                    questions: [], subjects: [],
                    questionStats: { total: 0, approved: 0, rejected: 0, thisWeek: 0 }
                });
            }

            const ph = subjects.map(() => '?').join(',');

            const questions = await new Promise((resolve, reject) => {
                db.all(`SELECT p.id, p.title, p.difficulty, p.subject, p.status, p.createdAt, p.description, p.input_format, p.output_format, p.constraints, p.sample_input, p.sample_output, p.hod_comments, u.fullName as faculty
                    FROM problems p JOIN users u ON p.faculty_id = u.id
                    WHERE (p.subject IN (${ph}) OR p.faculty_id = ?)
                    ORDER BY p.createdAt DESC`, [...subjects, hosId], (err, rows) => {
                    if (err) reject(err); else resolve(rows || []);
                });
            });

            // Calculate accurate stats across all statuses for the HOS's subjects
            const statsRows = await new Promise((resolve) => {
                db.all(`SELECT status, COUNT(*) as count FROM problems WHERE subject IN (${ph}) OR faculty_id = ? GROUP BY status`, [...subjects, hosId], (err, rows) => {
                    resolve(rows || []);
                });
            });

            let pending = 0, approved = 0, rejected = 0;
            statsRows.forEach(row => {
                const s = row.status ? row.status.toLowerCase() : '';
                if (s === 'pending') pending += row.count;
                else if (s === 'accepted' || s === 'approved') approved += row.count;
                else if (s === 'rejected') rejected += row.count;
            });

            const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
            const thisWeek = questions.filter(q => q.createdAt >= weekAgo).length;

            res.render('hos/pending_questions', {
                user: req.session.user, currentPage: 'pending-questions',
                questions, subjects,
                questionStats: { total: pending, approved, rejected, thisWeek }
            });
        } catch (e) {
            console.error('HOS Pending Questions Error:', e);
            res.status(500).send('Internal Server Error');
        }
    });

    // Bulk Verify POST Route
    router.post('/hos/bulk-verify', requireRole('hos'), checkScope, async (req, res) => {
        let { questionIds, action, comments } = req.body;
        const hosId = req.session.user.id;

        if (!questionIds) return res.status(400).json({ success: false, error: 'No questions selected.' });
        
        // Normalize to array
        if (!Array.isArray(questionIds)) questionIds = [questionIds];
        if (questionIds.length === 0) return res.status(400).json({ success: false, error: 'Empty selection.' });

        try {
            const subjects = await getAssignedSubjects(hosId);
            const status = action === 'approve' ? 'accepted' : 'rejected';
            const hos_verified = action === 'approve' ? 1 : 0;
            const is_public = action === 'approve' ? 1 : 0;

            const placeholders = questionIds.map(() => '?').join(',');
            
            // First check authorization for all questions
            const checkRows = await new Promise((resolve, reject) => {
                db.all(`SELECT subject FROM problems WHERE id IN (${placeholders})`, questionIds, (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });

            const unauthorized = checkRows.some(row => !subjects.includes(row.subject));
            if (unauthorized) {
                return res.status(403).json({ success: false, error: 'Access Denied: Some questions are outside your assigned subjects.' });
            }

            // Bulk update
            const updateSql = `UPDATE problems 
                              SET status = ?, 
                                  hos_verified = ?, 
                                  is_public = ?, 
                                  visibility_scope = CASE WHEN ? = 1 THEN 'global' ELSE visibility_scope END,
                                  hod_comments = ? 
                              WHERE id IN (${placeholders})`;
            
            const params = [status, hos_verified, is_public, hos_verified, comments || '', ...questionIds];

            db.run(updateSql, params, function(err) {
                if (err) {
                    console.error('Bulk Verify Error:', err);
                    return res.status(500).json({ success: false, error: 'Database update failed.' });
                }
                res.json({ success: true, message: `Successfully ${action}d ${this.changes} questions.` });
            });

        } catch (e) {
            console.error('Bulk Verify Exception:', e);
            res.status(500).json({ success: false, error: 'Internal server error.' });
        }
    });

    // Pending Contests - Full Dynamic Data
    router.get('/hos/pending-contests', requireRole('hos'), checkScope, async (req, res) => {
        try {
            const hosId = req.session.user.id;
            const subjects = await getAssignedSubjects(hosId);

            if (subjects.length === 0) {
                return res.render('hos/pending_contests', {
                    user: req.session.user, currentPage: 'pending-contests',
                    contests: [], subjects: [],
                    contestStats: { total: 0, approved: 0, rejected: 0, upcoming: 0 }
                });
            }

            const ph = subjects.map(() => '?').join(',');

            const contests = await new Promise((resolve, reject) => {
                db.all(`SELECT c.id, c.title, c.subject, c.status, c.startDate as start_date, c.endDate as end_date, c.createdAt, c.department, u.fullName as faculty
                    FROM contests c JOIN users u ON c.createdBy = u.id
                    WHERE (c.subject IN (${ph}) OR c.createdBy = ?)
                    ORDER BY c.createdAt DESC`, [...subjects, hosId], (err, rows) => {
                    if (err) reject(err); else resolve(rows || []);
                });
            });

            const pending = contests.filter(c => c.status === 'pending').length;
            const approved = contests.filter(c => c.status === 'accepted').length;
            const rejected = contests.filter(c => c.status === 'rejected').length;
            const upcoming = contests.filter(c => c.start_date && new Date(c.start_date) > new Date()).length;

            res.render('hos/pending_contests', {
                user: req.session.user, currentPage: 'pending-contests',
                contests, subjects,
                contestStats: { total: pending, approved, rejected, upcoming }
            });
        } catch (e) {
            console.error('HOS Pending Contests Error:', e);
            res.status(500).send('Internal Server Error');
        }
    });

    // Create Problem
    router.post('/hos/problem/create', requireRole('hos'), checkScope, (req, res) => {
        const user = req.session.user;
        const { 
            title, subject, difficulty, description, 
            input_format, output_format, constraints, 
            sample_input, sample_output, hidden_test_cases 
        } = req.body;
        
        db.run(
            `INSERT INTO problems (title, subject, difficulty, description, input_format, output_format, constraints, sample_input, sample_output, hidden_test_cases, faculty_id, department, status, visibility_scope) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'global')`,
            [
                title, subject, difficulty, description, 
                input_format || '', output_format || '', constraints || '', 
                sample_input || '', sample_output || '', hidden_test_cases || '', 
                user.id, user.department
            ],
            function(err) {
                if (err) {
                    console.error('Error creating problem:', err.message);
                    return res.json({ success: false, message: 'Database error: ' + err.message });
                }
                res.json({ success: true, id: this.lastID });
            }
        );
    });

    // Edit Problem
    router.post('/hos/problem/edit/:id', requireRole('hos'), checkScope, (req, res) => {
        const user = req.session.user;
        const { 
            title, subject, difficulty, description, 
            input_format, output_format, constraints, 
            sample_input, sample_output, hidden_test_cases 
        } = req.body;
        const problemId = req.params.id;

        db.run(
            `UPDATE problems SET 
                title = ?, subject = ?, difficulty = ?, description = ?, 
                input_format = ?, output_format = ?, constraints = ?, 
                sample_input = ?, sample_output = ?, hidden_test_cases = ?
             WHERE id = ? AND faculty_id = ?`,
            [
                title, subject, difficulty, description, 
                input_format || '', output_format || '', constraints || '', 
                sample_input || '', sample_output || '', hidden_test_cases || '', 
                problemId, user.id
            ],
            function(err) {
                if (err) {
                    console.error('Error editing problem:', err.message);
                    return res.json({ success: false, message: 'Database error' });
                }
                if (this.changes === 0) {
                    return res.json({ success: false, message: 'Problem not found or unauthorized' });
                }
                res.json({ success: true });
            }
        );
    });

    // Delete Problem
    router.post('/hos/problem/delete/:id', requireRole('hos'), checkScope, (req, res) => {
        const user = req.session.user;
        const problemId = req.params.id;

        db.run(
            `DELETE FROM problems WHERE id = ? AND faculty_id = ?`,
            [problemId, user.id],
            function(err) {
                if (err) {
                    console.error('Error deleting problem:', err.message);
                    return res.json({ success: false, message: 'Database error' });
                }
                if (this.changes === 0) {
                    return res.json({ success: false, message: 'Problem not found or unauthorized' });
                }
                res.json({ success: true });
            }
        );
    });

    // Get Contests API (for JS fetch in hos/contest.ejs)
    router.get('/hos/api/contests', requireRole('hos'), checkScope, async (req, res) => {
        const user = req.session.user;
        const college = req.session.user.collegeName;
        const hosId = req.session.user.id;
        const subjects = await getAssignedSubjects(hosId);

        let query = `SELECT c.*, u.role as creatorRole FROM contests c
                     LEFT JOIN users u ON c.createdBy = u.id
                     WHERE (c.status = 'accepted' AND c.collegeName = ?)
                        OR c.createdBy = ?`;
        const params = [college, hosId];

        if (subjects.length > 0) {
            const ph = subjects.map(() => '?').join(',');
            query += ` OR c.subject IN (${ph})`;
            params.push(...subjects);
        }
        query += ' ORDER BY c.id DESC';

        db.all(query, params, (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    // Create Contest API
    router.post('/hos/api/create-contest', requireRole('hos'), checkScope, (req, res) => {
        const { title, date, endDate, deadline, duration, eligibility, rulesAndDescription, problems } = req.body;
        const user = req.session.user;

        db.run(
            `INSERT INTO contests (
                title, date, startDate, endDate, deadline, duration, eligibility, 
                rulesAndDescription, problems, createdBy, status, department, collegeName
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
            [
                title, date, date, endDate, deadline, duration, eligibility,
                rulesAndDescription, problems, user.id, user.department, user.collegeName
            ],
            function(err) {
                if (err) {
                    console.error('Error creating contest:', err.message);
                    return res.json({ success: false, message: 'Database error' });
                }
                res.json({ success: true, id: this.lastID });
            }
        );
    });

    // Update Contest API
    router.post('/hos/api/update-contest', requireRole('hos'), checkScope, (req, res) => {
        const { id, title, date, endDate, deadline, duration, eligibility, rulesAndDescription, problems } = req.body;
        const user = req.session.user;

        db.run(
            `UPDATE contests SET 
                title = ?, date = ?, startDate = ?, endDate = ?, deadline = ?, 
                duration = ?, eligibility = ?, rulesAndDescription = ?, problems = ?
            WHERE id = ? AND createdBy = ?`,
            [
                title, date, date, endDate, deadline, 
                duration, eligibility, rulesAndDescription, problems,
                id, user.id
            ],
            function(err) {
                if (err) {
                    console.error('Error updating contest:', err.message);
                    return res.json({ success: false, message: 'Database error' });
                }
                if (this.changes === 0) {
                    return res.json({ success: false, message: 'Contest not found or unauthorized' });
                }
                res.json({ success: true });
            }
        );
    });

    // Delete Contest API
    router.post('/hos/api/delete-contest', requireRole('hos'), checkScope, (req, res) => {
        const { id } = req.body;
        const user = req.session.user;

        db.run(
            `DELETE FROM contests WHERE id = ? AND createdBy = ?`,
            [id, user.id],
            function(err) {
                if (err) {
                    console.error('Error deleting contest:', err.message);
                    return res.json({ success: false, message: 'Database error' });
                }
                if (this.changes === 0) {
                    return res.json({ success: false, message: 'Contest not found or unauthorized' });
                }
                res.json({ success: true });
            }
        );
    });

    // ============================================================
    // HOS APPROVE CONTENT (Problems: OR rule | Contests: AND rule)
    // ============================================================
    router.post('/hos/api/approve-content', requireRole('hos'), checkScope, (req, res) => {
        const { id, type, action } = req.body; // action: 'approve' | 'reject'
        const user = req.session.user;

        if (!id || !type) return res.status(400).json({ success: false, message: 'Missing id or type' });

        if (type === 'problem') {
            if (action === 'reject') {
                return db.run(`UPDATE problems SET status = 'rejected' WHERE id = ?`, [id], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Problem rejected.' });
                });
            }
            // OR rule: HOS alone can accept a problem
            db.run(
                `UPDATE problems SET hos_verified = 1, status = 'accepted', is_public = 1, visibility_scope = 'global' WHERE id = ?`,
                [id],
                function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Problem accepted and published globally.' });
                }
            );

        } else if (type === 'contest') {
            if (action === 'reject') {
                return db.run(`UPDATE contests SET status = 'rejected' WHERE id = ?`, [id], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Contest rejected.' });
                });
            }
            // AND rule: set hos_verified=1, then check if hod_verified is also 1
            db.run(`UPDATE contests SET hos_verified = 1 WHERE id = ?`, [id], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });

                db.get(`SELECT hod_verified, department FROM contests WHERE id = ?`, [id], (err, row) => {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    if (!row) return res.status(404).json({ success: false, message: 'Contest not found' });

                    if (row.hod_verified === 1) {
                        // Both approved — accept the contest
                        db.run(
                            `UPDATE contests SET status = 'accepted', isVerified = 1, visibility_scope = 'department' WHERE id = ?`,
                            [id],
                            function(err) {
                                if (err) return res.status(500).json({ success: false, message: err.message });
                                res.json({ success: true, message: 'Contest accepted! Both HOS and HOD have approved.' });
                            }
                        );
                    } else {
                        res.json({ success: true, message: 'HOS approval recorded. Waiting for HOD approval.' });
                    }
                });
            });
        } else {
            res.status(400).json({ success: false, message: 'Invalid type' });
        }
    });

    return router;
};
