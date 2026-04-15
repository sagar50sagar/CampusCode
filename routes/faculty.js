const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireRole } = require('../middleware/auth');
const { checkScope } = require('../middleware/authMiddleware');
const sanitizeHtml = require('sanitize-html');

module.exports = (db) => {
    const router = express.Router();
    const hiddenTestsUpload = multer({
        storage: multer.memoryStorage(),
        limits: { fileSize: 2 * 1024 * 1024 }
    }).fields([
        { name: 'hidden_input_file', maxCount: 1 },
        { name: 'hidden_output_file', maxCount: 1 }
    ]);

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

    function computeDurationFromRange(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
            return null;
        }
        const totalMinutes = Math.floor((end.getTime() - start.getTime()) / 60000);
        if (totalMinutes < 60) return `${totalMinutes} mins`;
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    router.get('/forum', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        res.render('faculty/forum.html', { user, currentPage: 'community', pageTitle: 'Community' });
    });

    router.get('/forum/create', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        res.render('faculty/forum-create.html', { user, currentPage: 'community', pageTitle: 'Create Discussion' });
    });

    router.get('/forum/thread', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        // Ensure thread is picked up by frontend
        res.render('faculty/forum-thread.html', { user, currentPage: 'community', pageTitle: 'View Discussion' });
    });

    router.get('/community', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => res.redirect('/faculty/forum'));

    router.get('/dashboard', requireRole(['faculty', 'hos', 'hod']), checkScope, async (req, res) => {
        const user = buildUser(req);
        
        try {
            const studentCountRow = await getSingle(`SELECT COUNT(id) as count FROM account_users WHERE role = 'student' AND status = 'active' AND collegeName = ?`, [user.collegeName]);
            const problemsCountRow = await getSingle(`SELECT COUNT(id) as count FROM problems WHERE faculty_id = ?`, [user.id]);
            const contestsCountRow = await getSingle(
                `SELECT COUNT(id) as count FROM contests WHERE createdBy = ? AND status = 'accepted'`, 
                [user.id]
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
                const assignmentCountRow = await getSingle(`SELECT COUNT(DISTINCT subject) as count FROM faculty_assignments WHERE user_id = ?`, [user.id]);
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

            // Fetch Contest Performance Data
            const performanceRows = await runQuery(`
                SELECT 
                    c.title, 
                    AVG(s.points_earned) as avgScore
                FROM contests c
                LEFT JOIN submissions s ON c.id = s.contest_id
                WHERE (c.createdBy = ? OR (c.collegeName = ? AND c.status = 'accepted'))
                GROUP BY c.id
                ORDER BY c.startDate DESC
                LIMIT 6
            `, [user.id, user.collegeName]);

            const contestPerformance = {
                labels: performanceRows.length > 0 ? performanceRows.map(r => r.title) : ["No Contests"],
                data: performanceRows.length > 0 ? performanceRows.map(r => Math.round(r.avgScore || 0)) : [0]
            };
            
            const getTimeAgo = (date) => {
                if (!date) return "Unknown";
                const seconds = Math.floor((new Date() - new Date(date)) / 1000);
                if (seconds < 60) return "Just now";
                const minutes = Math.floor(seconds / 60);
                if (minutes < 60) return `${minutes}m ago`;
                const hours = Math.floor(minutes / 60);
                if (hours < 24) return `${hours}h ago`;
                const days = Math.floor(hours / 24);
                if (days < 7) return `${days}d ago`;
                return new Date(date).toLocaleDateString();
            };

            // Fetch Recent Activity (Problems and Contests created by this faculty)
            const [recentProbs, recentContests] = await Promise.all([
                runQuery(`SELECT 'problem' as type, title, createdAt, status FROM problems WHERE faculty_id = ? ORDER BY createdAt DESC LIMIT 5`, [user.id]),
                runQuery(`SELECT 'contest' as type, title, createdAt, status FROM contests WHERE createdBy = ? ORDER BY createdAt DESC LIMIT 5`, [user.id])
            ]);

            const recentActivity = [...recentProbs, ...recentContests]
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 5)
                .map(item => ({
                    text: item.type === 'problem' 
                        ? `Created new problem: ${item.title}` 
                        : `New contest organized: ${item.title}`,
                    time: getTimeAgo(item.createdAt),
                    color: item.type === 'problem' 
                        ? (item.status === 'accepted' ? 'green' : (item.status === 'pending' ? 'yellow' : 'blue'))
                        : 'purple'
                }));
            
            const stats = {
                problemsCreated: problemsCountRow ? problemsCountRow.count : 0,
                activeContests: contestsCountRow ? contestsCountRow.count : 0,
                totalStudents: studentCountRow ? studentCountRow.count : 0,
                subjectsTaught: subjectsTaught
            };

            const nowHour = new Date().getHours();
            const greeting = nowHour < 12 ? 'Good morning' : (nowHour < 17 ? 'Good afternoon' : 'Good evening');
            res.render('faculty/dashboard.html', { user, stats, draftProblems, recentActivity, difficultySpread, contestPerformance, greeting, currentPage: 'dashboard', pageTitle: 'Dashboard' });
        } catch (error) {
            console.error("Dashboard DB Error:", error);
            const nowHour = new Date().getHours();
            const greeting = nowHour < 12 ? 'Good morning' : (nowHour < 17 ? 'Good afternoon' : 'Good evening');
            res.render('faculty/dashboard.html', { 
                user, 
                stats: { problemsCreated: 0, activeContests: 0, totalStudents: 0, subjectsTaught: 0 }, 
                draftProblems: [], 
                recentActivity: [],
                difficultySpread: [0, 0, 0],
                contestPerformance: { labels: ["No Data"], data: [0] },
                greeting,
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
            `SELECT p.*, u.fullName as facultyName, u.role as creatorRole FROM problems p 
             LEFT JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id 
             WHERE (u.collegeName = ? AND p.status = 'accepted' AND LOWER(p.visibility_scope) = 'global')
                OR (p.status IN ('accepted', 'active') AND LOWER(p.visibility_scope) = 'global' AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))
                OR p.faculty_id = ? 
             ORDER BY p.createdAt DESC`,
            [user.collegeName, user.id],
            (err, problems) => {
                if (err) problems = [];
                
                db.all(`SELECT subject FROM faculty_assignments WHERE user_id = ?`, [user.id], (err, assignments) => {
                    const assignedSubjects = assignments ? assignments.map(a => a.subject) : [];
                    res.render('faculty/problem.html', { 
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
        db.get(`SELECT isVerified FROM account_users WHERE id = ?`, [user.id], (err, row) => {
            if (!err && row) {
                const freshIsVerified = row.isVerified === 1 || row.isVerified === true;
                // Sync the session so other pages also see the updated value
                req.session.user.isVerified = freshIsVerified;
                user.isVerified = freshIsVerified;
            }
            
            db.all(`SELECT subject FROM faculty_assignments WHERE user_id = ?`, [user.id], (err, assignments) => {
                const assignedSubjects = assignments ? assignments.map(a => a.subject) : [];
                res.render('faculty/create-problem.html', { 
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
        hiddenTestsUpload(req, res, (uploadErr) => {
            if (uploadErr) {
                return res.status(400).send(`Hidden testcase upload failed: ${uploadErr.message}`);
            }

            const user = buildUser(req);
            let { title, subject, difficulty, input_format, output_format, constraints, sample_input, sample_output, hidden_test_cases, description, tags, visibility_scope } = req.body;
            
            // Ensure description is a string and trimmed
            const finalDescription = String(description || '').trim();
            const finalTags = String(tags || '').trim();
            
            const files = req.files || {};
            const inputFile = Array.isArray(files.hidden_input_file) ? files.hidden_input_file[0] : null;
            const outputFile = Array.isArray(files.hidden_output_file) ? files.hidden_output_file[0] : null;

            if ((inputFile && !outputFile) || (!inputFile && outputFile)) {
                return res.status(400).send('Please upload both hidden testcase files: input.txt and output.txt');
            }

            if (inputFile && outputFile) {
                const inputName = String(inputFile.originalname || '').trim().toLowerCase();
                const outputName = String(outputFile.originalname || '').trim().toLowerCase();
                if (inputName !== 'input.txt' || outputName !== 'output.txt') {
                    return res.status(400).send('Hidden testcase files must be named exactly: input.txt and output.txt');
                }
            }

            const scope = visibility_scope || 'global';
            const autoApproved = user.role === 'hos' || user.role === 'hod';
            const status = autoApproved ? 'accepted' : 'pending';
            const isPublicVal = autoApproved ? 1 : 0;
            const hosVerified = user.role === 'hos' ? 1 : 0;
            const hodVerified = user.role === 'hod' ? 1 : 0;
            const approvedBy = autoApproved ? user.id : null;
            const approvedAt = autoApproved ? new Date().toISOString() : null;

            // Set universal XP points based on difficulty
            const getPointsFromDifficulty = (diff) => {
                const normalizedDiff = String(diff || 'easy').toLowerCase();
                switch (normalizedDiff) {
                    case 'easy': return 5;
                    case 'medium': return 10;
                    case 'hard': return 15;
                    default: return 5; // default to easy
                }
            };
            const calculatedPoints = getPointsFromDifficulty(difficulty);

            console.log("[Create Problem] created_by:", user.id, "| title:", title, "| status:", status, "| descLength:", finalDescription.length);

            db.run(`INSERT INTO problems (title, description, subject, difficulty, points, input_format, output_format, constraints, sample_input, sample_output, hidden_test_cases, faculty_id, is_public, department, visibility_scope, status, tags, created_by, hos_verified, hod_verified, approved_by, approved_at) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [title, finalDescription, subject, difficulty, calculatedPoints, input_format || '', output_format || '', constraints || '', sample_input || '', sample_output || '', hidden_test_cases || '', user.id, isPublicVal, user.department, scope, status, finalTags, user.id, hosVerified, hodVerified, approvedBy, approvedAt],
                function(err) {
                    if (err) {
                        console.error("[Create Problem] DB Error:", err.message);
                        return res.status(500).send("Database error while creating problem: " + err.message);
                    }

                    const problemId = this.lastID;
                    const finalizeRedirect = () => {
                        if (user.role === 'hod') return res.redirect('/college/hod/problem?success=1');
                        if (user.role === 'hos') return res.redirect('/hos/problem?success=1');
                        return res.redirect('/faculty/problem?success=1');
                    };

                    if (!inputFile || !outputFile) {
                        return finalizeRedirect();
                    }

                    try {
                        const tcDir = path.join(__dirname, '..', 'public', 'uploads', 'testcases', String(problemId));
                        fs.mkdirSync(tcDir, { recursive: true });
                        fs.writeFileSync(path.join(tcDir, 'input1.txt'), inputFile.buffer);
                        fs.writeFileSync(path.join(tcDir, 'output1.txt'), outputFile.buffer);
                    } catch (fileErr) {
                        console.error('[Create Problem] hidden testcase file write error:', fileErr.message);
                        return res.status(500).send('Problem created, but failed to save hidden testcase files.');
                    }

                    const pairJson = JSON.stringify([{ input: 'input1.txt', output: 'output1.txt' }]);
                    db.run(`UPDATE problems SET hidden_test_cases = ? WHERE id = ?`, [pairJson, problemId], (updateErr) => {
                        if (updateErr) {
                            console.error('[Create Problem] hidden testcase metadata update error:', updateErr.message);
                            return res.status(500).send('Problem created, but failed to link hidden testcase metadata.');
                        }
                        finalizeRedirect();
                    });
                }
            );
        });
    });

    // ==========================================
    // VIEW PROBLEM
    // ==========================================
    router.get('/problem/view/:id', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const problemId = Number(req.params.id);
        if (!Number.isInteger(problemId) || problemId <= 0) return res.status(400).send("Invalid problem id.");
        // Unified IDE/problem page used across roles
        return res.redirect(`/student/problem/${problemId}`);
    });

    // ==========================================
    // EDIT & DELETE PROBLEM
    // ==========================================
    router.get('/problem/edit/:id', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        db.get(`SELECT * FROM problems WHERE id = ? AND faculty_id = ?`, [req.params.id, user.id], (err, problem) => {
            if (err || !problem) return res.status(404).send("Problem not found.");
            res.render('faculty/edit-problem.html', { user, problem, currentPage: 'problem', pageTitle: 'Edit Problem' });
        });
    });

    router.post('/problem/edit/:id', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        hiddenTestsUpload(req, res, (uploadErr) => {
            if (uploadErr) {
                return res.status(400).send(`Hidden testcase upload failed: ${uploadErr.message}`);
            }

            const user = buildUser(req);
            const problemId = req.params.id;
            let { title, subject, difficulty, input_format, output_format, constraints, sample_input, sample_output, hidden_test_cases, description, tags, is_public } = req.body;
            
            const files = req.files || {};
            const inputFile = Array.isArray(files.hidden_input_file) ? files.hidden_input_file[0] : null;
            const outputFile = Array.isArray(files.hidden_output_file) ? files.hidden_output_file[0] : null;

            if ((inputFile && !outputFile) || (!inputFile && outputFile)) {
                return res.status(400).send('Please upload both hidden testcase files: input.txt and output.txt');
            }

            let isPublicVal = (is_public === 'on' || is_public === 'true' || is_public === '1') ? 1 : 0;
            if (!user.isVerified) { isPublicVal = 0; }

            // Set universal XP points based on difficulty
            const getPointsFromDifficulty = (diff) => {
                const normalizedDiff = String(diff || 'easy').toLowerCase();
                switch (normalizedDiff) {
                    case 'easy': return 5;
                    case 'medium': return 10;
                    case 'hard': return 15;
                    default: return 5; // default to easy
                }
            };
            const calculatedPoints = getPointsFromDifficulty(difficulty);

            const finalDesc = String(description || '').trim();
            const finalTags = String(tags || '').trim();

            const autoApproved = user.role === 'hos' || user.role === 'hod';
            const status = autoApproved ? 'accepted' : 'pending';
            const hosVerified = user.role === 'hos' ? 1 : 0;
            const hodVerified = user.role === 'hod' ? 1 : 0;
            const approvedBy = autoApproved ? user.id : null;
            const approvedAt = autoApproved ? new Date().toISOString() : null;

            const performDbUpdate = (finalHiddenTestCases) => {
                db.run(`UPDATE problems SET title = ?, description = ?, subject = ?, difficulty = ?, points = ?, input_format = ?, output_format = ?, constraints = ?, sample_input = ?, sample_output = ?, hidden_test_cases = ?, tags = ?, is_public = ?, status = ?, hos_verified = ?, hod_verified = ?, approved_by = ?, approved_at = ? WHERE id = ? AND faculty_id = ?`,
                    [title, finalDesc, subject, difficulty, calculatedPoints, input_format, output_format, constraints, sample_input, sample_output, finalHiddenTestCases || hidden_test_cases || '', finalTags, isPublicVal, status, hosVerified, hodVerified, approvedBy, approvedAt, problemId, user.id],
                    function(err) {
                        if (err) {
                            console.error("[Edit Problem] DB Error:", err.message);
                            return res.status(500).send("Database error while updating problem: " + err.message);
                        }
                        
                        // Role-aware redirect
                        if (user.role === 'hod') return res.redirect('/college/hod/problem?success=1');
                        if (user.role === 'hos') return res.redirect('/hos/problem?success=1');
                        return res.redirect('/faculty/problem?success=1');
                    }
                );
            };

            if (inputFile && outputFile) {
                // Validate filenames
                const inputName = String(inputFile.originalname || '').trim().toLowerCase();
                const outputName = String(outputFile.originalname || '').trim().toLowerCase();
                if (inputName !== 'input.txt' || outputName !== 'output.txt') {
                    return res.status(400).send('Hidden testcase files must be named exactly: input.txt and output.txt');
                }

                // Save files
                try {
                    const tcDir = path.join(__dirname, '..', 'public', 'uploads', 'testcases', String(problemId));
                    if (!fs.existsSync(tcDir)) fs.mkdirSync(tcDir, { recursive: true });
                    fs.writeFileSync(path.join(tcDir, 'input1.txt'), inputFile.buffer);
                    fs.writeFileSync(path.join(tcDir, 'output1.txt'), outputFile.buffer);
                    
                    const pairJson = JSON.stringify([{ input: 'input1.txt', output: 'output1.txt' }]);
                    performDbUpdate(pairJson);
                } catch (fileErr) {
                    console.error('[Edit Problem] hidden testcase file write error:', fileErr.message);
                    return res.status(500).send('Database update skipped: failed to save hidden testcase files.');
                }
            } else {
                performDbUpdate(hidden_test_cases);
            }
        });
    });

    router.get('/view-problem/:id', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        const problemId = req.params.id;
        const collegeName = req.session.user.collegeName;
        db.get('SELECT * FROM problems WHERE id = ?', [problemId], (err, problem) => {
            if (err) return res.status(500).send('Database error');
            if (!problem) return res.status(404).send('Problem not found');
            if (problem.description) {
                problem.description = sanitizeHtml(problem.description, {
                    allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'img', 'u', 's', 'pre', 'code' ]),
                    allowedAttributes: Object.assign({}, sanitizeHtml.defaults.allowedAttributes, {
                        '*': ['style', 'class'],
                        'img': ['src', 'alt', 'width', 'height']
                    })
                });
            }
            res.render('faculty/view-problem.html', {
                user: req.session.user,
                problem: problem,
                collegeName: collegeName,
                currentPage: 'problem'
            });
        });
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
        const { title, startDate, endDate, subject, year, section, visibility_scope, registrationEndDate, deadline, description, rulesAndDescription, guidelines, problems, eligibility } = req.body;
        const computedDuration = computeDurationFromRange(startDate, endDate);
        if (!computedDuration) return res.status(400).send('End time must be after start time.');

        const creatorRole = String(user.role || '').toLowerCase();
        const hosVerified = creatorRole === 'hos' || creatorRole === 'hod' ? 1 : 0;
        const hodVerified = creatorRole === 'hod' ? 1 : 0;
        const isAutoApproved = creatorRole === 'hod';
        const status = isAutoApproved ? 'accepted' : 'pending';
        const isVerified = isAutoApproved ? 1 : 0;
        const scope = visibility_scope || 'college';
        const regDeadline = registrationEndDate || deadline || null;

        db.run(`INSERT INTO contests (title, createdBy, created_by, status, isVerified, startDate, endDate, registrationEndDate, deadline, duration, department, subject, visibility_scope, scope, level, collegeName, description, rulesAndDescription, guidelines, problems, eligibility, hos_verified, hod_verified, approved_by, approved_at, is_live, live_mode, live_user_ids, live_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, user.id, user.id, status, isVerified, startDate, endDate, regDeadline, regDeadline, computedDuration, user.department, subject || '', scope, 'college', 'college', user.collegeName || '', description || null, rulesAndDescription || null, guidelines || '', JSON.stringify(problems || []), eligibility || null, hosVerified, hodVerified, isAutoApproved ? user.id : null, isAutoApproved ? new Date().toISOString() : null, 1, 'all_students', '[]', null],
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
        let query = `
            SELECT
                u.id,
                u.fullName,
                u.email,
                u.role,
                u.status,
                u.points,
                u.solvedCount,
                u.rank,
                u.year,
                u.section,
                (
                    SELECT COUNT(*)
                    FROM contest_participants cp
                    WHERE cp.user_id = u.id
                ) AS contestCount,
                (
                    SELECT s.language
                    FROM submissions s
                    WHERE s.user_id = u.id
                      AND COALESCE(s.language, '') <> ''
                    ORDER BY datetime(s.createdAt) DESC, s.id DESC
                    LIMIT 1
                ) AS language,
                (
                    SELECT COUNT(*) + 1
                    FROM account_users u2
                    WHERE u2.role = 'student'
                      AND COALESCE(u2.points, 0) > COALESCE(u.points, 0)
                ) AS globalRank
            FROM account_users u
            WHERE u.role = 'student' AND u.collegeName = ?
        `;
        let params = [user.collegeName];

        if (user.role === 'hod') {
            query += ` AND u.department = ?`;
            params.push(user.department);
        }

        query += ` ORDER BY fullName ASC`;

        try {
            const students = await runQuery(query, params);
            res.render('faculty/student.html', { user, students, currentPage: 'student', pageTitle: 'Students' });
        } catch (err) {
            console.error("Student Fetch Error:", err);
            res.render('faculty/student.html', { user, students: [], currentPage: 'student', pageTitle: 'Students' });
        }
    });

    // ==========================================
    // UPDATE STUDENT
    // ==========================================
    router.post('/student/update/:id', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        const { fullName, email, year, section, status } = req.body;
        const studentId = req.params.id;
        const user = req.session.user;

        db.run(
            `UPDATE users 
             SET fullName = ?, email = ?, year = ?, section = ?, status = ? 
             WHERE id = ? AND collegeName = ? AND role = 'student'`,
            [fullName, email, year, section, String(status || 'active').toLowerCase(), studentId, user.collegeName],
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                if (this.changes === 0) return res.status(404).json({ success: false, message: 'Student not found or unauthorized' });
                res.json({ success: true, message: 'Student updated successfully!' });
            }
        );
    });

    // ==========================================

    // VIEW STUDENT PROFILE
    // ==========================================
    router.get('/view_student', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        res.render('faculty/view_student.html', { 
            user: req.session.user, 
            currentPage: 'student',
            queryId: req.query.id
        });
    });

    router.get('/view_faculty', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        res.render('faculty/view_faculty.html', { 
            user: req.session.user, 
            currentPage: 'faculty',
            queryId: req.query.id
        });
    });

    router.get('/api/student/public-profile/:id', requireRole(['faculty', 'hos', 'hod']), async (req, res) => {
        const studentId = req.params.id;
        const collegeName = req.session.user.collegeName;

        try {
            const user = await getSingle(`
                SELECT
                    id, fullName, email, department, branch, program, year, section, collegeName, role, status,
                    COALESCE(points, 0) as points,
                    COALESCE(solvedCount, 0) as solvedCount,
                    rank
                FROM account_users
                WHERE id = ? AND collegeName = ? AND role = 'student'
            `, [studentId, collegeName]);
            if (!user) return res.status(404).json({ success: false, message: "Student not found" });

            const rankRow = await getSingle(`
                SELECT COUNT(*) as cnt
                FROM account_users
                WHERE LOWER(COALESCE(role, '')) IN ('student', 'individual')
                  AND COALESCE(points, 0) > ?
            `, [Number(user.points || 0)]);

            const recentSubmissions = await runQuery(`
                SELECT
                    s.id,
                    COALESCE(p.title, 'Untitled Problem') as problemTitle,
                    COALESCE(p.difficulty, 'N/A') as difficulty,
                    COALESCE(s.language, 'N/A') as language,
                    COALESCE(s.status, 'pending') as status,
                    COALESCE(s.points_earned, 0) as pointsEarned,
                    COALESCE(s.createdAt, '') as createdAt
                FROM submissions s
                LEFT JOIN problems p ON p.id = s.problem_id
                WHERE s.user_id = ?
                ORDER BY datetime(COALESCE(s.createdAt, '1970-01-01')) DESC, s.id DESC
                LIMIT 5
            `, [studentId]);

            const acceptedDays = await runQuery(`
                SELECT DATE(COALESCE(createdAt, CURRENT_TIMESTAMP)) as submitted_on
                FROM submissions
                WHERE user_id = ?
                  AND LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass')
                GROUP BY DATE(COALESCE(createdAt, CURRENT_TIMESTAMP))
                ORDER BY submitted_on DESC
            `, [studentId]);

            const calculateConsecutiveDayStreak = (dateValues = []) => {
                const normalizedDates = [...new Set(
                    dateValues.map((value) => String(value || '').trim().slice(0, 10)).filter(Boolean)
                )].sort((a, b) => b.localeCompare(a));
                if (!normalizedDates.length) return 0;

                let streak = 1;
                for (let index = 1; index < normalizedDates.length; index += 1) {
                    const previous = new Date(`${normalizedDates[index - 1]}T00:00:00Z`);
                    const current = new Date(`${normalizedDates[index]}T00:00:00Z`);
                    const diffDays = Math.round((previous.getTime() - current.getTime()) / 86400000);
                    if (diffDays !== 1) break;
                    streak += 1;
                }

                return streak;
            };

            res.json({
                success: true,
                student: {
                    ...user,
                    rank: user.rank || `#${Number(rankRow?.cnt || 0) + 1}`,
                    streak: calculateConsecutiveDayStreak(acceptedDays.map((row) => row.submitted_on)),
                    level: Math.max(1, Math.floor(Number(user.points || 0) / 150) + 1)
                },
                recentSubmissions
            });
        } catch (error) {
            console.error('Faculty student public profile error:', error);
            res.status(500).json({ success: false, message: "Database error" });
        }
    });

    router.get('/api/faculty/public-profile/:id', requireRole(['faculty', 'hos', 'hod']), async (req, res) => {
        const facultyId = req.params.id;
        const collegeName = req.session.user.collegeName;

        try {
            const user = await getSingle(
                `SELECT id, fullName, email, department, branch, program, collegeName, role, status, is_hod
                 FROM account_users
                 WHERE id = ? AND collegeName = ?`,
                [facultyId, collegeName]
            );
            if (!user) return res.status(404).json({ success: false, message: "Faculty not found" });

            const stats = await getSingle(
                `SELECT
                    (SELECT COUNT(*) FROM contests WHERE createdBy = ?) as totalContests,
                    (SELECT COUNT(*) FROM problems WHERE faculty_id = ?) as totalProblems,
                    (SELECT COUNT(*) FROM submissions s
                     JOIN problems p ON p.id = s.problem_id
                     WHERE p.faculty_id = ? AND LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac', 'pass')) as acceptedSubmissions,
                    (SELECT COUNT(DISTINCT s.user_id) FROM submissions s
                     JOIN problems p ON p.id = s.problem_id
                     WHERE p.faculty_id = ?) as learnerReach`,
                [facultyId, facultyId, facultyId, facultyId]
            );

            const recentActivity = await runQuery(`
                SELECT *
                FROM (
                    SELECT
                        'problem' as type,
                        p.id as itemId,
                        p.title as title,
                        COALESCE(NULLIF(p.status, ''), 'draft') as status,
                        COALESCE(p.createdAt, '') as activityAt
                    FROM problems p
                    WHERE p.faculty_id = ?

                    UNION ALL

                    SELECT
                        'contest' as type,
                        c.id as itemId,
                        c.title as title,
                        COALESCE(NULLIF(c.status, ''), 'draft') as status,
                        COALESCE(c.createdAt, c.startDate, '') as activityAt
                    FROM contests c
                    WHERE c.createdBy = ?
                )
                ORDER BY datetime(activityAt) DESC, itemId DESC
                LIMIT 5
            `, [facultyId, facultyId]);

            res.json({
                success: true,
                faculty: user,
                stats: {
                    problemsCreated: stats ? stats.totalProblems : 0,
                    activeContests: stats ? stats.totalContests : 0,
                    platformRating: Number(Math.min(
                        5,
                        ((Number(stats?.totalProblems || 0) * 0.35)
                            + (Number(stats?.totalContests || 0) * 0.65)
                            + (Number(stats?.acceptedSubmissions || 0) * 0.02)
                            + (Number(stats?.learnerReach || 0) * 0.05))
                    ).toFixed(1))
                },
                recentActivity
            });
        } catch (error) {
            console.error('Faculty public profile error:', error);
            res.status(500).json({ success: false, message: "Database error" });
        }
    });

    // ==========================================
    // COMMUNITY
    // ==========================================
    router.get('/community', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        res.render('faculty/community.html', { user, currentPage: 'community', pageTitle: 'Community' });
    });

    // ==========================================
    // PROFILE
    // ==========================================
    router.get('/profile', requireRole(['faculty', 'hos', 'hod']), checkScope, async (req, res) => {
        const user = buildUser(req);
        try {
            // Fetch system-assigned load
            const assignments = await runQuery(`SELECT subject, year, section FROM faculty_assignments WHERE user_id = ?`, [user.id]);
            user.assignedSubjects = [...new Set(assignments.map(a => a.subject))].filter(Boolean);
            user.assignedYears = [...new Set(assignments.map(a => a.year))].filter(Boolean).join(',');
            user.assignedSections = [...new Set(assignments.map(a => a.section))].filter(Boolean).join(',');

            const [studentsRow, problemsRow, contestsRow, subjectsRow, submissionStatsRow, distinctSubmittingStudentsRow, solvedProblemsRow] = await Promise.all([
                getSingle(`SELECT COUNT(*) as count FROM account_users WHERE role = 'student' AND collegeName = ?`, [user.collegeName]),
                getSingle(`SELECT COUNT(*) as count FROM problems WHERE faculty_id = ?`, [user.id]),
                getSingle(`SELECT COUNT(*) as count FROM contests WHERE createdBy = ?`, [user.id]),
                getSingle(`SELECT COUNT(DISTINCT subject) as count FROM faculty_assignments WHERE user_id = ?`, [user.id]),
                getSingle(
                    `SELECT COUNT(*) as totalSubmissions,
                            SUM(CASE WHEN LOWER(COALESCE(s.status, '')) IN ('accepted','ac') THEN 1 ELSE 0 END) as acceptedSubmissions
                     FROM submissions s
                     JOIN problems p ON p.id = s.problem_id
                     WHERE p.faculty_id = ?`,
                    [user.id]
                ),
                getSingle(
                    `SELECT COUNT(DISTINCT s.user_id) as count
                     FROM submissions s
                     JOIN problems p ON p.id = s.problem_id
                     WHERE p.faculty_id = ?`,
                    [user.id]
                ),
                getSingle(
                    `SELECT COUNT(DISTINCT p.id) as count
                     FROM problems p
                     JOIN submissions s ON s.problem_id = p.id
                     WHERE p.faculty_id = ?
                       AND LOWER(COALESCE(s.status, '')) IN ('accepted','ac')`,
                    [user.id]
                )
            ]);

            const profileStats = {
                students: Number(studentsRow?.count || 0),
                problems: Number(problemsRow?.count || 0),
                activeStudents: Number(distinctSubmittingStudentsRow?.count || 0),
                contests: Number(contestsRow?.count || 0)
            };

            const totalSubmissions = Number(submissionStatsRow?.totalSubmissions || 0);
            const acceptedSubmissions = Number(submissionStatsRow?.acceptedSubmissions || 0);
            const submittingStudents = Number(distinctSubmittingStudentsRow?.count || 0);
            const solvedProblems = Number(solvedProblemsRow?.count || 0);
            const activeContests = await getSingle(
                `SELECT COUNT(*) as count
                 FROM contests
                 WHERE createdBy = ?
                   AND (
                     LOWER(COALESCE(status, '')) IN ('active','ongoing','live')
                     OR (startDate IS NOT NULL AND endDate IS NOT NULL AND datetime('now') BETWEEN datetime(startDate) AND datetime(endDate))
                   )`,
                [user.id]
            );
            const activeContestCount = Number(activeContests?.count || 0);

            const toPercent = (value, maxValue) => {
                if (!maxValue || maxValue <= 0) return 0;
                return Math.max(0, Math.min(100, Math.round((value / maxValue) * 100)));
            };

            const profilePerformance = {
                coverage: toPercent(submittingStudents, profileStats.students),
                engagement: toPercent(totalSubmissions, Math.max(1, profileStats.students * 5)),
                contests: toPercent(activeContestCount, profileStats.contests),
                mentoring: toPercent(solvedProblems, profileStats.problems),
                outcomes: toPercent(acceptedSubmissions, totalSubmissions)
            };

            const [topSubjects, topPerformers, recentActivity] = await Promise.all([
                runQuery(`SELECT subject, COUNT(*) as count FROM problems WHERE faculty_id = ? AND subject != '' GROUP BY subject ORDER BY count DESC LIMIT 5`, [user.id]),
                runQuery(`SELECT u.fullName, u.id, COUNT(*) as count 
                       FROM submissions s 
                       JOIN problems p ON p.id = s.problem_id 
                       JOIN account_users u ON u.id = s.user_id 
                       WHERE p.faculty_id = ? AND LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac') 
                       GROUP BY u.id ORDER BY count DESC LIMIT 5`, [user.id]),
                runQuery(`SELECT * FROM (
                        SELECT 'problem' as type, title, createdAt FROM problems WHERE faculty_id = ?
                        UNION ALL
                        SELECT 'contest' as type, title, createdAt FROM contests WHERE createdBy = ?
                       ) ORDER BY createdAt DESC LIMIT 5`, [user.id, user.id])
            ]);

            res.render('faculty/profile.html', {
                user,
                currentPage: 'profile',
                pageTitle: 'Profile',
                profileStats,
                profilePerformance,
                topSubjects: topSubjects || [],
                topPerformers: topPerformers || [],
                recentActivity: recentActivity || []
            });
        } catch (error) {
            console.error('Faculty Profile Error:', error);
            res.render('faculty/profile.html', {
                user,
                currentPage: 'profile',
                pageTitle: 'Profile',
                profileStats: { students: 0, problems: 0, activeStudents: 0, contests: 0 },
                profilePerformance: { coverage: 0, engagement: 0, contests: 0, mentoring: 0, outcomes: 0 },
                topSubjects: [],
                topPerformers: [],
                recentActivity: []
            });
        }
    });

    // ==========================================
    // REPORTS
    // ==========================================
    router.get('/report', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const now = new Date();
        const labels = [];
        const monthMap = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            labels.push(monthNames[d.getMonth()]);
            monthMap.push(String(d.getMonth() + 1).padStart(2, '0'));
        }

        Promise.all([
            runQuery(
                `SELECT strftime('%m', s.createdAt) as month, COUNT(*) as count
                 FROM submissions s
                 JOIN problems p ON p.id = s.problem_id
                 WHERE p.faculty_id = ?
                 GROUP BY strftime('%m', s.createdAt)`,
                [user.id]
            ),
            runQuery(
                `SELECT difficulty, COUNT(*) as count
                 FROM problems
                 WHERE faculty_id = ?
                 GROUP BY difficulty`,
                [user.id]
            ),
            getSingle(`SELECT COUNT(*) as count FROM problems WHERE faculty_id = ?`, [user.id]),
            getSingle(`SELECT COUNT(*) as count FROM contests WHERE createdBy = ?`, [user.id]),
            getSingle(
                `SELECT COUNT(DISTINCT s.user_id) as count
                 FROM submissions s
                 JOIN problems p ON p.id = s.problem_id
                 WHERE p.faculty_id = ?`,
                [user.id]
            )
        ]).then(([monthlyRows, difficultyRows, problemsRow, contestsRow, activeStudentsRow]) => {
            const monthlyByMonth = {};
            (monthlyRows || []).forEach(r => { monthlyByMonth[r.month] = Number(r.count || 0); });
            const participationTrend = monthMap.map(m => monthlyByMonth[m] || 0);

            let easy = 0, medium = 0, hard = 0;
            (difficultyRows || []).forEach(r => {
                if (String(r.difficulty || '').toLowerCase() === 'easy') easy = Number(r.count || 0);
                if (String(r.difficulty || '').toLowerCase() === 'medium') medium = Number(r.count || 0);
                if (String(r.difficulty || '').toLowerCase() === 'hard') hard = Number(r.count || 0);
            });

            res.render('faculty/report.html', {
                user,
                currentPage: 'report',
                pageTitle: 'Reports',
                reportData: {
                    labels,
                    participationTrend,
                    difficulty: [easy, medium, hard],
                    problems: Number(problemsRow?.count || 0),
                    contests: Number(contestsRow?.count || 0),
                    activeStudents: Number(activeStudentsRow?.count || 0)
                }
            });
        }).catch((err) => {
            console.error('Faculty Report Error:', err);
            res.render('faculty/report.html', {
                user,
                currentPage: 'report',
                pageTitle: 'Reports',
                reportData: {
                    labels,
                    participationTrend: [0,0,0,0,0,0],
                    difficulty: [0,0,0],
                    problems: 0,
                    contests: 0,
                    activeStudents: 0
                }
            });
        });
    });

    // ==========================================
    // HELP & SUPPORT
    // ==========================================
    router.get('/help', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = buildUser(req);
        res.render('faculty/help.html', { user, currentPage: 'help', pageTitle: 'Help & Support' });
    });

    // ==========================================
    // SETTINGS
    // ==========================================
    router.get('/settings', requireRole(['faculty', 'hos', 'hod']), checkScope, async (req, res) => {
        const userSession = buildUser(req);
        try {
            const row = await getSingle(`SELECT * FROM account_users WHERE id = ?`, [userSession.id]);
            if (!row) return res.redirect('/auth/login');

            const assignments = await runQuery(`SELECT subject, year, section FROM faculty_assignments WHERE user_id = ?`, [userSession.id]);
            
            // Map data for template
            row.name = row.fullName;
            row.college = row.collegeName;
            row.assignedSubjects = [...new Set(assignments.map(a => a.subject))].filter(Boolean);
            row.assignedYears = [...new Set(assignments.map(a => a.year))].filter(Boolean).join(',');
            row.assignedSections = [...new Set(assignments.map(a => a.section))].filter(Boolean).join(',');

            res.render('faculty/settings.html', { 
                user: row, 
                success: req.query.success === 'true', 
                currentPage: 'settings', 
                pageTitle: 'Settings' 
            });
        } catch (error) {
            console.error("Settings error:", error);
            res.status(500).send("Internal Server Error");
        }
    });

    router.post('/settings/update', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        const userSession = buildUser(req);
        const { name, email, gender, mobile, joiningDate, location } = req.body;
        
        db.run(`UPDATE account_users SET fullName = ?, email = ?, gender = ?, mobile = ?, joiningDate = ?, location = ? WHERE id = ?`,
            [name, email, gender, mobile, joiningDate, location, userSession.id],
            function(err) {
                if (err) {
                    console.error("Settings Update Error:", err);
                    return res.status(500).send("Error updating settings.");
                }
                // Update session memory to reflect changes
                req.session.user.fullName = name;
                req.session.user.name = name;
                req.session.user.email = email;
                req.session.user.joiningDate = joiningDate;
                req.session.user.location = location;
                
                res.redirect('/faculty/settings?success=true');
            }
        );
    });

    // Fetch students belonging to the faculty's college / department
    router.get('/api/students', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        const user = req.session.user;
        let query = `SELECT id, fullName, email FROM account_users WHERE role = 'student' AND status = 'active' AND collegeName = ?`;
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
                `SELECT c.*, u.fullName as creatorName, u.role as creatorRole, ap.fullName as approverName
                 FROM contests c
                 LEFT JOIN account_users u ON c.createdBy = u.id
                 LEFT JOIN account_users ap ON c.approved_by = ap.id
                 WHERE (
                     c.status = 'accepted' AND 
                     (c.collegeName = ? OR u.collegeName = ?) AND
                     (
                         LOWER(c.visibility_scope) = 'global' OR 
                         LOWER(c.scope) = 'global' OR 
                         c.department = ? OR
                         u.role IN ('admin', 'superadmin')
                     )
            ) OR c.createdBy = ? OR (c.status = 'accepted' AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))
                 ORDER BY c.startDate DESC`,
                [user.collegeName, user.collegeName, user.department, user.id]
            );

            const problems = await runQuery(
                `SELECT p.id, p.title 
                 FROM problems p 
                 LEFT JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id 
                 WHERE (p.status = 'accepted' AND u.collegeName = ?)
                    OR (p.status IN ('accepted', 'active') AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))`,
                [user.collegeName]
            );

            // Parse problems JSON for each contest
            contests.forEach(c => {
                try { c.problems = JSON.parse(c.problems || '[]'); } catch { c.problems = []; }
                c.startDate = c.startDate || '';
                c.endDate = c.endDate || '';
                c.registrationEndDate = c.registrationEndDate || '';
            });

            res.render('faculty/contest.html', {
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

    // API to fetch available problems for UI problem picker
    router.get('/api/available-problems', requireRole(['faculty', 'hos', 'hod']), async (req, res) => {
        const user = req.session.user;
        try {
            const query = `
                SELECT p.*, u.fullName as facultyName, u.role as creatorRole 
                FROM problems p 
                LEFT JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id 
                WHERE (p.status = 'accepted' AND u.collegeName = ?)
                   OR (p.status IN ('accepted', 'active') AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))
                ORDER BY p.id DESC
            `;
            const problems = await runQuery(query, [user.collegeName]);
            res.json({ success: true, data: problems });
        } catch (error) {
            console.error("Error fetching available problems:", error);
            res.status(500).json({ success: false, message: "Database Error" });
        }
    });

    // JSON API for faculty/HOS contest.ejs JS fetch
    router.get('/api/contests', requireRole(['faculty', 'hos', 'hod']), checkScope, async (req, res) => {
        const user = req.session.user;
        try {
            const contests = await runQuery(
                `SELECT c.*, u.fullName as creatorName, u.role as creatorRole, ap.fullName as approverName
                 FROM contests c
                 LEFT JOIN account_users u ON c.createdBy = u.id
                 LEFT JOIN account_users ap ON c.approved_by = ap.id
                 WHERE (
                     c.status = 'accepted' AND 
                     (c.collegeName = ? OR u.collegeName = ?) AND
                     (
                         LOWER(c.visibility_scope) = 'global' OR 
                         LOWER(c.scope) = 'global' OR 
                         c.department = ? OR
                         u.role IN ('admin', 'superadmin')
                     )
            ) OR c.createdBy = ? OR (c.status = 'accepted' AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))
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
        const { title, startDate, endDate, registrationEndDate, deadline, eligibility, description, rulesAndDescription, guidelines, problems, subject } = req.body;
        if (!title || !startDate || !endDate) return res.json({ success: false, message: 'Title, start date and end date are required.' });
        const computedDuration = computeDurationFromRange(startDate, endDate);
        if (!computedDuration) return res.json({ success: false, message: 'End time must be after start time.' });

        const creatorRole = String(user.role || '').toLowerCase();
        
        // Determine verification and status based on creator role
        let hosVerified = 0;
        let hodVerified = 0;
        let status = 'pending';
        let approvedBy = null;
        let approvedAt = null;
        
        if (creatorRole === 'hod') {
            // HOD creates: Auto-approved, immediately accepted
            hodVerified = 1;
            hosVerified = 1;
            status = 'accepted';
            approvedBy = user.id;
            approvedAt = new Date().toISOString();
        } else if (creatorRole === 'hos') {
            // HOS creates: Mark as HOS verified, but needs HOD approval
            hosVerified = 1;
            hodVerified = 0;
            status = 'pending';
        } else if (creatorRole === 'faculty') {
            // Faculty creates: Needs both HOS and HOD verification
            hosVerified = 0;
            hodVerified = 0;
            status = 'pending';
        }
        
        const visibilityScope = 'college';

        db.run(
            `INSERT INTO contests (title, startDate, endDate, registrationEndDate, deadline, duration, eligibility, description, rulesAndDescription, guidelines, problems, createdBy, created_by, collegeName, department, subject, visibility_scope, scope, level, status, hos_verified, hod_verified, isVerified, approved_by, approved_at, is_live, live_mode, live_user_ids, live_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, startDate, endDate, registrationEndDate || deadline || null, registrationEndDate || deadline || null, computedDuration, eligibility || null, description || null, rulesAndDescription || null, guidelines || '', JSON.stringify(problems || []), user.id, user.id, user.collegeName, user.department || '', subject || '', visibilityScope, visibilityScope, visibilityScope, status, hosVerified, hodVerified, status === 'accepted' ? 1 : 0, approvedBy, approvedAt, 1, 'all_students', '[]', null],
            function(err) {
                if (err) { console.error('Create Contest Error:', err); return res.json({ success: false, message: err.message }); }
                const message = creatorRole === 'hod' ? 'Contest created and immediately visible to students!' : 'Contest created! Awaiting approvals before visibility.';
                res.json({ success: true, message: message, id: this.lastID });
            }
        );
    });

    router.post('/api/update-contest', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = req.session.user;
        const { id, title, startDate, endDate, registrationEndDate, deadline, eligibility, description, rulesAndDescription, guidelines, problems, subject } = req.body;
        const computedDuration = computeDurationFromRange(startDate, endDate);
        if (!computedDuration) return res.json({ success: false, message: 'End time must be after start time.' });
        const creatorRole = String(user.role || '').toLowerCase();
        const hosVerified = creatorRole === 'hos' || creatorRole === 'hod' ? 1 : 0;
        const hodVerified = creatorRole === 'hod' ? 1 : 0;
        const isAutoApproved = creatorRole === 'hod';
        const status = isAutoApproved ? 'accepted' : 'pending';
        const isVerified = isAutoApproved ? 1 : 0;
        const approvedBy = isAutoApproved ? user.id : null;
        const approvedAt = isAutoApproved ? new Date().toISOString() : null;

        db.run(
            `UPDATE contests SET title=?, startDate=?, endDate=?, registrationEndDate=?, deadline=?, duration=?, eligibility=?, description=?, rulesAndDescription=?, guidelines=?, problems=?, subject=?, status=?, isVerified=?, hos_verified=?, hod_verified=?, approved_by=?, approved_at=?
             WHERE id=? AND createdBy=?`,
            [
                title, startDate, endDate, registrationEndDate || deadline || null, registrationEndDate || deadline || null, 
                computedDuration, eligibility || null, description || null, rulesAndDescription || null, guidelines || '', 
                JSON.stringify(problems || []), subject || '', status, isVerified, hosVerified, hodVerified, 
                approvedBy, approvedAt, id, user.id
            ],
            function(err) {
                if (err) { console.error('Update Contest Error:', err); return res.json({ success: false, message: err.message }); }
                if (this.changes === 0) return res.json({ success: false, message: 'Contest not found or not authorized.' });
                res.json({ success: true, message: 'Contest updated successfully!' });
            }
        );
    });

    router.post('/api/delete-contest', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        const user = req.session.user;
        const { id } = req.body;
        db.run(`DELETE FROM contests WHERE id=? AND createdBy=?`, [id, user.id], function(err) {
            if (err) { console.error('Delete Contest Error:', err); return res.json({ success: false, message: err.message }); }
            if (this.changes === 0) return res.json({ success: false, message: 'Contest not found or not authorized.' });
            res.json({ success: true, message: 'Contest deleted successfully!' });
        });
    });

    router.post('/api/live-contest', requireRole(['faculty', 'hos', 'hod']), checkScope, async (req, res) => {
        const user = req.session.user;
        const contestId = Number(req.body?.id);
        const action = String(req.body?.action || 'live').toLowerCase();
        const liveMode = String(req.body?.liveMode || 'all_students').toLowerCase();
        const requestedIds = Array.isArray(req.body?.selectedUserIds) ? req.body.selectedUserIds : [];

        if (!Number.isInteger(contestId) || contestId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid contest id.' });
        }

        const run = (query, params = []) => new Promise((resolve, reject) => {
            db.run(query, params, function(err) {
                if (err) return reject(err);
                resolve(this);
            });
        });
        const all = (query, params = []) => new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
        const get = (query, params = []) => new Promise((resolve, reject) => {
            db.get(query, params, (err, row) => {
                if (err) return reject(err);
                resolve(row || null);
            });
        });

        try {
            const contest = await get(`SELECT id, status, createdBy, collegeName FROM contests WHERE id = ?`, [contestId]);
            if (!contest || Number(contest.createdBy) !== Number(user.id)) {
                return res.status(403).json({ success: false, message: 'Only contest creator can update live status.' });
            }
            if (String(contest.status || '').toLowerCase() !== 'accepted') {
                return res.status(400).json({ success: false, message: 'Contest must be approved before going live.' });
            }

            if (action === 'unlive') {
                await run(
                    `UPDATE contests
                     SET is_live = 0, live_mode = 'manual_hold', live_user_ids = '[]', live_at = NULL
                     WHERE id = ? AND createdBy = ?`,
                    [contestId, user.id]
                );
                return res.json({ success: true, message: 'Contest moved out of live mode.' });
            }

            if (!['all_students', 'selected_users'].includes(liveMode)) {
                return res.status(400).json({ success: false, message: 'Invalid live mode.' });
            }

            let selectedUserIds = [];
            if (liveMode === 'selected_users') {
                const normalizedIds = [...new Set(
                    requestedIds
                        .map((value) => Number(value))
                        .filter((value) => Number.isInteger(value) && value > 0)
                )];
                if (!normalizedIds.length) {
                    return res.status(400).json({ success: false, message: 'Select at least one student for targeted live mode.' });
                }

                const placeholders = normalizedIds.map(() => '?').join(',');
                const studentRows = await all(
                    `SELECT id
                     FROM account_users
                     WHERE id IN (${placeholders})
                       AND role = 'student'
                       AND status = 'active'
                       AND collegeName = ?`,
                    [...normalizedIds, user.collegeName]
                );
                selectedUserIds = studentRows.map((row) => Number(row.id));
                if (!selectedUserIds.length) {
                    return res.status(400).json({ success: false, message: 'No valid target students found.' });
                }
            }

            await run(
                `UPDATE contests
                 SET is_live = 1,
                     live_mode = ?,
                     live_user_ids = ?,
                     live_at = ?
                 WHERE id = ? AND createdBy = ?`,
                [
                    liveMode,
                    liveMode === 'selected_users' ? JSON.stringify(selectedUserIds) : '[]',
                    new Date().toISOString(),
                    contestId,
                    user.id
                ]
            );
            return res.json({ success: true, message: 'Contest is now live for selected audience.' });
        } catch (error) {
            console.error('Live Contest Error:', error);
            return res.status(500).json({ success: false, message: error.message || 'Failed to update live state.' });
        }
    });

    // ==========================================
    // CONTEST VIEW & LEADERBOARD
    // ==========================================
    const parseContestProblemIds = (rawProblems) => {
        let parsed = [];
        if (Array.isArray(rawProblems)) {
            parsed = rawProblems;
        } else if (typeof rawProblems === 'string' && rawProblems.trim()) {
            try {
                const fromJson = JSON.parse(rawProblems);
                parsed = Array.isArray(fromJson) ? fromJson : [];
            } catch {
                parsed = [];
            }
        }
        return parsed
            .map((item) => Number(typeof item === 'object' && item !== null ? item.id : item))
            .filter((id) => Number.isInteger(id) && id > 0);
    };

    const getContestProblemIds = async (contest) => {
        const fromJson = parseContestProblemIds(contest?.problems);
        if (fromJson.length) return fromJson;
        const rows = await runQuery(`SELECT problem_id FROM contest_problems WHERE contest_id = ?`, [contest.id]);
        return rows.map((row) => Number(row.problem_id)).filter((id) => Number.isInteger(id) && id > 0);
    };

    const buildContestLeaderboard = async (contest) => {
        const contestProblemIds = await getContestProblemIds(contest);
        if (!contestProblemIds.length) return [];

        const participantRows = await runQuery(`
            SELECT cp.user_id, cp.joined_at, u.fullName
            FROM contest_participants cp
            JOIN account_users u ON u.id = cp.user_id
            WHERE cp.contest_id = ?
        `, [contest.id]);

        const acceptedRows = await runQuery(`
            SELECT s.user_id, s.problem_id, MAX(s.points_earned) as best_points, MIN(s.createdAt) as first_solved_at
            FROM submissions s
            WHERE s.contest_id = ? AND s.status = 'accepted'
            GROUP BY s.user_id, s.problem_id
        `, [contest.id]);

        const records = new Map();
        participantRows.forEach((row) => {
            records.set(Number(row.user_id), {
                user_id: Number(row.user_id),
                fullName: row.fullName || 'Student',
                score: 0,
                solved: 0,
                firstSolvedAt: null
            });
        });

        for (const row of acceptedRows) {
            const problemId = Number(row.problem_id);
            if (!contestProblemIds.includes(problemId)) continue;
            const userId = Number(row.user_id);
            if (!records.has(userId)) {
                const user = await getSingle(`SELECT fullName FROM account_users WHERE id = ?`, [userId]);
                records.set(userId, {
                    user_id: userId,
                    fullName: user?.fullName || 'Student',
                    score: 0,
                    solved: 0,
                    firstSolvedAt: null
                });
            }
            const target = records.get(userId);
            target.score += Number(row.best_points || 0);
            target.solved += 1;
            if (!target.firstSolvedAt || new Date(row.first_solved_at).getTime() < new Date(target.firstSolvedAt).getTime()) {
                target.firstSolvedAt = row.first_solved_at;
            }
        }

        const leaderboard = Array.from(records.values()).sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            if (b.solved !== a.solved) return b.solved - a.solved;
            const aTime = a.firstSolvedAt ? new Date(a.firstSolvedAt).getTime() : Number.MAX_SAFE_INTEGER;
            const bTime = b.firstSolvedAt ? new Date(b.firstSolvedAt).getTime() : Number.MAX_SAFE_INTEGER;
            return aTime - bTime;
        });

        const total = leaderboard.length || 1;
        return leaderboard.map((entry, index) => ({
            ...entry,
            rank: index + 1,
            percentile: Math.max(1, Math.round(((total - index) / total) * 100))
        }));
    };

    const normalizeContestRecord = (contest) => ({
        ...contest,
        startTime: contest.startTime || contest.startDate || contest.date || null,
        endTime: contest.endTime || contest.endDate || null,
        deadline: contest.deadline || contest.registrationEndDate || null,
        date: contest.date || contest.startDate || contest.startTime || null
    });

    router.get('/contest/view/:id', requireRole(['faculty', 'hos', 'hod']), checkScope, async (req, res) => {
        const user = req.session.user;
        const contestId = req.params.id;

        try {
            const contestRaw = await getSingle(
                `SELECT c.*, u.fullName as creatorName, u.role as creatorRole 
                 FROM contests c 
                 LEFT JOIN account_users u ON c.createdBy = u.id 
                 WHERE c.id = ?`, 
                [contestId]
            );

            if (!contestRaw) return res.status(404).send('Contest not found');
            const contest = normalizeContestRecord(contestRaw);

            // Fetch problems
            const problemIds = await getContestProblemIds(contest);
            let contestProblems = [];
            if (problemIds.length) {
                const placeholders = problemIds.map(() => '?').join(',');
                contestProblems = await runQuery(`SELECT * FROM problems WHERE id IN (${placeholders})`, problemIds);
            }

            // Leaderboard preview (top 5)
            const fullLeaderboard = await buildContestLeaderboard(contest);
            const leaderboardPreview = fullLeaderboard.slice(0, 5);

            res.render('faculty/contest_view.html', {
                user,
                contest,
                contestProblems,
                leaderboardPreview,
                backPath: '/faculty/contest',
                currentPage: 'contest'
            });
        } catch (error) {
            console.error('Contest View Error:', error);
            res.status(500).send(error.message);
        }
    });

    router.get('/contest/leaderboard/:id', requireRole(['faculty', 'hos', 'hod']), checkScope, async (req, res) => {
        const user = req.session.user;
        const contestId = req.params.id;

        try {
            const contestRaw = await getSingle(`SELECT * FROM contests WHERE id = ?`, [contestId]);
            if (!contestRaw) return res.status(404).send('Contest not found');
            const contest = normalizeContestRecord(contestRaw);

            const leaderboard = await buildContestLeaderboard(contest);

            // Summary stats
            const summary = {
                participants: leaderboard.length,
                submissions: (await getSingle(`SELECT COUNT(*) as count FROM submissions WHERE contest_id = ?`, [contestId])).count,
                totalSolved: leaderboard.reduce((acc, curr) => acc + curr.solved, 0),
                topScore: leaderboard.length ? leaderboard[0].score : 0
            };

            res.render('faculty/contest_leaderboard.html', {
                user,
                contest,
                leaderboard,
                summary,
                backPath: '/faculty/contest',
                currentPage: 'contest'
            });
        } catch (error) {
            console.error('Leaderboard View Error:', error);
            res.status(500).send(error.message);
        }
    });

    // Student Detail View for Faculty
    router.get('/view_student', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        res.render('faculty/view_student.html', { 
            currentPage: 'student', 
            queryId: req.query.id, 
            user: req.session.user 
        });
    });

    // Student Profile API for Faculty
    router.get('/api/student/public-profile/:id', requireRole(['faculty', 'hos', 'hod']), async (req, res) => {
        const studentId = req.params.id;
        const collegeName = req.session.user.collegeName;

        try {
            const student = await getSingle(`
                SELECT
                    id, fullName, email, department, branch, program, year, section, collegeName, role, status,
                    COALESCE(points, 0) as points,
                    COALESCE(solvedCount, 0) as solvedCount,
                    rank
                FROM account_users
                WHERE id = ? AND collegeName = ? AND role = 'student'
            `, [studentId, collegeName]);
            if (!student) return res.status(404).json({ success: false, message: "Student not found" });

            const rankRow = await getSingle(`
                SELECT COUNT(*) as cnt
                FROM account_users
                WHERE LOWER(COALESCE(role, '')) IN ('student', 'individual')
                  AND COALESCE(points, 0) > ?
            `, [Number(student.points || 0)]);

            const recentSubmissions = await runQuery(`
                SELECT
                    s.id,
                    COALESCE(p.title, 'Untitled Problem') as problemTitle,
                    COALESCE(p.difficulty, 'N/A') as difficulty,
                    COALESCE(s.language, 'N/A') as language,
                    COALESCE(s.status, 'pending') as status,
                    COALESCE(s.points_earned, 0) as pointsEarned,
                    COALESCE(s.createdAt, '') as createdAt
                FROM submissions s
                LEFT JOIN problems p ON p.id = s.problem_id
                WHERE s.user_id = ?
                ORDER BY datetime(COALESCE(s.createdAt, '1970-01-01')) DESC, s.id DESC
                LIMIT 5
            `, [studentId]);

            res.json({
                success: true,
                student: {
                    ...student,
                    rank: student.rank || `#${Number(rankRow?.cnt || 0) + 1}`
                },
                recentSubmissions
            });
        } catch (error) {
            console.error('Faculty student profile detail error:', error);
            res.status(500).json({ success: false, message: "Database error" });
        }
    });

    return router;
};
