const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

module.exports = (db) => {
    const router = express.Router();
    const pistonBaseUrl = process.env.PISTON_API_URL || 'http://127.0.0.1:2000';
    const runtimeCacheTtlMs = 60 * 1000;
    let runtimeCache = { fetchedAt: 0, runtimes: [] };

    // ==========================================
    // AUTH HELPERS
    // ==========================================
    const requireAuth = (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        next();
    };

    const requireSuperAdmin = (req, res, next) => {
        const user = req.session?.user || null;
        const role = String(user?.role || '').toLowerCase();
        const email = String(user?.email || '').toLowerCase();
        const isSuperByRole = role === 'superadmin';
        const isSuperByEmail = email === 'super@campuscode.com';
        if (!user || (!isSuperByRole && !isSuperByEmail)) {
            return res.status(403).json({ success: false, message: 'SuperAdmin access required' });
        }
        next();
    };

    const requireStudent = (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        next(); // Allow all logged-in users to submit code
    };

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

    // ==========================================
    // FILE UPLOAD SETUP (Multer)
    // ==========================================
    const storage = multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, '..', 'public', 'uploads', 'testcases', String(req.params.id));
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            cb(null, file.originalname); // Keep original filename: input1.txt, output1.txt etc.
        }
    });

    const upload = multer({
        storage,
        fileFilter: (req, file, cb) => {
            if (file.mimetype === 'text/plain' || file.originalname.endsWith('.txt')) {
                cb(null, true);
            } else {
                cb(new Error('Only .txt files allowed'));
            }
        }
    });
    // For form-based create/update payloads from superadmin page.
    const parseFormFields = multer().any();

    // ==========================================
    // PAGE ROUTES (Serve HTML Files)
    // ==========================================
    router.get('/student/problems', requireAuth, (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'views', 'student', 'problems.html'));
    });

    router.get('/student/problem/:id', requireAuth, (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'views', 'student', 'problem_page.html'));
    });

    router.get('/superadmin/problems', requireSuperAdmin, (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'views', 'superadmin', 'problem_manage.html'));
    });

    // ==========================================
    // 1. LIST PROBLEMS
    // ==========================================
    router.get('/list', requireAuth, (req, res) => {
        const { difficulty, search, status } = req.query;
        const userId = req.session.user.id;
        const userRole = String(req.session.user.role || '').toLowerCase();
        const userCollege = String(req.session.user.collegeName || '').trim();

        let query = `
            SELECT p.id, p.title, p.difficulty, p.tags, p.points, p.status,
                   CASE
                       WHEN LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin') THEN 'global'
                       ELSE 'college'
                   END as scope,
                   p.createdAt,
                   (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id AND s.user_id = ? AND LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac')) as solved,
                   (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id AND s.user_id = ?) as attempts,
                   (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id) as submissions
            FROM problems p
            LEFT JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id
            WHERE LOWER(COALESCE(p.status, '')) IN ('accepted', 'active')
        `;
        const params = [userId, userId];

        // Student visibility rules:
        // - Global problems: visible to all
        // - College problems: visible inside same college
        // - Department problems: visible inside same college + same department
        // Non-student roles can still query full accepted set via this endpoint.
        if (userRole === 'student') {
            query += `
                AND (
                    (LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin') AND LOWER(COALESCE(p.visibility_scope, p.scope, 'global')) = 'global')
                    OR (LOWER(COALESCE(u.role, '')) NOT IN ('superadmin', 'admin') AND COALESCE(u.collegeName, '') = ?)
                )
            `;
            params.push(userCollege);
        }

        if (difficulty && difficulty !== 'all') {
            query += ` AND LOWER(p.difficulty) = LOWER(?)`;
            params.push(difficulty);
        }

        if (search) {
            query += ` AND (p.title LIKE ? OR p.tags LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }

        query += ` ORDER BY p.createdAt DESC`;

        db.all(query, params, (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, problems: rows });
        });
    });

    // ==========================================
    // 2. GET SINGLE PROBLEM
    // ==========================================
    router.get('/:id', requireAuth, (req, res) => {
        const userId = req.session.user.id;
        const userRole = String(req.session.user.role || '').toLowerCase();
        const userCollege = String(req.session.user.collegeName || '').trim();

        let query = `
            SELECT p.*,
                   (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id AND s.user_id = ? AND LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac')) as solved
            FROM problems p
            LEFT JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id
            WHERE p.id = ?
        `;
        const params = [userId, req.params.id];

        if (userRole === 'student') {
            query += `
                AND LOWER(COALESCE(p.status, '')) IN ('accepted', 'active')
                AND (
                    (LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin') AND LOWER(COALESCE(p.visibility_scope, p.scope, 'global')) = 'global')
                    OR (LOWER(COALESCE(u.role, '')) NOT IN ('superadmin', 'admin') AND COALESCE(u.collegeName, '') = ?)
                )
            `;
            params.push(userCollege);
        }

        db.get(query, params, (err, row) => {
            if (err || !row) return res.status(404).json({ success: false, message: 'Problem not found' });

            // Don't expose hidden test cases to students
            if (req.session.user.role !== 'superadmin') {
                delete row.hidden_test_cases;
            }
            res.json({ success: true, problem: row });
        });
    });

    // ==========================================
    // 3. CREATE PROBLEM (SuperAdmin)
    // ==========================================
    router.post('/', requireSuperAdmin, parseFormFields, (req, res) => {
        const payload = req.body || {};
        const { title, difficulty, points, tags, description, input_format, output_format, constraints, sample_input, sample_output } = payload;
        const created_by = req.session.user.id;

        if (!title || !description) {
            return res.status(400).json({ success: false, message: 'Title and description are required' });
        }

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

        const calculatedPoints = points ? parseInt(points) : getPointsFromDifficulty(difficulty);

        db.run(`
            INSERT INTO problems (title, difficulty, points, tags, description, input_format, output_format, 
                                  constraints, sample_input, sample_output, status, scope, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'global', ?)
        `, [title, difficulty || 'Easy', calculatedPoints, tags || '', description, input_format || '', output_format || '', constraints || '', sample_input || '', sample_output || '', created_by],
            function (err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, message: 'Problem created', problem_id: this.lastID });
            });
    });

    // ==========================================
    // 4. UPDATE PROBLEM (SuperAdmin)
    // ==========================================
    router.put('/:id', requireSuperAdmin, parseFormFields, (req, res) => {
        const payload = req.body || {};
        const { title, difficulty, points, tags, description, input_format, output_format, constraints, sample_input, sample_output } = payload;

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

        const calculatedPoints = points ? parseInt(points) : getPointsFromDifficulty(difficulty);

        db.run(`
            UPDATE problems SET title=?, difficulty=?, points=?, tags=?, description=?, 
            input_format=?, output_format=?, constraints=?, sample_input=?, sample_output=?
            WHERE id=?
        `, [title, difficulty, calculatedPoints, tags || '', description, input_format, output_format, constraints, sample_input, sample_output, req.params.id],
            function (err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (this.changes === 0) return res.status(404).json({ success: false, message: 'Problem not found' });
                res.json({ success: true, message: 'Problem updated' });
            });
    });

    // ==========================================
    // 5. DELETE PROBLEM (SuperAdmin)
    // ==========================================
    router.delete('/:id', requireSuperAdmin, (req, res) => {
        db.run(`DELETE FROM problems WHERE id = ?`, [req.params.id], function (err) {
            if (err) return res.status(500).json({ success: false, error: err.message });

            // Also delete test case files
            const tcDir = path.join(__dirname, '..', 'public', 'uploads', 'testcases', String(req.params.id));
            if (fs.existsSync(tcDir)) {
                fs.rmSync(tcDir, { recursive: true, force: true });
            }

            res.json({ success: true, message: 'Problem deleted' });
        });
    });

    // ==========================================
    // 6. UPLOAD HIDDEN TEST CASES (SuperAdmin)
    // ==========================================
    router.post('/:id/upload-testcases', requireSuperAdmin, upload.array('testcases', 50), (req, res) => {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ success: false, message: 'No files uploaded' });
        }

        const tcDir = path.join(__dirname, '..', 'public', 'uploads', 'testcases', String(req.params.id));

        // Scan directory for input/output pairs
        const files = fs.readdirSync(tcDir);
        const inputFiles = files.filter(f => f.startsWith('input') && f.endsWith('.txt'));
        const pairs = inputFiles.map(f => {
            const num = f.replace('input', '').replace('.txt', '');
            return { input: f, output: `output${num}.txt` };
        }).filter(p => files.includes(p.output));

        // Store test case metadata in problem
        db.run(`UPDATE problems SET hidden_test_cases = ? WHERE id = ?`,
            [JSON.stringify(pairs), req.params.id],
            (err) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, message: `Uploaded ${req.files.length} files, ${pairs.length} test case pairs registered`, pairs });
            }
        );
    });

    // ==========================================
    // 7. GET TEST CASES LIST (SuperAdmin)
    // ==========================================
    router.get('/:id/testcases', requireSuperAdmin, (req, res) => {
        const tcDir = path.join(__dirname, '..', 'public', 'uploads', 'testcases', String(req.params.id));
        if (!fs.existsSync(tcDir)) {
            return res.json({ success: true, files: [], pairs: [] });
        }
        const files = fs.readdirSync(tcDir);
        const inputFiles = files.filter(f => f.startsWith('input') && f.endsWith('.txt'));
        const pairs = inputFiles.map(f => {
            const num = f.replace('input', '').replace('.txt', '');
            return { input: f, output: `output${num}.txt`, hasOutput: files.includes(`output${num}.txt`) };
        });
        res.json({ success: true, files, pairs });
    });

    // ==========================================
    // 8. DELETE A TEST CASE PAIR (SuperAdmin)
    // ==========================================
    router.delete('/:id/testcases/:filename', requireSuperAdmin, (req, res) => {
        const tcDir = path.join(__dirname, '..', 'public', 'uploads', 'testcases', String(req.params.id));
        const filename = req.params.filename;
        // Only allow safe filenames
        if (!/^(input|output)\d+\.txt$/.test(filename)) {
            return res.status(400).json({ success: false, message: 'Invalid filename' });
        }
        const filePath = path.join(tcDir, filename);
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // ==========================================
    // 9. GET ALL PROBLEMS (SuperAdmin Dashboard)
    // ==========================================
    router.get('/', requireSuperAdmin, (req, res) => {
        const primaryQuery = `SELECT p.*, 
                       (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id) as submission_count,
                       (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id AND s.status = 'accepted') as accepted_count
                FROM problems p
                LEFT JOIN account_users u ON COALESCE(p.created_by, p.faculty_id) = u.id
                WHERE LOWER(COALESCE(p.visibility_scope, p.scope, 'college')) = 'global'
                  AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin')
                ORDER BY p.createdAt DESC`;

        const fallbackQuery = `SELECT p.*, 
                       (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id) as submission_count,
                       (SELECT COUNT(*) FROM submissions s WHERE s.problem_id = p.id AND s.status = 'accepted') as accepted_count
                FROM problems p
                LEFT JOIN account_users u ON COALESCE(p.created_by, p.faculty_id) = u.id
                WHERE LOWER(COALESCE(p.scope, 'college')) = 'global'
                  AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin')
                ORDER BY p.createdAt DESC`;

        db.all(primaryQuery, [], (err, rows) => {
            if (!err) return res.json({ success: true, problems: rows });

            // Backward-compatible fallback for older DB schemas lacking visibility_scope.
            if (/no such column:.*visibility_scope/i.test(String(err.message || ''))) {
                return db.all(fallbackQuery, [], (fallbackErr, fallbackRows) => {
                    if (fallbackErr) return res.status(500).json({ success: false, error: fallbackErr.message });
                    return res.json({ success: true, problems: fallbackRows });
                });
            }

            return res.status(500).json({ success: false, error: err.message });
        });
    });

    // ==========================================
    // 10. RUN CODE (Sample Input)
    // ==========================================
    router.post('/:id/run', requireStudent, (req, res) => {
        const { code, language } = req.body;

        db.get(`SELECT sample_input FROM problems WHERE id = ?`, [req.params.id], (err, problem) => {
            if (err || !problem) return res.status(404).json({ success: false, message: 'Problem not found' });

            pistonExecute(language, code, problem.sample_input || '')
                .then(result => {
                    res.json({ success: true, output: result.output, stderr: result.stderr, exitCode: result.exitCode });
                })
                .catch(err => {
                    const msg = String(err?.message || '');
                    const executorOffline = /ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|timeout/i.test(msg);
                    if (executorOffline) {
                        return res.status(503).json({
                            success: false,
                            message: 'Code runner is offline. Please start the executor service on port 2000.',
                            error: msg
                        });
                    }
                    if (/Executor returned HTTP/i.test(msg)) {
                        return res.status(400).json({
                            success: false,
                            message: 'Code runner rejected this request. Please verify language/runtime support.',
                            error: msg
                        });
                    }
                    res.status(500).json({ success: false, message: 'Code execution failed', error: msg || 'Unknown executor error' });
                });
        });
    });

    // ==========================================
    // 11. SUBMIT CODE (Hidden Test Cases)
    // ==========================================
    router.post('/:id/submit', requireStudent, async (req, res) => {
        const { code, language } = req.body;
        const userId = req.session.user.id;
        const problemId = req.params.id;
        const rawContestId = req.body?.contestId ?? req.query?.contestId;
        const contestId = rawContestId ? Number(rawContestId) : null;

        if (rawContestId && (!Number.isInteger(contestId) || contestId <= 0)) {
            return res.status(400).json({ success: false, message: 'Invalid contest id.' });
        }

        // Get problem + hidden test cases
        db.get(`SELECT * FROM problems WHERE id = ?`, [problemId], async (err, problem) => {
            if (err || !problem) return res.status(404).json({ success: false, message: 'Problem not found' });

            if (contestId) {
                const contest = await new Promise((resolve, reject) => {
                    db.get(`SELECT id, title, status, problems, is_live, live_mode, live_user_ids FROM contests WHERE id = ?`, [contestId], (dbErr, row) => {
                        if (dbErr) return reject(dbErr);
                        resolve(row);
                    });
                }).catch(() => null);

                if (!contest) {
                    return res.status(404).json({ success: false, message: 'Contest not found.' });
                }
                if (contest.status !== 'accepted') {
                    return res.status(403).json({ success: false, message: 'Contest is not published for participation.' });
                }
                const liveMode = String(contest.live_mode || 'all_students').toLowerCase();
                const isLive = Number(contest.is_live ?? 0) === 1;
                if (!isLive && liveMode === 'manual_hold') {
                    return res.status(403).json({ success: false, message: 'Contest is not live yet.' });
                }
                if (!isLive && liveMode === 'selected_users') {
                    return res.status(403).json({ success: false, message: 'Contest is not live yet.' });
                }
                if (liveMode === 'selected_users') {
                    let allowedUserIds = [];
                    try {
                        const parsed = JSON.parse(contest.live_user_ids || '[]');
                        allowedUserIds = Array.isArray(parsed) ? parsed.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0) : [];
                    } catch {
                        allowedUserIds = [];
                    }
                    if (!allowedUserIds.includes(Number(userId))) {
                        return res.status(403).json({ success: false, message: 'You are not in the allowed audience for this contest.' });
                    }
                }

                let contestProblemIds = parseContestProblemIds(contest.problems);
                if (!contestProblemIds.length) {
                    contestProblemIds = await new Promise((resolve) => {
                        db.all(`SELECT problem_id FROM contest_problems WHERE contest_id = ?`, [contestId], (cpErr, rows) => {
                            if (cpErr) return resolve([]);
                            resolve((rows || []).map((r) => Number(r.problem_id)).filter((id) => Number.isInteger(id) && id > 0));
                        });
                    });
                }
                if (!contestProblemIds.includes(Number(problemId))) {
                    return res.status(403).json({ success: false, message: 'This problem is not part of the selected contest.' });
                }

                const participation = await new Promise((resolve) => {
                    db.get(`SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?`, [contestId, userId], (pErr, row) => {
                        if (pErr) return resolve(null);
                        resolve(row || null);
                    });
                });
                if (!participation) {
                    return res.status(403).json({ success: false, message: 'Please join the contest before submitting.' });
                }
            }

            // Load hidden test case pairs
            const tcDir = path.join(__dirname, '..', 'public', 'uploads', 'testcases', String(problemId));
            let pairs = [];

            try {
                const storedPairs = problem.hidden_test_cases ? JSON.parse(problem.hidden_test_cases) : [];
                pairs = storedPairs.filter(p => {
                    return fs.existsSync(path.join(tcDir, p.input)) && fs.existsSync(path.join(tcDir, p.output));
                });
            } catch (_) { }

            // If no hidden test cases, fall back to sample
            if (pairs.length === 0) {
                if (problem.sample_input && problem.sample_output) {
                    pairs = [{ input: '__sample__', output: '__sample__' }];
                } else {
                    return res.status(400).json({ success: false, message: 'No test cases available for this problem' });
                }
            }

            const results = [];
            let allPassed = true;

            for (let i = 0; i < pairs.length; i++) {
                const pair = pairs[i];
                let input, expectedOutput;

                if (pair.input === '__sample__') {
                    input = problem.sample_input;
                    expectedOutput = problem.sample_output;
                } else {
                    input = fs.readFileSync(path.join(tcDir, pair.input), 'utf8');
                    expectedOutput = fs.readFileSync(path.join(tcDir, pair.output), 'utf8');
                }

                try {
                    const execResult = await pistonExecute(language, code, input);

                    // Normalize outputs for comparison (trim + normalize newlines)
                    const normalizedActual = (execResult.output || '').trim().replace(/\r\n/g, '\n');
                    const normalizedExpected = expectedOutput.trim().replace(/\r\n/g, '\n');
                    const passed = normalizedActual === normalizedExpected && !execResult.exitCode;

                    if (!passed) allPassed = false;

                    results.push({
                        testCase: i + 1,
                        passed,
                        input: pair.input === '__sample__' ? input : `Test Case ${i + 1}`,
                        expected: normalizedExpected,
                        actual: normalizedActual,
                        stderr: execResult.stderr || '',
                        exitCode: execResult.exitCode
                    });
                } catch (execErr) {
                    allPassed = false;
                    results.push({ testCase: i + 1, passed: false, error: execErr.message });
                }
            }

            const finalStatus = allPassed ? 'accepted' : 'wrong_answer';
            const pointsEarned = allPassed ? (problem.points || 50) : 0;

            // Save submission
            db.run(`INSERT INTO submissions (problem_id, contest_id, user_id, language, code, status, result_details, points_earned)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [problemId, contestId, userId, language, code, finalStatus, JSON.stringify(results), pointsEarned],
                function (insertErr) {
                    if (insertErr) console.error('Submission insert error:', insertErr.message);

                    // If accepted, update user XP (only if not solved before)
                    if (allPassed) {
                        db.get(`SELECT COUNT(*) as cnt FROM submissions WHERE problem_id = ? AND user_id = ? AND status = 'accepted' AND id != ?`,
                            [problemId, userId, this.lastID],
                            (_, row) => {
                                if (row && row.cnt === 0) {
                                    // First time solving — award XP
                                    db.run(`UPDATE account_users SET points = points + ?, solvedCount = solvedCount + 1 WHERE id = ?`,
                                        [pointsEarned, userId]);
                                }
                            }
                        );
                    }

                    res.json({
                        success: true,
                        status: finalStatus,
                        passed: results.filter(r => r.passed).length,
                        total: results.length,
                        pointsEarned,
                        results
                    });
                }
            );
        });
    });

    // ==========================================
    // 12. SUBMISSION HISTORY (Student's own)
    // ==========================================
    router.get('/:id/submissions', requireAuth, (req, res) => {
        const userId = req.session.user.id;
        db.all(`SELECT id, language, status, points_earned, createdAt FROM submissions WHERE problem_id = ? AND user_id = ? ORDER BY createdAt DESC LIMIT 20`,
            [req.params.id, userId],
            (err, rows) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, submissions: rows });
            }
        );
    });

    // ==========================================
    // 13. ALL SUBMISSIONS FOR A PROBLEM (SuperAdmin)
    // ==========================================
    router.get('/:id/all-submissions', requireSuperAdmin, (req, res) => {
        db.all(`SELECT s.*, u.fullName, u.email, u.collegeName FROM submissions s 
                JOIN account_users u ON s.user_id = u.id WHERE s.problem_id = ? ORDER BY s.createdAt DESC`,
            [req.params.id],
            (err, rows) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, submissions: rows });
            }
        );
    });

    // ==========================================
    // PISTON API HELPER
    // ==========================================
    function runPythonLocally(code, stdin = '') {
        return new Promise((resolve, reject) => {
            const child = spawn('python', ['-c', code], { stdio: ['pipe', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            let finished = false;

            const timer = setTimeout(() => {
                if (finished) return;
                finished = true;
                child.kill('SIGKILL');
                reject(new Error('Local Python execution timeout'));
            }, 12000);

            child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

            child.on('error', (err) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                reject(err);
            });

            child.on('close', (code) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                resolve({
                    output: stdout,
                    stderr: stderr.trim(),
                    exitCode: typeof code === 'number' ? code : 1
                });
            });

            try {
                child.stdin.write(String(stdin || ''));
            } catch (e) {
                // Ignore stdin write errors and continue collecting process output.
            }
            child.stdin.end();
        });
    }

    function runLocalProcess(command, args = [], { cwd, stdin = '', timeoutMs = 12000 } = {}) {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
            let stdout = '';
            let stderr = '';
            let finished = false;

            const timer = setTimeout(() => {
                if (finished) return;
                finished = true;
                child.kill('SIGKILL');
                reject(new Error(`${command} execution timeout`));
            }, timeoutMs);

            child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
            child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

            child.on('error', (err) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                reject(err);
            });

            child.on('close', (code) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                resolve({
                    stdout,
                    stderr,
                    exitCode: typeof code === 'number' ? code : 1
                });
            });

            try {
                child.stdin.write(String(stdin || ''));
            } catch (_) {}
            child.stdin.end();
        });
    }

    function createTempExecutionDir() {
        return fs.mkdtempSync(path.join(os.tmpdir(), 'campuscode-'));
    }

    async function runCppLocally(code, stdin = '') {
        const tempDir = createTempExecutionDir();
        const sourceFile = path.join(tempDir, 'main.cpp');
        const binaryFile = path.join(tempDir, process.platform === 'win32' ? 'main.exe' : 'main');
        try {
            fs.writeFileSync(sourceFile, String(code || ''), 'utf8');
            const compile = await runLocalProcess('g++', [sourceFile, '-O2', '-std=c++17', '-o', binaryFile], { cwd: tempDir, timeoutMs: 15000 });
            if (compile.exitCode !== 0) {
                return { output: '', stderr: (compile.stderr || compile.stdout || '').trim(), exitCode: compile.exitCode };
            }
            const run = await runLocalProcess(binaryFile, [], { cwd: tempDir, stdin, timeoutMs: 12000 });
            return { output: run.stdout, stderr: (run.stderr || '').trim(), exitCode: run.exitCode };
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    async function runCLocally(code, stdin = '') {
        const tempDir = createTempExecutionDir();
        const sourceFile = path.join(tempDir, 'main.c');
        const binaryFile = path.join(tempDir, process.platform === 'win32' ? 'main.exe' : 'main');
        try {
            fs.writeFileSync(sourceFile, String(code || ''), 'utf8');
            const compile = await runLocalProcess('gcc', [sourceFile, '-O2', '-std=c11', '-o', binaryFile], { cwd: tempDir, timeoutMs: 15000 });
            if (compile.exitCode !== 0) {
                return { output: '', stderr: (compile.stderr || compile.stdout || '').trim(), exitCode: compile.exitCode };
            }
            const run = await runLocalProcess(binaryFile, [], { cwd: tempDir, stdin, timeoutMs: 12000 });
            return { output: run.stdout, stderr: (run.stderr || '').trim(), exitCode: run.exitCode };
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    async function runJavaLocally(code, stdin = '') {
        const tempDir = createTempExecutionDir();
        const sourceFile = path.join(tempDir, 'Main.java');
        try {
            fs.writeFileSync(sourceFile, String(code || ''), 'utf8');
            const compile = await runLocalProcess('javac', ['Main.java'], { cwd: tempDir, timeoutMs: 18000 });
            if (compile.exitCode !== 0) {
                return { output: '', stderr: (compile.stderr || compile.stdout || '').trim(), exitCode: compile.exitCode };
            }
            const run = await runLocalProcess('java', ['-cp', tempDir, 'Main'], { cwd: tempDir, stdin, timeoutMs: 15000 });
            return { output: run.stdout, stderr: (run.stderr || '').trim(), exitCode: run.exitCode };
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    function pistonExecute(language, code, stdin = '') {
        const langMap = {
            'python': { aliases: ['python', 'py'], fallback: { language: 'python', version: '3.10.0' }, fileName: 'main.py' },
            'cpp': { aliases: ['c++', 'cpp'], fallback: { language: 'c++', version: '10.2.0' }, fileName: 'main.cpp' },
            'c': { aliases: ['c'], fallback: { language: 'c', version: '10.2.0' }, fileName: 'main.c' },
            'java': { aliases: ['java'], fallback: { language: 'java', version: '15.0.2' }, fileName: 'Main.java' }
        };

        const requestedLang = String(language || 'python').toLowerCase();
        const lang = langMap[requestedLang] || langMap['python'];

        const executeViaPiston = async () => {
            const runtime = await resolveRuntimeForLanguage(lang);
            const payload = {
                language: runtime.language,
                version: runtime.version,
                files: [{ name: lang.fileName, content: code }],
                stdin: stdin,
                run_timeout: 3000
            };

            const parsed = await pistonRequest('POST', '/api/v2/execute', payload);
            const compile = parsed.compile || {};
            const run = parsed.run || {};
            const stdout = typeof run.stdout === 'string'
                ? run.stdout
                : (typeof run.output === 'string' ? run.output : '');
            const stderrParts = [
                typeof compile.stderr === 'string' ? compile.stderr : '',
                typeof run.stderr === 'string' ? run.stderr : ''
            ].filter(Boolean);

            return {
                output: stdout,
                stderr: stderrParts.join('\n').trim(),
                exitCode: typeof run.code === 'number' ? run.code : 0
            };
        };

        return executeViaPiston().catch(async (err) => {
            const msg = String(err?.message || '');
            const runnerUnavailable = /ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|timeout|Failed to parse Piston response|Executor returned HTTP 5/i.test(msg);
            const localFallbackRunner = {
                python: runPythonLocally,
                cpp: runCppLocally,
                c: runCLocally,
                java: runJavaLocally
            }[requestedLang];

            if (localFallbackRunner && runnerUnavailable) {
                try {
                    return await localFallbackRunner(code, stdin);
                } catch (localErr) {
                    const languageLabel = requestedLang.toUpperCase();
                    throw new Error(`Piston unavailable and local ${languageLabel} execution failed: ${localErr.message}`);
                }
            }
            throw err;
        });
    }

    async function resolveRuntimeForLanguage(langConfig) {
        const runtimes = await fetchRuntimes();
        if (!Array.isArray(runtimes) || runtimes.length === 0) {
            return langConfig.fallback;
        }

        const aliasSet = new Set(langConfig.aliases.map((a) => String(a || '').toLowerCase()));
        const match = runtimes.find((runtime) => {
            const runtimeLanguage = String(runtime?.language || '').toLowerCase();
            const runtimeAliases = Array.isArray(runtime?.aliases)
                ? runtime.aliases.map((a) => String(a || '').toLowerCase())
                : [];
            if (aliasSet.has(runtimeLanguage)) return true;
            return runtimeAliases.some((a) => aliasSet.has(a));
        });

        if (!match) return langConfig.fallback;
        return {
            language: match.language || langConfig.fallback.language,
            version: match.version || langConfig.fallback.version
        };
    }

    async function fetchRuntimes() {
        const now = Date.now();
        if (now - runtimeCache.fetchedAt < runtimeCacheTtlMs && runtimeCache.runtimes.length > 0) {
            return runtimeCache.runtimes;
        }
        const runtimes = await pistonRequest('GET', '/api/v2/runtimes');
        runtimeCache = {
            fetchedAt: now,
            runtimes: Array.isArray(runtimes) ? runtimes : []
        };
        return runtimeCache.runtimes;
    }

    function pistonRequest(method, pathName, bodyObj) {
        return new Promise((resolve, reject) => {
            let base;
            try {
                base = new URL(pistonBaseUrl);
            } catch (_) {
                return reject(new Error(`Invalid PISTON_API_URL: ${pistonBaseUrl}`));
            }

            const requestPayload = bodyObj ? JSON.stringify(bodyObj) : '';
            const reqModule = base.protocol === 'https:' ? https : http;
            const options = {
                protocol: base.protocol,
                hostname: base.hostname,
                port: base.port || (base.protocol === 'https:' ? 443 : 80),
                path: `${pathName.startsWith('/') ? '' : '/'}${pathName}`,
                method,
                headers: bodyObj ? {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestPayload)
                } : {}
            };

            const reqHttp = reqModule.request(options, (apiRes) => {
                let data = '';
                apiRes.on('data', (chunk) => { data += chunk; });
                apiRes.on('end', () => {
                    if (apiRes.statusCode && apiRes.statusCode >= 400) {
                        return reject(new Error(`Executor returned HTTP ${apiRes.statusCode}: ${String(data || '').slice(0, 240)}`));
                    }
                    try {
                        const parsed = data ? JSON.parse(data) : {};
                        resolve(parsed);
                    } catch (_) {
                        reject(new Error(`Failed to parse Piston response: ${String(data || '').slice(0, 240)}`));
                    }
                });
            });

            reqHttp.on('error', reject);
            reqHttp.setTimeout(15000, () => {
                reqHttp.destroy();
                reject(new Error('Piston API timeout'));
            });

            if (bodyObj) reqHttp.write(requestPayload);
            reqHttp.end();
        });
    }

    return router;
};
