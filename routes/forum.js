const express = require('express');

module.exports = (db) => {
    const router = express.Router();

    // Middleware to check if user is logged in
    const requireAuth = (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
        }
        next();
    };

    const requireSuperAdmin = (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized. Please log in.' });
        }
        if (String(req.session.user.role || '').toLowerCase() !== 'superadmin') {
            return res.status(403).json({ success: false, message: 'Forbidden: Superadmin access required.' });
        }
        next();
    };

    const toSlug = (value) => String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    // ==========================================
    // 1. GET CURRENT USER CONTEXT
    // ==========================================
    router.get('/me', (req, res) => {
        if (!(req.session && req.session.user)) {
            return res.status(401).json({ success: false, message: 'Not logged in' });
        }

        const sessionUser = req.session.user;
        db.get(
            `SELECT
                id, fullName, email, role, collegeName,
                COALESCE(points, 0) AS points,
                COALESCE(solvedCount, 0) AS solvedCount,
                rank
             FROM (
                SELECT id, fullName, email, role, collegeName, points, solvedCount, rank FROM student
                UNION ALL
                SELECT id, fullName, email, role, collegeName, points, solvedCount, rank FROM faculty
             ) x
             WHERE id = ?
             LIMIT 1`,
            [sessionUser.id],
            (err, row) => {
                if (err || !row) {
                    return res.json({ success: true, user: sessionUser });
                }

                const rankRaw = String(row.rank || '').trim();
                const globalRank = rankRaw
                    ? (rankRaw.startsWith('#') ? rankRaw : `#${rankRaw}`)
                    : '#-';

                const mergedUser = {
                    ...sessionUser,
                    ...row,
                    fullName: row.fullName || sessionUser.fullName || sessionUser.name || 'User',
                    collegeName: row.collegeName || sessionUser.collegeName || '',
                    xp: Number(row.points || 0),
                    problems_solved: Number(row.solvedCount || 0),
                    global_rank: globalRank
                };

                return res.json({ success: true, user: mergedUser });
            }
        );
    });

    // ==========================================
    // 1b. TOPICS (VISIBLE TO ALL AUTHENTICATED USERS)
    // ==========================================
    router.get('/topics', requireAuth, (req, res) => {
        db.all(
            `SELECT id, name, slug, icon, createdAt
             FROM forum_topics
             WHERE is_active = 1
             ORDER BY name COLLATE NOCASE ASC`,
            [],
            (err, rows) => {
                if (err) {
                    return res.status(500).json({ success: false, message: 'Database error', error: err.message });
                }
                res.json({ success: true, topics: rows || [] });
            }
        );
    });

    // ==========================================
    // 1c. CREATE TOPIC (SUPERADMIN ONLY)
    // ==========================================
    router.post('/topics', requireSuperAdmin, (req, res) => {
        const body = req.body || {};
        const name = String(body.name || '').trim();
        const slugRaw = String(body.slug || '').trim();
        const icon = String(body.icon || 'fas fa-hashtag').trim();
        const slug = toSlug(slugRaw || name);
        const createdBy = req.session.user.id;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Topic name is required.' });
        }
        if (!slug) {
            return res.status(400).json({ success: false, message: 'Invalid topic name/slug.' });
        }

        db.get(`SELECT id FROM forum_topics WHERE slug = ?`, [slug], (checkErr, existing) => {
            if (checkErr) {
                return res.status(500).json({ success: false, message: 'Database error', error: checkErr.message });
            }
            if (existing) {
                return res.status(400).json({ success: false, message: 'Topic already exists.' });
            }

            db.run(
                `INSERT INTO forum_topics (name, slug, icon, created_by, is_active)
                 VALUES (?, ?, ?, ?, 1)`,
                [name, slug, icon, createdBy],
                function (insertErr) {
                    if (insertErr) {
                        return res.status(500).json({ success: false, message: 'Database error', error: insertErr.message });
                    }
                    return res.json({
                        success: true,
                        message: 'Topic created successfully.',
                        topic: { id: this.lastID, name, slug, icon }
                    });
                }
            );
        });
    });

    // ==========================================
    // 2. GET THREADS LIST
    // ==========================================
    router.get('/threads', requireAuth, (req, res) => {
        const { filter = 'global', sort = 'latest', search = '' } = req.query;
        let query = `
            SELECT t.*, u.fullName as author_name, u.role as author_role, u.collegeName as author_college,
                   (SELECT COUNT(*) FROM forum_replies r WHERE r.thread_id = t.id) as reply_count
            FROM forum_threads t
            JOIN account_users u ON t.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (filter === 'college') {
            const userCollege = req.session.user.collegeName;
            if (userCollege) {
                query += ` AND t.collegeName = ?`;
                params.push(userCollege);
            }
        }

        if (search) {
            query += ` AND (t.title LIKE ? OR t.content LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }

        if (sort === 'popular') {
            query += ` ORDER BY reply_count DESC, t.views DESC, t.createdAt DESC`;
        } else {
            // 'latest'
            query += ` ORDER BY t.createdAt DESC`;
        }

        db.all(query, params, (err, rows) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error', error: err.message });
            res.json({ success: true, threads: rows });
        });
    });

    // ==========================================
    // 3. CREATE THREAD
    // ==========================================
    router.post('/threads', requireAuth, (req, res) => {
        const body = req.body || {};
        const title = body.title;
        const content = body.content;
        const topic = body.topic;
        const user_id = req.session.user.id;
        const collegeName = req.session.user.collegeName || '';

        if (!title || !content) {
            return res.status(400).json({ success: false, message: 'Title and content are required' });
        }

        db.run(`INSERT INTO forum_threads (title, content, topic, user_id, collegeName) VALUES (?, ?, ?, ?, ?)`,
            [title, content, topic || 'general', user_id, collegeName],
            function (err) {
                if (err) return res.status(500).json({ success: false, message: 'Database error' });
                res.json({ success: true, message: 'Thread created successfully', thread_id: this.lastID });
            }
        );
    });

    // ==========================================
    // 4. GET THREAD DETAILS & REPLIES
    // ==========================================
    router.get('/threads/:id', requireAuth, (req, res) => {
        const threadId = req.params.id;
        const userId = req.session.user.id; // For checking vote status later if needed

        // Increment views
        db.run(`UPDATE forum_threads SET views = views + 1 WHERE id = ?`, [threadId], (err) => {
            if (err) console.error("Error updating views:", err.message);
        });

        // Get Thread info
       db.get(`
            SELECT t.*, u.fullName as author_name, u.role as author_role, u.collegeName as author_college,
                   (SELECT vote_type FROM forum_thread_votes WHERE thread_id = t.id AND user_id = ?) as user_vote,
                   (SELECT COUNT(*) FROM forum_replies r WHERE r.thread_id = t.id) as reply_count
            FROM forum_threads t
            JOIN account_users u ON t.user_id = u.id
            WHERE t.id = ?
        `, [userId, threadId], (err, thread) => {
            if (err || !thread) return res.status(404).json({ success: false, message: 'Thread not found' });

            // Get Replies
            // We left join with current user's votes to know if they already voted
           db.all(`
                SELECT r.*, u.fullName as author_name, u.role as author_role,
                       (SELECT vote_type FROM forum_votes WHERE reply_id = r.id AND user_id = ?) as user_vote
                FROM forum_replies r
                JOIN account_users u ON r.user_id = u.id
                WHERE r.thread_id = ?
                ORDER BY (r.upvotes - r.downvotes) DESC, r.createdAt ASC
            `, [userId, threadId], (err, replies) => {
                if (err) return res.status(500).json({ success: false, message: 'Database error' });
                res.json({ success: true, thread, replies });
            });
        });
    });

    // ==========================================
    // 5a. THREAD UPVOTE
    // ==========================================
    router.post('/threads/:id/upvote', requireAuth, (req, res) => {
        const threadId = req.params.id;
        const userId = req.session.user.id;
        const numericVote = 1;

        db.get(`SELECT vote_type FROM forum_thread_votes WHERE thread_id = ? AND user_id = ?`, [threadId, userId], (err, row) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error' });

            if (row) {
                if (row.vote_type === numericVote) {
                    db.run(`DELETE FROM forum_thread_votes WHERE thread_id = ? AND user_id = ?`, [threadId, userId], (err) => {
                        if (err) return res.status(500).json({ success: false, message: 'Database error' });
                        db.run(`UPDATE forum_threads SET upvotes = upvotes - 1 WHERE id = ? AND upvotes > 0`, [threadId], (err) => {
                            if (err) return res.status(500).json({ success: false, message: 'Database error' });
                            db.get(`SELECT upvotes, downvotes FROM forum_threads WHERE id = ?`, [threadId], (err, row) => {
                                if (err || !row) return res.status(500).json({ success: false, message: 'Database error' });
                                res.json({ success: true, upvotes: row.upvotes, downvotes: row.downvotes, currentVote: 0 });
                            });
                        });
                    });
                } else {
                    db.run(`UPDATE forum_thread_votes SET vote_type = ? WHERE thread_id = ? AND user_id = ?`, [numericVote, threadId, userId], (err) => {
                        if (err) return res.status(500).json({ success: false, message: 'Database error' });
                        db.run(`UPDATE forum_threads SET upvotes = upvotes + 1, downvotes = downvotes - 1 WHERE id = ? AND downvotes > 0`, [threadId], (err) => {
                            if (err) return res.status(500).json({ success: false, message: 'Database error' });
                            db.get(`SELECT upvotes, downvotes FROM forum_threads WHERE id = ?`, [threadId], (err, row) => {
                                if (err || !row) return res.status(500).json({ success: false, message: 'Database error' });
                                res.json({ success: true, upvotes: row.upvotes, downvotes: row.downvotes, currentVote: 1 });
                            });
                        });
                    });
                }
            } else {
                db.run(`INSERT INTO forum_thread_votes (thread_id, user_id, vote_type) VALUES (?, ?, ?)`, [threadId, userId, numericVote], (err) => {
                    if (err) return res.status(500).json({ success: false, message: 'Database error' });
                    db.run(`UPDATE forum_threads SET upvotes = upvotes + 1 WHERE id = ?`, [threadId], (err) => {
                        if (err) return res.status(500).json({ success: false, message: 'Database error' });
                        db.get(`SELECT upvotes, downvotes FROM forum_threads WHERE id = ?`, [threadId], (err, row) => {
                            if (err || !row) return res.status(500).json({ success: false, message: 'Database error' });
                            res.json({ success: true, upvotes: row.upvotes, downvotes: row.downvotes, currentVote: 1 });
                        });
                    });
                });
            }
        });
    });

    // ==========================================
    // 5b. THREAD DOWNVOTE
    // ==========================================
    router.post('/threads/:id/downvote', requireAuth, (req, res) => {
        const threadId = req.params.id;
        const userId = req.session.user.id;
        const numericVote = -1;

        db.get(`SELECT vote_type FROM forum_thread_votes WHERE thread_id = ? AND user_id = ?`, [threadId, userId], (err, row) => {
            if (err) return res.status(500).json({ success: false, message: 'Database error' });

            if (row) {
                if (row.vote_type === numericVote) {
                    db.run(`DELETE FROM forum_thread_votes WHERE thread_id = ? AND user_id = ?`, [threadId, userId], (err) => {
                        if (err) return res.status(500).json({ success: false, message: 'Database error' });
                        db.run(`UPDATE forum_threads SET downvotes = downvotes - 1 WHERE id = ? AND downvotes > 0`, [threadId], (err) => {
                            if (err) return res.status(500).json({ success: false, message: 'Database error' });
                            db.get(`SELECT upvotes, downvotes FROM forum_threads WHERE id = ?`, [threadId], (err, row) => {
                                if (err || !row) return res.status(500).json({ success: false, message: 'Database error' });
                                res.json({ success: true, upvotes: row.upvotes, downvotes: row.downvotes, currentVote: 0 });
                            });
                        });
                    });
                } else {
                    db.run(`UPDATE forum_thread_votes SET vote_type = ? WHERE thread_id = ? AND user_id = ?`, [numericVote, threadId, userId], (err) => {
                        if (err) return res.status(500).json({ success: false, message: 'Database error' });
                        db.run(`UPDATE forum_threads SET downvotes = downvotes + 1, upvotes = upvotes - 1 WHERE id = ? AND upvotes > 0`, [threadId], (err) => {
                            if (err) return res.status(500).json({ success: false, message: 'Database error' });
                            db.get(`SELECT upvotes, downvotes FROM forum_threads WHERE id = ?`, [threadId], (err, row) => {
                                if (err || !row) return res.status(500).json({ success: false, message: 'Database error' });
                                res.json({ success: true, upvotes: row.upvotes, downvotes: row.downvotes, currentVote: -1 });
                            });
                        });
                    });
                }
            } else {
                db.run(`INSERT INTO forum_thread_votes (thread_id, user_id, vote_type) VALUES (?, ?, ?)`, [threadId, userId, numericVote], (err) => {
                    if (err) return res.status(500).json({ success: false, message: 'Database error' });
                    db.run(`UPDATE forum_threads SET downvotes = downvotes + 1 WHERE id = ?`, [threadId], (err) => {
                        if (err) return res.status(500).json({ success: false, message: 'Database error' });
                        db.get(`SELECT upvotes, downvotes FROM forum_threads WHERE id = ?`, [threadId], (err, row) => {
                            if (err || !row) return res.status(500).json({ success: false, message: 'Database error' });
                            res.json({ success: true, upvotes: row.upvotes, downvotes: row.downvotes, currentVote: -1 });
                        });
                    });
                });
            }
        });
    });

    // ==========================================
    // 5. DELETE THREAD (SUPER ADMIN)
    // ==========================================
    router.delete('/threads/:id', requireAuth, (req, res) => {
        if (req.session.user.role !== 'superadmin') {
            return res.status(403).json({ success: false, message: 'Forbidden: Super Admin access required.' });
        }
        const threadId = req.params.id;

        db.run(`DELETE FROM forum_threads WHERE id = ?`, [threadId], function (err) {
            if (err) return res.status(500).json({ success: false, message: 'Database error' });
            res.json({ success: true, message: 'Thread deleted successfully' });
        });
    });

    // ==========================================
    // 6. CREATE REPLY
    // ==========================================
    router.post('/replies', requireAuth, (req, res) => {
        const { thread_id, content } = req.body;
        const user_id = req.session.user.id;

        if (!thread_id || !content) {
            return res.status(400).json({ success: false, message: 'Thread ID and content are required' });
        }

        db.run(`INSERT INTO forum_replies (thread_id, user_id, content) VALUES (?, ?, ?)`,
            [thread_id, user_id, content],
            function (err) {
                if (err) {
                    console.error("Error creating reply:", err.message);
                    return res.status(500).json({ success: false, message: 'Database error' });
                }
                res.json({ success: true, message: 'Reply posted', reply_id: this.lastID });
            }
        );
    });

    // ==========================================
    // 7. VOTE ON REPLY
    // ==========================================
    router.post('/replies/vote', requireAuth, (req, res) => {
        const { reply_id, vote_type } = req.body; // vote_type: 1 or -1
        const user_id = req.session.user.id;

        if (!reply_id || ![1, -1].includes(Number(vote_type))) {
            return res.status(400).json({ success: false, message: 'Invalid payload' });
        }

        const numericVote = Number(vote_type);

        // Check if user already voted
        db.get(`SELECT vote_type FROM forum_votes WHERE reply_id = ? AND user_id = ?`,
            [reply_id, user_id],
            (err, row) => {
                if (err) return res.status(500).json({ success: false, message: 'Database error' });

                if (row) {
                    const existingVote = row.vote_type;
                    
                    if (existingVote === numericVote) {
                        // User clicking same vote button -> Toggle off (remove vote)
                        db.run(`DELETE FROM forum_votes WHERE reply_id = ? AND user_id = ?`, [reply_id, user_id], (err) => {
                            if (err) return res.status(500).json({ success: false });
                            
                            // Adjust counts
                            const col = numericVote === 1 ? 'upvotes' : 'downvotes';
                            db.run(`UPDATE forum_replies SET ${col} = ${col} - 1 WHERE id = ?`, [reply_id], (err) => {
                                res.json({ success: true, action: 'removed' });
                            });
                        });
                    } else {
                        // User changing vote (e.g. from +1 to -1)
                        db.run(`UPDATE forum_votes SET vote_type = ? WHERE reply_id = ? AND user_id = ?`, [numericVote, reply_id, user_id], (err) => {
                            if (err) return res.status(500).json({ success: false });

                            const incCol = numericVote === 1 ? 'upvotes' : 'downvotes';
                            const decCol = existingVote === 1 ? 'upvotes' : 'downvotes';

                            db.run(`UPDATE forum_replies SET ${incCol} = ${incCol} + 1, ${decCol} = Math.max(${decCol} - 1, 0) WHERE id = ?`, [reply_id], (err) => {
                                // SQLite Math is not directly available, do it simply:
                                db.run(`UPDATE forum_replies SET ${decCol} = ${decCol} - 1 WHERE id = ?`, [reply_id], () => {
                                    res.json({ success: true, action: 'changed' });
                                });
                            });
                        });
                    }
                } else {
                    // New vote
                    db.run(`INSERT INTO forum_votes (reply_id, user_id, vote_type) VALUES (?, ?, ?)`, [reply_id, user_id, numericVote], (err) => {
                        if (err) return res.status(500).json({ success: false, message: 'Database error' });

                        const col = numericVote === 1 ? 'upvotes' : 'downvotes';
                        db.run(`UPDATE forum_replies SET ${col} = ${col} + 1 WHERE id = ?`, [reply_id], (err) => {
                            res.json({ success: true, action: 'added' });
                        });
                    });
                }
            }
        );
    });

    // ==========================================
    // 8. DELETE REPLY (SUPER ADMIN)
    // ==========================================
    router.delete('/replies/:id', requireAuth, (req, res) => {
        if (req.session.user.role !== 'superadmin') {
            return res.status(403).json({ success: false, message: 'Forbidden.' });
        }
        const replyId = req.params.id;

        db.run(`DELETE FROM forum_replies WHERE id = ?`, [replyId], function (err) {
            if (err) return res.status(500).json({ success: false, message: 'Database error' });
            res.json({ success: true, message: 'Reply deleted' });
        });
    });


    return router;
};
