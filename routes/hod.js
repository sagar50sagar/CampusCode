const express = require('express');
const { requireRole } = require('../middleware/auth');
const { checkScope } = require('../middleware/authMiddleware');

module.exports = (db) => {
    const router = express.Router();
    const normalizeSql = (expr) => `
        LOWER(
            REPLACE(
                REPLACE(
                    REPLACE(
                        REPLACE(
                            REPLACE(TRIM(${expr}), ' ', ''),
                        '&', ''),
                    '-', ''),
                '_', ''),
            '/', '')
        )
    `;

    // Helper: Convert Semester to Year
    const semToYear = (sem) => {
        if (sem <= 2) return '1st Year';
        if (sem <= 4) return '2nd Year';
        if (sem <= 6) return '3rd Year';
        return '4th Year';
    };

    const computeDurationFromRange = (startDate, endDate) => {
        const start = new Date(startDate);
        const end = new Date(endDate);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
        const totalMinutes = Math.floor((end.getTime() - start.getTime()) / 60000);
        if (totalMinutes < 60) return `${totalMinutes} mins`;
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
    };

    const getUsersManagedByHod = (hodId, collegeName) => {
        return new Promise((resolve, reject) => {
            db.all(
                `SELECT DISTINCT ua.user_id
                 FROM faculty_assignments ua
                 JOIN account_users u ON u.id = ua.user_id
                 WHERE ua.assigned_by_id = ?
                   AND (COALESCE(ua.collegeName, '') = ? OR COALESCE(u.collegeName, '') = ?)
                   AND LOWER(COALESCE(u.role, '')) IN ('faculty', 'hos')`,
                [hodId, collegeName, collegeName],
                (err, rows) => {
                    if (err) return reject(err);
                    resolve((rows || []).map((row) => row.user_id));
                }
            );
        });
    };

    const deriveEndDateFromDuration = (startDate, durationText) => {
        const start = new Date(startDate);
        if (Number.isNaN(start.getTime()) || !durationText) return null;
        const raw = String(durationText).toLowerCase().trim();
        const hourMatch = raw.match(/(\d+)\s*h/);
        const minuteMatch = raw.match(/(\d+)\s*m/);
        const minsMatch = raw.match(/(\d+)\s*min/);
        const numberOnly = raw.match(/^(\d+)$/);
        let totalMinutes = 0;
        if (hourMatch) totalMinutes += Number(hourMatch[1]) * 60;
        if (minuteMatch) totalMinutes += Number(minuteMatch[1]);
        if (!hourMatch && minsMatch) totalMinutes += Number(minsMatch[1]);
        if (!hourMatch && !minuteMatch && !minsMatch && numberOnly) totalMinutes += Number(numberOnly[1]);
        if (!totalMinutes) return null;
        return new Date(start.getTime() + totalMinutes * 60000).toISOString();
    };

    const normalizeContestRecord = (contest) => ({
        ...contest,
        startTime: contest.startTime || contest.startDate || contest.date || null,
        endTime: contest.endTime || contest.endDate || null,
        deadline: contest.deadline || contest.registrationEndDate || null,
        date: contest.date || contest.startDate || contest.startTime || null
    });

    const resolveTeacherForCollege = (rawId, collegeName, emailHint, cb) => {
        const teacherId = Number(rawId);
        const safeEmailHint = String(emailHint || '').trim();

        const resolveByEmailHint = () => {
            if (!safeEmailHint) return cb(null, null);
            db.get(
                `SELECT id, fullName, email, role, department, branch
                 FROM account_users
                 WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(?))
                   AND ${normalizeSql(`COALESCE(collegeName, '')`)} = ${normalizeSql(`?`)}
                 LIMIT 1`,
                [safeEmailHint, collegeName],
                (mailErr, mailRow) => {
                    if (mailErr) return cb(mailErr);
                    return cb(null, mailRow || null);
                }
            );
        };

        if (!Number.isFinite(teacherId) || teacherId <= 0) return resolveByEmailHint();

        db.get(
            `SELECT id, fullName, email, role, department, branch
             FROM account_users
             WHERE id = ?
               AND ${normalizeSql(`COALESCE(collegeName, '')`)} = ${normalizeSql(`?`)}`,
            [teacherId, collegeName],
            (err, accountRow) => {
                if (err) return cb(err);
                if (accountRow) return cb(null, accountRow);

                db.get(
                    `SELECT id, fullName, email, role, department, branch
                     FROM faculty
                     WHERE id = ?
                       AND ${normalizeSql(`COALESCE(collegeName, '')`)} = ${normalizeSql(`?`)}`,
                    [teacherId, collegeName],
                    (fallbackErr, facultyRow) => {
                        if (fallbackErr) return cb(fallbackErr);
                        if (!facultyRow) return resolveByEmailHint();

                        const facultyEmail = String(facultyRow.email || '').trim();
                        if (!facultyEmail) return resolveByEmailHint();

                        db.get(
                            `SELECT id, fullName, email, role, department, branch
                             FROM account_users
                             WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(?))
                               AND ${normalizeSql(`COALESCE(collegeName, '')`)} = ${normalizeSql(`?`)}
                             LIMIT 1`,
                            [facultyEmail, collegeName],
                            (mapErr, mappedAccountRow) => {
                                if (mapErr) return cb(mapErr);
                                if (mappedAccountRow) return cb(null, mappedAccountRow);
                                return resolveByEmailHint();
                            }
                        );
                    }
                );
            }
        );
    };

    // HOD: Assign Role (HOS or Faculty) within their own department
    router.post('/hod/assign-role', requireRole('hod'), (req, res) => {
        const { targetUserId, newRole, subject } = req.body;
        const collegeName = req.session.user.collegeName;

        if (!['hos', 'faculty'].includes(newRole)) {
            return res.status(400).json({ success: false, error: "Invalid role. HODs can only assign 'hos' or 'faculty'." });
        }

        if (newRole === 'hos' && (!subject || subject.trim() === '')) {
            return res.status(400).json({ success: false, error: "A subject must be selected to promote a teacher to HOS." });
        }

        resolveTeacherForCollege(targetUserId, collegeName, '', (err, resolvedTeacher) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (!resolvedTeacher) return res.status(404).json({ success: false, error: "Faculty not found in your college." });
                if (['student', 'superadmin', 'admin'].includes(String(resolvedTeacher.role || '').toLowerCase())) {
                    return res.status(400).json({ success: false, error: "Only faculty/hos can be promoted here." });
                }

                db.get(`SELECT is_hod FROM account_users WHERE id = ? LIMIT 1`, [resolvedTeacher.id], (chkErr, roleRow) => {
                    if (chkErr) return res.status(500).json({ success: false, error: chkErr.message });
                    if (Number(roleRow?.is_hod || 0) === 1) {
                        return res.status(403).json({ success: false, error: "This user is assigned as HOD. Change HOD only from Admin panel." });
                    }

                const roleSubject = newRole === 'hos' ? subject : '';
                db.run(
                    `UPDATE account_users 
                     SET role = ?, 
                         subject = ?, 
                         post = CASE 
                                   WHEN ? = 'hos' THEN 'HOS'
                                   WHEN ? = 'faculty' AND LOWER(COALESCE(post, '')) = 'hos' THEN 'Faculty Member'
                                   ELSE post
                                END
                     WHERE id = ?`,
                    [newRole, roleSubject, newRole, newRole, resolvedTeacher.id],
                    function(err) {
                    if (err) {
                        if (err.message.includes('UNIQUE constraint failed')) {
                            return res.status(400).json({ success: false, error: `Constraint Violated: This subject already has an HOS.` });
                        }
                        return res.status(500).json({ success: false, error: err.message });
                    }
                    
                    // Auto-Assignment for HOS
                    if (newRole === 'hos') {
                        const masterPoolQuery = `
                            SELECT DISTINCT sec.semester, sec.name as sectionName
                            FROM subjects s
                            JOIN sections sec ON s.section_id = sec.id
                            WHERE s.name = ? AND s.collegeName = ?
                        `;
                        db.all(masterPoolQuery, [subject, collegeName], (err, rows) => {
                            if (!err && rows && rows.length > 0) {
                                rows.forEach(row => {
                                    const year = semToYear(row.semester);
                                    db.run(`INSERT OR IGNORE INTO faculty_assignments (user_id, subject, year, section, assigned_by_id, collegeName) VALUES (?, ?, ?, ?, ?, ?)`,
                                        [resolvedTeacher.id, subject, year, row.sectionName, req.session.user.id, collegeName]);
                                });
                            }
                        });
                    }

                    res.json({ success: true, message: `Role updated to ${newRole} for ${newRole === 'hos' ? subject : 'teaching'} successfully.` });
                });
                });
            });
    });

    // HOD: Global Teacher Search & Profile View
    router.get('/hod/view-profile/:id', requireRole('hod'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.get(`SELECT id, fullName, email, role, department, mobile, post FROM account_users WHERE id = ? AND collegeName = ?`, 
            [req.params.id, collegeName], (err, row) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (!row) return res.status(404).json({ success: false, error: "Teacher not found." });
                res.json({ success: true, profile: row });
            });
    });


    // HOD: 100% Dynamic Oversight Dashboard
    router.get('/hod/dashboard-data', requireRole('hod'), (req, res) => {
        const hodDept = req.session.user.department;
        const collegeName = req.session.user.collegeName;

        const data = {};
        
        // Fetch Pending Questions from Department
        db.all(`SELECT p.*, u.fullName as facultyName, u.role as creatorRole 
                FROM problems p 
                JOIN account_users u ON p.faculty_id = u.id 
                WHERE u.department = ? AND p.status = 'pending' AND u.collegeName = ?`, 
            [hodDept, collegeName], (err, problems) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                data.pendingQuestions = problems;

                // Fetch Pending Contests from Department
                db.all(`SELECT c.*, u.fullName as creatorName 
                        FROM contests c 
                        JOIN account_users u ON c.createdBy = u.id 
                        WHERE u.department = ? AND c.status = 'pending' AND u.collegeName = ?`, 
                    [hodDept, collegeName], (err, contests) => {
                        if (err) return res.status(500).json({ success: false, error: err.message });
                        data.pendingContests = contests;

                        // Fetch college-wide teachers for HOD (faculty + HOS, excluding HOD rows)
                        db.all(`
                            SELECT id, fullName, email, role, post
                            FROM account_users
                            WHERE ${normalizeSql(`COALESCE(collegeName, '')`)} = ${normalizeSql(`?`)}
                              AND LOWER(COALESCE(role, '')) IN ('faculty', 'hos')
                              AND (is_hod = 0 OR is_hod IS NULL)
                        `,
                            [collegeName], (err, faculty) => {
                                if (err) return res.status(500).json({ success: false, error: err.message });
                                data.departmentFaculty = faculty;

                                db.all(
                                    `SELECT id, fullName, email, year, section
                                     FROM account_users
                                     WHERE role = 'student'
                                       AND ${normalizeSql(`COALESCE(NULLIF(department, ''), NULLIF(branch, ''), '')`)} = ${normalizeSql(`?`)}
                                       AND ${normalizeSql(`COALESCE(collegeName, '')`)} = ${normalizeSql(`?`)}`,
                                    [hodDept, collegeName],
                                    (studentErr, students) => {
                                        if (studentErr) return res.status(500).json({ success: false, error: studentErr.message });
                                        data.students = students || [];
                                        res.json({ success: true, data });
                                    }
                                );
                            });
                    });
            });
    });

    // Unified HOD Dashboard
    router.get('/hod/dashboard', requireRole('hod'), checkScope, (req, res) => {
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        // Statistics
        const statsQuery = `
            SELECT 
                (SELECT COUNT(*) FROM account_users WHERE role IN ('faculty','hos') AND collegeName = ?) as facultyCount,
                (SELECT COUNT(*) FROM account_users WHERE role = 'student' AND department = ? AND collegeName = ?) as studentCount,
                (SELECT COUNT(*) FROM problems WHERE department = ? AND status = 'pending') as pendingQuestionsCount,
                (SELECT COUNT(*) FROM contests WHERE department = ? AND status = 'pending') as pendingContestsCount
        `;

        // Recently Pending Items
        const questionsQuery = `SELECT * FROM problems WHERE department = ? AND status = 'pending' ORDER BY id DESC LIMIT 5`;
        const contestsQuery  = `SELECT * FROM contests WHERE department = ? AND status = 'pending' ORDER BY id DESC LIMIT 5`;

        // Chart 1: Difficulty Spread
        const difficultyQuery = `
            SELECT difficulty, COUNT(*) as count
            FROM problems
            WHERE department = ?
            GROUP BY difficulty
        `;

        // Chart 2: Participation Trend (problems created per month, last 6 months)
        const trendQuery = `
            SELECT strftime('%m', createdAt) as month, COUNT(*) as count
            FROM problems
            WHERE department = ?
              AND createdAt >= date('now', '-6 months')
            GROUP BY month
            ORDER BY month ASC
        `;

        db.get(statsQuery, [college, dept, college, dept, dept], (err, stats) => {
            if (err) return res.status(500).send(err.message);

            db.all(questionsQuery, [dept], (err, pendingQuestions) => {
                if (err) return res.status(500).send(err.message);

                db.all(contestsQuery, [dept], (err, pendingContests) => {
                    if (err) return res.status(500).send(err.message);

                    db.all(difficultyQuery, [dept], (err, diffRows) => {
                        if (err) return res.status(500).send(err.message);

                        db.all(trendQuery, [dept], (err, trendRows) => {
                            if (err) return res.status(500).send(err.message);

                            // Build difficulty spread object
                            const difficultySpread = { Easy: 0, Medium: 0, Hard: 0 };
                            diffRows.forEach(r => {
                                if (r.difficulty in difficultySpread) difficultySpread[r.difficulty] = r.count;
                            });

                            // Build participation trend — fill in all 6 months with zeroes
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

                            const graphData = { difficultySpread, trendLabels, trendCounts };

                            res.render('hod/dashboard.html', {
                                user: req.session.user,
                                stats,
                                pendingQuestions,
                                pendingContests,
                                graphData,
                                currentPage: 'dashboard'
                            });
                        });
                    });
                });
            });
        });
    });


    // Faculty Management
    router.get('/hod/faculty', requireRole('hod'), checkScope, (req, res) => {
        const college = req.session.user.collegeName;

        // Canonical source of truth for role tags is account_users.
        // This avoids stale UNION collisions that can mislabel HOD as HOS.
        let facultyQuery = `
            SELECT
                u.id,
                u.fullName,
                u.email,
                CASE WHEN COALESCE(u.is_hod, 0) = 1 THEN 'hod' ELSE LOWER(COALESCE(u.role, 'faculty')) END as role,
                u.status,
                COALESCE(NULLIF(u.department, ''), NULLIF(u.branch, ''), '') as department,
                u.subject as hosSubject,
                u.joiningDate,
                GROUP_CONCAT(DISTINCT ua.subject || ' (' || ua.year || ' - ' || ua.section || ')') as assignments
            FROM account_users u
            LEFT JOIN faculty_assignments ua
                ON u.id = ua.user_id
               AND ${normalizeSql(`COALESCE(ua.collegeName, '')`)} = ${normalizeSql(`?`)}
            WHERE ${normalizeSql(`COALESCE(u.collegeName, '')`)} = ${normalizeSql(`?`)}
              AND LOWER(COALESCE(u.role, '')) IN ('faculty', 'hos', 'hod')
            GROUP BY u.id
            ORDER BY u.fullName COLLATE NOCASE ASC
        `;
        const params = [college, college];

        db.all(facultyQuery, params, (err, faculty) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            
            res.render('hod/faculty.html', {
                user: req.session.user,
                departmentFaculty: faculty,
                currentPage: 'faculty',
                dropdownData: res.locals.dropdownData
            });
        });
    });

    // HOD: Create Faculty Account
    router.post('/hod/faculty/create', requireRole('hod'), (req, res) => {
        const { fullName, email, mobile, post } = req.body;
        const branch = req.session.user.department;
        const program = req.session.user.course;
        const college = req.session.user.collegeName;

        if (!fullName || !email) {
            return res.redirect('/college/hod/faculty?error=Name+and+email+are+required');
        }

        // Check if email already exists
        db.get(`SELECT id FROM account_users WHERE email = ?`, [email], (err, existing) => {
            if (err) return res.status(500).send(err.message);
            if (existing) {
                return res.redirect('/college/hod/faculty?error=A+user+with+this+email+already+exists');
            }

            const bcrypt = require('bcrypt');
            const tempPassword = 'changeme123';
            bcrypt.hash(tempPassword, 10, (err, hash) => {
                if (err) return res.status(500).send(err.message);

                db.run(
                    `INSERT INTO account_users (fullName, email, password, role, department, branch, program, collegeName, mobile, post, status)
                     VALUES (?, ?, ?, 'faculty', ?, ?, ?, ?, ?, ?, 'pending')`,
                    [fullName, email, hash, branch, branch, program || '', college, mobile || '', post || ''],
                    function(err) {
                        if (err) return res.status(500).send(err.message);
                        res.redirect('/college/hod/faculty?created=1');
                    }
                );
            });
        });
    });

    // HOD: Assign Sections and Years
    router.post('/hod/assign-sections-years', requireRole('hod'), (req, res) => {
        const { facultyId, assignedYears, assignedSections, subjectName } = req.body;
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;
        const hodId = req.session.user.id;

        if (!subjectName || !assignedYears || !assignedSections) {
            return res.redirect('/college/hod/faculty?error=Missing+assignment+details');
        }

        // Ensure the faculty exists in the same college
        db.get(`SELECT id FROM account_users WHERE id = ? AND collegeName = ? AND role IN ('faculty', 'hos')`, 
            [facultyId, college], (err, row) => {
            if (err) return res.status(500).send(err.message);
            if (!row) return res.status(403).send("Unauthorized or Invalid Faculty ID.");

            // Insert into faculty_assignments
            db.run(
                `INSERT INTO faculty_assignments (user_id, subject, year, section, assigned_by_id, collegeName)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [facultyId, subjectName, assignedYears, assignedSections, hodId, college],
                function(err) {
                    if (err) return res.status(500).send(err.message);
                    res.redirect('/college/hod/faculty?assigned=1');
                }
            );
        });
    });

    // HOD: Assign Subject (Legacy, keeping for compatibility but pointing to new table or merging)
    router.post('/hod/assign-subject', requireRole('hod'), (req, res) => {
        const { facultyId, subjectName } = req.body;
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;
        const hodId = req.session.user.id;

        if (!subjectName || !subjectName.trim()) {
             return res.redirect('/college/hod/faculty?error=Subject+name+cannot+be+empty');
        }

        db.get(`SELECT id FROM account_users WHERE id = ? AND collegeName = ? AND role IN ('faculty', 'hos')`, 
            [facultyId, college], (err, row) => {
            if (err) return res.status(500).send(err.message);
            if (!row) return res.status(403).send("Unauthorized or Invalid Faculty ID.");

            // Also putting it into faculty_assignments with 'All' defaults for year/section if just assigning subject
            db.run(
                `INSERT INTO faculty_assignments (user_id, subject, year, section, assigned_by_id, collegeName) 
                 VALUES (?, ?, 'All Years', 'All Sections', ?, ?)`,
                [facultyId, subjectName.trim(), hodId, college],
                function(err) {
                    if (err) return res.status(500).send(err.message);
                    res.redirect('/college/hod/faculty?assigned=subject');
                }
            );
        });
    });


    // Student Management
    router.get('/hod/student', requireRole('hod'), checkScope, (req, res) => {
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;
        db.all(`SELECT * FROM account_users WHERE role = 'student' AND department = ? AND collegeName = ?`, [dept, college], (err, students) => {
            if (err) return res.status(500).send(err.message);
            res.render('hod/student.html', { user: req.session.user, students: students || [], currentPage: 'student' });
        });
    });

    // Question Bank / Problem Management
    router.get('/hod/problem', requireRole('hod'), checkScope, (req, res) => {
        const user = req.session.user;
        const dept = user.department;
        const college = user.collegeName;
        db.all(
            `SELECT p.*, u.fullName as facultyName, u.role as creatorRole FROM problems p 
             LEFT JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id 
             WHERE (p.department = ?)
                OR (p.status = 'accepted' AND u.collegeName = ? AND LOWER(p.visibility_scope) = 'global')
                OR (p.status IN ('accepted', 'active') AND LOWER(p.visibility_scope) = 'global' AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))
             ORDER BY p.createdAt DESC`, 
            [dept, college], 
            (err, problems) => {
                if (err) return res.status(500).send(err.message);
                const allProblems = problems || [];

                db.all(
                    `SELECT problem_id FROM problem_bookmarks WHERE user_id = ?`,
                    [user.id],
                    (bookmarkErr, bookmarkRows) => {
                        if (bookmarkErr) return res.status(500).send(bookmarkErr.message);
                        const bookmarkedProblemIds = (bookmarkRows || []).map((row) => row.problem_id);
                        const bookmarkedSet = new Set(bookmarkedProblemIds);
                        const bookmarkedProblems = allProblems.filter((problem) => bookmarkedSet.has(problem.id));

                        res.render('hod/problem.html', {
                            user: req.session.user,
                            problems: allProblems,
                            bookmarkedProblemIds,
                            bookmarkedProblems,
                            currentPage: 'problem'
                        });
                    }
                );
            }
        );
    });

    // Contest Management
    router.get('/hod/contest', requireRole('hod'), checkScope, (req, res) => {
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;
        const hodId = req.session.user.id;
        db.all(
            `SELECT c.*, u.role as creatorRole FROM contests c
             LEFT JOIN account_users u ON c.createdBy = u.id
             WHERE (c.status = 'accepted' AND c.collegeName = ?)
                OR (c.department = ? AND c.collegeName = ?)
                OR c.createdBy = ?
                        OR (c.status = 'accepted' AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))
             ORDER BY c.id DESC`,
            [college, dept, college, hodId],
            (err, contests) => {
                if (err) return res.status(500).send(err.message);
                res.render('hod/contest.html', {
                    user: req.session.user,
                    contests: (contests || []).map(normalizeContestRecord),
                    currentPage: 'contest'
                });
            }
        );
    });

    // Community Forum
    router.get('/hod/community', requireRole('hod'), checkScope, (req, res) => {
        res.render('hod/community.html', { user: req.session.user, currentPage: 'community' });
    });

    // Reports & Analytics (Dynamic)
    router.get('/hod/report', requireRole('hod'), checkScope, async (req, res) => {
        const college = String(req.session.user.collegeName || '').trim();
        const hodBranch = String(req.session.user.department || '').trim();
        const hodProgram = String(req.session.user.course || req.session.user.program || '').trim();

        const norm = (v) => String(v || '').toLowerCase().replace(/[\s&\-_\/]/g, '');
        const inScope = (row) => {
            const rowBranch = String(row.branch || row.department || '').trim();
            const rowProgram = String(row.program || row.course || '').trim();
            const branchOk = !hodBranch || !rowBranch || norm(rowBranch) === norm(hodBranch);
            const programOk = !hodProgram || !rowProgram || norm(rowProgram) === norm(hodProgram);
            return branchOk && programOk;
        };

        const dbAll = (sql, params = []) =>
            new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || []))));

        try {
            const [allFacultyRaw, allStudentsRaw, problemsRaw, contestsRaw, assignmentsRaw] = await Promise.all([
                dbAll(
                    `SELECT id, fullName, email, role, status, joiningDate, department, branch, program, course, subject, points, solvedCount, rank
                     FROM account_users
                     WHERE collegeName = ? AND role IN ('faculty','hos')
                     ORDER BY fullName ASC`,
                    [college]
                ),
                dbAll(
                    `SELECT id, fullName, email, status, department, branch, program, course, year, section, points, solvedCount, rank
                     FROM account_users
                     WHERE collegeName = ? AND role = 'student'
                     ORDER BY fullName ASC`,
                    [college]
                ),
                dbAll(
                    `SELECT p.id, p.title, p.subject, p.difficulty, p.status, p.tags, p.createdAt, p.department, p.points,
                            COUNT(s.id) AS totalSubmissions,
                            SUM(CASE WHEN LOWER(COALESCE(s.status, '')) IN ('accepted','ac') THEN 1 ELSE 0 END) AS acceptedSubmissions
                     FROM problems p
                     LEFT JOIN submissions s ON s.problem_id = p.id
                     WHERE p.department = ?
                     GROUP BY p.id
                     ORDER BY p.id DESC`,
                    [hodBranch]
                ),
                dbAll(
                    `SELECT c.id, c.title, c.department, c.subject, c.status, c.contest_class, c.prize, c.guidelines,
                            c.startDate, c.endDate, c.createdAt, c.visibility_scope,
                            COUNT(DISTINCT cp.user_id) AS participants
                     FROM contests c
                     LEFT JOIN contest_participants cp ON cp.contest_id = c.id
                     WHERE (
                             c.department = ?
                             AND (c.collegeName IS NULL OR c.collegeName = '' OR ${normalizeSql('c.collegeName')} = ${normalizeSql('?')})
                           )
                        OR LOWER(COALESCE(c.visibility_scope,'')) = 'global'
                     GROUP BY c.id
                     ORDER BY COALESCE(c.startDate, c.createdAt) DESC`,
                    [hodBranch, college]
                ),
                dbAll(
                    `SELECT user_id, subject, year, section
                     FROM faculty_assignments
                     WHERE collegeName = ?`,
                    [college]
                )
            ]);

            const allFaculty = allFacultyRaw.filter(inScope);
            const allStudents = allStudentsRaw.filter(inScope);
            const studentIds = allStudents.map(s => s.id);
            const studentIdSet = new Set(studentIds);
            const facultyIdSet = new Set(allFaculty.map(f => f.id));

            const studentSubmissions = studentIds.length
                ? await dbAll(
                    `SELECT user_id,
                            COUNT(*) AS total,
                            SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('accepted','ac') THEN 1 ELSE 0 END) AS accepted
                     FROM submissions
                     WHERE user_id IN (${studentIds.map(() => '?').join(',')})
                     GROUP BY user_id`,
                    studentIds
                )
                : [];

            const progressRows = studentIds.length
                ? await dbAll(
                    `SELECT substr(COALESCE(createdAt, datetime('now')), 1, 7) AS monthKey,
                            COUNT(*) AS total,
                            SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('accepted','ac') THEN 1 ELSE 0 END) AS accepted
                     FROM submissions
                     WHERE user_id IN (${studentIds.map(() => '?').join(',')})
                     GROUP BY monthKey
                     ORDER BY monthKey DESC
                     LIMIT 8`,
                    studentIds
                )
                : [];

            const submissionsByStudent = new Map(studentSubmissions.map(r => [r.user_id, { total: Number(r.total || 0), accepted: Number(r.accepted || 0) }]));
            const assignmentsByFaculty = new Map();
            assignmentsRaw.forEach((a) => {
                if (!facultyIdSet.has(a.user_id)) return;
                if (!assignmentsByFaculty.has(a.user_id)) assignmentsByFaculty.set(a.user_id, []);
                assignmentsByFaculty.get(a.user_id).push(a);
            });

            const facultyData = allFaculty.map((f) => {
                const assigned = assignmentsByFaculty.get(f.id) || [];
                return {
                    id: f.id,
                    facultyId: `FAC-${f.id}`,
                    name: f.fullName,
                    email: f.email,
                    role: String(f.role || '').toUpperCase(),
                    status: f.status || 'active',
                    department: f.branch || f.department || '',
                    program: f.program || f.course || '',
                    joined: f.joiningDate || '-',
                    hosSubject: f.subject || '',
                    assignedSubjects: [...new Set(assigned.map(a => a.subject).filter(Boolean))].join(', '),
                    assignedCount: assigned.length
                };
            });

            const studentsData = allStudents.map((s) => {
                const sub = submissionsByStudent.get(s.id) || { total: 0, accepted: 0 };
                return {
                    id: s.id,
                    studentId: `STU-${s.id}`,
                    name: s.fullName,
                    email: s.email,
                    status: s.status || 'active',
                    department: s.branch || s.department || '',
                    program: s.program || s.course || '',
                    year: s.year || '-',
                    section: s.section || '-',
                    points: Number(s.points || 0),
                    solvedCount: Number(s.solvedCount || 0),
                    rank: Number(s.rank || 0),
                    submissions: sub.total,
                    acceptedSubmissions: sub.accepted
                };
            });

            const problemsData = problemsRaw.map((p) => {
                const total = Number(p.totalSubmissions || 0);
                const accepted = Number(p.acceptedSubmissions || 0);
                const rate = total > 0 ? Math.round((accepted * 10000) / total) / 100 : 0;
                return {
                    id: p.id,
                    title: p.title || '',
                    subject: p.subject || '-',
                    difficulty: p.difficulty || '-',
                    status: p.status || '-',
                    tags: p.tags || '',
                    points: Number(p.points || 0),
                    createdAt: p.createdAt || '-',
                    totalSubmissions: total,
                    acceptedSubmissions: accepted,
                    acceptanceRate: rate
                };
            });

            const contestsData = contestsRaw.map((c) => ({
                id: c.id,
                title: c.title || '',
                department: c.department || '',
                subject: c.subject || '-',
                status: c.status || '-',
                contestClass: c.contest_class || '-',
                participants: Number(c.participants || 0),
                prize: c.prize || '-',
                startDate: c.startDate || '-',
                endDate: c.endDate || '-',
                createdAt: c.createdAt || '-',
                guidelines: c.guidelines || '',
                visibility: c.visibility_scope || 'department'
            }));

            const progressData = progressRows
                .slice()
                .reverse()
                .map((r) => {
                    const total = Number(r.total || 0);
                    const accepted = Number(r.accepted || 0);
                    return {
                        month: r.monthKey,
                        totalSubmissions: total,
                        acceptedSubmissions: accepted,
                        acceptanceRate: total > 0 ? Math.round((accepted * 10000) / total) / 100 : 0
                    };
                });

            const totalSubmissions = progressData.reduce((acc, r) => acc + r.totalSubmissions, 0);
            const totalAccepted = progressData.reduce((acc, r) => acc + r.acceptedSubmissions, 0);

            const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

            const reportData = {
                generatedAt: new Date().toISOString(),
                scope: { college, branch: hodBranch, program: hodProgram },
                summary: {
                    facultyCount: facultyData.length,
                    studentCount: studentsData.length,
                    problemCount: problemsData.length,
                    contestCount: contestsData.length,
                    submissionCount: totalSubmissions,
                    acceptanceRate: totalSubmissions ? Math.round((totalAccepted * 10000) / totalSubmissions) / 100 : 0
                },
                filters: {
                    departments: uniq(studentsData.map(s => s.department).concat(facultyData.map(f => f.department))),
                    programs: uniq(studentsData.map(s => s.program).concat(facultyData.map(f => f.program))),
                    years: uniq(studentsData.map(s => s.year)),
                    sections: uniq(studentsData.map(s => s.section)),
                    difficulties: uniq(problemsData.map(p => p.difficulty)),
                    subjects: uniq(problemsData.map(p => p.subject).concat(contestsData.map(c => c.subject))),
                    contestClasses: uniq(contestsData.map(c => c.contestClass)),
                    statuses: uniq(problemsData.map(p => p.status).concat(contestsData.map(c => c.status)))
                },
                faculty: facultyData,
                students: studentsData,
                problems: problemsData,
                contests: contestsData,
                progress: progressData
            };

            res.render('hod/report.html', { user: req.session.user, currentPage: 'report', reportData });
        } catch (error) {
            res.status(500).send(error.message);
        }
    });

    // Settings
    router.get('/hod/settings', requireRole('hod'), checkScope, (req, res) => {
        db.get(`SELECT * FROM account_users WHERE id = ?`, [req.session.user.id], (err, user) => {
            if (err) return res.status(500).send(err.message);
            const success = req.query.saved === '1';
            res.render('hod/settings.html', { user, currentPage: 'settings', success });
        });
    });

    // Settings Update
    router.post('/hod/settings/update', requireRole('hod'), (req, res) => {
        const { fullName, email, gender, mobile } = req.body;
        const id = req.session.user.id;
        db.run(
            `UPDATE account_users SET fullName = ?, email = ?, gender = ?, mobile = ? WHERE id = ?`,
            [fullName, email, gender, mobile, id],
            function(err) {
                if (err) return res.status(500).send(err.message);
                // Refresh session
                req.session.user.fullName = fullName;
                req.session.user.email = email;
                res.redirect('/college/hod/settings?saved=1');
            }
        );
    });

    // Help & Support
    router.get('/hod/help', requireRole('hod'), checkScope, (req, res) => {
        res.render('hod/help.html', { user: req.session.user, currentPage: 'help' });
    });

    // Pending Questions (Dedicated Page)
    router.get('/hod/pending-questions', requireRole('hod'), checkScope, (req, res) => {
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        // Fetch all questions for listing (we'll filter in EJS or handle with query params)
        const status = req.query.status || 'pending';
        
        const statsQuery = `
            SELECT 
                (SELECT COUNT(*) FROM problems WHERE department = ? AND status = 'pending') as pendingCount,
                (SELECT COUNT(*) FROM problems WHERE department = ? AND status = 'accepted') as approvedCount,
                (SELECT COUNT(*) FROM problems WHERE department = ? AND status = 'rejected') as rejectedCount,
                (SELECT COUNT(*) FROM problems WHERE department = ? AND createdAt >= date('now', '-7 days')) as thisWeekCount
        `;

        const subjectsQuery = `SELECT DISTINCT subject FROM problems WHERE department = ?`;

        const problemsQuery = `
            SELECT p.*, u.fullName as facultyName, u.role as creatorRole 
            FROM problems p 
            JOIN account_users u ON p.faculty_id = u.id 
            WHERE p.department = ? 
            ORDER BY p.id DESC
        `;

        db.get(statsQuery, [dept, dept, dept, dept], (err, stats) => {
            if (err) return res.status(500).send(err.message);
            
            db.all(subjectsQuery, [dept], (err, subjects) => {
                if (err) return res.status(500).send(err.message);
                
                db.all(problemsQuery, [dept], (err, allQuestions) => {
                    if (err) return res.status(500).send(err.message);
                    
                    res.render('hod/pending_questions.html', { 
                        user: req.session.user, 
                        allQuestions, 
                        subjects: subjects || [],
                        stats: stats || {},
                        currentPage: 'dashboard' 
                    });
                });
            });
        });
    });

    // Pending Contests (Refined with Stats and Filters)
    router.get('/hod/pending-contests', requireRole('hod'), checkScope, (req, res) => {
        const hodId = req.session.user.id;
        const college = req.session.user.collegeName;
        const { subject, type, dateFrom, dateTo, hos_approved, tab } = req.query;
        getUsersManagedByHod(hodId, college)
            .then((managedUserIds) => {
                if (!managedUserIds.length) {
                    return res.render('hod/pending_contests.html', {
                        user: req.session.user,
                        pendingContests: [],
                        stats: { pendingCount: 0, approvedCount: 0, rejectedCount: 0, upcomingCount: 0, conflictCount: 0 },
                        subjects: [],
                        types: [],
                        query: req.query,
                        currentPage: 'dashboard'
                    });
                }
                const placeholders = managedUserIds.map(() => '?').join(',');
                const filterQuery = `
                    SELECT c.*, u.fullName as creatorName, u.role as creatorRole
                    FROM contests c
                    JOIN account_users u ON c.createdBy = u.id
                    WHERE c.createdBy IN (${placeholders})
                      AND (COALESCE(u.collegeName, '') = ? OR COALESCE(c.collegeName, '') = ?)
                `;
                db.all(filterQuery, [...managedUserIds, college, college], (err, allContests) => {
                    if (err) return res.status(500).send(err.message);
                    const stats = {
                        pendingCount: allContests.filter(c => c.status === 'pending').length,
                        approvedCount: allContests.filter(c => c.status === 'accepted').length,
                        rejectedCount: allContests.filter(c => c.status === 'rejected').length,
                        upcomingCount: allContests.filter(c => c.status === 'accepted' && c.startDate && new Date(c.startDate) > new Date()).length
                    };

                // Conflict Detection
                allContests.forEach(c1 => {
                    c1.conflicts = allContests.filter(c2 => {
                        if (c1.id === c2.id || c2.status === 'rejected') return false;
                        const start1 = new Date(c1.startDate), end1 = new Date(c1.endDate);
                        const start2 = new Date(c2.startDate), end2 = new Date(c2.endDate);
                        return (start1 < end2 && end1 > start2);
                    });
                });

                // Calculate conflict stats
                stats.conflictCount = allContests.filter(c => c.status === 'pending' && c.conflicts.length > 0).length;

                // Filtering the list based on Tab and Query Params
                let filteredContests = allContests;
                const normalizedTab = tab === 'accepted' ? 'approved' : tab;

                // Tab Filter
                if (normalizedTab === 'approved') filteredContests = filteredContests.filter(c => c.status === 'accepted');
                else if (normalizedTab === 'rejected') filteredContests = filteredContests.filter(c => c.status === 'rejected');
                else if (normalizedTab === 'active') filteredContests = filteredContests.filter(c => c.status === 'accepted' && new Date(c.startDate) <= new Date() && new Date(c.endDate) >= new Date());
                else if (normalizedTab === 'conflicts') filteredContests = filteredContests.filter(c => c.conflicts.length > 0);
                else if (!normalizedTab || normalizedTab === 'all') {
                    // Default to pending for "All" if that's what user prefers, but image implies "All"
                    // We'll show all but user can select
                }

                // Query Params Filter
                if (subject && subject !== 'All Subjects') filteredContests = filteredContests.filter(c => c.subject === subject);
                if (type && type !== 'All Types') filteredContests = filteredContests.filter(c => c.type === type);
                if (dateFrom) filteredContests = filteredContests.filter(c => new Date(c.startDate) >= new Date(dateFrom));
                if (dateTo) filteredContests = filteredContests.filter(c => new Date(c.startDate) <= new Date(dateTo));
                if (hos_approved && hos_approved !== 'All') {
                    const val = hos_approved === 'Yes' ? 1 : 0;
                    filteredContests = filteredContests.filter(c => Number(c.hos_verified || 0) === val);
                }

                // Get unique subjects for filter dropdown
                const subjects = [...new Set(allContests.map(c => c.subject))].filter(Boolean);
                const types = [...new Set(allContests.map(c => c.type))].filter(Boolean);

                res.render('hod/pending_contests.html', { 
                    user: req.session.user, 
                    pendingContests: filteredContests, 
                    stats,
                    subjects,
                    types,
                    query: req.query,
                    currentPage: 'dashboard' 
                });
                });
            })
            .catch((error) => {
                console.error('HOD pending contests load error:', error);
                res.status(500).send(error.message);
            });
    });

    // Profile View
    router.get('/hod/profile', requireRole('hod'), checkScope, (req, res) => {
        const user = req.session.user;
        
        // Fetch all subjects and sections in the HOD's department
        db.all(`
            SELECT s.name as subjectName, sec.name as sectionName, sec.semester
            FROM subjects s
            JOIN sections sec ON s.section_id = sec.id
            JOIN branches b ON sec.branch_id = b.id
            WHERE b.collegeName = ? AND (b.name = ? OR b.abbreviation = ? OR b.code = ?)
            ORDER BY s.name ASC, sec.name ASC
        `, [user.collegeName, user.department, user.department, user.department], (err, rows) => {
            if (err) {
                console.error("Profile Fetch Error:", err);
                return res.render('hod/profile.html', { user, managedResources: [], currentPage: 'profile' });
            }

            // Group by subject
            const managedResources = [];
            rows.forEach(row => {
                let subject = managedResources.find(s => s.name === row.subjectName);
                if (!subject) {
                    subject = { name: row.subjectName, sections: [] };
                    managedResources.push(subject);
                }
                if (!subject.sections.includes(row.sectionName)) {
                    subject.sections.push(row.sectionName);
                }
            });

            res.render('hod/profile.html', { user, managedResources, currentPage: 'profile' });
        });
    });

    // --- HOD API Endpoints ---

    // Assign subject to self (HOD)
    router.post('/hod/api/assign-self-subject', requireRole('hod'), (req, res) => {
        const userId = req.session.user.id;
        const college = req.session.user.collegeName;
        const { subjectName, assignedYears, assignedSections } = req.body;

        if (!subjectName || !assignedYears || !assignedSections) {
            return res.status(400).json({ success: false, message: 'Subject, year and section are required' });
        }

        db.get(
            `SELECT id FROM account_users WHERE id = ? AND collegeName = ? AND role = 'hod'`,
            [userId, college],
            (err, hodUser) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                if (!hodUser) return res.status(403).json({ success: false, message: 'Unauthorized' });

                db.get(
                    `SELECT id FROM faculty_assignments WHERE user_id = ? AND collegeName = ? AND subject = ? AND year = ? AND section = ?`,
                    [userId, college, subjectName, assignedYears, assignedSections],
                    (checkErr, existing) => {
                        if (checkErr) return res.status(500).json({ success: false, message: checkErr.message });
                        if (existing) return res.json({ success: true, message: 'This assignment already exists.' });

                        db.run(
                            `INSERT INTO faculty_assignments (user_id, subject, year, section, assigned_by_id, collegeName)
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [userId, subjectName, assignedYears, assignedSections, userId, college],
                            function (insertErr) {
                                if (insertErr) return res.status(500).json({ success: false, message: insertErr.message });

                                db.run(`UPDATE account_users SET subject = ? WHERE id = ?`, [subjectName, userId], () => {});
                                req.session.user.subject = subjectName;
                                return res.json({ success: true, message: 'Subject assigned to your profile successfully.' });
                            }
                        );
                    }
                );
            }
        );
    });

    // Verify Faculty
    router.post('/hod/api/verify-faculty', requireRole('hod'), (req, res) => {
        const { id } = req.body;
        const college = req.session.user.collegeName;

        db.run('UPDATE account_users SET status = "active" WHERE id = ? AND collegeName = ? AND status = "pending" AND role IN ("faculty","hos")', [id, college], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (this.changes === 0) return res.status(404).json({ success: false, message: 'Faculty not found or already verified' });
            res.json({ success: true, message: 'Faculty verified successfully' });
        });
    });

    // Assign Role (Faculty/HOS)
    router.post('/hod/api/assign-role', requireRole('hod'), (req, res) => {
        const rawId = req.body.id ?? req.body.targetUserId;
        const emailHint = String(req.body.email ?? req.body.targetEmail ?? '').trim();
        const id = Number(rawId);
        const role = String(req.body.role ?? req.body.newRole ?? '').trim().toLowerCase();
        const subject = String(req.body.subject ?? '').trim();
        const college = String(req.session.user.collegeName || '').trim();

        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid faculty id' });
        }
        if (!['faculty', 'hos'].includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        // If promoting to HOS, a subject must be selected
        if (role === 'hos' && !subject) {
            return res.status(400).json({ success: false, message: 'A subject must be selected to promote a teacher to HOS.' });
        }

        const applyFacultyFallbackUpdate = () => {
            const normalizedRole = role === 'hos' ? 'hos' : 'faculty';
            const resolvedEmail = emailHint || '';
            const whereByEmail = resolvedEmail ? ` OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(?))` : '';
            const params = resolvedEmail
                ? [normalizedRole, role === 'hos' ? subject : '', normalizedRole, normalizedRole, id, college, resolvedEmail]
                : [normalizedRole, role === 'hos' ? subject : '', normalizedRole, normalizedRole, id, college];

            db.run(
                `UPDATE faculty
                 SET role = ?,
                     subject = ?,
                     post = CASE
                                WHEN ? = 'hos' THEN 'HOS'
                                WHEN ? = 'faculty' AND LOWER(COALESCE(post, '')) = 'hos' THEN 'Faculty Member'
                                ELSE post
                            END
                 WHERE (id = ?${whereByEmail})
                   AND ${normalizeSql(`COALESCE(collegeName, '')`)} = ${normalizeSql(`?`)}`,
                params,
                function (fallbackErr) {
                    if (fallbackErr) return res.status(500).json({ success: false, message: fallbackErr.message });
                    if (this.changes === 0) return res.status(404).json({ success: false, message: 'Faculty not found in your college' });
                    return res.json({ success: true, message: `Role assigned successfully (faculty table sync).` });
                }
            );
        };

        const checkConflict = () => {
            resolveTeacherForCollege(id, college, emailHint, (targetErr, targetUser) => {
                if (targetErr) return res.status(500).json({ success: false, message: targetErr.message });
                if (!targetUser) return applyFacultyFallbackUpdate();
                if (['student', 'superadmin', 'admin'].includes(String(targetUser.role || '').toLowerCase())) {
                    return res.status(400).json({ success: false, message: 'Only faculty/hos can be promoted here.' });
                }
                return handleRoleChange(targetUser);
            });
        };

        const handleRoleChange = (targetUser) => {
            const targetDept = String(targetUser.department || targetUser.branch || '').trim();
            const roleSubject = role === 'hos' ? subject : '';

            return db.get(`SELECT is_hod FROM account_users WHERE id = ? LIMIT 1`, [targetUser.id], (chkErr, roleRow) => {
                if (chkErr) return res.status(500).json({ success: false, message: chkErr.message });
                if (Number(roleRow?.is_hod || 0) === 1) {
                    return res.status(403).json({ success: false, message: 'This user is assigned as HOD. Change HOD only from Admin panel.' });
                }

                if (role === 'hos') {
                    // Keep uniqueness check college + department + subject where department exists
                    const conflictQuery = `
                        SELECT fullName
                        FROM account_users
                        WHERE LOWER(COALESCE(role,'')) = 'hos'
                          AND collegeName = ?
                          AND LOWER(TRIM(COALESCE(subject,''))) = LOWER(TRIM(?))
                          AND id != ?
                          ${targetDept ? "AND LOWER(TRIM(COALESCE(NULLIF(department,''), NULLIF(branch,''), ''))) = LOWER(TRIM(?))" : ""}
                        LIMIT 1
                    `;
                    const params = targetDept ? [college, subject, targetUser.id, targetDept] : [college, subject, targetUser.id];
                    return db.get(conflictQuery, params, (err, row) => {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        if (row) {
                            return res.status(400).json({ success: false, message: `Conflict: ${row.fullName} is already the HOS for ${subject}.` });
                        }
                        return performUpdate(roleSubject, targetUser.id);
                    });
                }
                return performUpdate(roleSubject, targetUser.id);
            });
        };

        const performUpdate = (roleSubject, resolvedUserId) => {
            db.run(
                `UPDATE account_users 
                 SET role = ?, 
                     subject = ?, 
                     post = CASE 
                               WHEN ? = 'hos' THEN 'HOS'
                               WHEN ? = 'faculty' AND LOWER(COALESCE(post, '')) = 'hos' THEN 'Faculty Member'
                               ELSE post
                            END
                 WHERE id = ? AND LOWER(TRIM(COALESCE(collegeName, ''))) = LOWER(TRIM(?)) AND LOWER(COALESCE(role, '')) IN ('faculty','hos','hod')`,
                [role, roleSubject, role, role, resolvedUserId, college],
                function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ success: false, message: `Constraint Violated: This subject already has an HOS.` });
                    }
                    return res.status(500).json({ success: false, message: err.message });
                }
                
                // Auto-Assignment for HOS
                if (role === 'hos') {
                    const masterPoolQuery = `
                        SELECT DISTINCT sec.semester, sec.name as sectionName
                        FROM subjects s
                        JOIN sections sec ON s.section_id = sec.id
                        WHERE s.name = ? AND s.collegeName = ?
                    `;
                    db.all(masterPoolQuery, [subject, college], (err, rows) => {
                        if (!err && rows && rows.length > 0) {
                            rows.forEach(row => {
                                const year = semToYear(row.semester);
                                db.run(`INSERT OR IGNORE INTO faculty_assignments (user_id, subject, year, section, assigned_by_id, collegeName) VALUES (?, ?, ?, ?, ?, ?)`,
                                    [id, subject, year, row.sectionName, req.session.user.id, college]);
                            });
                        }
                    });
                }

                if (this.changes === 0) return applyFacultyFallbackUpdate();

                // Best-effort mirror to faculty table by id/email to keep legacy tables in sync.
                const mirrorEmail = emailHint || '';
                const whereByEmail = mirrorEmail ? ` OR LOWER(TRIM(COALESCE(email,''))) = LOWER(TRIM(?))` : '';
                const mirrorParams = mirrorEmail
                    ? [role, roleSubject, role, role, resolvedUserId, college, mirrorEmail]
                    : [role, roleSubject, role, role, resolvedUserId, college];
                db.run(
                    `UPDATE faculty
                     SET role = ?,
                         subject = ?,
                         post = CASE
                                    WHEN ? = 'hos' THEN 'HOS'
                                    WHEN ? = 'faculty' AND LOWER(COALESCE(post, '')) = 'hos' THEN 'Faculty Member'
                                    ELSE post
                                END
                     WHERE (id = ?${whereByEmail})
                       AND ${normalizeSql(`COALESCE(collegeName, '')`)} = ${normalizeSql(`?`)}`,
                    mirrorParams,
                    () => {}
                );

                res.json({ success: true, message: `Role assigned successfully. ${role === 'hos' ? 'User is now HOS for ' + subject : ''}` });
            });
        };

        checkConflict();
    });

    // Update Faculty Profile (from HOD)
    router.post('/hod/api/update-faculty', requireRole('hod'), (req, res) => {
        const { id, fullName, email, joiningDate } = req.body;
        const college = req.session.user.collegeName;

        db.run('UPDATE account_users SET fullName = ?, email = ?, joiningDate = ? WHERE id = ? AND collegeName = ? AND role IN ("faculty","hos") AND (is_hod = 0 OR is_hod IS NULL)', [fullName, email, joiningDate, id, college], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (this.changes === 0) return res.status(404).json({ success: false, message: 'Faculty not found in your college' });
            res.json({ success: true, message: 'Faculty profile updated successfully' });
        });
    });

    // Global Search Teachers (College-wide)
    router.get('/hod/api/search-teachers', requireRole('hod'), (req, res) => {
        const { q } = req.query;
        const college = req.session.user.collegeName;
        if (!q) return res.json([]);

        const searchQuery = `
            SELECT id, fullName, email, role, department, branch
            FROM account_users 
            WHERE (fullName LIKE ? OR email LIKE ?) 
              AND collegeName = ? 
              AND role IN ('faculty', 'hos', 'hod')
            LIMIT 10
        `;
        const params = [`%${q}%`, `%${q}%`, college];

        db.all(searchQuery, params, (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json(rows);
        });
    });

    // Assign Subject to Faculty (API version)
    router.post('/hod/api/assign-subject', requireRole('hod'), (req, res) => {
        const { userId, subjectName } = req.body;
        const assignedById = req.session.user.id;
        const college = req.session.user.collegeName;

        if (!userId || !subjectName) {
            return res.status(400).json({ success: false, message: 'User ID and Subject Name are required' });
        }

        // Verify faculty belongs to the same college and check HOS constraint
        db.get(`SELECT id, role, department FROM account_users WHERE id = ? AND collegeName = ?`, [userId, college], (err, targetUser) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (!targetUser) return res.status(403).json({ success: false, message: "Faculty not found in your college." });

            const checkHOS = () => {
                if (targetUser.role === 'hos') {
                    // Check if another HOS is already assigned to this subject name in this department
                    const hosCheckQuery = `
                        SELECT u.fullName 
                        FROM faculty_assignments ua
                        JOIN account_users u ON ua.user_id = u.id
                        WHERE ua.subject = ? 
                        AND u.id != ?
                        AND u.role = 'hos'
                        AND u.department = ?
                        AND u.collegeName = ?
                        LIMIT 1
                    `;
                    db.get(hosCheckQuery, [subjectName, userId, targetUser.department, college], (err, row) => {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        if (row) {
                            return res.status(400).json({ success: false, message: `Constraint Violated: ${row.fullName} is already the HOS for ${subjectName} in this department.` });
                        }
                        performInsert();
                    });
                } else {
                    performInsert();
                }
            };

            const performInsert = () => {
                db.run(`INSERT INTO faculty_assignments (user_id, subject, year, section, assigned_by_id, collegeName) VALUES (?, ?, 'All Years', 'All Sections', ?, ?)`, 
                    [userId, subjectName, assignedById, college], function(err) {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        res.json({ success: true, message: 'Subject assigned successfully' });
                    });
            };

            checkHOS();
        });
    });

    // Assign Sections and Years (API version)
    router.post('/hod/api/assign-sections', requireRole('hod'), (req, res) => {
        const { facultyId, assignedYears, assignedSections, subjectName } = req.body;
        const college = req.session.user.collegeName;
        const hodId = req.session.user.id;

        if (!facultyId || !subjectName || !assignedYears || !assignedSections) {
            return res.status(400).json({ success: false, message: 'Missing assignment details' });
        }

        db.get(`SELECT id FROM account_users WHERE id = ? AND collegeName = ?`, [facultyId, college], (err, row) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (!row) return res.status(403).json({ success: false, message: "Faculty not found." });

            db.run(
                `INSERT INTO faculty_assignments (user_id, subject, year, section, assigned_by_id, collegeName)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [facultyId, subjectName, assignedYears, assignedSections, hodId, college],
                function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Sections assigned successfully' });
                }
            );
        });
    });

    // De-assign Subject from Faculty (remove all assignment rows for subject)
    router.post('/hod/api/deassign-subject', requireRole('hod'), (req, res) => {
        const { facultyId, subjectName } = req.body;
        const college = req.session.user.collegeName;

        if (!facultyId || !subjectName) {
            return res.status(400).json({ success: false, message: 'Faculty and subject are required' });
        }

        db.get(
            `SELECT id, role, subject FROM account_users WHERE id = ? AND collegeName = ? AND role IN ('faculty','hos','hod')`,
            [facultyId, college],
            (err, row) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                if (!row) return res.status(404).json({ success: false, message: 'Faculty not found in your college' });

                db.run(
                    `DELETE FROM faculty_assignments WHERE user_id = ? AND collegeName = ? AND subject = ?`,
                    [facultyId, college, subjectName],
                    function (delErr) {
                        if (delErr) return res.status(500).json({ success: false, message: delErr.message });

                        // If HOS loses their master subject, demote to faculty for consistency
                        const currentMasterSubject = String(row.subject || '').trim();
                        if (row.role === 'hos' && currentMasterSubject && currentMasterSubject === String(subjectName).trim()) {
                            db.run(
                                `UPDATE account_users 
                                 SET role = 'faculty', 
                                     subject = '', 
                                     post = CASE WHEN LOWER(COALESCE(post, '')) = 'hos' THEN 'Faculty Member' ELSE post END 
                                 WHERE id = ?`,
                                [facultyId],
                                function (updErr) {
                                    if (updErr) return res.status(500).json({ success: false, message: updErr.message });
                                    return res.json({
                                        success: true,
                                        message: this.changes >= 0
                                            ? 'Subject de-assigned and HOS reverted to Faculty.'
                                            : 'Subject de-assigned successfully.'
                                    });
                                }
                            );
                        } else {
                            return res.json({
                                success: true,
                                message: `Subject de-assigned successfully.${this.changes === 0 ? ' No existing assignment rows were found.' : ''}`
                            });
                        }
                    }
                );
            }
        );
    });

    // Bulk Approve Contests (HOD sets hod_verified; accepts only when both verified)
    router.post('/hod/api/bulk-approve-contests', requireRole('hod'), (req, res) => {
        const { ids } = req.body;
        const hodId = req.session.user.id;
        const college = req.session.user.collegeName;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'No contests selected' });
        }
        getUsersManagedByHod(hodId, college)
            .then((managedUserIds) => {
                if (!managedUserIds.length) return res.status(403).json({ success: false, message: 'No managed users found for this HOD' });
                const idPlaceholders = ids.map(() => '?').join(',');
                const ownerPlaceholders = managedUserIds.map(() => '?').join(',');
                db.run(
                    `UPDATE contests
                     SET hod_verified = 1
                     WHERE id IN (${idPlaceholders}) AND createdBy IN (${ownerPlaceholders})`,
                    [...ids, ...managedUserIds],
                    function(err) {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        db.run(
                            `UPDATE contests
                             SET status = 'accepted', isVerified = 1, visibility_scope = 'college', approved_by = ?, approved_at = ?
                             WHERE id IN (${idPlaceholders}) AND createdBy IN (${ownerPlaceholders}) AND hos_verified = 1`,
                            [hodId, new Date().toISOString(), ...ids, ...managedUserIds],
                            function(err2) {
                                if (err2) return res.status(500).json({ success: false, message: err2.message });
                                res.json({ success: true, message: `${this.changes} contests fully approved. Others are pending HOS approval.` });
                            }
                        );
                    }
                );
            })
            .catch((error) => res.status(500).json({ success: false, message: error.message }));
    });
    // Approve Content (Problem/Contest)
    router.post('/hod/api/approve-content', requireRole(['hod', 'hos']), (req, res) => {
        const { id, type, action } = req.body;
        const dept = req.session.user.department;

        if (!id || !type) return res.status(400).json({ success: false, message: 'Missing id or type' });

        if (type === 'problem') {
            if (action === 'reject') {
                return db.run(`UPDATE problems SET status = 'rejected' WHERE id = ? AND department = ?`, [id, dept], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Problem rejected.' });
                });
            }
            db.get(`SELECT u.role as creatorRole FROM problems p JOIN account_users u ON p.faculty_id = u.id WHERE p.id = ? AND p.department = ?`, [id, dept], (infoErr, infoRow) => {
                if (infoErr) return res.status(500).json({ success: false, message: infoErr.message });
                if (!infoRow) return res.status(404).json({ success: false, message: 'Problem not found or not in your department' });
                if (String(infoRow.creatorRole || '').toLowerCase() === 'faculty') {
                    return res.status(400).json({ success: false, message: 'Faculty-created problems require HOS approval.' });
                }
                db.run(
                    `UPDATE problems SET hod_verified = 1, status = 'accepted', is_public = 1, approved_by = ?, approved_at = ? WHERE id = ? AND department = ?`,
                    [req.session.user.id, new Date().toISOString(), id, dept],
                    function(err) {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        res.json({ success: true, message: 'Problem approved.' });
                    }
                );
            });

        } else if (type === 'contest') {
            if (action === 'reject') {
                return getUsersManagedByHod(req.session.user.id, req.session.user.collegeName)
                    .then((managedUserIds) => {
                        if (!managedUserIds.length) return res.status(403).json({ success: false, message: 'No managed users found for this HOD' });
                        const ownerPlaceholders = managedUserIds.map(() => '?').join(',');
                        db.run(`UPDATE contests SET status = 'rejected' WHERE id = ? AND createdBy IN (${ownerPlaceholders})`, [id, ...managedUserIds], function(err) {
                            if (err) return res.status(500).json({ success: false, message: err.message });
                            if (!this.changes) return res.status(403).json({ success: false, message: 'Contest not found in your HOD scope' });
                            res.json({ success: true, message: 'Contest rejected.' });
                        });
                    })
                    .catch((error) => res.status(500).json({ success: false, message: error.message }));
            }
            getUsersManagedByHod(req.session.user.id, req.session.user.collegeName)
                .then((managedUserIds) => {
                    if (!managedUserIds.length) return res.status(403).json({ success: false, message: 'No managed users found for this HOD' });
                    const ownerPlaceholders = managedUserIds.map(() => '?').join(',');
                    db.get(`SELECT c.hos_verified, u.role as creatorRole FROM contests c JOIN account_users u ON c.createdBy = u.id WHERE c.id = ? AND c.createdBy IN (${ownerPlaceholders})`, [id, ...managedUserIds], (infoErr, infoRow) => {
                if (infoErr) return res.status(500).json({ success: false, message: infoErr.message });
                if (!infoRow) return res.status(404).json({ success: false, message: 'Contest not found in your HOD scope' });

                db.run(`UPDATE contests SET hod_verified = 1 WHERE id = ? AND createdBy IN (${ownerPlaceholders})`, [id, ...managedUserIds], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });

                    const creatorRole = String(infoRow.creatorRole || '').toLowerCase();
                    const shouldAccept = creatorRole === 'hos' || (creatorRole === 'faculty' && infoRow.hos_verified === 1);
                    if (!shouldAccept) {
                        return res.json({ success: true, message: 'HOD approval recorded. Waiting for HOS approval.' });
                    }
                    db.run(
                        `UPDATE contests SET status = 'accepted', isVerified = 1, visibility_scope = 'college', approved_by = ?, approved_at = ? WHERE id = ?`,
                        [req.session.user.id, new Date().toISOString(), id],
                        function(updErr) {
                            if (updErr) return res.status(500).json({ success: false, message: updErr.message });
                            res.json({ success: true, message: 'Contest approved and now visible to students.' });
                        }
                    );
                });
                    });
                })
                .catch((error) => res.status(500).json({ success: false, message: error.message }));
        } else {
            res.status(400).json({ success: false, message: 'Invalid type' });
        }
    });

    // --- HOD Contest APIs ---

    // Get Assigned Data (Subjects, Years, Sections)
    router.get('/hod/api/assigned-data', requireRole('hod'), (req, res) => {
        const userId = req.session.user.id;
        const college = req.session.user.collegeName;

        db.all(`SELECT DISTINCT subject, year, section FROM faculty_assignments WHERE user_id = ? AND collegeName = ?`, [userId, college], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            
            const subjects = [...new Set(rows.map(r => r.subject))];
            const years = [...new Set(rows.map(r => r.year))];
            const sections = [...new Set(rows.map(r => r.section))];
            
            res.json({ success: true, subjects, years, sections });
        });
    });

    // Get Available Problems for Contest
    router.get('/hod/api/available-problems', requireRole('hod'), (req, res) => {
        const userId = req.session.user.id;
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        // Fetch problems: created by HOD OR in HOD's department
        const query = `
            SELECT p.*, u.fullName as facultyName, u.role as creatorRole 
            FROM problems p
            LEFT JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id
            WHERE (p.department = ? AND u.collegeName = ?)
               OR (p.status = 'accepted' AND u.collegeName = ? AND LOWER(p.visibility_scope) = 'global')
                    OR (p.status IN ('accepted', 'active') AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin') AND LOWER(p.visibility_scope) = 'global')
            ORDER BY p.id DESC
        `;
        db.all(query, [dept, college, college], (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: rows });
        });
    });

    // Fetch All Contests (Department-wide + Admin college-wide)
    router.get('/hod/api/contests', requireRole('hod'), (req, res) => {
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;
        const hodId = req.session.user.id;
        db.all(
            `SELECT c.*, u.role as creatorRole FROM contests c
             LEFT JOIN account_users u ON c.createdBy = u.id
             WHERE (c.status = 'accepted' AND c.collegeName = ?)
                OR (c.department = ? AND c.collegeName = ?)
                OR c.createdBy = ?
                        OR (c.status = 'accepted' AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))
             ORDER BY c.id DESC`,
            [college, dept, college, hodId],
            (err, rows) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, data: (rows || []).map(normalizeContestRecord) });
            }
        );
    });

    router.get('/hod/api/problem-bookmarks', requireRole('hod'), (req, res) => {
        db.all(
            `SELECT problem_id FROM problem_bookmarks WHERE user_id = ? ORDER BY createdAt DESC`,
            [req.session.user.id],
            (err, rows) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, data: (rows || []).map((row) => row.problem_id) });
            }
        );
    });

    router.post('/hod/api/problem-bookmarks', requireRole('hod'), (req, res) => {
        const problemId = Number(req.body.problemId);
        if (!Number.isInteger(problemId)) return res.status(400).json({ success: false, message: 'Invalid problem ID' });

        db.run(
            `INSERT OR IGNORE INTO problem_bookmarks (user_id, problem_id) VALUES (?, ?)`,
            [req.session.user.id, problemId],
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, bookmarked: true });
            }
        );
    });

    router.delete('/hod/api/problem-bookmarks/:problemId', requireRole('hod'), (req, res) => {
        const problemId = Number(req.params.problemId);
        if (!Number.isInteger(problemId)) return res.status(400).json({ success: false, message: 'Invalid problem ID' });

        db.run(
            `DELETE FROM problem_bookmarks WHERE user_id = ? AND problem_id = ?`,
            [req.session.user.id, problemId],
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, bookmarked: false });
            }
        );
    });

    // Create Contest
    router.post('/hod/api/create-contest', requireRole('hod'), (req, res) => {
        const { title, date, startDate, endDate, deadline, registrationEndDate, duration, description, rulesAndDescription, guidelines, eligibility, problems, subject } = req.body;
        const createdBy = req.session.user.id;
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;
        const start = startDate || date;
        const resolvedEndDate = endDate || deriveEndDateFromDuration(start, duration);
        const regDeadline = registrationEndDate || deadline || null;
        const computedDuration = computeDurationFromRange(start, resolvedEndDate) || duration || null;

        if (!title || !start || !resolvedEndDate) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        if (!computedDuration) return res.status(400).json({ success: false, message: 'End time must be after start time' });

        const query = `
            INSERT INTO contests (
                title, date, startDate, endDate, registrationEndDate, deadline, duration, description, rulesAndDescription, guidelines,
                eligibility, problems, department, collegeName, subject, createdBy, created_by, status, hos_verified, hod_verified, isVerified, approved_by, approved_at, createdAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', 1, 1, 1, ?, ?, CURRENT_TIMESTAMP)
        `;
        const params = [
            title, start, start, resolvedEndDate, regDeadline, regDeadline, computedDuration, description || null, rulesAndDescription || null, guidelines || '',
            eligibility || null, problems || '[]', dept, college, subject || '', createdBy, createdBy, createdBy, new Date().toISOString()
        ];

        db.run(query, params, function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, id: this.lastID, message: 'Contest created successfully' });
        });
    });

    // Update Contest
    router.post('/hod/api/update-contest', requireRole('hod'), (req, res) => {
        const { id, title, date, startDate, endDate, deadline, registrationEndDate, duration, description, rulesAndDescription, guidelines, eligibility, problems, subject } = req.body;
        const creatorId = req.session.user.id;
        const start = startDate || date;
        const resolvedEndDate = endDate || deriveEndDateFromDuration(start, duration);
        const regDeadline = registrationEndDate || deadline || null;
        const computedDuration = computeDurationFromRange(start, resolvedEndDate) || duration || null;

        if (!id) return res.status(400).json({ success: false, message: 'Missing contest ID' });
        if (!computedDuration) return res.status(400).json({ success: false, message: 'End time must be after start time' });

        const query = `
            UPDATE contests SET 
                title = ?, date = ?, startDate = ?, endDate = ?, registrationEndDate = ?, deadline = ?, duration = ?, description = ?, 
                rulesAndDescription = ?, guidelines = ?, eligibility = ?, problems = ?, subject = ?
            WHERE id = ? AND createdBy = ?
        `;
        const params = [
            title, start, start, resolvedEndDate, regDeadline, regDeadline, computedDuration, description || null,
            rulesAndDescription || null, guidelines || '', eligibility || null, problems || '[]', subject || '', id, creatorId
        ];

        db.run(query, params, function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (this.changes === 0) return res.status(403).json({ success: false, message: 'Only contest creator can update this contest' });
            res.json({ success: true, message: 'Contest updated successfully' });
        });
    });

    // Delete Contest
    router.post('/hod/api/delete-contest', requireRole('hod'), (req, res) => {
        const { id } = req.body;
        const creatorId = req.session.user.id;
        db.run(`DELETE FROM contests WHERE id = ? AND createdBy = ?`, [id, creatorId], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (this.changes === 0) return res.status(403).json({ success: false, message: 'Only contest creator can delete this contest' });
            res.json({ success: true, message: 'Contest deleted successfully' });
        });
    });

    // Delete Faculty (from HOD)
    router.post('/hod/api/delete-faculty', requireRole('hod'), (req, res) => {
        const { id } = req.body;
        const college = req.session.user.collegeName;

        db.serialize(() => {
            db.run('DELETE FROM faculty_assignments WHERE user_id = ? AND collegeName = ?', [id, college]);
            db.run('DELETE FROM account_users WHERE id = ? AND collegeName = ? AND role IN ("faculty","hos") AND (is_hod = 0 OR is_hod IS NULL)', [id, college], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                if (this.changes === 0) return res.status(404).json({ success: false, message: 'Faculty not found in your college' });
                res.json({ success: true, message: 'Faculty removed successfully' });
            });
        });
    });

    return router;
};



