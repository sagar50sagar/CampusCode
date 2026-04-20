const express = require('express');
const path = require('path');
const { requireRole } = require('../middleware/auth');

module.exports = (db) => {
    const router = express.Router();
    const requireIndividual = requireRole('individual');
    let profileColumnsEnsured = false;
    let notesTableEnsured = false;
    const parseDateValue = (value) => {
        if (!value) return null;
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
        const raw = String(value).trim();
        if (!raw) return null;

        const normalized = raw.replace(' ', 'T');
        const primary = new Date(normalized);
        if (Number.isNaN(primary.getTime())) return null;

        // Handle mixed storage where UTC suffix exists but stored clock-time is local.
        const hasTzSuffix = /([zZ]|[+\-]\d{2}:\d{2})$/.test(normalized);
        if (!hasTzSuffix) return primary;

        const tzStripped = normalized.replace(/([zZ]|[+\-]\d{2}:\d{2})$/, '');
        const localCandidate = new Date(tzStripped);
        if (Number.isNaN(localCandidate.getTime())) return primary;

        const now = Date.now();
        const primaryDelta = Math.abs(primary.getTime() - now);
        const localDelta = Math.abs(localCandidate.getTime() - now);
        return localDelta < primaryDelta ? localCandidate : primary;
    };
    const localDateKey = (value) => {
        const d = parseDateValue(value);
        if (!d) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };
    const dbGet = (query, params = []) => new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => err ? reject(err) : resolve(row));
    });
    const dbAll = (query, params = []) => new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
    const dbRun = (query, params = []) => new Promise((resolve, reject) => {
        db.run(query, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
    const resolveIndividualUser = async (sessionUser) => {
        const email = String(sessionUser?.email || '').trim().toLowerCase();
        const sessionId = Number(sessionUser?.id);
        if (email) {
            const fromStudent = await dbGet(`
                SELECT id, fullName, email, points, solvedCount, rank, role, status,
                       mobile, gender, course, program, department, branch, year, section,
                       notif_contest_alerts, notif_submission_results, notif_deadline_reminders,
                       github_link, location
                FROM student
                WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(?))
                  AND LOWER(COALESCE(role, '')) = 'individual'
                ORDER BY id DESC
                LIMIT 1
            `, [email]);
            if (fromStudent) return { ...fromStudent, sourceTable: 'student' };

            const fromUsers = await dbGet(`
                SELECT id, fullName, email, points, solvedCount, rank, role, status,
                       mobile, gender, course, program, department, branch, year, section,
                       notif_contest_alerts, notif_submission_results, notif_deadline_reminders,
                       github_link, location
                FROM users
                WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(?))
                  AND LOWER(COALESCE(role, '')) = 'individual'
                ORDER BY id DESC
                LIMIT 1
            `, [email]);
            if (fromUsers) return { ...fromUsers, sourceTable: 'users' };
        }
        if (Number.isInteger(sessionId) && sessionId > 0) {
            const fallback = await dbGet(`
                SELECT id, fullName, email, points, solvedCount, rank, role, status,
                       mobile, gender, course, program, department, branch, year, section,
                       notif_contest_alerts, notif_submission_results, notif_deadline_reminders,
                       github_link, location
                FROM account_users
                WHERE id = ?
                LIMIT 1
            `, [sessionId]);
            if (fallback) return { ...fallback, sourceTable: 'account_users' };
        }
        return null;
    };

    const ensureProfileColumns = async () => {
        if (profileColumnsEnsured) return;
        await Promise.allSettled([
            dbRun(`ALTER TABLE users ADD COLUMN github_link TEXT DEFAULT ''`),
            dbRun(`ALTER TABLE users ADD COLUMN location TEXT DEFAULT ''`),
            dbRun(`ALTER TABLE student ADD COLUMN github_link TEXT DEFAULT ''`),
            dbRun(`ALTER TABLE student ADD COLUMN location TEXT DEFAULT ''`),
            dbRun(`ALTER TABLE faculty ADD COLUMN github_link TEXT DEFAULT ''`),
            dbRun(`ALTER TABLE faculty ADD COLUMN location TEXT DEFAULT ''`)
        ]);
        profileColumnsEnsured = true;
    };

    const ensureProblemNotesTable = async () => {
        if (notesTableEnsured) return;
        await dbRun(`
            CREATE TABLE IF NOT EXISTS individual_problem_notes (
                user_id INTEGER NOT NULL,
                problem_id INTEGER NOT NULL,
                before_plan TEXT DEFAULT '',
                approach TEXT DEFAULT '',
                edge_cases TEXT DEFAULT '',
                complexity TEXT DEFAULT '',
                mistakes TEXT DEFAULT '',
                revision TEXT DEFAULT '',
                tags TEXT DEFAULT '',
                revise_bucket TEXT DEFAULT '',
                is_pinned INTEGER DEFAULT 0,
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, problem_id)
            )
        `);
        await dbRun(`
            CREATE TABLE IF NOT EXISTS individual_problem_note_entries (
                entry_id TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL,
                problem_id INTEGER NOT NULL,
                status TEXT DEFAULT '',
                language TEXT DEFAULT '',
                passed_count INTEGER DEFAULT 0,
                total_count INTEGER DEFAULT 0,
                used_method TEXT DEFAULT '',
                best_method TEXT DEFAULT '',
                previous_approach TEXT DEFAULT '',
                approach_snapshot TEXT DEFAULT '',
                code_snapshot TEXT DEFAULT '',
                createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        notesTableEnsured = true;
    };

    const detectMethodFromCode = (code) => {
        const src = String(code || '').toLowerCase();
        if (!src.trim()) return 'Not detected';
        if (src.includes('heapq') || src.includes('priority_queue')) return 'Heap / Priority Queue';
        if (src.includes('deque') || src.includes('queue<')) return 'Queue / BFS';
        if (src.includes('dfs') || src.includes('stack<') || src.includes('recursion') || src.includes('def dfs')) return 'DFS / Recursion';
        if (src.includes('binary_search') || src.includes('while (l <= r') || src.includes('mid =')) return 'Binary Search';
        if (src.includes('dp[') || src.includes('memo') || src.includes('tabulation')) return 'Dynamic Programming';
        if (src.includes('sliding window') || (src.includes('left') && src.includes('right') && src.includes('while'))) return 'Sliding Window / Two Pointers';
        if (src.includes('sort(') || src.includes('.sort(') || src.includes('sorted(')) return 'Sorting-based';
        if (src.includes('unordered_map') || src.includes('hashmap') || src.includes('dict(') || src.includes('{}')) return 'Hashing / Map';
        return 'Brute Force / Custom Logic';
    };

    const suggestBestMethod = (title, difficulty, tags) => {
        const t = String(title || '').toLowerCase();
        const d = String(difficulty || '').toLowerCase();
        const tagText = String(tags || '').toLowerCase();
        const all = `${t} ${tagText}`;
        if (all.includes('palindrome')) return 'Two pointers (or reverse-check) with O(n) time';
        if (all.includes('subarray') && all.includes('xor')) return 'Prefix XOR + hashmap frequency counting';
        if (all.includes('window') || all.includes('substring')) return 'Sliding window with frequency map';
        if (all.includes('merge k') || all.includes('k sorted')) return 'Min-heap across k lists';
        if (all.includes('graph') || all.includes('tree')) return 'BFS/DFS traversal with visited tracking';
        if (all.includes('dp') || d === 'hard') return 'Dynamic programming or optimized data-structure approach';
        if (d === 'medium') return 'Hashmap / two-pointers / sorting based optimization';
        return 'Single-pass linear approach with edge-case handling';
    };

    const serve = (file) => (req, res) =>
        res.sendFile(path.join(__dirname, '../views/individual', file));

    router.use(async (req, _res, next) => {
        try {
            if (!req.session?.user) return next();
            const role = String(req.session.user.role || '').toLowerCase();
            if (role !== 'individual') return next();
            const resolved = await resolveIndividualUser(req.session.user);
            if (!resolved) return next();
            req.session.user.id = resolved.id;
            req.session.user.email = resolved.email || req.session.user.email;
            req.session.user.fullName = resolved.fullName || req.session.user.fullName;
            req.session.user.name = resolved.fullName || req.session.user.name;
            req.session.user.role = 'individual';
            return next();
        } catch (_err) {
            return next();
        }
    });

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
            const resolvedUser = await resolveIndividualUser(req.session?.user);
            const userId = Number(resolvedUser?.id);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const user = resolvedUser;
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

            const weeklyPointsRow = await dbGet(`
                SELECT COALESCE(SUM(points_earned), 0) AS pts
                FROM submissions
                WHERE user_id = ?
                  AND LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass')
                  AND DATE(createdAt) >= DATE('now', '-6 days')
            `, [userId]);
            const weeklyPoints = Number(weeklyPointsRow?.pts || 0);
            const weeklyHigherRow = await dbGet(`
                SELECT COUNT(*) AS cnt
                FROM account_users u
                LEFT JOIN (
                    SELECT user_id, COALESCE(SUM(points_earned), 0) AS weekly_points
                    FROM submissions
                    WHERE LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass')
                      AND DATE(createdAt) >= DATE('now', '-6 days')
                    GROUP BY user_id
                ) s ON s.user_id = u.id
                WHERE LOWER(COALESCE(u.role, '')) IN ('student', 'individual')
                  AND COALESCE(s.weekly_points, 0) > ?
            `, [weeklyPoints]);
            const weeklyHighRank = Number(weeklyHigherRow?.cnt || 0) + 1;

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
                const dates = new Set(acceptedRows.map(r => localDateKey(r.d)).filter(Boolean));
                const cursor = new Date();
                cursor.setHours(0, 0, 0, 0);
                while (true) {
                    const key = localDateKey(cursor);
                    if (!dates.has(key)) break;
                    streakDays += 1;
                    cursor.setDate(cursor.getDate() - 1);
                }
            }

            const recentProblems = await dbAll(`
                SELECT p.title,
                       COALESCE(NULLIF(p.difficulty, ''), 'Easy') AS difficulty,
                       MAX(s.createdAt) AS "solvedAt"
                FROM submissions s
                JOIN problems p ON p.id = s.problem_id
                WHERE s.user_id = ?
                  AND LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac', 'pass')
                GROUP BY p.id, p.title, p.difficulty
                ORDER BY "solvedAt" DESC
                LIMIT 4
            `, [userId]);
            const recentProblemsNormalized = recentProblems.map((row) => {
                const solvedAtRaw = row.solvedAt || row.solvedat || row.createdAt || row.createdat || null;
                const solvedAtDate = parseDateValue(solvedAtRaw);
                return {
                    title: row.title,
                    difficulty: row.difficulty,
                    solvedAt: solvedAtRaw,
                    solvedAtMs: solvedAtDate ? solvedAtDate.getTime() : null
                };
            });

            const last7 = await dbAll(`
                SELECT strftime('%Y-%m-%d', createdAt) AS "dayKey", COUNT(*) AS cnt
                FROM submissions
                WHERE user_id = ?
                  AND LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass')
                  AND DATE(createdAt) >= DATE('now', '-6 days')
                GROUP BY 1
            `, [userId]);
            const last7Map = new Map(
                last7
                    .map((r) => [localDateKey(r.dayKey || r.daykey), Number(r.cnt || 0)])
                    .filter(([k]) => !!k)
            );
            const activityLabels = [];
            const activityData = [];
            for (let i = 6; i >= 0; i -= 1) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const key = localDateKey(d);
                activityLabels.push(d.toLocaleDateString('en-US', { weekday: 'short' }));
                activityData.push(last7Map.get(key) || 0);
            }

            const heatRows = await dbAll(`
                SELECT strftime('%Y-%m-%d', createdAt) AS "dayKey", COUNT(*) AS cnt
                FROM submissions
                WHERE user_id = ?
                  AND LOWER(COALESCE(status, '')) IN ('accepted', 'ac', 'pass')
                  AND DATE(createdAt) >= DATE('now', '-83 days')
                GROUP BY 1
            `, [userId]);
            const heatMap = new Map(
                heatRows
                    .map((r) => [localDateKey(r.dayKey || r.daykey), Number(r.cnt || 0)])
                    .filter(([k]) => !!k)
            );
            const heatmapData = [];
            for (let i = 83; i >= 0; i -= 1) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const key = localDateKey(d);
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
                    weeklyHighRank: `#${weeklyHighRank}`,
                    streakDays,
                    level,
                    levelCurrentXp: points,
                    levelTargetXp: levelEnd,
                    levelProgress: progress,
                    xpToNext,
                    recentProblems: recentProblemsNormalized,
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
            const resolvedUser = await resolveIndividualUser(req.session?.user);
            const userId = Number(resolvedUser?.id);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const user = resolvedUser;
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
            await ensureProfileColumns();
            const resolvedUser = await resolveIndividualUser(req.session?.user);
            const userId = Number(resolvedUser?.id);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const user = resolvedUser;
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
                        githubLink: user.github_link || '',
                        location: user.location || '',
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

    router.post('/api/profile', requireIndividual, async (req, res) => {
        try {
            await ensureProfileColumns();
            const resolvedUser = await resolveIndividualUser(req.session?.user);
            const userId = Number(resolvedUser?.id);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const fullName = String(req.body?.fullName || '').trim();
            const email = String(req.body?.email || '').trim();
            const githubLink = String(req.body?.githubLink || '').trim();
            const location = String(req.body?.location || '').trim();

            if (!fullName || !email) {
                return res.status(400).json({ success: false, error: 'Full name and email are required' });
            }

            const emailOwner = await dbGet(`
                SELECT id FROM account_users
                WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(?))
                  AND LOWER(COALESCE(role, '')) = 'individual'
                  AND id != ?
            `, [email, userId]);
            if (emailOwner) {
                return res.status(409).json({ success: false, error: 'Email already in use' });
            }

            const targetTable = resolvedUser?.sourceTable === 'users' ? 'users' : 'student';
            await dbRun(`
                UPDATE ${targetTable}
                SET fullName = ?, email = ?, github_link = ?, location = ?
                WHERE id = ?
            `, [fullName, email, githubLink, location, userId]);
            if (targetTable === 'student') {
                await Promise.allSettled([
                    dbRun(`
                        UPDATE users
                        SET fullName = ?, email = ?, github_link = ?, location = ?
                        WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(?))
                          AND LOWER(COALESCE(role, '')) = 'individual'
                    `, [fullName, email, githubLink, location, String(req.session?.user?.email || email)]),
                    dbRun(`
                        UPDATE users
                        SET fullName = ?, email = ?, github_link = ?, location = ?
                        WHERE id = ?
                          AND LOWER(COALESCE(role, '')) = 'individual'
                    `, [fullName, email, githubLink, location, userId])
                ]);
            }

            if (req.session?.user) {
                req.session.user.fullName = fullName;
                req.session.user.name = fullName;
                req.session.user.email = email;
                req.session.user.location = location;
                req.session.user.github_link = githubLink;
            }

            return res.json({ success: true, message: 'Profile updated successfully' });
        } catch (error) {
            console.error('Individual profile update error:', error);
            return res.status(500).json({ success: false, error: 'Failed to update profile' });
        }
    });

    router.get('/api/stats-data', requireIndividual, async (req, res) => {
        try {
            const resolvedUser = await resolveIndividualUser(req.session?.user);
            const userId = Number(resolvedUser?.id);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const user = resolvedUser;
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
            const resolvedUser = await resolveIndividualUser(req.session?.user);
            const userId = Number(resolvedUser?.id);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            const user = resolvedUser;

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

    router.get('/api/problem-notes/:problemId', requireIndividual, async (req, res) => {
        try {
            await ensureProblemNotesTable();
            const resolvedUser = await resolveIndividualUser(req.session?.user);
            const userId = Number(resolvedUser?.id);
            const problemId = Number(req.params.problemId);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            if (!Number.isInteger(problemId) || problemId <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid problem id' });
            }

            const row = await dbGet(`
                SELECT before_plan, approach, edge_cases, complexity, mistakes, revision, tags,
                       revise_bucket, is_pinned, createdAt, updatedAt
                FROM individual_problem_notes
                WHERE user_id = ? AND problem_id = ?
            `, [userId, problemId]);

            const entries = await dbAll(`
                SELECT entry_id, status, language, passed_count, total_count,
                       used_method, best_method, previous_approach, approach_snapshot, createdAt
                FROM individual_problem_note_entries
                WHERE user_id = ? AND problem_id = ?
                ORDER BY createdAt DESC
                LIMIT 100
            `, [userId, problemId]);

            return res.json({
                success: true,
                note: row || {
                    before_plan: '',
                    approach: '',
                    edge_cases: '',
                    complexity: '',
                    mistakes: '',
                    revision: '',
                    tags: '',
                    revise_bucket: '',
                    is_pinned: 0,
                    createdAt: null,
                    updatedAt: null
                },
                entries: Array.isArray(entries) ? entries : []
            });
        } catch (error) {
            console.error('Individual problem note fetch error:', error);
            return res.status(500).json({ success: false, error: 'Failed to load notes' });
        }
    });

    router.post('/api/problem-notes/:problemId', requireIndividual, async (req, res) => {
        try {
            await ensureProblemNotesTable();
            const resolvedUser = await resolveIndividualUser(req.session?.user);
            const userId = Number(resolvedUser?.id);
            const problemId = Number(req.params.problemId);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            if (!Number.isInteger(problemId) || problemId <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid problem id' });
            }

            const payload = req.body || {};
            const sanitize = (v, max = 6000) => String(v || '').trim().slice(0, max);
            const beforePlan = sanitize(payload.beforePlan);
            const approach = sanitize(payload.approach);
            const edgeCases = sanitize(payload.edgeCases);
            const complexity = sanitize(payload.complexity, 2000);
            const mistakes = sanitize(payload.mistakes);
            const revision = sanitize(payload.revision);
            const tags = sanitize(payload.tags, 500);
            const reviseBucket = sanitize(payload.reviseBucket, 50);
            const isPinned = payload.isPinned ? 1 : 0;

            const existing = await dbGet(
                `SELECT user_id FROM individual_problem_notes WHERE user_id = ? AND problem_id = ?`,
                [userId, problemId]
            );

            if (existing) {
                await dbRun(`
                    UPDATE individual_problem_notes
                    SET before_plan = ?, approach = ?, edge_cases = ?, complexity = ?, mistakes = ?,
                        revision = ?, tags = ?, revise_bucket = ?, is_pinned = ?, updatedAt = CURRENT_TIMESTAMP
                    WHERE user_id = ? AND problem_id = ?
                `, [beforePlan, approach, edgeCases, complexity, mistakes, revision, tags, reviseBucket, isPinned, userId, problemId]);
            } else {
                await dbRun(`
                    INSERT INTO individual_problem_notes (
                        user_id, problem_id, before_plan, approach, edge_cases, complexity, mistakes,
                        revision, tags, revise_bucket, is_pinned, createdAt, updatedAt
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                `, [userId, problemId, beforePlan, approach, edgeCases, complexity, mistakes, revision, tags, reviseBucket, isPinned]);
            }

            return res.json({ success: true, message: 'Notes saved' });
        } catch (error) {
            console.error('Individual problem note save error:', error);
            return res.status(500).json({ success: false, error: 'Failed to save notes' });
        }
    });

    router.post('/api/problem-notes/:problemId/solve-entry', requireIndividual, async (req, res) => {
        try {
            await ensureProblemNotesTable();
            const resolvedUser = await resolveIndividualUser(req.session?.user);
            const userId = Number(resolvedUser?.id);
            const problemId = Number(req.params.problemId);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            if (!Number.isInteger(problemId) || problemId <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid problem id' });
            }

            const payload = req.body || {};
            const sanitize = (v, max = 10000) => String(v || '').trim().slice(0, max);
            const status = sanitize(payload.status, 50).toLowerCase();
            if (!['accepted', 'ac', 'pass'].includes(status)) {
                return res.json({ success: true, skipped: true, message: 'Entry skipped for non-accepted status' });
            }

            const language = sanitize(payload.language, 20);
            const passedCount = Math.max(0, Number(payload.passedCount || payload.passed || 0) || 0);
            const totalCount = Math.max(0, Number(payload.totalCount || payload.total || 0) || 0);
            const codeSnapshot = sanitize(payload.code, 20000);
            const approachSnapshot = sanitize(payload.approachSnapshot || payload.approach, 6000);
            const previousApproach = sanitize(payload.previousApproach, 6000);
            const usedMethod = sanitize(payload.usedMethod, 200) || detectMethodFromCode(codeSnapshot);

            const problem = await dbGet(`
                SELECT title, difficulty, tags
                FROM problems
                WHERE id = ?
            `, [problemId]);
            const bestMethod = suggestBestMethod(problem?.title, problem?.difficulty, problem?.tags);
            const entryId = `${userId}-${problemId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

            await dbRun(`
                INSERT INTO individual_problem_note_entries (
                    entry_id, user_id, problem_id, status, language, passed_count, total_count,
                    used_method, best_method, previous_approach, approach_snapshot, code_snapshot, createdAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [entryId, userId, problemId, status, language, passedCount, totalCount, usedMethod, bestMethod, previousApproach, approachSnapshot, codeSnapshot]);

            return res.json({ success: true, entryId, usedMethod, bestMethod });
        } catch (error) {
            console.error('Individual problem solve-entry save error:', error);
            return res.status(500).json({ success: false, error: 'Failed to save solve entry' });
        }
    });

    router.get('/api/problem-notes/:problemId/download', requireIndividual, async (req, res) => {
        try {
            await ensureProblemNotesTable();
            const resolvedUser = await resolveIndividualUser(req.session?.user);
            const userId = Number(resolvedUser?.id);
            const problemId = Number(req.params.problemId);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }
            if (!Number.isInteger(problemId) || problemId <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid problem id' });
            }

            const problem = await dbGet(`SELECT title FROM problems WHERE id = ?`, [problemId]);
            const base = await dbGet(`
                SELECT before_plan, approach, edge_cases, complexity, mistakes, revision, tags, revise_bucket, is_pinned, updatedAt
                FROM individual_problem_notes
                WHERE user_id = ? AND problem_id = ?
            `, [userId, problemId]);
            const entries = await dbAll(`
                SELECT status, language, passed_count, total_count, used_method, best_method, previous_approach, approach_snapshot, createdAt
                FROM individual_problem_note_entries
                WHERE user_id = ? AND problem_id = ?
                ORDER BY createdAt DESC
            `, [userId, problemId]);

            const title = String(problem?.title || `Problem-${problemId}`);
            const lines = [];
            lines.push(`CampusCode Problem Notes`);
            lines.push(`Problem: ${title} (ID: ${problemId})`);
            lines.push(`User ID: ${userId}`);
            lines.push(`Generated At: ${new Date().toISOString()}`);
            lines.push('');
            lines.push('=== Master Note ===');
            lines.push(`Before Plan: ${base?.before_plan || ''}`);
            lines.push(`Approach: ${base?.approach || ''}`);
            lines.push(`Edge Cases: ${base?.edge_cases || ''}`);
            lines.push(`Complexity: ${base?.complexity || ''}`);
            lines.push(`Mistakes: ${base?.mistakes || ''}`);
            lines.push(`Revision: ${base?.revision || ''}`);
            lines.push(`Tags: ${base?.tags || ''}`);
            lines.push(`Revision Bucket: ${base?.revise_bucket || ''}`);
            lines.push(`Pinned: ${Number(base?.is_pinned || 0) === 1 ? 'Yes' : 'No'}`);
            lines.push('');
            lines.push('=== Solve History ===');

            if (!entries.length) {
                lines.push('No solved-note entries found yet.');
            } else {
                entries.forEach((e, idx) => {
                    lines.push(``);
                    lines.push(`# ${idx + 1}`);
                    lines.push(`When: ${e.createdAt || ''}`);
                    lines.push(`Status: ${String(e.status || '').toUpperCase()}`);
                    lines.push(`Language: ${e.language || ''}`);
                    lines.push(`Cases: ${Number(e.passed_count || 0)}/${Number(e.total_count || 0)}`);
                    lines.push(`Used Method: ${e.used_method || ''}`);
                    lines.push(`Best Method: ${e.best_method || ''}`);
                    lines.push(`Previous Approach: ${e.previous_approach || ''}`);
                    lines.push(`Approach Snapshot: ${e.approach_snapshot || ''}`);
                });
            }

            const filename = `problem-${problemId}-notes.txt`;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            return res.send(lines.join('\n'));
        } catch (error) {
            console.error('Individual notes download error:', error);
            return res.status(500).json({ success: false, error: 'Failed to download notes' });
        }
    });

    // 2. Save updated data from the settings page
    router.post('/api/update-profile', requireIndividual, async (req, res) => {
        try {
            const resolvedUser = await resolveIndividualUser(req.session?.user);
            const userId = Number(resolvedUser?.id);
            if (!Number.isInteger(userId) || userId <= 0) {
                return res.status(401).json({ success: false, error: 'Unauthorized' });
            }

            const {
                fullName, email, mobile, gender,
                course, program, department, branch, year, section,
                notifContestAlerts, notifSubmissionResults, notifDeadlineReminders
            } = req.body;

            const targetTable = resolvedUser?.sourceTable === 'users' ? 'users' : 'student';
            const updateQuery = `
                UPDATE ${targetTable}
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
                if (targetTable === 'student') {
                    db.run(`
                        UPDATE users
                        SET fullName = ?, email = ?, mobile = ?, gender = ?,
                            course = ?, program = ?, department = ?, branch = ?, year = ?, section = ?,
                            notif_contest_alerts = ?, notif_submission_results = ?, notif_deadline_reminders = ?
                        WHERE LOWER(TRIM(COALESCE(email, ''))) = LOWER(TRIM(?))
                          AND LOWER(COALESCE(role, '')) = 'individual'
                    `, [
                        fullName, email, mobile, gender,
                        course, program, department, branch, year, section,
                        notifContestAlerts ? 1 : 0, notifSubmissionResults ? 1 : 0, notifDeadlineReminders ? 1 : 0,
                        String(req.session?.user?.email || email)
                    ], () => {});
                }
                if (req.session?.user) {
                    req.session.user.fullName = fullName;
                    req.session.user.name = fullName;
                    req.session.user.email = email;
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

