const express = require('express');
const path = require('path');
const { requireRole } = require('../middleware/auth');

module.exports = (db) => {
    const router = express.Router();
    const requireIndividual = requireRole('individual');
    const dbGet = (query, params = []) => new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => err ? reject(err) : resolve(row));
    });
    const dbAll = (query, params = []) => new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows));
    });

    const serve = (file) => (req, res) =>
        res.sendFile(path.join(__dirname, '../views/individual', file));

    router.get('/', requireIndividual, (req, res) => {
        return res.redirect('/individual/dashboard');
    });

    router.get('/dashboard', requireIndividual, serve('dashboard.html'));
    router.get('/dashboard.html', requireIndividual, (req, res) => res.redirect('/individual/dashboard'));

    router.get('/problems', requireIndividual, serve('problems.html'));
    router.get('/problems.html', requireIndividual, (req, res) => res.redirect('/individual/problems'));
    router.get('/problem/:id', requireIndividual, serve('problem_page.html'));
    router.get('/problem_page.html', requireIndividual, serve('problem_page.html'));

    router.get('/contest', requireIndividual, serve('contest.html'));
    router.get('/contests', requireIndividual, (req, res) => res.redirect('/individual/contest'));
    router.get('/contest.html', requireIndividual, (req, res) => res.redirect('/individual/contest'));
    router.get('/contest/:id', requireIndividual, serve('contest-details.html'));
    router.get('/contest-details.html', requireIndividual, serve('contest-details.html'));

    router.get('/forum', requireIndividual, serve('forum.html'));
    router.get('/forum.html', requireIndividual, (req, res) => res.redirect('/individual/forum'));
    router.get('/new-post', requireIndividual, serve('new-post.html'));
    router.get('/new-post.html', requireIndividual, (req, res) => res.redirect('/individual/new-post'));

    router.get('/report', requireIndividual, serve('report.html'));
    router.get('/report.html', requireIndividual, (req, res) => res.redirect('/individual/report'));
    router.get('/stats', requireIndividual, serve('stats.html'));
    router.get('/stats.html', requireIndividual, (req, res) => res.redirect('/individual/stats'));
    router.get('/profile', requireIndividual, serve('profile.html'));
    router.get('/profile.html', requireIndividual, (req, res) => res.redirect('/individual/profile'));
    router.get('/support', requireIndividual, serve('support.html'));
    router.get('/support.html', requireIndividual, (req, res) => res.redirect('/individual/support'));

    // Reuse student APIs for individual users (role guard + same session context).
    router.get('/api/contests', requireIndividual, (req, res) => res.redirect(307, '/student/api/contests'));
    router.get('/api/contests/:id', requireIndividual, (req, res) => res.redirect(307, `/student/api/contests/${req.params.id}`));
    router.post('/api/contests/:id/join', requireIndividual, (req, res) => res.redirect(307, `/student/api/contests/${req.params.id}/join`));
    router.get('/api/contests/:id/leaderboard', requireIndividual, (req, res) => res.redirect(307, `/student/api/contests/${req.params.id}/leaderboard`));
    router.get('/api/dashboard-data', requireIndividual, async (req, res) => {
        try {
            const userId = Number(req.session?.user?.id);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const user = await dbGet(`
                SELECT id, fullName, email, points, solvedCount, rank
                FROM account_users
                WHERE id = ?
            `, [userId]);
            if (!user) return res.status(404).json({ success: false, error: 'User not found' });

            const points = Number(user.points || 0);
            const solved = Number(user.solvedCount || 0);
            const globalHigher = await dbGet(`
                SELECT COUNT(*) as cnt
                FROM account_users
                WHERE LOWER(COALESCE(role, '')) IN ('student', 'individual')
                  AND COALESCE(points, 0) > ?
            `, [points]);
            const totalUsers = await dbGet(`
                SELECT COUNT(*) as cnt
                FROM account_users
                WHERE LOWER(COALESCE(role, '')) IN ('student', 'individual')
            `, []);

            const globalRank = Number(globalHigher?.cnt || 0) + 1;
            const total = Math.max(1, Number(totalUsers?.cnt || 1));
            const topPercent = Math.max(1, Math.round((1 - ((globalRank - 1) / total)) * 100));

            const acceptedRows = await dbAll(`
                SELECT DATE(createdAt) AS d
                FROM submissions
                WHERE user_id = ?
                  AND LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass')
                GROUP BY DATE(createdAt)
                ORDER BY d DESC
            `, [userId]);

            let streakDays = 0;
            if (acceptedRows.length) {
                const dates = new Set(acceptedRows.map(r => String(r.d)));
                const cursor = new Date();
                cursor.setHours(0, 0, 0, 0);
                while (true) {
                    const key = cursor.toISOString().slice(0, 10);
                    if (!dates.has(key)) break;
                    streakDays += 1;
                    cursor.setDate(cursor.getDate() - 1);
                }
            }

            const recentProblems = await dbAll(`
                SELECT p.title,
                       COALESCE(NULLIF(p.difficulty, ''), 'Easy') AS difficulty,
                       MAX(s.createdAt) AS solvedAt
                FROM submissions s
                JOIN problems p ON p.id = s.problem_id
                WHERE s.user_id = ?
                  AND LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac', 'pass')
                GROUP BY p.id, p.title, p.difficulty
                ORDER BY solvedAt DESC
                LIMIT 4
            `, [userId]);

            const last7 = await dbAll(`
                SELECT strftime('%Y-%m-%d', createdAt) AS dayKey, COUNT(*) AS cnt
                FROM submissions
                WHERE user_id = ?
                  AND LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass')
                  AND DATE(createdAt) >= DATE('now', '-6 days')
                GROUP BY dayKey
            `, [userId]);
            const last7Map = new Map(last7.map(r => [String(r.dayKey), Number(r.cnt || 0)]));
            const activityLabels = [];
            const activityData = [];
            for (let i = 6; i >= 0; i -= 1) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const key = d.toISOString().slice(0, 10);
                activityLabels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
                activityData.push(last7Map.get(key) || 0);
            }

            const heatRows = await dbAll(`
                SELECT strftime('%Y-%m-%d', createdAt) AS dayKey, COUNT(*) AS cnt
                FROM submissions
                WHERE user_id = ?
                  AND LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass')
                  AND DATE(createdAt) >= DATE('now', '-83 days')
                GROUP BY dayKey
            `, [userId]);
            const heatMap = new Map(heatRows.map(r => [String(r.dayKey), Number(r.cnt || 0)]));
            const heatmapData = [];
            for (let i = 83; i >= 0; i -= 1) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const key = d.toISOString().slice(0, 10);
                heatmapData.push({
                    date: key,
                    value: heatMap.get(key) || 0
                });
            }

            const level = Math.max(1, Math.floor(points / 500) + 1);
            const levelStart = (level - 1) * 500;
            const levelEnd = level * 500;
            const progress = Math.max(0, Math.min(100, Math.floor(((points - levelStart) / 500) * 100)));
            const xpToNext = Math.max(0, levelEnd - points);

            return res.json({
                success: true,
                dashboard: {
                    user: {
                        fullName: user.fullName || 'Individual',
                        email: user.email || '',
                        solved,
                        points,
                        globalRank: `#${globalRank}`,
                        topPercent: `Top ${topPercent}%`
                    },
                    streakDays,
                    level,
                    levelCurrentXp: points,
                    levelTargetXp: levelEnd,
                    levelProgress: progress,
                    xpToNext,
                    recentProblems,
                    activityLabels,
                    activityData,
                    heatmapData
                }
            });
        } catch (error) {
            console.error('Individual dashboard data error:', error);
            return res.status(500).json({ success: false, error: 'Failed to load dashboard data' });
        }
    });

    return router;
};
