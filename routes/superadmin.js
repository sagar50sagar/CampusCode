const express = require('express');
const path = require('path');
const { requireRole } = require('../middleware/auth');
const { checkScope } = require('../middleware/authMiddleware');

module.exports = (db) => {
    const router = express.Router();
    const dbAll = (query, params = []) => new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
    const dbRun = (query, params = []) => new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
    const dedupeByEmail = (rows = []) => {
        const seen = new Set();
        const out = [];
        for (const row of rows) {
            const key = String(row?.email || '').trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(row);
        }
        return out;
    };
    const getMergedAdminsByStatus = async (accountTable, status) => {
        const statusNorm = String(status || '').trim().toLowerCase();
        const primary = await dbAll(
            `SELECT id, fullName, email, collegeName
             FROM ${accountTable}
             WHERE LOWER(COALESCE(role, '')) = 'admin'
               AND LOWER(COALESCE(status, '')) = ?
             ORDER BY id DESC`,
            [statusNorm]
        );
        if (accountTable === 'faculty') return dedupeByEmail(primary);
        const secondary = await dbAll(
            `SELECT id, fullName, email, collegeName
             FROM faculty
             WHERE LOWER(COALESCE(role, '')) = 'admin'
               AND LOWER(COALESCE(status, '')) = ?
             ORDER BY id DESC`,
            [statusNorm]
        );
        return dedupeByEmail([...(primary || []), ...(secondary || [])]);
    };
    const getMergedActiveAdminsByCollege = async (accountTable, collegeName) => {
        const primary = await dbAll(
            `SELECT id, fullName, email, collegeName
             FROM ${accountTable}
             WHERE LOWER(COALESCE(role, '')) = 'admin'
               AND LOWER(COALESCE(status, '')) = 'active'
               AND LOWER(TRIM(COALESCE(collegeName, ''))) = LOWER(TRIM(?))
             ORDER BY id ASC`,
            [collegeName]
        );
        if (accountTable === 'faculty') return dedupeByEmail(primary);
        const secondary = await dbAll(
            `SELECT id, fullName, email, collegeName
             FROM faculty
             WHERE LOWER(COALESCE(role, '')) = 'admin'
               AND LOWER(COALESCE(status, '')) = 'active'
               AND LOWER(TRIM(COALESCE(collegeName, ''))) = LOWER(TRIM(?))
             ORDER BY id ASC`,
            [collegeName]
        );
        return dedupeByEmail([...(primary || []), ...(secondary || [])]);
    };
    const getAccountTable = async () => {
        const rows = await dbAll(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name IN ('account_users', 'users')
            ORDER BY CASE WHEN name = 'account_users' THEN 0 ELSE 1 END
            LIMIT 1
        `);
        return rows[0]?.name || 'users';
    };
    const getTableColumns = async (tableName) => {
        const rows = await dbAll(`PRAGMA table_info(${tableName})`);
        return new Set((rows || []).map((row) => String(row.name || '').trim()));
    };

    // ==========================================
    // DASHBOARD VIEW
    // ==========================================
    router.get('/dashboard', requireRole('superadmin'), checkScope, (req, res) => {
        res.render('superadmin/dashboard.html', { user: req.session.user, currentPage: 'dashboard' });
    });

    router.get('/contest', requireRole('superadmin'), checkScope, (req, res) => {
        res.render('superadmin/contest.html', { user: req.session.user, currentPage: 'contest' });
    });

    router.get('/support', requireRole('superadmin'), checkScope, (req, res) => {
        res.render('superadmin/support.html', { user: req.session.user, currentPage: 'support' });
    });

    router.get('/colleges/manage/:id', requireRole('superadmin'), checkScope, (req, res) => {
        res.render('superadmin/college_manage.html', {
            user: req.session.user,
            currentPage: 'dashboard',
            initialCollegeId: Number(req.params.id) || 0
        });
    });

    // ==========================================
    // SUPERADMIN APIs (Manage Colleges)
    // ==========================================
    // Fetch all colleges
    router.get('/api/colleges', requireRole('superadmin'), (req, res) => {
        (async () => {
            const accountTable = await getAccountTable();
            const colleges = await dbAll(`SELECT * FROM colleges ORDER BY id DESC`, []);
            const rows = [];
            for (const college of colleges) {
                const admins = await getMergedActiveAdminsByCollege(accountTable, college.name);
                rows.push({
                    ...college,
                    adminNames: admins.length ? admins.map((a) => a.fullName).join(', ') : 'Not Assigned',
                    collegeAdmin: admins[0]?.fullName || 'Not Assigned'
                });
            }
            res.json({ success: true, colleges: rows });
        })().catch((error) => res.status(500).json({ success: false, error: error.message }));
    });

    // Add a new college
    router.post('/api/colleges', requireRole('superadmin'), (req, res) => {
        const { name, university, accreditation } = req.body;
        db.run(`INSERT INTO colleges (name, university, accreditation) VALUES (?, ?, ?)`, [name, university || '', accreditation || ''], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(400).json({ success: false, error: 'College already exists' });
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, id: this.lastID, message: 'College added successfully' });
        });
    });

    router.put('/api/colleges/:id/metadata', requireRole('superadmin'), (req, res) => {
        const collegeId = Number(req.params.id);
        if (!Number.isInteger(collegeId) || collegeId <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid college id' });
        }
        const university = String(req.body.university || '').trim();
        const accreditation = String(req.body.accreditation || '').trim();
        db.run(
            `UPDATE colleges SET university = ?, accreditation = ? WHERE id = ?`,
            [university, accreditation, collegeId],
            function(err) {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (!this.changes) return res.status(404).json({ success: false, error: 'College not found' });
                res.json({ success: true, message: 'College metadata updated' });
            }
        );
    });

    // Delete a college
    router.delete('/api/colleges/:id', requireRole('superadmin'), (req, res) => {
        db.run(`DELETE FROM colleges WHERE id = ?`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, message: 'College deleted successfully' });
        });
    });

    router.get('/api/college-management', requireRole('superadmin'), async (req, res) => {
        try {
            const accountTable = await getAccountTable();
            const problemCols = await getTableColumns('problems');
            const contestCols = await getTableColumns('contests');
            const hasProblemCreatedBy = problemCols.has('created_by');
            const hasProblemFacultyId = problemCols.has('faculty_id');
            const hasContestCollegeName = contestCols.has('collegeName');
            const colleges = await dbAll(`
                SELECT id, name, COALESCE(university, '') AS university, COALESCE(accreditation, '') AS accreditation, COALESCE(status, 'active') AS status
                FROM colleges
                ORDER BY id DESC
            `);

            const response = [];
            for (const college of colleges) {
                const collegeName = String(college.name || '').trim();
                const admins = await getMergedActiveAdminsByCollege(accountTable, collegeName);

                let problemCount = 0;
                if (hasProblemCreatedBy || hasProblemFacultyId) {
                    const ownerExpr = hasProblemCreatedBy && hasProblemFacultyId
                        ? 'COALESCE(pr.created_by, pr.faculty_id)'
                        : (hasProblemCreatedBy ? 'pr.created_by' : 'pr.faculty_id');
                    const rows = await dbAll(`
                        SELECT COUNT(*) AS count
                        FROM problems pr
                        LEFT JOIN ${accountTable} u ON u.id = ${ownerExpr}
                        WHERE LOWER(TRIM(COALESCE(u.collegeName, ''))) = LOWER(TRIM(?))
                    `, [collegeName]);
                    problemCount = Number(rows[0]?.count || 0);
                }

                let contestCount = 0;
                if (hasContestCollegeName) {
                    const rows = await dbAll(`
                        SELECT COUNT(*) AS count
                        FROM contests c
                        WHERE LOWER(TRIM(COALESCE(c.collegeName, ''))) = LOWER(TRIM(?))
                    `, [collegeName]);
                    contestCount = Number(rows[0]?.count || 0);
                } else {
                    const rows = await dbAll(`
                        SELECT COUNT(*) AS count
                        FROM contests c
                        LEFT JOIN ${accountTable} u ON u.id = c.createdBy
                        WHERE LOWER(TRIM(COALESCE(u.collegeName, ''))) = LOWER(TRIM(?))
                    `, [collegeName]);
                    contestCount = Number(rows[0]?.count || 0);
                }

                const metrics = await dbAll(`
                    SELECT
                        (SELECT COUNT(*) FROM programs p WHERE LOWER(TRIM(COALESCE(p.collegeName, ''))) = LOWER(TRIM(?))) AS programCount,
                        (SELECT COUNT(*) FROM branches b WHERE LOWER(TRIM(COALESCE(b.collegeName, ''))) = LOWER(TRIM(?))) AS branchCount,
                        (SELECT COUNT(*) FROM sections sec WHERE LOWER(TRIM(COALESCE(sec.collegeName, ''))) = LOWER(TRIM(?))) AS sectionCount,
                        (SELECT COUNT(*) FROM subjects sub WHERE LOWER(TRIM(COALESCE(sub.collegeName, ''))) = LOWER(TRIM(?))) AS subjectCount,
                        (SELECT COUNT(*) FROM student s WHERE LOWER(TRIM(COALESCE(s.collegeName, ''))) = LOWER(TRIM(?)) AND LOWER(COALESCE(s.role, '')) = 'student') AS studentCount,
                        (SELECT COUNT(*) FROM faculty f WHERE LOWER(TRIM(COALESCE(f.collegeName, ''))) = LOWER(TRIM(?)) AND LOWER(COALESCE(f.role, '')) = 'faculty') AS facultyCount
                `, [collegeName, collegeName, collegeName, collegeName, collegeName, collegeName]);

                const [programs, branches, sections, subjects] = await Promise.all([
                    dbAll(`SELECT id, name FROM programs WHERE LOWER(TRIM(COALESCE(collegeName, ''))) = LOWER(TRIM(?)) ORDER BY name ASC`, [collegeName]),
                    dbAll(`SELECT id, name, program_id FROM branches WHERE LOWER(TRIM(COALESCE(collegeName, ''))) = LOWER(TRIM(?)) ORDER BY name ASC`, [collegeName]),
                    dbAll(`SELECT id, name, branch_id FROM sections WHERE LOWER(TRIM(COALESCE(collegeName, ''))) = LOWER(TRIM(?)) ORDER BY name ASC`, [collegeName]),
                    dbAll(`SELECT id, name, branch_id, section_id FROM subjects WHERE LOWER(TRIM(COALESCE(collegeName, ''))) = LOWER(TRIM(?)) ORDER BY name ASC`, [collegeName]),
                ]);

                const allUsers = await dbAll(`
                    SELECT id, fullName, email, program, branch, section, subject, LOWER(COALESCE(role, '')) AS role
                    FROM ${accountTable}
                    WHERE LOWER(TRIM(COALESCE(collegeName, ''))) = LOWER(TRIM(?))
                      AND LOWER(COALESCE(role, '')) IN ('student', 'faculty', 'hod', 'hos', 'admin')
                    ORDER BY fullName ASC
                `, [collegeName]);
                const studentUsers = allUsers
                    .filter((u) => u.role === 'student')
                    .map((u) => ({ ...u, userType: 'student' }));
                const facultyUsers = allUsers
                    .filter((u) => u.role !== 'student')
                    .map((u) => ({ ...u, userType: 'faculty' }));

                const problemList = await dbAll(`
                    SELECT pr.id, pr.title
                    FROM problems pr
                    LEFT JOIN ${accountTable} u ON u.id = COALESCE(pr.created_by, pr.faculty_id)
                    WHERE LOWER(TRIM(COALESCE(u.collegeName, ''))) = LOWER(TRIM(?))
                    ORDER BY pr.id DESC
                `, [collegeName]);

                const contestList = await dbAll(`
                    SELECT c.id, c.title
                    FROM contests c
                    LEFT JOIN ${accountTable} u ON u.id = COALESCE(c.createdBy, c.created_by)
                    WHERE LOWER(TRIM(COALESCE(c.collegeName, ''))) = LOWER(TRIM(?))
                       OR LOWER(TRIM(COALESCE(u.collegeName, ''))) = LOWER(TRIM(?))
                    ORDER BY c.id DESC
                `, [collegeName, collegeName]);

                const metricRow = metrics[0] || {};
                const toNum = (v) => Number(v || 0);
                const resolvedMetrics = {
                    // Handle both SQLite alias casing and PostgreSQL lower-cased alias keys.
                    programCount: toNum(metricRow.programCount ?? metricRow.programcount ?? programs.length),
                    branchCount: toNum(metricRow.branchCount ?? metricRow.branchcount ?? branches.length),
                    sectionCount: toNum(metricRow.sectionCount ?? metricRow.sectioncount ?? sections.length),
                    subjectCount: toNum(metricRow.subjectCount ?? metricRow.subjectcount ?? subjects.length),
                    studentCount: toNum(metricRow.studentCount ?? metricRow.studentcount ?? studentUsers.length),
                    facultyCount: toNum(metricRow.facultyCount ?? metricRow.facultycount ?? facultyUsers.length),
                    problemCount: toNum(problemCount ?? problemList.length),
                    contestCount: toNum(contestCount ?? contestList.length)
                };

                response.push({
                    id: college.id,
                    name: collegeName,
                    university: college.university || '',
                    accreditation: college.accreditation || '',
                    status: college.status || 'active',
                    adminNames: admins.map((a) => a.fullName),
                    admins,
                    metrics: resolvedMetrics,
                    programs,
                    branches,
                    sections,
                    subjects,
                    users: {
                        students: studentUsers,
                        faculty: facultyUsers
                    },
                    problems: problemList,
                    contests: contestList
                });
            }

            res.json({ success: true, colleges: response });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ==========================================
    // SUPERADMIN APIs (Manage Admin Approvals)
    // ==========================================
    
    // 1. Fetch all pending college admins
    router.get('/api/pending-admins', requireRole('superadmin'), (req, res) => {
        (async () => {
            const accountTable = await getAccountTable();
            const rows = await getMergedAdminsByStatus(accountTable, 'pending');
            res.json({ success: true, pendingAdmins: rows });
        })().catch((error) => res.status(500).json({ success: false, error: error.message }));
    });

    // 2. Approve a pending admin
    router.post('/api/approve-admin/:id', requireRole('superadmin'), (req, res) => {
        (async () => {
            const accountTable = await getAccountTable();
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid admin id' });
            }
            const r1 = await dbRun(`UPDATE ${accountTable} SET status = 'active' WHERE id = ? AND LOWER(COALESCE(role, '')) = 'admin'`, [id]);
            let totalChanges = Number(r1?.changes || 0);
            if (accountTable !== 'faculty') {
                const r2 = await dbRun(`UPDATE faculty SET status = 'active' WHERE id = ? AND LOWER(COALESCE(role, '')) = 'admin'`, [id]);
                totalChanges += Number(r2?.changes || 0);
            }
            if (!totalChanges) return res.status(404).json({ success: false, message: 'Admin not found or already active' });
            res.json({ success: true, message: 'College Admin approved successfully' });
        })().catch((error) => res.status(500).json({ success: false, error: error.message }));
    });

    // 3. Reject (delete) a pending admin
    router.delete('/api/reject-admin/:id', requireRole('superadmin'), (req, res) => {
        (async () => {
            const accountTable = await getAccountTable();
            const id = Number(req.params.id);
            if (!Number.isInteger(id) || id <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid admin id' });
            }
            const r1 = await dbRun(`DELETE FROM ${accountTable} WHERE id = ? AND LOWER(COALESCE(role, '')) = 'admin' AND LOWER(COALESCE(status, '')) = 'pending'`, [id]);
            let totalChanges = Number(r1?.changes || 0);
            if (accountTable !== 'faculty') {
                const r2 = await dbRun(`DELETE FROM faculty WHERE id = ? AND LOWER(COALESCE(role, '')) = 'admin' AND LOWER(COALESCE(status, '')) = 'pending'`, [id]);
                totalChanges += Number(r2?.changes || 0);
            }
            if (!totalChanges) return res.status(404).json({ success: false, message: 'Pending admin not found' });
            res.json({ success: true, message: 'College Admin registration rejected' });
        })().catch((error) => res.status(500).json({ success: false, error: error.message }));
    });

    // ==========================================
    // SUPERADMIN CONTEST MANAGEMENT
    // ==========================================
    router.get('/api/contests', requireRole('superadmin'), async (req, res) => {
        try {
            const rows = await dbAll(`
                SELECT c.*, u.fullName as creatorName, u.role as creatorRole
                FROM contests c
                LEFT JOIN account_users u ON c.createdBy = u.id
                WHERE
                    LOWER(COALESCE(NULLIF(c.scope, ''), NULLIF(c.level, ''), NULLIF(c.visibility_scope, ''), '')) = 'global'
                    OR LOWER(COALESCE(u.role, '')) = 'superadmin'
                ORDER BY c.id DESC
            `, []);
            const contests = rows.map((row) => {
                let parsedProblems = [];
                try { parsedProblems = JSON.parse(row.problems || '[]'); } catch { parsedProblems = []; }
                return {
                    ...row,
                    problems: parsedProblems,
                    contest_class: row.contest_class || 'E',
                    guidelines: row.guidelines || row.rulesAndDescription || '',
                    prize: row.prize || ''
                };
            });
            res.json({ success: true, contests });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/api/contests', requireRole('superadmin'), async (req, res) => {
        try {
            const {
                title, description, discription, guidelines, prize, contest_class, class: contestClassInput,
                problems, startDate, endDate, registrationEndDate, duration, eligibility, publishNow
            } = req.body;
            if (!title || !String(title).trim()) {
                return res.status(400).json({ success: false, error: 'Title is required' });
            }
            const allowedClasses = ['E', 'D', 'C', 'B', 'A', 'S'];
            const classValue = String(contestClassInput || contest_class || 'E').toUpperCase();
            const normalizedClass = allowedClasses.includes(classValue) ? classValue : 'E';
            const finalDescription = String(description || discription || '').trim();
            const finalGuidelines = String(guidelines || '').trim();
            const finalPrize = String(prize || '').trim();
            const status = publishNow ? 'accepted' : 'upcoming';
            const approvedBy = publishNow ? req.session.user.id : null;
            const approvedAt = publishNow ? new Date().toISOString() : null;
            let problemPayload = '[]';
            if (Array.isArray(problems)) {
                problemPayload = JSON.stringify(problems);
            } else if (typeof problems === 'string' && problems.trim()) {
                try {
                    const parsed = JSON.parse(problems);
                    problemPayload = JSON.stringify(Array.isArray(parsed) ? parsed : []);
                } catch {
                    problemPayload = JSON.stringify(
                        problems.split(',').map(item => item.trim()).filter(Boolean)
                    );
                }
            }

            let result;
            try {
                result = await dbRun(`
                    INSERT INTO contests (
                        title, description, guidelines, rulesAndDescription, contest_class, prize, problems,
                        startDate, endDate, registrationEndDate, date, deadline, duration, eligibility,
                        status, visibility_scope, scope, level, createdBy, collegeName, isVerified, approved_by, approved_at, createdAt
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'global', 'global', 'global', ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                    title.trim(), finalDescription, finalGuidelines, finalGuidelines, normalizedClass, finalPrize, problemPayload,
                    startDate || null, endDate || null, registrationEndDate || null, startDate || null, endDate || null, duration || null, eligibility || null,
                    status, req.session.user.id, publishNow ? 1 : 0, approvedBy, approvedAt
                ]);
            } catch (insertErr) {
                // Backward-compatible fallback for legacy query/schema mismatch variants.
                if (!/values?\s+for\s+\d+\s+columns?/i.test(String(insertErr.message || ''))) {
                    throw insertErr;
                }
                result = await dbRun(`
                    INSERT INTO contests (
                        title, description, guidelines, rulesAndDescription, contest_class, prize, problems,
                        startDate, endDate, date, deadline, duration, eligibility,
                        status, visibility_scope, scope, level, createdBy, collegeName, isVerified, approved_by, approved_at, createdAt
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'global', 'global', 'global', ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
                `, [
                    title.trim(), finalDescription, finalGuidelines, finalGuidelines, normalizedClass, finalPrize, problemPayload,
                    startDate || null, endDate || null, startDate || null, endDate || null, duration || null, eligibility || null,
                    status, req.session.user.id, publishNow ? 1 : 0, approvedBy, approvedAt
                ]);
            }

            res.json({
                success: true,
                id: result.lastID,
                message: publishNow ? 'Contest created and published.' : 'Contest created as draft.'
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/api/contests/:id/publish', requireRole('superadmin'), async (req, res) => {
        try {
            const contestId = Number(req.params.id);
            if (!Number.isInteger(contestId) || contestId <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid contest id' });
            }
            const contestRows = await dbAll(`SELECT problems FROM contests WHERE id = ?`, [contestId]);
            if (!contestRows.length) return res.status(404).json({ success: false, error: 'Contest not found' });
            let parsedProblems = [];
            try { parsedProblems = JSON.parse(contestRows[0].problems || '[]'); } catch { parsedProblems = []; }
            if (!Array.isArray(parsedProblems) || parsedProblems.length === 0) {
                return res.status(400).json({ success: false, error: 'Add at least one problem before publishing.' });
            }
            const result = await dbRun(`
                UPDATE contests
                SET status = 'accepted', isVerified = 1, visibility_scope = 'global', scope = 'global', level = 'global', approved_by = ?, approved_at = ?
                WHERE id = ?
            `, [req.session.user.id, new Date().toISOString(), contestId]);
            if (!result.changes) return res.status(404).json({ success: false, error: 'Contest not found' });
            res.json({ success: true, message: 'Contest published to users.' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.post('/api/contests/:id/problems', requireRole('superadmin'), async (req, res) => {
        try {
            const contestId = Number(req.params.id);
            if (!Number.isInteger(contestId) || contestId <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid contest id' });
            }
            const { problems } = req.body;
            if (!Array.isArray(problems)) {
                return res.status(400).json({ success: false, error: 'Problems must be an array.' });
            }
            const sanitized = problems
                .map((p) => (typeof p === 'object' && p !== null ? {
                    id: Number(p.id),
                    title: String(p.title || '').trim()
                } : null))
                .filter((p) => Number.isInteger(p?.id) && p.id > 0);
            const result = await dbRun(`UPDATE contests SET problems = ? WHERE id = ?`, [JSON.stringify(sanitized), contestId]);
            if (!result.changes) return res.status(404).json({ success: false, error: 'Contest not found' });

            await dbRun(`DELETE FROM contest_problems WHERE contest_id = ?`, [contestId]);
            for (const problem of sanitized) {
                await dbRun(`INSERT INTO contest_problems (contest_id, problem_id) VALUES (?, ?)`, [contestId, problem.id]);
            }

            res.json({ success: true, message: 'Problems mapped to contest.' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.delete('/api/contests/:id', requireRole('superadmin'), async (req, res) => {
        try {
            const contestId = Number(req.params.id);
            if (!Number.isInteger(contestId) || contestId <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid contest id' });
            }
            await dbRun(`DELETE FROM contests WHERE id = ?`, [contestId]);
            res.json({ success: true, message: 'Contest removed.' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ==========================================
    // SUPERADMIN SUPPORT TICKETS
    // ==========================================
    router.get('/api/support-tickets', requireRole('superadmin'), async (req, res) => {
        try {
            const status = String(req.query.status || 'all').toLowerCase();
            const where = status === 'all' ? '' : 'WHERE LOWER(t.status) = ?';
            const params = status === 'all' ? [] : [status];
            const tickets = await dbAll(`
                SELECT t.*,
                       u.fullName as userFullName,
                       r.fullName as resolvedByName
                FROM support_tickets t
                LEFT JOIN users u ON u.id = t.user_id
                LEFT JOIN users r ON r.id = t.resolved_by
                ${where}
                ORDER BY CASE
                    WHEN LOWER(t.status) = 'open' THEN 1
                    WHEN LOWER(t.status) = 'reopened' THEN 2
                    WHEN LOWER(t.status) = 'in_progress' THEN 3
                    WHEN LOWER(t.status) = 'resolved' THEN 4
                    ELSE 5
                END, t.id DESC
            `, params);
            res.json({ success: true, tickets });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    router.patch('/api/support-tickets/:id', requireRole('superadmin'), async (req, res) => {
        try {
            const ticketId = Number(req.params.id);
            if (!Number.isInteger(ticketId) || ticketId <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid ticket id' });
            }
            const allowedStatuses = ['open', 'reopened', 'in_progress', 'resolved'];
            const status = String(req.body.status || '').toLowerCase();
            const reply = String(req.body.reply || '').trim();
            if (status && !allowedStatuses.includes(status)) {
                return res.status(400).json({ success: false, error: 'Invalid status value' });
            }
            const finalStatus = status || 'in_progress';
            const resolvedBy = finalStatus === 'resolved' ? req.session.user.id : null;

            const result = await dbRun(`
                UPDATE support_tickets
                SET status = ?, superadmin_reply = ?, resolved_by = ?, updatedAt = CURRENT_TIMESTAMP
                WHERE id = ?
            `, [finalStatus, reply, resolvedBy, ticketId]);
            if (!result.changes) return res.status(404).json({ success: false, error: 'Ticket not found' });
            res.json({ success: true, message: 'Ticket updated successfully' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
};
