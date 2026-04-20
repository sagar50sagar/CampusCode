const express = require('express');
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

    const createTicketHandler = async (req, res) => {
        try {
            const user = req.session?.user;
            if (!user?.id) return res.status(401).json({ success: false, message: 'Unauthorized' });

            const subject = String(req.body.subject || '').trim();
            const category = String(req.body.category || 'General Question').trim();
            const details = String(req.body.details || req.body.message || '').trim();

            if (!subject || !details) {
                return res.status(400).json({ success: false, message: 'Subject and details are required.' });
            }
            if (subject.length > 50) {
                return res.status(400).json({ success: false, message: 'Subject must be 50 characters or fewer.' });
            }

            const result = await dbRun(`
                INSERT INTO support_tickets (
                    user_id, requester_name, requester_email, requester_role, requester_college,
                    subject, category, details, status, updatedAt
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', CURRENT_TIMESTAMP)
            `, [
                user.id,
                user.fullName || user.name || 'User',
                user.email || '',
                String(user.role || '').toLowerCase(),
                user.collegeName || user.college || '',
                subject,
                category || 'General Question',
                details
            ]);

            return res.json({
                success: true,
                message: 'Ticket submitted successfully.',
                ticketId: result.lastID
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    };

    const requireAuth = (req, res, next) => {
        if (!req.session?.user?.id) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        next();
    };

    router.post('/', requireAuth, createTicketHandler);
    router.post('/tickets', requireAuth, createTicketHandler);

    router.get('/tickets/me', requireAuth, async (req, res) => {
        try {
            const rows = await dbAll(`
                SELECT id, subject, category, details, status, superadmin_reply, createdAt, updatedAt
                FROM support_tickets
                WHERE user_id = ?
                ORDER BY id DESC
            `, [req.session.user.id]);
            res.json({ success: true, tickets: rows });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    router.patch('/tickets/:id/reopen', requireAuth, async (req, res) => {
        try {
            const ticketId = Number(req.params.id);
            const userId = Number(req.session.user.id);
            if (!Number.isInteger(ticketId) || ticketId <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid ticket id.' });
            }

            const ownRows = await dbAll(`SELECT id, status FROM support_tickets WHERE id = ? AND user_id = ? LIMIT 1`, [ticketId, userId]);
            const ownTicket = ownRows[0];
            if (!ownTicket) {
                return res.status(404).json({ success: false, message: 'Ticket not found.' });
            }

            const currentStatus = String(ownTicket.status || '').toLowerCase();
            if (!['resolved', 'closed'].includes(currentStatus)) {
                return res.status(400).json({ success: false, message: 'Only resolved/closed tickets can be reopened.' });
            }

            await dbRun(`
                UPDATE support_tickets
                SET status = 'reopened', resolved_by = NULL, updatedAt = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
            `, [ticketId, userId]);

            return res.json({ success: true, status: 'reopened' });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    });

    return router;
};
