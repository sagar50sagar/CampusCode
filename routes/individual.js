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
    router.get('/contest/problems.html', requireIndividual, serve('contest-details.html'));

    router.get('/forum', requireIndividual, serve('forum.html'));
    router.get('/forum.html', requireIndividual, (req, res) => res.redirect('/individual/forum'));
    router.get('/new-post', requireIndividual, serve('new-post.html'));
    router.get('/new-post.html', requireIndividual, (req, res) => res.redirect('/individual/new-post'));
    router.get('/thread', requireIndividual, serve('thread.html'));
    router.get('/thread.html', requireIndividual, serve('thread.html'));


    router.get('/report', requireIndividual, serve('report.html'));
    router.get('/report.html', requireIndividual, (req, res) => res.redirect('/individual/report'));
    router.get('/stats', requireIndividual, serve('stats.html'));
    router.get('/stats.html', requireIndividual, (req, res) => res.redirect('/individual/stats'));
    router.get('/profile', requireIndividual, serve('profile.html'));
    router.get('/profile.html', requireIndividual, (req, res) => res.redirect('/individual/profile'));
    router.get('/support', requireIndividual, serve('support.html'));
    router.get('/support.html', requireIndividual, (req, res) => res.redirect('/individual/support'));
    router.get('/settings', requireIndividual, serve('settings.html'));
    router.get('/settings.html', requireIndividual, (req, res) => res.redirect('/individual/settings'));



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

    router.get('/api/report-data', requireIndividual, async (req, res) => {
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
            const globalRank = Number(globalHigher?.cnt || 0) + 1;

            const submissionTotals = await dbGet(`
                SELECT
                    COUNT(*) as attempted,
                    SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass') THEN 1 ELSE 0 END) as accepted
                FROM submissions
                WHERE user_id = ?
            `, [userId]);
            const attempted = Number(submissionTotals?.attempted || 0);
            const accepted = Number(submissionTotals?.accepted || 0);
            const accuracy = attempted ? ((accepted / attempted) * 100).toFixed(1) : '0.0';

            const difficultyRows = await dbAll(`
                SELECT
                    LOWER(COALESCE(NULLIF(p.difficulty, ''), 'easy')) as difficulty,
                    COUNT(*) as attempted,
                    SUM(CASE WHEN LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac', 'pass') THEN 1 ELSE 0 END) as solved
                FROM submissions s
                JOIN problems p ON p.id = s.problem_id
                WHERE s.user_id = ?
                GROUP BY LOWER(COALESCE(NULLIF(p.difficulty, ''), 'easy'))
            `, [userId]);
            const byDifficulty = { easy: { attempted: 0, solved: 0 }, medium: { attempted: 0, solved: 0 }, hard: { attempted: 0, solved: 0 } };
            difficultyRows.forEach((row) => {
                const k = String(row.difficulty || '').toLowerCase();
                if (!byDifficulty[k]) return;
                byDifficulty[k] = {
                    attempted: Number(row.attempted || 0),
                    solved: Number(row.solved || 0)
                };
            });

            const topicRows = await dbAll(`
                SELECT
                    TRIM(value) as topic,
                    COUNT(*) as solved
                FROM submissions s
                JOIN problems p ON p.id = s.problem_id
                JOIN json_each(
                    CASE
                        WHEN p.tags IS NULL OR TRIM(p.tags) = '' THEN '[]'
                        WHEN substr(TRIM(p.tags), 1, 1) = '[' THEN p.tags
                        ELSE '[]'
                    END
                )
                WHERE s.user_id = ?
                  AND LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac', 'pass')
                GROUP BY TRIM(value)
                ORDER BY solved DESC, topic ASC
                LIMIT 6
            `, [userId]);

            const contestRows = await dbAll(`
                SELECT c.title, c.startDate,
                       COUNT(DISTINCT cp.problem_id) as total_problems,
                       SUM(CASE WHEN LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac', 'pass') THEN 1 ELSE 0 END) as solved
                FROM contest_participants p
                JOIN contests c ON c.id = p.contest_id
                LEFT JOIN contest_problems cp ON cp.contest_id = c.id
                LEFT JOIN submissions s ON s.contest_id = c.id AND s.user_id = p.user_id AND s.problem_id = cp.problem_id
                WHERE p.user_id = ?
                GROUP BY c.id, c.title, c.startDate
                ORDER BY c.startDate DESC
                LIMIT 5
            `, [userId]);

            return res.json({
                success: true,
                report: {
                    user: {
                        fullName: user.fullName || 'Individual',
                        email: user.email || '',
                        solved,
                        points,
                        rank: `#${globalRank}`
                    },
                    summary: {
                        attempted,
                        accepted,
                        accuracy
                    },
                    byDifficulty,
                    topics: topicRows.map((r) => ({ topic: r.topic || 'General', solved: Number(r.solved || 0) })),
                    contests: contestRows.map((r) => ({
                        title: r.title || 'Contest',
                        date: r.startDate || '',
                        solved: Number(r.solved || 0),
                        total: Number(r.total_problems || 0)
                    })),
                    generatedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                }
            });
        } catch (error) {
            console.error('Individual report data error:', error);
            return res.status(500).json({ success: false, error: 'Failed to load report data' });
        }
    });

    router.get('/api/profile-data', requireIndividual, async (req, res) => {
        try {
            const userId = Number(req.session?.user?.id);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const user = await dbGet(`
                SELECT id, fullName, email, points, solvedCount, rank, role
                FROM account_users
                WHERE id = ?
            `, [userId]);
            if (!user) return res.status(404).json({ success: false, error: 'User not found' });

            const points = Number(user.points || 0);
            const solved = Number(user.solvedCount || 0);

            const rankRow = await dbGet(`
                SELECT COUNT(*) as cnt
                FROM account_users
                WHERE LOWER(COALESCE(role, '')) IN ('student', 'individual')
                  AND COALESCE(points, 0) > ?
            `, [points]);
            const globalRank = Number(rankRow?.cnt || 0) + 1;

            const submissions = await dbGet(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass') THEN 1 ELSE 0 END) as accepted
                FROM submissions
                WHERE user_id = ?
            `, [userId]);
            const totalSubmissions = Number(submissions?.total || 0);
            const acceptedSubmissions = Number(submissions?.accepted || 0);
            const accuracy = totalSubmissions > 0 ? Number(((acceptedSubmissions / totalSubmissions) * 100).toFixed(1)) : 0;

            const difficultyRows = await dbAll(`
                SELECT
                    LOWER(COALESCE(NULLIF(p.difficulty, ''), 'easy')) as difficulty,
                    SUM(CASE WHEN LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac', 'pass') THEN 1 ELSE 0 END) as solved
                FROM submissions s
                JOIN problems p ON p.id = s.problem_id
                WHERE s.user_id = ?
                GROUP BY LOWER(COALESCE(NULLIF(p.difficulty, ''), 'easy'))
            `, [userId]);

            const difficulty = { easy: 0, medium: 0, hard: 0 };
            difficultyRows.forEach((row) => {
                const key = String(row.difficulty || '').toLowerCase();
                if (Object.prototype.hasOwnProperty.call(difficulty, key)) {
                    difficulty[key] = Number(row.solved || 0);
                }
            });

            const languageRows = await dbAll(`
                SELECT
                    LOWER(COALESCE(NULLIF(language, ''), 'unknown')) as language,
                    COUNT(*) as cnt
                FROM submissions
                WHERE user_id = ?
                GROUP BY LOWER(COALESCE(NULLIF(language, ''), 'unknown'))
                ORDER BY cnt DESC
                LIMIT 5
            `, [userId]);

            const badges = [];
            if (solved >= 1) badges.push('First Solve');
            if (solved >= 50) badges.push('Problem Crusher');
            if (solved >= 100) badges.push('Century Solver');
            if (accuracy >= 70) badges.push('Accurate Coder');
            if (points >= 1000) badges.push('XP Milestone');

            const initials = (user.fullName || 'I')
                .split(' ')
                .filter(Boolean)
                .slice(0, 2)
                .map((part) => part[0])
                .join('')
                .toUpperCase() || 'I';

            return res.json({
                success: true,
                profile: {
                    user: {
                        id: user.id,
                        fullName: user.fullName || 'Individual',
                        email: user.email || '',
                        initials,
                        points,
                        solved,
                        globalRank: `#${globalRank}`,
                        role: 'Individual'
                    },
                    summary: {
                        totalSubmissions,
                        acceptedSubmissions,
                        accuracy
                    },
                    difficulty,
                    topLanguages: languageRows.map((row) => ({
                        language: row.language,
                        count: Number(row.cnt || 0)
                    })),
                    badges: badges.slice(0, 4)
                }
            });
        } catch (error) {
            console.error('Individual profile data error:', error);
            return res.status(500).json({ success: false, error: 'Failed to load profile data' });
        }
    });

    router.get('/api/stats-data', requireIndividual, async (req, res) => {
        try {
            const userId = Number(req.session?.user?.id);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const user = await dbGet(`
                SELECT id, fullName, email, points, solvedCount, role
                FROM account_users
                WHERE id = ?
            `, [userId]);
            if (!user) return res.status(404).json({ success: false, error: 'User not found' });

            const points = Number(user.points || 0);

            const rankRow = await dbGet(`
                SELECT COUNT(*) as cnt
                FROM account_users
                WHERE LOWER(COALESCE(role, '')) IN ('student', 'individual')
                  AND COALESCE(points, 0) > ?
            `, [points]);
            const globalRank = Number(rankRow?.cnt || 0) + 1;

            const submissionRows = await dbAll(`
                SELECT
                    LOWER(COALESCE(status, 'unknown')) as status,
                    COUNT(*) as cnt
                FROM submissions
                WHERE user_id = ?
                GROUP BY LOWER(COALESCE(status, 'unknown'))
            `, [userId]);

            let totalSubmissions = 0;
            let acceptedSubmissions = 0;
            const verdictMap = {};
            submissionRows.forEach((row) => {
                const status = String(row.status || 'unknown');
                const count = Number(row.cnt || 0);
                verdictMap[status] = count;
                totalSubmissions += count;
                if (['accepted', 'ac', 'pass'].includes(status)) acceptedSubmissions += count;
            });

            const accuracy = totalSubmissions > 0 ? Number(((acceptedSubmissions / totalSubmissions) * 100).toFixed(1)) : 0;

            const difficultyRows = await dbAll(`
                SELECT
                    LOWER(COALESCE(NULLIF(p.difficulty, ''), 'easy')) as difficulty,
                    COUNT(*) as attempted,
                    SUM(CASE WHEN LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac', 'pass') THEN 1 ELSE 0 END) as solved
                FROM submissions s
                JOIN problems p ON p.id = s.problem_id
                WHERE s.user_id = ?
                GROUP BY LOWER(COALESCE(NULLIF(p.difficulty, ''), 'easy'))
            `, [userId]);
            const difficulty = { easy: { attempted: 0, solved: 0 }, medium: { attempted: 0, solved: 0 }, hard: { attempted: 0, solved: 0 } };
            difficultyRows.forEach((row) => {
                const key = String(row.difficulty || '').toLowerCase();
                if (Object.prototype.hasOwnProperty.call(difficulty, key)) {
                    difficulty[key] = {
                        attempted: Number(row.attempted || 0),
                        solved: Number(row.solved || 0)
                    };
                }
            });

            // 1. Get actual points earned per month based on problem difficulty
            const byMonth = await dbAll(`
                SELECT
                    strftime('%Y-%m', s.createdAt) as month_key,
                    SUM(COALESCE(p.points, CASE 
                        WHEN LOWER(p.difficulty) = 'hard' THEN 50
                        WHEN LOWER(p.difficulty) = 'medium' THEN 30
                        ELSE 10 
                    END)) as points_earned
                FROM submissions s
                JOIN problems p ON p.id = s.problem_id
                WHERE s.user_id = ?
                  AND LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac', 'pass')
                  AND DATE(s.createdAt) >= DATE('now', '-5 months')
                GROUP BY strftime('%Y-%m', s.createdAt)
                ORDER BY month_key ASC
            `, [userId]);
            
            const monthMap = new Map(byMonth.map((row) => [String(row.month_key), Number(row.points_earned || 0)]));
            const ratingLabels = [];
            const earnedData = [];
            
            // Get labels and points earned for the last 6 months
            for (let i = 5; i >= 0; i -= 1) {
                const dt = new Date();
                dt.setDate(1);
                dt.setMonth(dt.getMonth() - i);
                const monthKey = dt.toISOString().slice(0, 7);
                const label = dt.toLocaleDateString('en-US', { month: 'short' });
                
                ratingLabels.push(label);
                earnedData.push(monthMap.get(monthKey) || 0);
            }

            // 2. Calculate backwards so the graph perfectly ends at their CURRENT live points
            let currentPoints = points; // Pulled from the user query at the top
            const ratingData = new Array(6).fill(0);
            ratingData[5] = currentPoints;
            
            for (let i = 4; i >= 0; i -= 1) {
                currentPoints -= earnedData[i + 1]; // Subtract the month's earned points going backward
                ratingData[i] = Math.max(0, currentPoints); // Prevent negative points
            
            }

            const languageRows = await dbAll(`
                SELECT
                    COALESCE(NULLIF(language, ''), 'unknown') as language,
                    COUNT(*) as cnt
                FROM submissions
                WHERE user_id = ?
                GROUP BY COALESCE(NULLIF(language, ''), 'unknown')
                ORDER BY cnt DESC
                LIMIT 6
            `, [userId]);

            // 3. Extract live topics accurately, handling both JSON and comma-separated formats
            const topicRows = await dbAll(`
                SELECT
                    TRIM(value) as topic,
                    COUNT(DISTINCT p.id) as solved
                FROM submissions s
                JOIN problems p ON p.id = s.problem_id
                JOIN json_each(
                    CASE
                        WHEN p.tags IS NULL OR TRIM(p.tags) = '' THEN '[]'
                        WHEN substr(TRIM(p.tags), 1, 1) = '[' THEN p.tags
                        ELSE '["' || REPLACE(TRIM(p.tags), ',', '","') || '"]'
                    END
                )
                WHERE s.user_id = ?
                  AND LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac', 'pass')
                GROUP BY TRIM(value)
                ORDER BY solved DESC, topic ASC
                LIMIT 6
            `, [userId]);

            return res.json({
                success: true,
                stats: {
                    user: {
                        fullName: user.fullName || 'Individual',
                        email: user.email || '',
                        points,
                        solvedCount: Number(user.solvedCount || 0),
                        globalRank: `#${globalRank}`
                    },
                    cards: {
                        totalSubmissions,
                        acceptedSubmissions,
                        accuracy,
                        activeLanguages: languageRows.length,
                        topScore: ratingData[ratingData.length - 1] || 1000
                    },
                    charts: {
                        difficulty,
                        verdicts: verdictMap,
                        ratingLabels,
                        ratingData,
                        languages: languageRows.map((row) => ({
                            language: row.language,
                            count: Number(row.cnt || 0)
                        })),
                        topics: topicRows.map((row) => ({
                            topic: row.topic || 'General',
                            solved: Number(row.solved || 0)
                        }))
                    }
                }
            });
        } catch (error) {
            console.error('Individual stats data error:', error);
            return res.status(500).json({ success: false, error: 'Failed to load stats data' });
        }
    });

    // 1. Fetch user data for the settings page
    router.get('/api/settings-data', requireIndividual, async (req, res) => {
        try {
            const userId = Number(req.session?.user?.id);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const user = await dbGet(`
                SELECT id, fullName, email, mobile, gender, course, program, department, branch, year, section,
                       notif_contest_alerts, notif_submission_results, notif_deadline_reminders,
                       points, solvedCount, rank
                FROM account_users
                WHERE id = ?
            `, [userId]);

            if (!user) return res.status(404).json({ success: false, error: 'User not found' });

            const points = Number(user.points || 0);
            const rankRow = await dbGet(`
                SELECT COUNT(*) as cnt
                FROM account_users
                WHERE LOWER(COALESCE(role, '')) IN ('student', 'individual')
                  AND COALESCE(points, 0) > ?
            `, [points]);
            user.globalRank = Number(rankRow?.cnt || 0) + 1;

            return res.json({ success: true, user });
        } catch (error) {
            console.error('Individual settings fetch error:', error);
            return res.status(500).json({ success: false, error: 'Failed to load settings data' });
        }
    });

    // 2. Save updated data from the settings page
    router.post('/api/update-profile', requireIndividual, async (req, res) => {
        try {
            const userId = Number(req.session?.user?.id);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const {
                fullName, email, mobile, gender,
                course, program, department, branch, year, section,
                notifContestAlerts, notifSubmissionResults, notifDeadlineReminders
            } = req.body;

            const updateQuery = `
                UPDATE account_users
                SET fullName = ?, email = ?, mobile = ?, gender = ?,
                    course = ?, program = ?, department = ?, branch = ?, year = ?, section = ?,
                    notif_contest_alerts = ?, notif_submission_results = ?, notif_deadline_reminders = ?
                WHERE id = ?
            `;

            db.run(updateQuery, [
                fullName, email, mobile, gender,
                course, program, department, branch, year, section,
                notifContestAlerts ? 1 : 0, notifSubmissionResults ? 1 : 0, notifDeadlineReminders ? 1 : 0,
                userId
            ], function(err) {
                if (err) {
                    console.error('Update DB error:', err);
                    return res.status(500).json({ success: false, error: 'Failed to save changes' });
                }
                res.json({ success: true, message: 'Settings updated successfully' });
            });
        } catch (error) {
            console.error('Profile update error:', error);
            res.status(500).json({ success: false, error: 'Server error' });
        }
    });

    return router;
};

