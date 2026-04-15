const express = require('express');
const path = require('path');
const { requireRole } = require('../middleware/auth');
const { checkScope } = require('../middleware/authMiddleware');
const sanitizeHtml = require('sanitize-html');

module.exports = (db, transporter) => {
    function dbGet(query, params = []) {
        return new Promise((resolve, reject) => {
            db.get(query, params, (err, row) => err ? reject(err) : resolve(row));
        });
    }
    function dbAll(query, params = []) {
        return new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows));
        });
    }

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
        const rows = await dbAll(`SELECT problem_id FROM contest_problems WHERE contest_id = ?`, [contest.id]);
        return rows.map((row) => Number(row.problem_id)).filter((id) => Number.isInteger(id) && id > 0);
    };

    const buildContestLeaderboard = async (contest) => {
        const contestProblemIds = await getContestProblemIds(contest);
        if (!contestProblemIds.length) return [];

        const participantRows = await dbAll(`
            SELECT cp.user_id, cp.joined_at, u.fullName
            FROM contest_participants cp
            JOIN account_users u ON u.id = cp.user_id
            WHERE cp.contest_id = ?
        `, [contest.id]);

        const acceptedRows = await dbAll(`
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
                const user = await dbGet(`SELECT fullName FROM account_users WHERE id = ?`, [userId]);
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


    const getUsersManagedByHod = (hodId, collegeName) => {
        return new Promise((resolve, reject) => {
            // Get HOD's department first
            db.get(`SELECT department FROM account_users WHERE id = ?`, [hodId], (deptErr, hodDept) => {
                if (deptErr) return reject(deptErr);
                const department = hodDept ? hodDept.department : '';

                // Now get all faculty/HOS in that department OR those assigned explicitly
                db.all(
                    `SELECT DISTINCT u.id as user_id
                     FROM account_users u
                     LEFT JOIN faculty_assignments ua ON u.id = ua.user_id
                     WHERE (
                         (u.department = ? AND u.collegeName = ?) 
                         OR (ua.assigned_by_id = ? AND (COALESCE(ua.collegeName, '') = ? OR COALESCE(u.collegeName, '') = ?))
                     )
                     AND LOWER(COALESCE(u.role, '')) IN ('faculty', 'hos')`,
                    [department, collegeName, hodId, collegeName, collegeName],
                    (err, rows) => {
                        if (err) return reject(err);
                        resolve((rows || []).map((row) => row.user_id));
                    }
                );
            });
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
    router.post('/hod/api/assign-role', requireRole('hod'), (req, res) => {
        const { id, role, subject } = req.body;
        const targetUserId = id;
        const newRole = role;
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

    // HOD: Global Teacher Search & Profile View (Legacy JSON)
    router.get('/hod/view-profile/:id', requireRole('hod'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.get(`SELECT id, fullName, email, role, department, mobile, post FROM account_users WHERE id = ? AND collegeName = ?`, 
            [req.params.id, collegeName], (err, row) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (!row) return res.status(404).json({ success: false, error: "Teacher not found." });
                res.json({ success: true, profile: row });
            });
    });

    // ⭐ HOD: View Detailed Student Profile Page
    router.get('/hod/view_student', requireRole('hod'), (req, res) => {
        res.render('hod/view_student.html', { 
            user: req.session.user, 
            currentPage: 'student',
            queryId: req.query.id
        });
    });

    // ⭐ HOD: View Detailed Faculty Profile Page
    router.get('/hod/view_faculty', requireRole('hod'), (req, res) => {
        res.render('hod/view_faculty.html', { 
            user: req.session.user, 
            currentPage: 'faculty',
            queryId: req.query.id
        });
    });

    // ⭐ Faculty/HOD: View Detailed Student Profile Page (Redirected from Faculty list)
    router.get('/faculty/view_student', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        res.render('faculty/view_student.html', { 
            user: req.session.user, 
            currentPage: 'student',
            queryId: req.query.id
        });
    });

    // ⭐ Faculty/HOD: View Detailed Faculty Profile Page (Redirected from Faculty list)
    router.get('/faculty/view_faculty', requireRole(['faculty', 'hos', 'hod']), (req, res) => {
        res.render('faculty/view_faculty.html', { 
            user: req.session.user, 
            currentPage: 'faculty',
            queryId: req.query.id
        });
    });

    // ⭐ HOD: Detailed Student Profile API (Replicated but isolated for HOD)
    router.get('/hod/api/student/public-profile/:id', requireRole('hod'), async (req, res) => {
        const studentId = req.params.id;
        const collegeName = req.session.user.collegeName;

        try {
            const user = await dbGet(`
                SELECT
                    id, fullName, email, department, branch, program, year, section, collegeName, role, status,
                    COALESCE(points, 0) as points,
                    COALESCE(solvedCount, 0) as solvedCount,
                    rank
                FROM account_users
                WHERE id = ? AND collegeName = ? AND role = 'student'
            `, [studentId, collegeName]);
            if (!user) return res.status(404).json({ success: false, message: "Student not found" });

            const rankRow = await dbGet(`
                SELECT COUNT(*) as cnt
                FROM account_users
                WHERE LOWER(COALESCE(role, '')) IN ('student', 'individual')
                  AND COALESCE(points, 0) > ?
            `, [Number(user.points || 0)]);

            const recentSubmissions = await dbAll(`
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
                    ...user,
                    rank: user.rank || `#${Number(rankRow?.cnt || 0) + 1}`
                },
                recentSubmissions
            });
        } catch (error) {
            console.error('HOD student public profile error:', error);
            res.status(500).json({ success: false, message: "Database error" });
        }
    });

    // ⭐ Faculty/HOD: Detailed Student Profile API
    router.get('/faculty/api/student/public-profile/:id', requireRole(['faculty', 'hos', 'hod']), async (req, res) => {
        const studentId = req.params.id;
        const collegeName = req.session.user.collegeName;

        try {
            const user = await dbGet(`
                SELECT
                    id, fullName, email, department, branch, program, year, section, collegeName, role, status,
                    COALESCE(points, 0) as points,
                    COALESCE(solvedCount, 0) as solvedCount,
                    rank
                FROM account_users
                WHERE id = ? AND collegeName = ? AND role = 'student'
            `, [studentId, collegeName]);
            if (!user) return res.status(404).json({ success: false, message: "Student not found" });

            const rankRow = await dbGet(`
                SELECT COUNT(*) as cnt
                FROM account_users
                WHERE LOWER(COALESCE(role, '')) IN ('student', 'individual')
                  AND COALESCE(points, 0) > ?
            `, [Number(user.points || 0)]);

            const recentSubmissions = await dbAll(`
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
                    ...user,
                    rank: user.rank || `#${Number(rankRow?.cnt || 0) + 1}`
                },
                recentSubmissions
            });
        } catch (error) {
            console.error('Faculty/HOD student public profile error:', error);
            res.status(500).json({ success: false, message: "Database error" });
        }
    });

    // ⭐ HOD: Detailed Faculty Profile API (Replicated but isolated for HOD)
    router.get('/hod/api/faculty/public-profile/:id', requireRole('hod'), async (req, res) => {
        const facultyId = req.params.id;
        const collegeName = req.session.user.collegeName;

        try {
            const user = await dbGet(
                `SELECT id, fullName, email, department, branch, program, collegeName, role, status, is_hod
                 FROM account_users
                 WHERE id = ? AND collegeName = ?`,
                [facultyId, collegeName]
            );
            if (!user) return res.status(404).json({ success: false, message: "Faculty not found" });

            const stats = await dbGet(
                `SELECT
                    (SELECT COUNT(*) FROM contests WHERE createdBy = ?) as totalContests,
                    (SELECT COUNT(*) FROM problems WHERE faculty_id = ?) as totalProblems`,
                [facultyId, facultyId]
            );

            const recentActivity = await dbAll(`
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
                    activeContests: stats ? stats.totalContests : 0
                },
                recentActivity
            });
        } catch (error) {
            console.error('HOD faculty public profile error:', error);
            res.status(500).json({ success: false, message: "Database error" });
        }
    });

    // ⭐ HOD: API to Get Full Contest Details for Modal
    router.get('/hod/api/contest-details/:id', requireRole('hod'), async (req, res) => {
        const contestId = req.params.id;
        const collegeName = req.session.user.collegeName;

        try {
            const contest = await dbGet(`
                SELECT c.*, u.fullName as creatorName 
                FROM contests c 
                JOIN account_users u ON c.createdBy = u.id 
                WHERE c.id = ? AND u.collegeName = ?
            `, [contestId, collegeName]);

            if (!contest) return res.status(404).json({ success: false, message: "Contest not found" });

            const problems = await dbAll(`
                SELECT p.id, p.title, p.subject, p.difficulty, p.points
                FROM problems p
                JOIN contest_problems cp ON p.id = cp.problem_id
                WHERE cp.contest_id = ?
            `, [contestId]);

            res.json({
                success: true,
                contest: {
                    ...contest,
                    problems: problems || []
                }
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, message: "Server error" });
        }
    });

    // ⭐ Faculty/HOD: Detailed Faculty Profile API
    router.get('/faculty/api/faculty/public-profile/:id', requireRole(['faculty', 'hos', 'hod']), async (req, res) => {
        const facultyId = req.params.id;
        const collegeName = req.session.user.collegeName;

        try {
            const user = await dbGet(
                `SELECT id, fullName, email, department, branch, program, collegeName, role, status, is_hod
                 FROM account_users
                 WHERE id = ? AND collegeName = ?`,
                [facultyId, collegeName]
            );
            if (!user) return res.status(404).json({ success: false, message: "Faculty not found" });

            const stats = await dbGet(
                `SELECT
                    (SELECT COUNT(*) FROM contests WHERE createdBy = ?) as totalContests,
                    (SELECT COUNT(*) FROM problems WHERE faculty_id = ?) as totalProblems`,
                [facultyId, facultyId]
            );

            const recentActivity = await dbAll(`
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
                    activeContests: stats ? stats.totalContests : 0
                },
                recentActivity
            });
        } catch (error) {
            console.error('Faculty/HOD faculty public profile error:', error);
            res.status(500).json({ success: false, message: "Database error" });
        }
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
    router.get('/hod/view-problem/:id', requireRole('hod'), checkScope, (req, res) => {
        const problemId = req.params.id;
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
            res.render('hod/view-problem.html', {
                user: req.session.user,
                problem: problem,
                currentPage: 'problem'
            });
        });
    });

    router.get('/hod/forum', requireRole('hod'), checkScope, (req, res) => {
        res.render('hod/forum.html', { user: req.session.user, currentPage: 'community', pageTitle: 'Community' });
    });

    router.get('/hod/forum/create', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        res.render('hod/forum-create.html', { user: req.session.user, currentPage: 'community', pageTitle: 'Create Discussion' });
    });

    router.get('/hod/forum/thread', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => {
        res.render('hod/forum-thread.html', { user: req.session.user, currentPage: 'community', pageTitle: 'View Discussion' });
    });

    router.get('/hod/community', requireRole(['faculty', 'hos', 'hod']), checkScope, (req, res) => res.redirect('/college/hod/forum'));

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
        const recentActivityQuery = `
            SELECT *
            FROM (
                SELECT
                    'problem' AS type,
                    p.title AS title,
                    p.createdAt AS activityAt,
                    u.fullName AS author,
                    p.status AS status
                FROM problems p
                LEFT JOIN account_users u ON p.faculty_id = u.id
                WHERE p.department = ?

                UNION ALL

                SELECT
                    'contest' AS type,
                    c.title AS title,
                    COALESCE(c.createdAt, c.startDate, c.date) AS activityAt,
                    u.fullName AS author,
                    c.status AS status
                FROM contests c
                LEFT JOIN account_users u ON c.createdBy = u.id
                WHERE c.department = ?
            ) recent_items
            WHERE activityAt IS NOT NULL
            ORDER BY datetime(activityAt) DESC
            LIMIT 6
        `;

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

                    db.all(recentActivityQuery, [dept, dept], (recentErr, recentActivity) => {
                        if (recentErr) return res.status(500).send(recentErr.message);

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

                            const formattedActivity = (recentActivity || []).map(item => ({
                                text: `${item.type === 'problem' ? 'Submitted' : 'Created'} ${item.type} "${item.title}" by ${item.author || 'Faculty'}`,
                                time: getTimeAgo(item.activityAt),
                                color: item.type === 'problem' 
                                    ? (item.status === 'accepted' ? 'green' : (item.status === 'pending' ? 'yellow' : 'blue'))
                                    : 'purple'
                            }));

                            const graphData = { difficultySpread, trendLabels, trendCounts };

                                res.render('hod/dashboard.html', {
                                    user: req.session.user,
                                    stats,
                                    pendingQuestions,
                                    pendingContests,
                                    recentActivity: formattedActivity,
                                    graphData,
                                    currentPage: 'dashboard'
                                });
                            });
                        });
                    });
                });
            });
        });
    });


    // Faculty Management
    router.get('/hod/faculty', requireRole('hod'), checkScope, async (req, res) => {
        const college = req.session.user.collegeName;
        const hodDept = req.session.user.department;
        const selectedDept = req.query.dept || '';

        try {
            // Fetch all departments in this college for the dropdown filter
            const departments = await dbAll(`SELECT name FROM branches WHERE collegeName = ? ORDER BY name ASC`, [college]);
            const allCollegeDepartments = (departments || []).map(d => d.name);

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
                    u.mobile,
                    u.gender,
                    u.post,
                    GROUP_CONCAT(DISTINCT ua.subject || ' (' || ua.year || ' - ' || ua.section || ')') as assignments
                FROM account_users u
                LEFT JOIN faculty_assignments ua
                    ON u.id = ua.user_id
                   AND ${normalizeSql(`COALESCE(ua.collegeName, '')`)} = ${normalizeSql(`?`)}
                WHERE ${normalizeSql(`COALESCE(u.collegeName, '')`)} = ${normalizeSql(`?`)}
                  AND (
                      u.status = 'active'
                      OR (u.status = 'pending' AND COALESCE(NULLIF(u.department, ''), NULLIF(u.branch, ''), '') = ?)
                  )
                  AND LOWER(COALESCE(u.role, '')) IN ('faculty', 'hos', 'hod')
            `;
            
            const params = [college, college, hodDept];

            if (selectedDept) {
                facultyQuery += ` AND COALESCE(NULLIF(u.department, ''), NULLIF(u.branch, ''), '') = ? `;
                params.push(selectedDept);
            }

            facultyQuery += ` GROUP BY u.id ORDER BY u.fullName COLLATE NOCASE ASC `;

            const faculty = await dbAll(facultyQuery, params);
            
            // Calculate stats for dashboard cards
            const hosCount = (faculty || []).filter(f => f.role === 'hos').length;
            const totalAssignments = (faculty || []).reduce((acc, f) => {
                if (!f.assignments) return acc;
                return acc + f.assignments.split(',').length;
            }, 0);

            res.render('hod/faculty.html', {
                user: req.session.user,
                departmentFaculty: faculty,
                allCollegeDepartments,
                selectedDept,
                stats: {
                    hosCount,
                    totalAssignments
                },
                currentPage: 'faculty',
                dropdownData: res.locals.dropdownData
            });
        } catch (err) {
            console.error(err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // HOD: Create Faculty Account
    router.post('/hod/faculty/create', requireRole('hod'), (req, res) => {
        const { fullName, email, mobile, post, gender, joiningDate } = req.body;
        
        // Inherit context from HOD session
        const branch = req.session.user.department; // Branch same as HOD department
        const department = req.session.user.department; 
        const program = req.session.user.course; // Program same as HOD course
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
            const defaultPass = 'changeme123';
            bcrypt.hash(defaultPass, 10, (err, hash) => {
                if (err) return res.status(500).send(err.message);

                db.run(
                    `INSERT INTO account_users (fullName, email, password, role, department, branch, program, collegeName, mobile, post, gender, joiningDate, status)
                     VALUES (?, ?, ?, 'faculty', ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
                    [fullName, email, hash, department, branch, program || '', college, mobile || '', post || '', gender || '', joiningDate || ''],
                    function(err) {
                        if (err) return res.status(500).send(err.message);
                        
                        // Send Welcome Email
                        if (transporter) {
                            const mailOptions = {
                                from: process.env.EMAIL_USER,
                                to: email,
                                subject: 'Welcome to CampusCode - Faculty Account Created',
                                html: `
                                    <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
                                        <h2 style="color: #1E4A7A;">Welcome to CampusCode, ${fullName}!</h2>
                                        <p>Your faculty account has been created by your Head of Department.</p>
                                        <p><strong>Department:</strong> ${department}</p>
                                        <p><strong>Program:</strong> ${program || 'N/A'}</p>
                                        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
                                        <p>You can now log in using the following credentials:</p>
                                        <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; font-family: monospace;">
                                            <p><strong>Email:</strong> ${email}</p>
                                            <p><strong>Default Password:</strong> <span style="color: #d32f2f;">${defaultPass}</span></p>
                                        </div>
                                        <p style="margin-top: 20px; font-size: 0.9em; color: #666;">For security reasons, please change your password immediately after your first login.</p>
                                    </div>
                                `
                            };
                            transporter.sendMail(mailOptions).catch(mailErr => {
                                console.error('Faculty Welcome Email failed:', mailErr);
                            });
                        }

                        res.redirect('/college/hod/faculty?created=1');
                    }
                );
            });
        });
    });

    // HOD: Update Faculty Profile
    router.post('/hod/faculty/update', requireRole('hod'), (req, res) => {
        const { id, fullName, email, post, mobile, gender, joiningDate } = req.body;
        const college = req.session.user.collegeName;

        if (!id || !fullName || !email) {
            return res.redirect('/college/hod/faculty?error=Missing+details');
        }

        db.run(
            `UPDATE account_users 
             SET fullName = ?, email = ?, post = ?, mobile = ?, gender = ?, joiningDate = ?
             WHERE id = ? AND collegeName = ?`,
            [fullName, email, post, mobile, gender, joiningDate, id, college],
            function(err) {
                if (err) return res.status(500).send(err.message);
                res.redirect('/college/hod/faculty?updated=1');
            }
        );
    });

    // HOD: Assign Sections and Years
    router.post('/hod/api/assign-sections', requireRole('hod'), (req, res) => {
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
                    res.json({ success: true, message: 'Assignment successful' });
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

    // HOD: Create Student
    router.post('/hod/student/create', requireRole('hod'), (req, res) => {
        const { fullName, email, year, section } = req.body;
        const hod = req.session.user;
        const college = hod.collegeName;
        const department = hod.department;
        const branch = hod.department; 
        const program = hod.course;

        if (!fullName || !email) {
            return res.status(400).json({ success: false, message: 'Name and email are required' });
        }

        db.get(`SELECT id FROM users WHERE email = ?`, [email], (err, existing) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (existing) return res.status(400).json({ success: false, message: 'Email already exists' });

            const defaultPass = 'student123'; 
            bcrypt.hash(defaultPass, 10, (err, hash) => {
                if (err) return res.status(500).json({ success: false, message: err.message });

                db.run(
                    `INSERT INTO users (fullName, email, password, role, collegeName, department, branch, program, year, section, status, is_verified, isVerified)
                     VALUES (?, ?, ?, 'student', ?, ?, ?, ?, ?, ?, 'active', 1, 1)`,
                    [fullName, email.toLowerCase(), hash, college, department, branch, program, year || '', section || ''],
                    function(err) {
                        if (err) return res.status(500).json({ success: false, message: err.message });

                        // Send Welcome Email
                        if (transporter) {
                            const mailOptions = {
                                from: process.env.EMAIL_USER,
                                to: email,
                                subject: 'Welcome to CampusCode - Student Account Created',
                                html: `
                                    <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e5e7eb; border-radius: 10px;">
                                        <h2 style="color: #1E4A7A;">Hi ${fullName},</h2>
                                        <p>Your student account has been created by your HOD.</p>
                                        <div style="background: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
                                            <p style="margin: 5px 0;"><strong>Login URL:</strong> <a href="http://localhost:3000">CampusCode Dashboard</a></p>
                                            <p style="margin: 5px 0;"><strong>Username:</strong> ${email}</p>
                                            <p style="margin: 5px 0;"><strong>Password:</strong> <span style="color: #d946ef;">${defaultPass}</span></p>
                                        </div>
                                        <p>Please log in and change your password as soon as possible.</p>
                                    </div>
                                `
                            };
                            transporter.sendMail(mailOptions).catch(console.error);
                        }

                        res.json({ success: true, message: 'Student added successfully!' });
                    }
                );
            });
        });
    });

    // HOD: Update Student
    router.post('/hod/student/update/:id', requireRole('hod'), (req, res) => {
        const { fullName, email, year, section, status } = req.body;
        const studentId = req.params.id;
        const hodDept = req.session.user.department;
        const hodCollege = req.session.user.collegeName;

        db.run(
            `UPDATE users 
             SET fullName = ?, email = ?, year = ?, section = ?, status = ? 
             WHERE id = ? AND department = ? AND collegeName = ? AND role = 'student'`,
            [fullName, email, year, section, String(status || 'active').toLowerCase(), studentId, hodDept, hodCollege],
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                if (this.changes === 0) return res.status(404).json({ success: false, message: 'Student not found or unauthorized' });
                res.json({ success: true, message: 'Student updated successfully!' });
            }
        );
    });

    // HOD: Delete Student
    router.delete('/hod/student/:id', requireRole('hod'), (req, res) => {
        const studentId = req.params.id;
        const hodDept = req.session.user.department;
        const hodCollege = req.session.user.collegeName;

        db.run(
            `DELETE FROM users WHERE id = ? AND department = ? AND collegeName = ? AND role = 'student'`,
            [studentId, hodDept, hodCollege],
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                if (this.changes === 0) return res.status(404).json({ success: false, message: 'Student not found or unauthorized' });
                res.json({ success: true, message: 'Student deleted successfully!' });
            }
        );
    });

    // Question Bank / Problem Management
    router.get('/hod/problem', requireRole('hod'), checkScope, (req, res) => {
        const user = req.session.user;
        const dept = user.department;
        const college = user.collegeName;
        db.all(
            `SELECT p.*, u.fullName as facultyName, u.role as creatorRole FROM problems p 
             LEFT JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id 
             WHERE (p.department = ? AND COALESCE(u.collegeName, '') = ?)
                OR (p.status = 'accepted' AND u.collegeName = ? AND LOWER(p.visibility_scope) = 'global')
                OR (p.status IN ('accepted', 'active') AND LOWER(p.visibility_scope) = 'global' AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))
             ORDER BY p.createdAt DESC`, 
            [dept, college, college], 
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
                OR (c.department = ? AND c.status = 'accepted' AND c.collegeName = ?)
                OR (c.createdBy = ? AND c.collegeName = ?)
                OR (c.status = 'accepted' AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))
             ORDER BY c.id DESC`,
            [college, dept, college, hodId, college],
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

    // HOD: Contest View (Details)
    router.get('/hod/contest/view/:id', requireRole('hod'), checkScope, async (req, res) => {
        const contestId = Number(req.params.id);
        const college = req.session.user.collegeName;
        const dept = req.session.user.department;

        try {
            const contest = await dbGet(`
                SELECT c.*, u.fullName as creatorName, u2.fullName as approverName
                FROM contests c
                LEFT JOIN account_users u ON c.createdBy = u.id
                LEFT JOIN account_users u2 ON c.approved_by = u2.id
                WHERE c.id = ? AND (c.collegeName = ? OR c.department = ?)
            `, [contestId, college, dept]);

            if (!contest) return res.status(404).send("Contest not found or access denied.");

            const problemIds = await getContestProblemIds(contest);
            let contestProblems = [];
            if (problemIds.length) {
                const placeholders = problemIds.map(() => '?').join(',');
                contestProblems = await dbAll(`
                    SELECT id, title, subject, difficulty, status
                    FROM problems
                    WHERE id IN (${placeholders})
                `, problemIds);
            }

            const leaderboard = await buildContestLeaderboard(contest);
            const leaderboardPreview = leaderboard.slice(0, 5);

            res.render('hod/contest_view.html', {
                user: req.session.user,
                contest: normalizeContestRecord(contest),
                contestProblems,
                leaderboardPreview,
                backPath: '/college/hod/contest',
                currentPage: 'contest'
            });
        } catch (err) {
            console.error(err);
            res.status(500).send(err.message);
        }
    });

    // HOD: Contest Leaderboard
    router.get('/hod/contest/leaderboard/:id', requireRole('hod'), checkScope, async (req, res) => {
        const contestId = Number(req.params.id);
        const college = req.session.user.collegeName;
        const dept = req.session.user.department;

        try {
            const contest = await dbGet(`
                SELECT * FROM contests WHERE id = ? AND (collegeName = ? OR department = ?)
            `, [contestId, college, dept]);

            if (!contest) return res.status(404).send("Contest not found or access denied.");

            const leaderboard = await buildContestLeaderboard(contest);
            
            // Calculate summary stats
            const participants = leaderboard.length;
            const submissionsRow = await dbGet(`SELECT COUNT(*) as cnt FROM submissions WHERE contest_id = ?`, [contestId]);
            const totalSolved = leaderboard.reduce((acc, entry) => acc + entry.solved, 0);
            const topScore = leaderboard.length > 0 ? leaderboard[0].score : 0;

            res.render('hod/contest_leaderboard.html', {
                user: req.session.user,
                contest: normalizeContestRecord(contest),
                leaderboard,
                summary: {
                    participants,
                    submissions: submissionsRow?.cnt || 0,
                    totalSolved,
                    topScore
                },
                backPath: '/college/hod/contest',
                currentPage: 'contest'
            });
        } catch (err) {
            console.error(err);
            res.status(500).send(err.message);
        }
    });

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
    router.get('/hod/settings', requireRole('hod'), checkScope, async (req, res) => {
        try {
            const user = await dbGet(`SELECT * FROM account_users WHERE id = ?`, [req.session.user.id]);
            if (!user) return res.redirect('/auth/login');

            const assignments = await dbAll(`SELECT subject, year, section FROM faculty_assignments WHERE user_id = ?`, [req.session.user.id]);
            
            user.assignedSubjects = [...new Set(assignments.map(a => a.subject))].filter(Boolean);
            user.assignedYears = [...new Set(assignments.map(a => a.year))].filter(Boolean).join(',');
            user.assignedSections = [...new Set(assignments.map(a => a.section))].filter(Boolean).join(',');

            const success = req.query.saved === '1';
            res.render('hod/settings.html', { user, currentPage: 'settings', success });
        } catch (err) {
            res.status(500).send(err.message);
        }
    });

    // Settings Update
    router.post('/hod/settings/update', requireRole('hod'), (req, res) => {
        const { fullName, email, gender, mobile, joiningDate, location } = req.body;
        const id = req.session.user.id;
        db.run(
            `UPDATE account_users SET fullName = ?, email = ?, gender = ?, mobile = ?, joiningDate = ?, location = ? WHERE id = ?`,
            [fullName, email, gender, mobile, joiningDate, location, id],
            function(err) {
                if (err) return res.status(500).send(err.message);
                // Refresh session
                req.session.user.fullName = fullName;
                req.session.user.email = email;
                req.session.user.gender = gender;
                req.session.user.mobile = mobile;
                req.session.user.joiningDate = joiningDate;
                req.session.user.location = location;
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
        const currentTab = req.query.tab || 'pending';
        let statusFilter = 'pending';
        if (currentTab === 'approved') statusFilter = 'accepted';
        else if (currentTab === 'rejected') statusFilter = 'rejected';

        const statsQuery = `
            SELECT 
                (SELECT COUNT(*) FROM problems WHERE department = ? AND status = 'pending') as pendingCount,
                (SELECT COUNT(*) FROM problems WHERE department = ? AND status = 'accepted') as approvedCount,
                (SELECT COUNT(*) FROM problems WHERE department = ? AND status = 'rejected') as rejectedCount
        `;

        const problemsQuery = `
            SELECT p.*, u.fullName as facultyName, u.role as creatorRole 
            FROM problems p 
            JOIN account_users u ON p.faculty_id = u.id 
            WHERE p.department = ? AND p.status = ?
            ORDER BY p.id DESC
        `;

        const subjectsQuery = `SELECT DISTINCT subject FROM problems WHERE department = ?`;

        db.get(statsQuery, [dept, dept, dept], (err, stats) => {
            if (err) return res.status(500).send(err.message);
            
            db.all(subjectsQuery, [dept], (err, subjects) => {
                if (err) return res.status(500).send(err.message);

                db.all(problemsQuery, [dept, statusFilter], (err, questions) => {
                    if (err) return res.status(500).send(err.message);
                    
                    res.render('hod/pending_questions.html', { 
                        user: req.session.user, 
                        allQuestions: questions, 
                        activeTab: currentTab,
                        subjects: subjects || [],
                        stats: stats || {},
                        currentPage: 'pending-questions'
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
                    SELECT c.*, u.fullName as creatorName, u.role as creatorRole, uHOS.fullName as hos_verified_by_name
                    FROM contests c
                    JOIN account_users u ON c.createdBy = u.id
                    LEFT JOIN account_users uHOS ON c.hos_verified_by = uHOS.id
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

                // Filtering by query params ONLY (Tab filtering moved to client-side)
                let filteredContests = allContests;
                if (subject && subject !== 'All Subjects') filteredContests = filteredContests.filter(c => c.subject === subject);
                if (type && type !== 'All Types') filteredContests = filteredContests.filter(c => c.type === type);
                if (dateFrom) filteredContests = filteredContests.filter(c => new Date(c.startDate) >= new Date(dateFrom));
                if (dateTo) filteredContests = filteredContests.filter(c => new Date(c.startDate) <= new Date(dateTo));
                if (hos_approved && hos_approved !== 'All') {
                    const val = hos_approved === 'Yes' ? 1 : 0;
                    filteredContests = filteredContests.filter(c => Number(c.hos_verified || 0) === val);
                }

                // Get unique subjects/types for dropdowns
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
        const { id, action, status } = req.body;
        const type = String(req.body.type || '').toLowerCase();
        const dept = req.session.user.department;
        const finalAction = (action || status || '').toLowerCase();

        if (!id || !type) return res.status(400).json({ success: false, message: 'Missing id or type' });

        if (type === 'problem' || type === 'question') {
            if (finalAction === 'reject') {
                return db.run(`UPDATE problems SET status = 'rejected' WHERE id = ? AND department = ?`, [id, dept], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Problem rejected.' });
                });
            }
            db.get(`SELECT p.hos_verified, p.hod_verified, u.role as creatorRole 
                    FROM problems p 
                    JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id 
                    WHERE p.id = ? AND p.department = ?`, [id, dept], (infoErr, infoRow) => {
                if (infoErr) return res.status(500).json({ success: false, message: infoErr.message });
                if (!infoRow) return res.status(404).json({ success: false, message: 'Problem not found or not in your department' });

                const userRole = String(req.session.user.role).toLowerCase();
                const creatorRole = String(infoRow.creatorRole || '').toLowerCase();

                // Logic: 
                // 1. If HOD approves, it's accepted.
                // 2. If HOS approves a Faculty problem, it marks hos_verified = 1 (and accepts if HOD verification not strictly sequential).
                // Actually, let's keep it simple: HOS or HOD approval accepts it, 
                // but we record who verified what.

                let sql = '';
                let params = [];
                if (userRole === 'hod') {
                    sql = `UPDATE problems SET hod_verified = 1, status = 'accepted', is_public = 1, approved_by = ?, approved_at = ? WHERE id = ? AND department = ?`;
                    params = [req.session.user.id, new Date().toISOString(), id, dept];
                } else if (userRole === 'hos') {
                    sql = `UPDATE problems SET hos_verified = 1, status = 'accepted', is_public = 1, approved_by = ?, approved_at = ? WHERE id = ? AND department = ?`;
                    params = [req.session.user.id, new Date().toISOString(), id, dept];
                } else {
                    return res.status(403).json({ success: false, message: 'Unauthorized role for approval.' });
                }
                db.run(sql, params, function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Problem approved.' });
                });
            });

        } else if (type === 'contest') {
            if (finalAction === 'reject') {
                return getUsersManagedByHod(req.session.user.id, req.session.user.collegeName)
                    .then((managedUserIds) => {
                        if (!managedUserIds.length) return res.status(403).json({ success: false, message: 'No managed users found for this HOD' });
                        const ownerPlaceholders = managedUserIds.map(() => '?').join(',');
                        db.run(`UPDATE contests SET status = 'rejected' WHERE id = ? AND createdBy IN (${ownerPlaceholders})`, [id, ...managedUserIds], function(err) {
                            if (err) return res.status(500).json({ success: false, message: err.message });
                            res.json({ success: true, message: 'Contest rejected.' });
                        });
                    })
                    .catch((error) => res.status(500).json({ success: false, message: error.message }));
            } else {
                getUsersManagedByHod(req.session.user.id, req.session.user.collegeName)
                    .then((managedUserIds) => {
                        if (!managedUserIds.length) return res.status(403).json({ success: false, message: 'No managed users found for this HOD' });
                        const ownerPlaceholders = managedUserIds.map(() => '?').join(',');
                        db.get(`SELECT c.hos_verified, u.role as creatorRole FROM contests c JOIN account_users u ON c.createdBy = u.id WHERE c.id = ? AND c.createdBy IN (${ownerPlaceholders})`, [id, ...managedUserIds], (infoErr, infoRow) => {
                            if (infoErr) return res.status(500).json({ success: false, message: infoErr.message });
                            if (!infoRow) return res.status(404).json({ success: false, message: 'Contest not found in your HOD scope' });

                            db.run(`UPDATE contests SET hod_verified = 1, hod_verified_by = ?, hod_verified_at = ? WHERE id = ? AND createdBy IN (${ownerPlaceholders})`, [req.session.user.id, new Date().toISOString(), id, ...managedUserIds], function(err) {
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
            }
        } else {
            res.status(400).json({ success: false, message: 'Invalid type' });
        }
    });

    // Bulk Approve Questions
    router.post('/college/hod/api/bulk-approve-questions', requireRole('hod'), (req, res) => {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'No questions selected' });
        }
        
        const dept = req.session.user.department;
        const placeholders = ids.map(() => '?').join(',');
        const sql = `UPDATE problems 
                      SET hod_verified = 1, status = 'accepted', is_public = 1, 
                          approved_by = ?, approved_at = ? 
                      WHERE id IN (${placeholders}) AND department = ?`;
        
        const params = [req.session.user.id, new Date().toISOString(), ...ids, dept];
        
        db.run(sql, params, function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: `Successfully approved ${this.changes} questions.` });
        });
    });

    // Update Problem Feedback
    router.post('/college/hod/api/update-problem-feedback', requireRole(['hod', 'hos']), (req, res) => {
        const { id, comments } = req.body;
        const dept = req.session.user.department;
        
        if (!id) return res.status(400).json({ success: false, message: 'Missing problem id' });
        
        db.run(`UPDATE problems SET hod_remarks = ? WHERE id = ? AND department = ?`, [comments, id, dept], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Feedback updated successfully.' });
        });
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

        const query = `
            SELECT p.*, u.fullName as facultyName, u.role as creatorRole 
            FROM problems p
            LEFT JOIN account_users u ON COALESCE(p.faculty_id, p.created_by) = u.id
            WHERE (p.status = 'accepted' AND u.collegeName = ?)
               OR (p.status IN ('accepted', 'active') AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))
            ORDER BY p.id DESC
        `;
        db.all(query, [college], (err, rows) => {
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
                OR (c.department = ? AND c.status = 'accepted' AND c.collegeName = ?)
                OR (c.createdBy = ? AND c.collegeName = ?)
                OR (c.status = 'accepted' AND LOWER(COALESCE(u.role, '')) IN ('superadmin', 'admin'))
             ORDER BY c.id DESC`,
            [college, dept, college, hodId, college],
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


