const express = require('express');
const { requireRole } = require('../middleware/auth');
const { checkScope } = require('../middleware/authMiddleware');

module.exports = (db) => {
    const router = express.Router();

    // Helper: Get HOS's assigned subjects
    const getAssignedSubjects = (userId, collegeName = '') => {
        return new Promise((resolve, reject) => {
            let sql = `SELECT DISTINCT subject FROM faculty_assignments WHERE user_id = ?`;
            const params = [userId];
            if (collegeName) {
                sql += ` AND COALESCE(collegeName, '') = ?`;
                params.push(collegeName);
            }
            db.all(sql, params, (err, rows) => {
                if (err) return reject(err);
                resolve(rows.map(r => r.subject));
            });
        });
    };

    const getFacultyUnderHos = (hosId, collegeName, subjects) => {
        return new Promise((resolve, reject) => {
            if (!subjects || subjects.length === 0) return resolve([]);
            const placeholders = subjects.map(() => '?').join(',');
            const sql = `
                SELECT DISTINCT u.id
                FROM account_users u
                JOIN faculty_assignments ua ON ua.user_id = u.id
                WHERE LOWER(COALESCE(u.role, '')) = 'faculty'
                  AND u.id <> ?
                  AND ua.subject IN (${placeholders})
                  AND (COALESCE(ua.collegeName, '') = ? OR COALESCE(u.collegeName, '') = ?)
            `;
            db.all(sql, [hosId, ...subjects, collegeName, collegeName], (err, rows) => {
                if (err) return reject(err);
                resolve((rows || []).map((row) => row.id));
            });
        });
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

    // Middleware: Ensure subjects are available for all HOS views (profile overlay)
    router.use('/hos', requireRole('hos'), checkScope, async (req, res, next) => {
        try {
            const subjects = await getAssignedSubjects(req.session.user.id, req.session.user.collegeName);
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
                return res.render('hos/dashboard.html', {
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
                db.get(`SELECT COUNT(DISTINCT user_id) as count FROM faculty_assignments WHERE subject IN (${subjectPlaceholders})`, subjects, (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });
            stats.facultyCount = facultyCountRow.count;

            // 3. Students Count (College & Department scoped)
            const studentCountRow = await new Promise((resolve, reject) => {
                db.get(`SELECT COUNT(*) as count FROM account_users WHERE role = 'student' AND collegeName = ? AND department = ?`, [college, req.session.user.department], (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });
            stats.studentCount = studentCountRow.count;

            // 4. Sections Count (Unique sections across all assigned subjects)
            const sectionsCountRow = await new Promise((resolve, reject) => {
                db.get(`SELECT COUNT(DISTINCT section) as count FROM faculty_assignments WHERE subject IN (${subjectPlaceholders})`, subjects, (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });
            stats.sectionsCount = sectionsCountRow.count;

            // Recently Pending Items
            const pendingQuestions = await new Promise((resolve, reject) => {
                db.all(`SELECT p.*, u.fullName as facultyName FROM problems p JOIN account_users u ON p.faculty_id = u.id WHERE (p.subject IN (${subjectPlaceholders}) OR p.faculty_id = ?) AND p.status = 'pending' ORDER BY p.id DESC LIMIT 5`, [...subjects, hosId], (err, rows) => {
                    if (err) reject(err); else resolve(rows);
                });
            });

            const pendingContests = await new Promise((resolve, reject) => {
                db.all(`SELECT c.*, u.fullName as creatorName FROM contests c JOIN account_users u ON c.createdBy = u.id WHERE (c.subject IN (${subjectPlaceholders}) OR c.createdBy = ?) AND c.status = 'pending' ORDER BY c.id DESC LIMIT 5`, [...subjects, hosId], (err, rows) => {
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
                db.all(`SELECT p.title, p.status, p.createdAt, 'problem' as type, u.fullName as author FROM problems p JOIN account_users u ON p.faculty_id = u.id WHERE (p.subject IN (${subjectPlaceholders}) OR p.faculty_id = ?) ORDER BY p.createdAt DESC LIMIT 5`, [...subjects, hosId], (err, rows) => {
                    if (err) reject(err); else resolve(rows || []);
                });
            });
            const recentContestsAll = await new Promise((resolve, reject) => {
                db.all(`SELECT c.title, c.status, c.createdAt, 'contest' as type, u.fullName as author FROM contests c JOIN account_users u ON c.createdBy = u.id WHERE (c.subject IN (${subjectPlaceholders}) OR c.createdBy = ?) ORDER BY c.createdAt DESC LIMIT 5`, [...subjects, hosId], (err, rows) => {
                    if (err) reject(err); else resolve(rows || []);
                });
            });
            const recentActivity = [...recentProblems, ...recentContestsAll]
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                .slice(0, 5);

            res.render('hos/dashboard.html', {
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
                    // HOS approval should publish to college scope, not global scope.
                    updateSql = `UPDATE problems SET status = ?, hod_comments = ?, hos_verified = 1, is_public = 1, visibility_scope = 'college', scope = 'college' WHERE id = ?`;
                    params = [status, comments || '', problemId];
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
            const subjects = await getAssignedSubjects(hosId, college);
            const facultyIds = await getFacultyUnderHos(hosId, req.session.user.collegeName, subjects);
            if (facultyIds.length === 0) {
                return res.status(403).json({ success: false, error: "Access Denied: No mapped faculty found under this HOS." });
            }
            const facultyPlaceholders = facultyIds.map(() => '?').join(',');
            db.get(`SELECT c.id FROM contests c JOIN account_users u ON u.id = c.createdBy WHERE c.id = ? AND LOWER(COALESCE(u.role,'')) = 'faculty' AND c.createdBy IN (${facultyPlaceholders})`, [contestId, ...facultyIds], (err, row) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (!row) {
                    return res.status(403).json({ success: false, error: "Access Denied: This contest creator is not mapped under your HOS scope." });
                }
                db.run(`UPDATE contests SET hos_verified = CASE WHEN ? IN ('accepted','approved') THEN 1 ELSE hos_verified END, status = CASE WHEN ? IN ('accepted','approved') AND hod_verified = 1 THEN 'accepted' ELSE status END WHERE id = ?`, [status, status, contestId], function(err) {
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
            const subjects = await getAssignedSubjects(hosId, req.session.user.collegeName);
            
            // Fetch all global accepted problems from the college, HOS's own problems, and accepted problems from assigned subjects
            let problemSql = `SELECT p.*, u.fullName as facultyName, u.role as creatorRole
                               FROM problems p 
                               LEFT JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id 
                               WHERE (p.status = 'accepted' AND u.collegeName = ? AND LOWER(p.visibility_scope) = 'global') 
                OR (p.status IN ('accepted', 'active') AND LOWER(p.visibility_scope) = 'global' AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))
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
                const allProblems = problems || [];
                const myProblems = allProblems.filter(p => p.faculty_id === hosId);

                db.all(
                    `SELECT problem_id FROM problem_bookmarks WHERE user_id = ?`,
                    [hosId],
                    (bookmarkErr, bookmarkRows) => {
                        if (bookmarkErr) return res.status(500).send(bookmarkErr.message);
                        const bookmarkedProblemIds = (bookmarkRows || []).map((row) => row.problem_id);
                        const bookmarkedSet = new Set(bookmarkedProblemIds);
                        const bookmarkedProblems = allProblems.filter((problem) => bookmarkedSet.has(problem.id));

                        res.render('hos/problem.html', {
                            user: req.session.user,
                            problems: allProblems,
                            myProblems,
                            bookmarkedProblemIds,
                            bookmarkedProblems,
                            subjects,
                            currentPage: 'problem'
                        });
                    }
                );
            });
        } catch (e) { res.status(500).send(e.message); }
    });

    router.get('/hos/contest', requireRole('hos'), checkScope, async (req, res) => {
        try {
            const hosId = req.session.user.id;
            const college = req.session.user.collegeName;
            const subjects = await getAssignedSubjects(hosId);
            
            const placeholders = subjects.length > 0 ? subjects.map(() => '?').join(',') : null;
    let query = `SELECT c.*, u.fullName as creatorName FROM contests c JOIN account_users u ON c.createdBy = u.id WHERE (u.collegeName = ? AND c.status = 'accepted') OR c.createdBy = ? OR (LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin') AND c.status = 'accepted')`;
            let params = [college, hosId];

            if (placeholders) {
                query += ` OR c.subject IN (${placeholders})`;
                params.push(...subjects);
            }
            query += ` ORDER BY c.createdAt DESC`;

            const contests = await new Promise((resolve, reject) => {
                db.all(query, params, (err, rows) => {
                    if (err) reject(err); else resolve((rows || []).map(normalizeContestRecord));
                });
            });

            // Also fetch problems for the problem selection dropdown in contest form
            let problemsQuery = `
                SELECT p.id, p.title, p.difficulty, p.subject 
                FROM problems p 
                LEFT JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id 
                WHERE p.status IN ('accepted', 'active') 
                  AND (
                      (u.collegeName = ? AND LOWER(p.visibility_scope) = 'global')
                        OR (LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin') AND LOWER(p.visibility_scope) = 'global')
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

            res.render('hos/contest.html', { 
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
            const subjects = await getAssignedSubjects(hosId, req.session.user.collegeName);

            if (!subjects.length) {
                return res.render('hos/faculty.html', {
                    user: req.session.user,
                    faculty: [],
                    subjects: [],
                    facultySummary: {
                        totalFaculty: 0,
                        sectionsCount: 0,
                        activeContestCount: 0,
                        facultyCountBySubject: {},
                        sectionsCountBySubject: {},
                        activeContestCountBySubject: {}
                    },
                    currentPage: 'faculty'
                });
            }

            const placeholders = subjects.map(() => '?').join(',');
            const collegeName = req.session.user.collegeName;
            const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
                db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || [])));
            });
            const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
                db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row || {})));
            });

            const [facultyRows, sectionsRows, activeContestRows] = await Promise.all([
                dbAll(
                    `SELECT
                        sa.user_id AS id,
                        COALESCE(au.fullName, f.fullName, 'Unknown Faculty') AS fullName,
                        COALESCE(au.email, f.email, '') AS email,
                        COALESCE(NULLIF(au.post, ''), NULLIF(f.post, ''), UPPER(COALESCE(au.role, f.role, 'faculty'))) AS post,
                        COALESCE(NULLIF(au.department, ''), NULLIF(au.branch, ''), NULLIF(f.department, ''), NULLIF(f.branch, ''), '') AS department,
                        COALESCE(NULLIF(au.status, ''), NULLIF(f.status, ''), 'active') AS status,
                        COALESCE(au.joiningDate, f.joiningDate, '') AS joiningDate,
                        (SELECT COUNT(*) FROM problems p WHERE p.faculty_id = sa.user_id) AS problems_created,
                        GROUP_CONCAT(DISTINCT sa.subject) AS teaching_subjects
                     FROM faculty_assignments sa
                     LEFT JOIN account_users au ON au.id = sa.user_id
                     LEFT JOIN faculty f ON f.id = sa.user_id
                     WHERE sa.subject IN (${placeholders})
                       AND LOWER(COALESCE(sa.collegeName, COALESCE(au.collegeName, f.collegeName, ''))) = LOWER(?)
                       AND sa.user_id <> ?
                       AND LOWER(COALESCE(au.role, f.role, 'faculty')) IN ('faculty', 'hos')
                     GROUP BY sa.user_id
                     ORDER BY fullName COLLATE NOCASE ASC`,
                    [...subjects, String(collegeName || '').toLowerCase(), hosId]
                ),
                dbAll(
                    `SELECT subject, COUNT(DISTINCT section) as count
                     FROM faculty_assignments
                     WHERE subject IN (${placeholders})
                     GROUP BY subject`,
                    subjects
                ),
                dbAll(
                    `SELECT subject, COUNT(*) as count
                     FROM contests
                     WHERE subject IN (${placeholders})
                       AND (
                         LOWER(COALESCE(status, '')) IN ('active','ongoing','live')
                         OR (startDate IS NOT NULL AND endDate IS NOT NULL AND datetime('now') BETWEEN datetime(startDate) AND datetime(endDate))
                       )
                     GROUP BY subject`,
                    subjects
                )
            ]);

            const facultyCountBySubject = {};
            for (const subject of subjects) facultyCountBySubject[subject] = 0;
            for (const fac of facultyRows) {
                const subjectList = String(fac.teaching_subjects || '')
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                for (const subject of subjectList) {
                    facultyCountBySubject[subject] = (facultyCountBySubject[subject] || 0) + 1;
                }
            }

            const sectionsCountBySubject = {};
            for (const subject of subjects) sectionsCountBySubject[subject] = 0;
            for (const row of sectionsRows) sectionsCountBySubject[row.subject] = Number(row.count || 0);

            const activeContestCountBySubject = {};
            for (const subject of subjects) activeContestCountBySubject[subject] = 0;
            for (const row of activeContestRows) activeContestCountBySubject[row.subject] = Number(row.count || 0);

            const sectionsCountRow = await dbGet(
                `SELECT COUNT(DISTINCT section) as count
                 FROM faculty_assignments
                 WHERE subject IN (${placeholders})`,
                subjects
            );
            const activeContestCountRow = await dbGet(
                `SELECT COUNT(*) as count
                 FROM contests
                 WHERE subject IN (${placeholders})
                   AND (
                     LOWER(COALESCE(status, '')) IN ('active','ongoing','live')
                     OR (startDate IS NOT NULL AND endDate IS NOT NULL AND datetime('now') BETWEEN datetime(startDate) AND datetime(endDate))
                   )`,
                subjects
            );

            res.render('hos/faculty.html', {
                user: req.session.user,
                faculty: facultyRows || [],
                subjects,
                facultySummary: {
                    totalFaculty: facultyRows.length,
                    sectionsCount: Number(sectionsCountRow.count || 0),
                    activeContestCount: Number(activeContestCountRow.count || 0),
                    facultyCountBySubject,
                    sectionsCountBySubject,
                    activeContestCountBySubject
                },
                currentPage: 'faculty'
            });
        } catch (e) { res.status(500).send(e.message); }
    });
    router.get('/hos/student', requireRole('hos'), checkScope, async (req, res) => {
        const college = req.session.user.collegeName;
        const department = req.session.user.department;
        try {
            const students = await new Promise((resolve, reject) => {
                db.all(`SELECT id, fullName, email, course, department, joiningDate 
                        FROM account_users 
                        WHERE role = 'student' AND collegeName = ? AND department = ? 
                        ORDER BY fullName ASC`,
                    [college, department], (err, rows) => {
                        if (err) reject(err); else resolve(rows || []);
                    });
            });

            const years = await new Promise((resolve) => {
                db.all(`SELECT DISTINCT section as year_name FROM faculty_assignments WHERE 1=0`, [], (e, r) => resolve([]));
            });
            const sections = await new Promise((resolve) => {
                db.all(`SELECT DISTINCT section as section_name FROM faculty_assignments WHERE 1=0`, [], (e, r) => resolve([]));
            });

            res.render('hos/student.html', {
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
    router.get('/hos/community', requireRole('hos'), checkScope, (req, res) => res.render('hos/community.html', { user: req.session.user, currentPage: 'community' }));
    const renderHosProfile = async (req, res) => {
        const dbGet = (sql, params = []) => new Promise((resolve) => db.get(sql, params, (err, row) => resolve(err ? null : row)));
        try {
            const hosId = req.session.user.id;
            const college = req.session.user.collegeName;
            const department = req.session.user.department;
            const subjects = await getAssignedSubjects(hosId, college);

            const subjectPlaceholders = subjects.length ? subjects.map(() => '?').join(',') : null;

            const [studentsRow, facultyRow, contestsRow] = await Promise.all([
                dbGet(`SELECT COUNT(*) as count FROM account_users WHERE role = 'student' AND collegeName = ? AND department = ?`, [college, department]),
                (subjectPlaceholders
                    ? dbGet(
                        `SELECT COUNT(DISTINCT sa.user_id) as count
                         FROM faculty_assignments sa
                         LEFT JOIN account_users u ON u.id = sa.user_id
                         WHERE sa.subject IN (${subjectPlaceholders})
                           AND LOWER(COALESCE(sa.collegeName, COALESCE(u.collegeName, ''))) = LOWER(?)
                           AND sa.user_id <> ?`,
                        [...subjects, college, hosId]
                    )
                    : Promise.resolve({ count: 0 })),
                dbGet(`SELECT COUNT(*) as count FROM contests WHERE department = ? AND (collegeName IS NULL OR collegeName = '' OR collegeName = ?)`, [department, college])
            ]);

            const stats = {
                students: Number(studentsRow?.count || 0),
                faculty: Number(facultyRow?.count || 0),
                contests: Number(contestsRow?.count || 0),
                activeStudents: 0
            };

            let profilePerformance = {
                coverage: 0,
                engagement: 0,
                contests: 0,
                mentoring: 0,
                outcomes: 0
            };

            if (subjects.length > 0) {
                const placeholders = subjects.map(() => '?').join(',');
                const [subjectContestTotalRow, subjectContestActiveRow, submissionStatsRow, distinctSubmittingStudentsRow, distinctFacultyBySubjectRow] = await Promise.all([
                    dbGet(`SELECT COUNT(*) as count FROM contests WHERE subject IN (${placeholders})`, subjects),
                    dbGet(`SELECT COUNT(*) as count
                           FROM contests
                           WHERE subject IN (${placeholders})
                             AND (
                               LOWER(COALESCE(status, '')) IN ('active','ongoing','live')
                               OR (startDate IS NOT NULL AND endDate IS NOT NULL AND datetime('now') BETWEEN datetime(startDate) AND datetime(endDate))
                             )`, subjects),
                    dbGet(`SELECT COUNT(*) as totalSubmissions,
                                  SUM(CASE WHEN LOWER(COALESCE(s.status, '')) IN ('accepted','ac') THEN 1 ELSE 0 END) as acceptedSubmissions
                           FROM submissions s
                           JOIN problems p ON p.id = s.problem_id
                           WHERE p.subject IN (${placeholders})`, subjects),
                    dbGet(`SELECT COUNT(DISTINCT s.user_id) as count
                           FROM submissions s
                           JOIN problems p ON p.id = s.problem_id
                           JOIN account_users u ON u.id = s.user_id
                           WHERE p.subject IN (${placeholders})
                             AND u.role = 'student'
                             AND u.collegeName = ?
                             AND u.department = ?`, [...subjects, college, department]),
                    dbGet(`SELECT COUNT(DISTINCT user_id) as count
                           FROM faculty_assignments
                           WHERE subject IN (${placeholders})`, subjects)
                ]);

                const totalSubmissions = Number(submissionStatsRow?.totalSubmissions || 0);
                const acceptedSubmissions = Number(submissionStatsRow?.acceptedSubmissions || 0);
                const totalSubjectContests = Number(subjectContestTotalRow?.count || 0);
                const activeSubjectContests = Number(subjectContestActiveRow?.count || 0);
                const distinctSubmittingStudents = Number(distinctSubmittingStudentsRow?.count || 0);
                const distinctFacultyBySubject = Number(distinctFacultyBySubjectRow?.count || 0);
                stats.activeStudents = distinctSubmittingStudents;

                const toPercent = (value, maxValue) => {
                    if (!maxValue || maxValue <= 0) return 0;
                    return Math.max(0, Math.min(100, Math.round((value / maxValue) * 100)));
                };

                profilePerformance = {
                    coverage: toPercent(distinctSubmittingStudents, stats.students),
                    engagement: toPercent(totalSubmissions, Math.max(1, stats.students * 5)),
                    contests: toPercent(activeSubjectContests, totalSubjectContests),
                    mentoring: toPercent(distinctFacultyBySubject, stats.faculty),
                    outcomes: toPercent(acceptedSubmissions, totalSubmissions)
                };
            }

            res.render('hos/profile.html', {
                user: req.session.user,
                currentPage: 'profile',
                profileStats: stats,
                profilePerformance
            });
        } catch (e) {
            console.error('HOS Profile Error:', e);
            res.render('hos/profile.html', {
                user: req.session.user,
                currentPage: 'profile',
                profileStats: { students: 0, faculty: 0, contests: 0, activeStudents: 0 },
                profilePerformance: { coverage: 0, engagement: 0, contests: 0, mentoring: 0, outcomes: 0 }
            });
        }
    };
    router.get('/hos/profile', requireRole('hos'), checkScope, renderHosProfile);
    router.get('/college/hos/profile', requireRole('hos'), checkScope, renderHosProfile);
    router.get('/hos/report', requireRole('hos'), checkScope, async (req, res) => {
        const dbAll = (sql, params = []) =>
            new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || []))));
        try {
            const hosId = req.session.user.id;
            const college = String(req.session.user.collegeName || '');
            const department = String(req.session.user.department || '');
            const subjects = await getAssignedSubjects(hosId);

            let problems = [];
            let contests = [];
            let faculty = [];
            if (subjects.length > 0) {
                const placeholders = subjects.map(() => '?').join(',');

                problems = await dbAll(
                    `SELECT p.id, p.title, p.subject, p.difficulty, p.status, p.tags, p.createdAt, p.points,
                            COUNT(s.id) AS totalSubmissions,
                            SUM(CASE WHEN LOWER(COALESCE(s.status, '')) IN ('accepted','ac') THEN 1 ELSE 0 END) AS acceptedSubmissions
                     FROM problems p
                     LEFT JOIN submissions s ON s.problem_id = p.id
                     WHERE p.subject IN (${placeholders})
                     GROUP BY p.id
                     ORDER BY p.id DESC`,
                    subjects
                );

                contests = await dbAll(
                    `SELECT c.id, c.title, c.subject, c.status, c.contest_class, c.prize, c.guidelines, c.startDate, c.endDate, c.createdAt,
                            COUNT(DISTINCT cp.user_id) AS participants
                     FROM contests c
                     LEFT JOIN contest_participants cp ON cp.contest_id = c.id
                     WHERE c.subject IN (${placeholders})
                     GROUP BY c.id
                     ORDER BY COALESCE(c.startDate, c.createdAt) DESC`,
                    subjects
                );

                faculty = await dbAll(
                    `SELECT u.id, u.fullName, u.email, u.role, u.post, u.department, u.course, u.program, u.status, u.joiningDate,
                            (SELECT COUNT(*) FROM problems WHERE faculty_id = u.id) AS problems_created
                     FROM account_users u
                     JOIN faculty_assignments sa ON u.id = sa.user_id
                     WHERE sa.subject IN (${placeholders}) AND u.collegeName = ? AND u.role IN ('faculty','hos')
                     GROUP BY u.id
                     ORDER BY u.fullName ASC`,
                    [...subjects, college]
                );
            }

            const studentsRaw = await dbAll(
                `SELECT id, fullName, email, course, program, department, year, section, points, solvedCount, rank, joiningDate
                 FROM account_users
                 WHERE role = 'student' AND collegeName = ? AND department = ?
                 ORDER BY fullName ASC`,
                [college, department]
            );
            const studentIds = studentsRaw.map((s) => s.id);
            const submissionsByStudent = studentIds.length
                ? await dbAll(
                    `SELECT user_id, COUNT(*) AS total,
                            SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('accepted','ac') THEN 1 ELSE 0 END) AS accepted
                     FROM submissions
                     WHERE user_id IN (${studentIds.map(() => '?').join(',')})
                     GROUP BY user_id`,
                    studentIds
                )
                : [];
            const subMap = new Map(submissionsByStudent.map((r) => [r.user_id, r]));
            const students = studentsRaw.map((s) => {
                const sub = subMap.get(s.id) || { total: 0, accepted: 0 };
                return {
                    ...s,
                    submissions: Number(sub.total || 0),
                    acceptedSubmissions: Number(sub.accepted || 0)
                };
            });

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
            const progress = progressRows.slice().reverse().map((row) => {
                const total = Number(row.total || 0);
                const accepted = Number(row.accepted || 0);
                return {
                    month: row.monthKey,
                    totalSubmissions: total,
                    acceptedSubmissions: accepted,
                    acceptanceRate: total ? Math.round((accepted * 10000) / total) / 100 : 0
                };
            });

            const totalSubmissions = progress.reduce((acc, r) => acc + Number(r.totalSubmissions || 0), 0);
            const totalAccepted = progress.reduce((acc, r) => acc + Number(r.acceptedSubmissions || 0), 0);
            const uniq = (arr) => [...new Set((arr || []).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));

            const reportData = {
                generatedAt: new Date().toISOString(),
                scope: { college, department, subjects },
                summary: {
                    facultyCount: faculty.length,
                    studentCount: students.length,
                    problemCount: problems.length,
                    contestCount: contests.length,
                    submissionCount: totalSubmissions,
                    acceptanceRate: totalSubmissions ? Math.round((totalAccepted * 10000) / totalSubmissions) / 100 : 0
                },
                filters: {
                    years: uniq(students.map((s) => s.year)),
                    sections: uniq(students.map((s) => s.section)),
                    departments: uniq(students.map((s) => s.department).concat(faculty.map((f) => f.department))),
                    programs: uniq(students.map((s) => s.program || s.course).concat(faculty.map((f) => f.program || f.course))),
                    difficulties: uniq(problems.map((p) => p.difficulty)),
                    statuses: uniq(problems.map((p) => p.status).concat(contests.map((c) => c.status))),
                    subjects: uniq((subjects || []).concat(problems.map((p) => p.subject)).concat(contests.map((c) => c.subject))),
                    contestClasses: uniq(contests.map((c) => c.contest_class))
                },
                problems,
                contests,
                faculty,
                students,
                progress
            };

            res.render('hos/report.html', {
                user: req.session.user,
                currentPage: 'report',
                reportData
            });
        } catch (e) {
            console.error('HOS Report Error:', e);
            res.status(500).send("Internal Server Error");
        }
    });
    router.get('/hos/help', requireRole('hos'), checkScope, (req, res) => res.render('hos/help.html', { user: req.session.user, currentPage: 'help' }));
    router.get('/hos/settings', requireRole('hos'), checkScope, (req, res) => res.render('hos/settings.html', { user: req.session.user, currentPage: 'settings' }));

    router.post('/hos/settings/update', requireRole('hos'), checkScope, (req, res) => {
        const { fullName, email, gender, mobile } = req.body;
        const userId = req.session.user.id;
        db.run(
            `UPDATE account_users SET fullName = ?, email = ?, gender = ?, mobile = ? WHERE id = ?`,
            [fullName, email, gender, mobile, userId],
            (err) => {
                if (err) {
                    console.error('HOS Settings Update Error:', err);
                    return res.render('hos/settings.html', { user: req.session.user, currentPage: 'settings', error: 'Failed to update settings.' });
                }
                // Refresh session
                req.session.user.fullName = fullName;
                req.session.user.email = email;
                req.session.user.gender = gender;
                req.session.user.mobile = mobile;
                res.render('hos/settings.html', { user: req.session.user, currentPage: 'settings', success: true });
            }
        );
    });

    // Pending Questions - Full Dynamic Data
    router.get('/hos/pending-questions', requireRole('hos'), checkScope, async (req, res) => {
        try {
            const hosId = req.session.user.id;
            const subjects = await getAssignedSubjects(hosId);

            if (subjects.length === 0) {
                return res.render('hos/pending_questions.html', {
                    user: req.session.user, currentPage: 'pending-questions',
                    questions: [], subjects: [],
                    questionStats: { total: 0, approved: 0, rejected: 0, thisWeek: 0 }
                });
            }

            const ph = subjects.map(() => '?').join(',');

            const questions = await new Promise((resolve, reject) => {
                db.all(`SELECT p.id, p.title, p.difficulty, p.subject, p.status, p.createdAt, p.description, p.input_format, p.output_format, p.constraints, p.sample_input, p.sample_output, p.hod_comments, u.fullName as faculty
                    FROM problems p JOIN account_users u ON p.faculty_id = u.id
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

            res.render('hos/pending_questions.html', {
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
            const subjects = await getAssignedSubjects(hosId, req.session.user.collegeName);
            const facultyIds = await getFacultyUnderHos(hosId, req.session.user.collegeName, subjects);

            if (subjects.length === 0 || facultyIds.length === 0) {
                return res.render('hos/pending_contests.html', {
                    user: req.session.user, currentPage: 'pending-contests',
                    contests: [], subjects: [],
                    contestStats: { total: 0, approved: 0, rejected: 0, upcoming: 0 }
                });
            }

            const facultyPh = facultyIds.map(() => '?').join(',');

            const contests = await new Promise((resolve, reject) => {
                db.all(`SELECT c.id, c.title, c.subject, c.status, c.startDate as start_date, c.endDate as end_date, c.createdAt, c.department, c.hos_verified, c.hod_verified, u.fullName as faculty, u.role as creatorRole
                    FROM contests c JOIN account_users u ON c.createdBy = u.id
                    WHERE c.status = 'pending'
                      AND COALESCE(c.hos_verified, 0) = 0
                      AND LOWER(COALESCE(u.role, '')) = 'faculty'
                      AND c.createdBy IN (${facultyPh})
                    ORDER BY c.createdAt DESC`, [...facultyIds], (err, rows) => {
                    if (err) reject(err); else resolve(rows || []);
                });
            });

            const pending = contests.filter(c => c.status === 'pending').length;
            const approved = contests.filter(c => c.status === 'accepted').length;
            const rejected = contests.filter(c => c.status === 'rejected').length;
            const upcoming = contests.filter(c => c.start_date && new Date(c.start_date) > new Date()).length;

            res.render('hos/pending_contests.html', {
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
            sample_input, sample_output, hidden_test_cases, tags
        } = req.body;
        
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
        
        db.run(
            `INSERT INTO problems (title, subject, difficulty, points, description, input_format, output_format, constraints, sample_input, sample_output, hidden_test_cases, tags, faculty_id, created_by, department, status, visibility_scope, is_public, hos_verified, approved_by, approved_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', 'global', 1, 1, ?, ?)`,
            [
                title, subject, difficulty, calculatedPoints, description, 
                input_format || '', output_format || '', constraints || '', 
                sample_input || '', sample_output || '', hidden_test_cases || '', 
                tags || '', user.id, user.id, user.department, user.id, new Date().toISOString()
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
            sample_input, sample_output, hidden_test_cases, tags
        } = req.body;
        const problemId = req.params.id;

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

        db.run(
            `UPDATE problems SET 
                title = ?, subject = ?, difficulty = ?, points = ?, description = ?, 
                input_format = ?, output_format = ?, constraints = ?, 
                sample_input = ?, sample_output = ?, hidden_test_cases = ?, tags = ?
             WHERE id = ? AND faculty_id = ?`,
            [
                title, subject, difficulty, calculatedPoints, description, 
                input_format || '', output_format || '', constraints || '', 
                sample_input || '', sample_output || '', hidden_test_cases || '', tags || '',
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
                     LEFT JOIN account_users u ON c.createdBy = u.id
                     WHERE (c.status = 'accepted' AND c.collegeName = ?)
                        OR c.createdBy = ?
                        OR (c.status = 'accepted' AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))`;
        const params = [college, hosId];

        if (subjects.length > 0) {
            const ph = subjects.map(() => '?').join(',');
            query += ` OR c.subject IN (${ph})`;
            params.push(...subjects);
        }
        query += ' ORDER BY c.id DESC';

        db.all(query, params, (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, data: (rows || []).map(normalizeContestRecord) });
        });
    });

    router.get('/hos/api/problem-bookmarks', requireRole('hos'), checkScope, (req, res) => {
        db.all(
            `SELECT problem_id FROM problem_bookmarks WHERE user_id = ? ORDER BY createdAt DESC`,
            [req.session.user.id],
            (err, rows) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, data: (rows || []).map((row) => row.problem_id) });
            }
        );
    });

    router.post('/hos/api/problem-bookmarks', requireRole('hos'), checkScope, (req, res) => {
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

    router.delete('/hos/api/problem-bookmarks/:problemId', requireRole('hos'), checkScope, (req, res) => {
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

    // Create Contest API
    router.post('/hos/api/create-contest', requireRole('hos'), checkScope, (req, res) => {
        const { title, date, startDate, endDate, deadline, registrationEndDate, duration, eligibility, description, rulesAndDescription, guidelines, problems, subject } = req.body;
        const user = req.session.user;
        const start = startDate || date;
        const resolvedEndDate = endDate || deriveEndDateFromDuration(start, duration);
        const regDeadline = registrationEndDate || deadline || null;
        const computedDuration = computeDurationFromRange(start, resolvedEndDate) || duration || null;
        if (!title || !start || !resolvedEndDate) return res.json({ success: false, message: 'Title, start date and end date are required.' });
        if (!computedDuration) return res.json({ success: false, message: 'End time must be after start time.' });

        db.run(
            `INSERT INTO contests (
                title, date, startDate, endDate, registrationEndDate, deadline, duration, eligibility, description,
                rulesAndDescription, guidelines, problems, createdBy, created_by, status, department, collegeName, subject, hos_verified, hod_verified
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, 1, 0)`,
            [
                title, start, start, resolvedEndDate, regDeadline, regDeadline, computedDuration, eligibility || null, description || null,
                rulesAndDescription || null, guidelines || '', problems, user.id, user.id, user.department, user.collegeName, subject || ''
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
        const { id, title, date, startDate, endDate, deadline, registrationEndDate, duration, eligibility, description, rulesAndDescription, guidelines, problems, subject } = req.body;
        const user = req.session.user;
        const start = startDate || date;
        const resolvedEndDate = endDate || deriveEndDateFromDuration(start, duration);
        const regDeadline = registrationEndDate || deadline || null;
        const computedDuration = computeDurationFromRange(start, resolvedEndDate) || duration || null;
        if (!computedDuration) return res.json({ success: false, message: 'End time must be after start time.' });

        db.run(
            `UPDATE contests SET 
                title = ?, date = ?, startDate = ?, endDate = ?, registrationEndDate = ?, deadline = ?, 
                duration = ?, eligibility = ?, description = ?, rulesAndDescription = ?, guidelines = ?, problems = ?, subject = ?
            WHERE id = ? AND createdBy = ?`,
            [
                title, start, start, resolvedEndDate, regDeadline, regDeadline,
                computedDuration, eligibility || null, description || null, rulesAndDescription || null, guidelines || '', problems, subject || '',
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
    // HOS APPROVE CONTENT
    // Problem: faculty -> HOS approval required
    // Contest: faculty -> HOS + HOD, HOS-created -> only HOD
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
            db.get(`SELECT u.role as creatorRole FROM problems p JOIN account_users u ON p.faculty_id = u.id WHERE p.id = ?`, [id], (roleErr, row) => {
                if (roleErr) return res.status(500).json({ success: false, message: roleErr.message });
                if (!row) return res.status(404).json({ success: false, message: 'Problem not found.' });
                if (String(row.creatorRole || '').toLowerCase() !== 'faculty') {
                    return res.json({ success: true, message: 'Problem is already auto-approved for non-faculty creators.' });
                }
                db.run(
                    `UPDATE problems SET hos_verified = 1, status = 'accepted', is_public = 1, visibility_scope = 'global', approved_by = ?, approved_at = ? WHERE id = ?`,
                    [user.id, new Date().toISOString(), id],
                    function(err) {
                        if (err) return res.status(500).json({ success: false, message: err.message });
                        res.json({ success: true, message: 'Problem approved by HOS and published in college bank.' });
                    }
                );
            });

        } else if (type === 'contest') {
            if (action === 'reject') {
                return db.run(`UPDATE contests SET status = 'rejected' WHERE id = ?`, [id], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Contest rejected.' });
                });
            }
            db.get(`SELECT c.hod_verified, u.role as creatorRole FROM contests c JOIN account_users u ON c.createdBy = u.id WHERE c.id = ?`, [id], (infoErr, infoRow) => {
                if (infoErr) return res.status(500).json({ success: false, message: infoErr.message });
                if (!infoRow) return res.status(404).json({ success: false, message: 'Contest not found' });
                if (String(infoRow.creatorRole || '').toLowerCase() !== 'faculty') {
                    return res.json({ success: true, message: 'HOS approval is only required for faculty-created contests.' });
                }
                db.run(`UPDATE contests SET hos_verified = 1 WHERE id = ?`, [id], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    if (infoRow.hod_verified === 1) {
                        db.run(
                            `UPDATE contests SET status = 'accepted', isVerified = 1, visibility_scope = 'department', approved_by = ?, approved_at = ? WHERE id = ?`,
                            [user.id, new Date().toISOString(), id],
                            function(updErr) {
                                if (updErr) return res.status(500).json({ success: false, message: updErr.message });
                                res.json({ success: true, message: 'Contest approved and now visible to students.' });
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


