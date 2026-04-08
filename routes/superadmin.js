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

    // ==========================================
    // SUPERADMIN APIs (Manage Colleges)
    // ==========================================
    // Fetch all colleges
    router.get('/api/colleges', requireRole('superadmin'), (req, res) => {
        db.all(`
            SELECT
                c.*,
                COALESCE((
                    SELECT GROUP_CONCAT(u.fullName, ', ')
                    FROM account_users u
                    WHERE LOWER(TRIM(u.collegeName)) = LOWER(TRIM(c.name))
                      AND u.role = 'admin'
                      AND u.status = 'active'
                ), 'Not Assigned') AS adminNames,
                COALESCE((
                    SELECT u.fullName
                    FROM account_users u
                    WHERE LOWER(TRIM(u.collegeName)) = LOWER(TRIM(c.name))
                      AND u.role = 'admin'
                      AND u.status = 'active'
                    ORDER BY u.id ASC
                    LIMIT 1
                ), 'Not Assigned') AS collegeAdmin
            FROM colleges c
            ORDER BY c.id DESC
        `, [], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, colleges: rows });
        });
    });

    // Add a new college
    router.post('/api/colleges', requireRole('superadmin'), (req, res) => {
        const { name } = req.body;
        db.run(`INSERT INTO colleges (name) VALUES (?)`, [name], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(400).json({ success: false, error: 'College already exists' });
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({ success: true, id: this.lastID, message: 'College added successfully' });
        });
    });

    // Delete a college
    router.delete('/api/colleges/:id', requireRole('superadmin'), (req, res) => {
        db.run(`DELETE FROM colleges WHERE id = ?`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, message: 'College deleted successfully' });
        });
    });

    // ==========================================
    // SUPERADMIN APIs (Manage Admin Approvals)
    // ==========================================
    
    // 1. Fetch all pending college admins
    router.get('/api/pending-admins', requireRole('superadmin'), (req, res) => {
        db.all(`SELECT id, fullName, email, collegeName FROM account_users WHERE role = 'admin' AND status = 'pending' ORDER BY id DESC`, [], (err, rows) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, pendingAdmins: rows });
        });
    });

    // 2. Approve a pending admin
    router.post('/api/approve-admin/:id', requireRole('superadmin'), (req, res) => {
        db.run(`UPDATE account_users SET status = 'active' WHERE id = ? AND role = 'admin'`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            if (this.changes === 0) return res.status(404).json({ success: false, message: 'Admin not found or already active' });
            res.json({ success: true, message: 'College Admin approved successfully' });
        });
    });

    // 3. Reject (delete) a pending admin
    router.delete('/api/reject-admin/:id', requireRole('superadmin'), (req, res) => {
        db.run(`DELETE FROM account_users WHERE id = ? AND role = 'admin' AND status = 'pending'`, [req.params.id], function(err) {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, message: 'College Admin registration rejected' });
        });
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

            const result = await dbRun(`
                INSERT INTO contests (
                    title, description, guidelines, rulesAndDescription, contest_class, prize, problems,
                    startDate, endDate, registrationEndDate, date, deadline, duration, eligibility,
                    status, visibility_scope, scope, level, createdBy, collegeName, isVerified, approved_by, approved_at, createdAt
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'global', 'global', 'global', ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
            `, [
                title.trim(), finalDescription, finalGuidelines, finalGuidelines, normalizedClass, finalPrize, problemPayload,
                startDate || null, endDate || null, registrationEndDate || null, startDate || null, endDate || null, duration || null, eligibility || null,
                status, req.session.user.id, publishNow ? 1 : 0, approvedBy, approvedAt
            ]);

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
                LEFT JOIN account_users u ON u.id = t.user_id
                LEFT JOIN account_users r ON r.id = t.resolved_by
                ${where}
                ORDER BY CASE
                    WHEN LOWER(t.status) = 'open' THEN 1
                    WHEN LOWER(t.status) = 'in_progress' THEN 2
                    WHEN LOWER(t.status) = 'resolved' THEN 3
                    ELSE 4
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
            const allowedStatuses = ['open', 'in_progress', 'resolved'];
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
