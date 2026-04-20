const express = require('express');
const path = require('path');
const bcrypt = require('bcrypt');
const { requireRole } = require('../middleware/auth');

const otpStore = new Map();

module.exports = (db, transporter) => {
    const router = express.Router();
const RANK_ORDER = ['E', 'D', 'C', 'B', 'A', 'S'];
const GLOBAL_SOLVE_WEIGHT_FOR_COLLEGE_RANK = 0.3;
    let profileColumnsEnsured = false;

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

    const getRankIndex = (rankClass) => RANK_ORDER.indexOf(String(rankClass || '').toUpperCase());
    const normalizeRankClass = (value) => {
        const normalized = String(value || '').trim().toUpperCase();
        return RANK_ORDER.includes(normalized) ? normalized : 'E';
    };
    const minRankClass = (a, b) => {
        const aIndex = getRankIndex(a);
        const bIndex = getRankIndex(b);
        if (aIndex < 0) return normalizeRankClass(b);
        if (bIndex < 0) return normalizeRankClass(a);
        return RANK_ORDER[Math.min(aIndex, bIndex)];
    };
    const getRankClassFromXp = (xp) => {
        const points = Number(xp || 0);
        if (points >= 15000) return 'S';
        if (points >= 5001) return 'A';
        if (points >= 3001) return 'B';
        if (points >= 1600) return 'C';
        if (points >= 501) return 'D';
        return 'E';
    };
    const getClassProgressMeta = (xp) => {
        const points = Number(xp || 0);
        const rankClass = getRankClassFromXp(points);
        if (rankClass === 'S') {
            return { currentClass: 'S', classMinXp: 15000, nextClass: null, nextClassMinXp: null, xpToNextClass: 0, progressPercent: 100 };
        }
        const band = rankClass === 'A'
            ? { min: 5001, nextMin: 15000, nextClass: 'S' } // Keep users in class A until S threshold
            : rankClass === 'B'
                ? { min: 3001, nextMin: 5001, nextClass: 'A' }
                : rankClass === 'C'
                    ? { min: 1600, nextMin: 3001, nextClass: 'B' }
                    : rankClass === 'D'
                        ? { min: 501, nextMin: 1600, nextClass: 'C' }
                        : { min: 0, nextMin: 501, nextClass: 'D' };
        const span = Math.max(1, band.nextMin - band.min);
        const covered = Math.max(0, Math.min(points - band.min, span));
        const progressPercent = Math.max(0, Math.min(100, Math.floor((covered / span) * 100)));
        return {
            currentClass: rankClass,
            classMinXp: band.min,
            nextClass: band.nextClass,
            nextClassMinXp: band.nextMin,
            xpToNextClass: Math.max(0, band.nextMin - points),
            progressPercent
        };
    };
    const getDifficultyMixClassCap = ({ easy = 0, medium = 0, hard = 0 }) => {
        if (hard >= 40 && medium >= 70 && easy >= 40) return 'S';
        if (hard >= 20 && medium >= 45 && easy >= 30) return 'A';
        if (hard >= 8 && medium >= 25 && easy >= 20) return 'B';
        if (medium >= 8 && easy >= 15) return 'C';
        if (easy >= 5) return 'D';
        return 'E';
    };
    const canJoinContestClass = (studentClass, contestClass) => {
        const studentIndex = getRankIndex(studentClass);
        const contestIndex = getRankIndex(contestClass);
        if (studentIndex < 0 || contestIndex < 0) return false;
        return contestIndex <= (studentIndex + 1);
    };
    const getContestClass = (contestRow) => {
        const explicitClass = normalizeRankClass(contestRow?.contest_class || contestRow?.class);
        if (explicitClass !== 'E' || String(contestRow?.contest_class || contestRow?.class || '').trim().toUpperCase() === 'E') {
            return explicitClass;
        }
        const legacyLevel = normalizeRankClass(contestRow?.level);
        return legacyLevel;
    };
    const isContestVisibleToStudent = (contestRow, sessionUser) => {
        const contestStatus = String(contestRow?.status || '').toLowerCase();
        if (contestStatus !== 'accepted') return false;

        const liveMode = String(contestRow?.live_mode || 'all_students').toLowerCase();
        const isLive = Number(contestRow?.is_live ?? 0) === 1;
        if (!isLive && liveMode === 'manual_hold') return false;
        if (!isLive && liveMode === 'selected_users') return false;
        if (liveMode === 'selected_users') {
            let allowedUserIds = [];
            try {
                const parsed = JSON.parse(contestRow?.live_user_ids || '[]');
                allowedUserIds = Array.isArray(parsed) ? parsed.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0) : [];
            } catch {
                allowedUserIds = [];
            }
            if (!allowedUserIds.includes(Number(sessionUser?.id))) {
                return false;
            }
        }

        const creatorRole = String(contestRow?.creatorRole || '').toLowerCase();
        const creatorCollege = String(contestRow?.creatorCollegeName || contestRow?.collegeName || '').trim();
        const studentCollege = String(sessionUser?.collegeName || '').trim();
        const creatorCollegeNorm = creatorCollege.toLowerCase();
        const studentCollegeNorm = studentCollege.toLowerCase();
        const studentDepartment = String(sessionUser?.department || '').trim();
        const contestDepartment = String(contestRow?.department || '').trim();
        const scope = String(contestRow?.visibility_scope || contestRow?.scope || contestRow?.level || '').toLowerCase();

        // Platform-level contests are visible to all students regardless of creator college.
        if (scope === 'global') return true;
        if (creatorRole === 'superadmin' || creatorRole === 'admin') return true;
        if (!studentCollegeNorm || !creatorCollegeNorm || creatorCollegeNorm !== studentCollegeNorm) return false;

        if (scope === 'global') return true;
        if (scope === 'college') return true;
        if (scope === 'department' || scope === 'internal') {
            return Boolean(studentDepartment) && Boolean(contestDepartment) && contestDepartment === studentDepartment;
        }
        if (!contestDepartment) return true;
        return contestDepartment === studentDepartment;
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

    const getStudentDifficultyCounts = async (userId) => {
        const rows = await dbAll(`
            SELECT LOWER(COALESCE(NULLIF(p.difficulty, ''), 'easy')) as difficulty, COUNT(DISTINCT s.problem_id) as solved
            FROM submissions s
            JOIN problems p ON p.id = s.problem_id
            WHERE s.user_id = ? AND s.status = 'accepted'
            GROUP BY LOWER(COALESCE(NULLIF(p.difficulty, ''), 'easy'))
        `, [userId]);
        const counts = { easy: 0, medium: 0, hard: 0 };
        rows.forEach((row) => {
            const key = String(row.difficulty || '').trim();
            if (Object.prototype.hasOwnProperty.call(counts, key)) {
                counts[key] = Number(row.solved || 0);
            }
        });
        return counts;
    };

    const getCollegeWeightedRankMeta = async (userId, collegeName) => {
        const normalizedCollege = String(collegeName || '').trim();
        if (!normalizedCollege) {
            return { score: 0, rank: '-' };
        }

        const rows = await dbAll(`
            WITH solved_distinct AS (
                SELECT DISTINCT
                    s.user_id,
                    s.problem_id,
                    LOWER(COALESCE(NULLIF(p.scope, ''), NULLIF(p.visibility_scope, ''),
                        CASE
                            WHEN LOWER(COALESCE(creator.role, '')) = 'superadmin' THEN 'global'
                            ELSE 'college'
                        END
                    )) AS scope_norm,
                    LOWER(COALESCE(creator.collegeName, '')) AS creator_college
                FROM submissions s
                JOIN problems p ON p.id = s.problem_id
                LEFT JOIN account_users creator ON creator.id = COALESCE(p.created_by, p.faculty_id)
                WHERE s.status = 'accepted'
            )
            SELECT
                sd.user_id,
                SUM(
                    CASE
                        WHEN sd.scope_norm = 'global' THEN CAST(? AS DOUBLE PRECISION)
                        WHEN sd.scope_norm IN ('college', 'department', 'internal')
                             AND sd.creator_college = LOWER(?) THEN 1.0
                        ELSE 0.0
                    END
                ) AS weighted_score
            FROM solved_distinct sd
            JOIN account_users u ON u.id = sd.user_id
            WHERE LOWER(COALESCE(u.role, '')) = 'student'
              AND LOWER(COALESCE(u.collegeName, '')) = LOWER(?)
            GROUP BY sd.user_id
        `, [GLOBAL_SOLVE_WEIGHT_FOR_COLLEGE_RANK, normalizedCollege, normalizedCollege]);

        const scoreMap = new Map(rows.map((row) => [Number(row.user_id), Number(row.weighted_score || 0)]));
        const myScore = scoreMap.get(Number(userId)) || 0;
        const higherCount = Array.from(scoreMap.values()).filter((score) => score > myScore).length;

        return {
            score: myScore,
            rank: `#${higherCount + 1}`
        };
    };

    const buildContestVisibilityData = async (sessionUser, userRow, solvedDifficultyCounts, yearFilter = '') => {
        const displayUser = await buildDisplayUser(sessionUser, userRow, solvedDifficultyCounts);
        const rows = await dbAll(`
            SELECT c.*, u.fullName as creatorName, u.role as creatorRole, u.collegeName as creatorCollegeName
            FROM contests c
            JOIN account_users u ON c.createdBy = u.id
            WHERE c.status = 'accepted'
            ORDER BY c.startDate DESC
        `, []);

        const contests = rows
            .filter(row => isContestVisibleToStudent(row, sessionUser))
            .filter((row) => {
                if (!yearFilter) return true;
                return !row.eligibility || String(row.eligibility).includes(String(yearFilter));
            })
            .map((row) => {
                const contestClass = getContestClass(row);
                const canJoin = canJoinContestClass(displayUser.rank_class, contestClass);
                return {
                    ...row,
                    contest_class: contestClass,
                    can_join: canJoin,
                    student_rank_class: displayUser.rank_class,
                    join_restriction: canJoin
                        ? null
                        : `Requires ${contestClass} class access. Your class is ${displayUser.rank_class}.`,
                    prize: row.prize || '',
                    guidelines: row.guidelines || row.rulesAndDescription || ''
                };
            });

        return { displayUser, contests };
    };

    const buildDisplayUser = async (sessionUser, userRow, difficultyCounts = null) => {
        const fullName = userRow?.fullName || sessionUser.fullName || sessionUser.name || 'Student';
        const nameParts = fullName.split(' ');
        const points = Number(userRow?.points || 0);
        const solvedCount = Number(userRow?.solvedCount || 0);
        const solvedDifficultyCounts = difficultyCounts || await getStudentDifficultyCounts(sessionUser.id);
        const xpRankClass = getRankClassFromXp(points);
        const mixCapRankClass = getDifficultyMixClassCap(solvedDifficultyCounts);
        const rankClass = minRankClass(xpRankClass, mixCapRankClass);
        const classProgress = getClassProgressMeta(points);
        const collegeRankMeta = await getCollegeWeightedRankMeta(sessionUser.id, sessionUser.collegeName || '');
        const globalHigherRankRow = await dbGet(`
            SELECT COUNT(*) as cnt
            FROM account_users
            WHERE LOWER(role) = 'student' AND points > ?
        `, [points]);

        return {
            ...sessionUser,
            fullName,
            first_name: nameParts[0] || 'Student',
            last_name: nameParts.slice(1).join(' '),
            username: sessionUser.name ? sessionUser.name.split(' ')[0].toLowerCase() : (sessionUser.email ? sessionUser.email.split('@')[0] : 'student'),
            xp: points,
            level: Math.max(1, Math.floor(points / 150) + 1),
            xp_percentage: classProgress.progressPercent,
            global_rank: `#${Number(globalHigherRankRow?.cnt || 0) + 1}`,
            college_rank: sessionUser.collegeName ? collegeRankMeta.rank : '-',
            college_weighted_score: Number(collegeRankMeta.score || 0),
            rank_class: rankClass,
            xp_rank_class: xpRankClass,
            mix_cap_rank_class: mixCapRankClass,
            next_rank_class: classProgress.nextClass,
            next_rank_min_xp: classProgress.nextClassMinXp,
            solved_easy: solvedDifficultyCounts.easy,
            solved_medium: solvedDifficultyCounts.medium,
            solved_hard: solvedDifficultyCounts.hard,
            problems_solved: solvedCount,
            streak: Math.min(14, Math.floor(solvedCount / 2)),
            college: sessionUser.collegeName || 'Independent',
            email: userRow?.email || sessionUser.email || '',
            year: userRow?.year || sessionUser.year || '',
            section: userRow?.section || sessionUser.section || '',
            branch: userRow?.branch || sessionUser.branch || '',
            program: userRow?.program || sessionUser.program || '',
            department: sessionUser.department || '',
            github_link: userRow?.github_link || sessionUser.github_link || '',
            location: userRow?.location || sessionUser.location || ''
        };
    };

    const parseDbDate = (value) => {
        if (!value) return null;
        if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
        const raw = String(value).trim();
        if (!raw) return null;

        const normalized = raw.replace(' ', 'T');
        const primary = new Date(normalized);
        if (Number.isNaN(primary.getTime())) return null;

        // For mixed datasets: if timezone suffix exists, also try local interpretation
        // and keep the one closest to system current time.
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

    const toLocalDateKey = (value) => {
        const dt = parseDbDate(value);
        if (!dt) return null;
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const getTimeAgo = (dateValue) => {
        const dt = parseDbDate(dateValue);
        if (!dt) return 'Recently';
        const timestamp = dt.getTime();
        if (Number.isNaN(timestamp)) return 'Recently';
        const diffMs = Date.now() - timestamp;
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);
        if (diffMinutes < 1) return 'Just now';
        if (diffMinutes < 60) return `${diffMinutes}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 30) return `${diffDays}d ago`;
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    // ==========================================
    // DASHBOARD VIEW
    // ==========================================
    router.get('/dashboard', requireRole('student'), async (req, res) => {
        const sessionUser = req.session.user;
        const userId = sessionUser.id;
        const toIsoDateKey = (value) => toLocalDateKey(value);
        try {
            const [userRow, solvedDifficultyCounts] = await Promise.all([
                dbGet(`SELECT points, solvedCount, rank, year, section, branch, program, fullName, email FROM account_users WHERE id = ?`, [userId]),
                getStudentDifficultyCounts(userId)
            ]);
            const displayUser = await buildDisplayUser(sessionUser, userRow, solvedDifficultyCounts);

            const allContests = await dbAll(`
                SELECT c.*,
                       u.fullName as creatorName, u.role as creatorRole, u.collegeName as creatorCollegeName
                FROM contests c
                JOIN account_users u ON c.createdBy = u.id
                WHERE c.status = 'accepted'
                ORDER BY c.startDate DESC
                LIMIT 40
            `, []);
            const contests = allContests
                .filter(row => isContestVisibleToStudent(row, sessionUser))
                .map((row) => {
                    const contestClass = getContestClass(row);
                    return {
                        ...row,
                        contest_class: contestClass,
                        can_join: canJoinContestClass(displayUser.rank_class, contestClass)
                    };
                })
                .slice(0, 10);

            const [submissionRows, acceptedRows, studentCountRow] = await Promise.all([
                dbAll(`
                    SELECT s.status, s.createdAt, s.points_earned, p.title, p.difficulty
                    FROM submissions s
                    JOIN problems p ON p.id = s.problem_id
                    WHERE s.user_id = ?
                    ORDER BY s.createdAt DESC
                    LIMIT 20
                `, [userId]),
                dbAll(`
                    SELECT s.createdAt, p.title, p.difficulty
                    FROM submissions s
                    JOIN problems p ON p.id = s.problem_id
                    WHERE s.user_id = ?
                      AND LOWER(COALESCE(s.status, '')) IN ('accepted', 'ac', 'pass')
                    ORDER BY s.createdAt DESC
                `, [userId]),
                dbGet(`SELECT COUNT(*) as cnt FROM account_users WHERE LOWER(role) = 'student'`, [])
            ]);

            const latestAccepted = acceptedRows[0];
            if (latestAccepted) {
                const solvedAt = new Date(latestAccepted.createdAt);
                displayUser.last_solved_time = Number.isNaN(solvedAt.getTime())
                    ? 'No recent activity'
                    : `Last solved ${solvedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
            } else {
                displayUser.last_solved_time = 'No recent activity';
            }
            displayUser.next_level_xp = getClassProgressMeta(displayUser.xp).xpToNextClass;

            const stats = {
                availableContests: contests.length,
                activeContests: contests.filter(c => c.status === 'accepted').length,
                college: sessionUser.collegeName || 'Independent',
                department: sessionUser.department || 'N/A',
                globalStudentCount: Number(studentCountRow?.cnt || 0),
                topPercent: studentCountRow?.cnt ? Math.max(1, Math.round((1 - ((Number(String(displayUser.global_rank).replace('#', '')) - 1) / Number(studentCountRow.cnt))) * 100)) : 100
            };

            const last7Days = [];
            for (let i = 6; i >= 0; i -= 1) {
                const date = new Date();
                date.setHours(0, 0, 0, 0);
                date.setDate(date.getDate() - i);
                last7Days.push({
                    key: toLocalDateKey(date),
                    label: date.toLocaleDateString('en-US', { weekday: 'short' })
                });
            }

            const activityMap = new Map(last7Days.map(day => [day.key, 0]));
            submissionRows.forEach(row => {
                if (!['accepted', 'ac', 'pass'].includes(String(row.status || '').toLowerCase())) return;
                const key = toIsoDateKey(row.createdAt);
                if (!key) return;
                if (activityMap.has(key)) {
                    activityMap.set(key, activityMap.get(key) + 1);
                }
            });

            const heatmapDates = [];
            for (let i = 83; i >= 0; i -= 1) {
                const date = new Date();
                date.setHours(0, 0, 0, 0);
                date.setDate(date.getDate() - i);
                heatmapDates.push({
                    key: toLocalDateKey(date),
                    label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                });
            }
            const heatmapMap = new Map(heatmapDates.map(day => [day.key, 0]));
            acceptedRows.forEach(row => {
                const key = toIsoDateKey(row.createdAt);
                if (!key) return;
                if (heatmapMap.has(key)) {
                    heatmapMap.set(key, heatmapMap.get(key) + 1);
                }
            });
            const heatmapData = heatmapDates.map(day => ({ date: day.label, value: heatmapMap.get(day.key) || 0 }));

            const recentActivities = submissionRows.slice(0, 5).map(row => ({
                icon: row.status === 'accepted' ? 'fa-check-circle' : 'fa-code',
                title: row.status === 'accepted' ? 'Accepted Submission' : 'Submitted Solution',
                description: `${row.title} · ${row.difficulty || 'Easy'}${row.points_earned ? ` · +${row.points_earned} XP` : ''}`,
                time_ago: getTimeAgo(row.createdAt),
                color: row.status === 'accepted' ? 'green' : 'blue'
            }));

            if (!recentActivities.length && contests.length) {
                recentActivities.push({
                    icon: 'fa-trophy',
                    title: 'Contest Available',
                    description: `Upcoming contest: ${contests[0].title}`,
                    time_ago: 'Now',
                    color: 'purple'
                });
            }

            res.render('student/dashboard.html', {
                user: displayUser,
                stats,
                contests,
                heatmap_data: JSON.stringify(heatmapData),
                recent_problems: acceptedRows.slice(0, 4).map(row => ({
                    title: row.title,
                    difficulty: row.difficulty || 'Easy',
                    solvedAgo: getTimeAgo(row.createdAt)
                })),
                activity_labels: JSON.stringify(last7Days.map(day => day.label)),
                activity_data: JSON.stringify(last7Days.map(day => activityMap.get(day.key) || 0)),
                recent_activities: recentActivities,
                currentPage: 'dashboard'
            });
        } catch (err) {
            console.error('Student dashboard query failed:', err);
            return res.status(500).send('Unable to load student dashboard at this time.');
        }
    });

    // ==========================================
    // REPORT VIEW
    // ==========================================
    router.get('/report', requireRole('student'), async (req, res) => {
        const sessionUser = req.session.user;
        const userId = sessionUser.id;

        try {
            const [userRow, solvedDifficultyCounts, difficultyRows, submissionRows, topicRows, joinedContestRows] = await Promise.all([
                dbGet(`SELECT points, solvedCount, rank, year, section, branch, program, fullName, email FROM account_users WHERE id = ?`, [userId]),
                getStudentDifficultyCounts(userId),
                dbAll(`
                    SELECT COALESCE(NULLIF(p.difficulty, ''), 'Easy') as difficulty, COUNT(DISTINCT s.problem_id) as solvedCount
                    FROM submissions s
                    JOIN problems p ON p.id = s.problem_id
                    WHERE s.user_id = ? AND s.status = 'accepted'
                    GROUP BY COALESCE(NULLIF(p.difficulty, ''), 'Easy')
                `, [userId]),
                dbAll(`
                    SELECT s.id, s.status, s.createdAt, s.language, s.points_earned, p.title, p.difficulty
                    FROM submissions s
                    JOIN problems p ON p.id = s.problem_id
                    WHERE s.user_id = ?
                    ORDER BY s.createdAt DESC
                    LIMIT 50
                `, [userId]),
                dbAll(`
                    SELECT p.tags
                    FROM submissions s
                    JOIN problems p ON p.id = s.problem_id
                    WHERE s.user_id = ? AND s.status = 'accepted'
                `, [userId]),
                dbAll(`
                    SELECT c.*, u.fullName as creatorName, u.role as creatorRole, u.collegeName as creatorCollegeName
                    FROM contest_participants cp
                    JOIN contests c ON c.id = cp.contest_id
                    JOIN account_users u ON c.createdBy = u.id
                    WHERE cp.user_id = ?
                    ORDER BY COALESCE(c.startDate, cp.joined_at) DESC
                    LIMIT 10
                `, [userId])
            ]);
            const displayUser = await buildDisplayUser(sessionUser, userRow, solvedDifficultyCounts);
            const contestRows = [];
            for (const row of joinedContestRows) {
                if (!isContestVisibleToStudent(row, sessionUser)) continue;
                const contestClass = getContestClass(row);
                const leaderboard = await buildContestLeaderboard(row);
                const me = leaderboard.find((entry) => Number(entry.user_id) === Number(userId));
                contestRows.push({
                    ...row,
                    contest_class: contestClass,
                    can_join: canJoinContestClass(displayUser.rank_class, contestClass),
                    rank_display: me ? `#${me.rank}` : 'Not Ranked',
                    percentile_display: me ? `${me.percentile}%` : 'N/A',
                    score_display: me ? Number(me.score || 0) : 0
                });
            }
            if (!contestRows.length) {
                const visibleContests = await dbAll(`
                    SELECT c.*, u.fullName as creatorName, u.role as creatorRole, u.collegeName as creatorCollegeName
                    FROM contests c
                    JOIN account_users u ON c.createdBy = u.id
                    WHERE c.status = 'accepted'
                    ORDER BY c.startDate DESC
                    LIMIT 5
                `, []);
                visibleContests
                    .filter(row => isContestVisibleToStudent(row, sessionUser))
                    .forEach((row) => {
                        const contestClass = getContestClass(row);
                        contestRows.push({
                            ...row,
                            contest_class: contestClass,
                            can_join: canJoinContestClass(displayUser.rank_class, contestClass),
                            rank_display: 'Not Joined',
                            percentile_display: 'N/A',
                            score_display: 0
                        });
                    });
            }

            const difficultyStats = { Easy: 0, Medium: 0, Hard: 0 };
            difficultyRows.forEach(row => {
                const key = ['Easy', 'Medium', 'Hard'].find(level => level.toLowerCase() === String(row.difficulty || '').toLowerCase());
                if (key) difficultyStats[key] = Number(row.solvedCount || 0);
            });

            const last7Days = [];
            for (let i = 6; i >= 0; i -= 1) {
                const date = new Date();
                date.setHours(0, 0, 0, 0);
                date.setDate(date.getDate() - i);
                last7Days.push({
                    key: date.toISOString().slice(0, 10),
                    label: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                });
            }

            const activityMap = new Map(last7Days.map(day => [day.key, 0]));
            submissionRows.forEach(row => {
                const key = new Date(row.createdAt).toISOString().slice(0, 10);
                if (activityMap.has(key)) {
                    activityMap.set(key, activityMap.get(key) + 1);
                }
            });

            const dailySubmissions = last7Days.map(day => ({
                day: day.label,
                count: activityMap.get(day.key) || 0
            }));

            const topicCountMap = new Map();
            topicRows.forEach(row => {
                String(row.tags || '')
                    .split(',')
                    .map(tag => tag.trim())
                    .filter(Boolean)
                    .forEach(tag => {
                        topicCountMap.set(tag, (topicCountMap.get(tag) || 0) + 1);
                    });
            });
            const topicStats = Array.from(topicCountMap.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)
                .map(([topic, solved]) => ({
                    topic,
                    solved,
                    proficiency: solved >= 8 ? 'Expert' : solved >= 4 ? 'Advanced' : solved >= 2 ? 'Intermediate' : 'Beginner'
                }));

            const attemptedCount = submissionRows.length;
            const acceptedCount = submissionRows.filter(row => row.status === 'accepted').length;
            const accuracy = attemptedCount ? ((acceptedCount / attemptedCount) * 100).toFixed(1) : '0.0';
            const facultyRemark = acceptedCount >= 15
                ? 'Strong consistency and a healthy solve volume. Keep pushing on medium and hard problems to improve interview readiness.'
                : acceptedCount >= 5
                    ? 'Good momentum so far. Focus on solving problems regularly and reviewing wrong submissions to improve accuracy.'
                    : 'Early progress is visible. Build a stronger routine with daily practice and broader topic coverage.';

            res.render('student/report.html', {
                user: displayUser,
                totalSolved: displayUser.problems_solved,
                difficultyStats,
                dailySubmissions,
                submissions: submissionRows,
                topicStats,
                contestHistory: contestRows,
                attemptedCount,
                accuracy,
                facultyRemark,
                reportGeneratedAt: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
                currentPage: 'report'
            });
        } catch (error) {
            console.error('Student report query failed:', error);
            res.status(500).send('Unable to load student report at this time.');
        }
    });

    // ==========================================
    // PROFILE VIEW
    // ==========================================
    router.get('/profile', requireRole('student'), async (req, res) => {
        try {
            const userRow = await dbGet(`
                SELECT id, fullName, email, collegeName, department, branch, program, year, section, points, solvedCount, rank, github_link, location
                FROM account_users
                WHERE id = ?
            `, [req.session.user.id]);
            const user = await buildDisplayUser(req.session.user, userRow);
            res.render('student/profile.html', { user, currentPage: 'profile', error: null, success: null });
        } catch (error) {
            console.error('Student profile query failed:', error);
            res.status(500).send('Unable to load student profile at this time.');
        }
    });

    router.get('/stats', requireRole('student'), async (req, res) => {
        const sessionUser = req.session.user;
        const userId = sessionUser.id;
        try {
            const [userRow, submissions, acceptedTagRows] = await Promise.all([
                dbGet(`SELECT id, fullName, email, collegeName, department, branch, program, year, section, points, solvedCount, rank, github_link, location FROM account_users WHERE id = ?`, [userId]),
                dbAll(`
                    SELECT s.status, s.language, s.createdAt, p.difficulty, p.tags
                    FROM submissions s
                    JOIN problems p ON p.id = s.problem_id
                    WHERE s.user_id = ?
                    ORDER BY s.createdAt ASC
                `, [userId]),
                dbAll(`
                    SELECT p.tags
                    FROM submissions s
                    JOIN problems p ON p.id = s.problem_id
                    WHERE s.user_id = ? AND s.status = 'accepted'
                `, [userId])
            ]);
            const user = await buildDisplayUser(sessionUser, userRow);
            const difficulty = { Easy: 0, Medium: 0, Hard: 0 };
            const verdicts = {};
            const languages = {};
            const ratingHistory = [];
            let running = 0;
            submissions.forEach((sub, index) => {
                const diffKey = ['Easy', 'Medium', 'Hard'].find(level => level.toLowerCase() === String(sub.difficulty || '').toLowerCase()) || 'Easy';
                difficulty[diffKey] += 1;
                verdicts[sub.status || 'pending'] = (verdicts[sub.status || 'pending'] || 0) + 1;
                const lang = (sub.language || 'unknown').toUpperCase();
                languages[lang] = (languages[lang] || 0) + 1;
                if (sub.status === 'accepted') running += 20;
                ratingHistory.push({ label: `S${index + 1}`, value: running });
            });
            const topicCounter = new Map();
            acceptedTagRows.forEach(row => {
                String(row.tags || '').split(',').map(t => t.trim()).filter(Boolean).forEach(tag => {
                    topicCounter.set(tag, (topicCounter.get(tag) || 0) + 1);
                });
            });
            const topTopics = Array.from(topicCounter.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
            res.render('student/stats.html', {
                user,
                currentPage: 'stats',
                skill_labels: JSON.stringify(topTopics.map(item => item[0])),
                skill_values: JSON.stringify(topTopics.map(item => item[1])),
                rating_labels: JSON.stringify(ratingHistory.map(item => item.label)),
                rating_values: JSON.stringify(ratingHistory.map(item => item.value)),
                difficulty_labels: JSON.stringify(Object.keys(difficulty)),
                difficulty_values: JSON.stringify(Object.values(difficulty)),
                verdict_labels: JSON.stringify(Object.keys(verdicts)),
                verdict_values: JSON.stringify(Object.values(verdicts)),
                language_labels: JSON.stringify(Object.keys(languages)),
                language_values: JSON.stringify(Object.values(languages)),
                top_percent: Math.max(1, Math.round((1 - ((Number(String(user.global_rank).replace('#', '')) - 1) / Math.max(1, Number((await dbGet(`SELECT COUNT(*) as cnt FROM account_users WHERE LOWER(role) = 'student'`, [])).cnt || 1)))) * 100))
            });
        } catch (error) {
            console.error('Student stats query failed:', error);
            res.status(500).send('Unable to load student stats at this time.');
        }
    });

    router.get('/support', requireRole('student'), async (req, res) => {
        try {
            const userRow = await dbGet(`SELECT id, fullName, email, collegeName, department, branch, program, year, section, points, solvedCount, rank, github_link, location FROM account_users WHERE id = ?`, [req.session.user.id]);
            const user = await buildDisplayUser(req.session.user, userRow);
            res.render('student/support.html', { user, currentPage: 'support' });
        } catch (error) {
            console.error('Student support query failed:', error);
            res.status(500).send('Unable to load support at this time.');
        }
    });

    router.get('/forum', requireRole('student'), async (req, res) => {
        try {
            const userRow = await dbGet(`SELECT id, fullName, email, collegeName, department, branch, program, year, section, points, solvedCount, rank, github_link, location FROM account_users WHERE id = ?`, [req.session.user.id]);
            const user = await buildDisplayUser(req.session.user, userRow);
            res.render('student/forum.html', { user, currentPage: 'community' });
        } catch (error) {
            console.error('Student forum query failed:', error);
            res.status(500).send('Unable to load forum at this time.');
        }
    });

    router.get('/new-post', requireRole('student'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/student/new-post.html'));
    });

    router.get('/new-post.html', requireRole('student'), (req, res) => res.redirect('/student/new-post'));

    router.get('/thread', requireRole('student'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/student/thread.html'));
    });

    router.get('/forum/thread', requireRole('student'), (req, res) => {
        const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
        return res.redirect(`/student/thread${query}`);
    });

    router.get('/thread.html', requireRole('student'), (req, res) => res.redirect('/student/thread'));

    router.get('/community', requireRole('student'), (req, res) => res.redirect('/student/forum'));

    router.get('/settings', requireRole('student'), (req, res) => {
        res.sendFile(path.join(__dirname, '../views/student/settings.html'));
    });

    router.get('/settings.html', requireRole('student'), (req, res) => res.redirect('/student/settings'));

    router.get('/submissions', requireRole('student'), (req, res) => res.redirect('/student/stats'));

    router.get('/contests', requireRole('student'), async (req, res) => {
        try {
            const sessionUser = req.session.user;
            const userId = sessionUser.id;
            const [userRow, solvedDifficultyCounts] = await Promise.all([
                dbGet(`SELECT id, fullName, email, collegeName, department, branch, program, year, section, points, solvedCount, rank, github_link, location FROM account_users WHERE id = ?`, [userId]),
                getStudentDifficultyCounts(userId)
            ]);
            const { displayUser } = await buildContestVisibilityData(sessionUser, userRow, solvedDifficultyCounts);
            res.render('student/contest.html', { user: displayUser, currentPage: 'contests' });
        } catch (error) {
            console.error('Student contests page failed:', error);
            res.status(500).send('Unable to load contests right now.');
        }
    });

    router.get('/contests/:id', requireRole('student'), async (req, res) => {
        try {
            const sessionUser = req.session.user;
            const userId = sessionUser.id;
            const [userRow, solvedDifficultyCounts] = await Promise.all([
                dbGet(`SELECT id, fullName, email, collegeName, department, branch, program, year, section, points, solvedCount, rank, github_link, location FROM account_users WHERE id = ?`, [userId]),
                getStudentDifficultyCounts(userId)
            ]);
            const displayUser = await buildDisplayUser(sessionUser, userRow, solvedDifficultyCounts);
            res.render('student/contest-details.html', {
                user: displayUser,
                currentPage: 'contests',
                contestId: Number(req.params.id)
            });
        } catch (error) {
            console.error('Student contest details page failed:', error);
            res.status(500).send('Unable to load contest details right now.');
        }
    });

    router.post('/profile', requireRole('student'), async (req, res) => {
        await ensureProfileColumns();
        const userId = req.session.user.id;
        const firstName = String(req.body.first_name || '').trim();
        const lastName = String(req.body.last_name || '').trim();
        const email = String(req.body.email || '').trim();
        const college = String(req.body.college || '').trim();
        const branch = String(req.body.branch || '').trim();
        const program = String(req.body.program || '').trim();
        const year = String(req.body.year || '').trim();
        const section = String(req.body.section || '').trim();
        const location = String(req.body.location || '').trim();
        const githubLink = String(req.body.github_link || '').trim();
        const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

        const renderProfileWithMessage = async (error, success) => {
            const userRow = await dbGet(`
                SELECT id, fullName, email, collegeName, department, branch, program, year, section, points, solvedCount, rank, github_link, location
                FROM account_users
                WHERE id = ?
            `, [userId]);
            const user = await buildDisplayUser(req.session.user, userRow);
            if (email) user.email = email;
            if (college) user.college = college;
            if (branch) user.branch = branch;
            if (program) user.program = program;
            if (year) user.year = year;
            if (section) user.section = section;
            if (location) user.location = location;
            if (githubLink) user.github_link = githubLink;
            if (firstName) user.first_name = firstName;
            if (lastName || lastName === '') user.last_name = lastName;
            if (fullName) user.fullName = fullName;
            return res.status(error ? 400 : 200).render('student/profile.html', { user, currentPage: 'profile', error, success });
        };

        if (!firstName || !email || !fullName) {
            return renderProfileWithMessage('First name and email are required.', null);
        }

        try {
            const emailOwner = await dbGet(`SELECT id FROM account_users WHERE email = ? AND id != ?`, [email, userId]);
            if (emailOwner) {
                return renderProfileWithMessage('That email is already in use.', null);
            }

            await dbRun(`
                UPDATE account_users
                SET fullName = ?, email = ?, collegeName = ?, branch = ?, program = ?, year = ?, section = ?, location = ?, github_link = ?
                WHERE id = ?
            `, [fullName, email, college, branch, program, year, section, location, githubLink, userId]);

            req.session.user.fullName = fullName;
            req.session.user.name = fullName;
            req.session.user.email = email;
            req.session.user.collegeName = college;
            req.session.user.branch = branch;
            req.session.user.program = program;
            req.session.user.year = year;
            req.session.user.section = section;
            req.session.user.location = location;
            req.session.user.github_link = githubLink;

            const userRow = await dbGet(`
                SELECT id, fullName, email, collegeName, department, branch, program, year, section, points, solvedCount, rank, github_link, location
                FROM account_users
                WHERE id = ?
            `, [userId]);
            const user = await buildDisplayUser(req.session.user, userRow);
            return res.render('student/profile.html', { user, currentPage: 'profile', error: null, success: 'Profile updated successfully.' });
        } catch (error) {
            console.error('Student profile update failed:', error);
            return renderProfileWithMessage('Unable to update your profile right now.', null);
        }
    });

    router.post('/delete-account', requireRole('student'), async (req, res) => {
        const userId = req.session.user.id;
        const confirm = String(req.body.confirm_name || '').trim().toLowerCase();
        const currentName = String(req.session.user.fullName || req.session.user.name || '').trim().toLowerCase();

        try {
            if (!confirm || confirm !== currentName) {
                const userRow = await dbGet(`
                    SELECT id, fullName, email, collegeName, department, branch, program, year, section, points, solvedCount, rank, github_link, location
                    FROM account_users
                    WHERE id = ?
                `, [userId]);
                const user = await buildDisplayUser(req.session.user, userRow);
                return res.status(400).render('student/profile.html', { user, currentPage: 'profile', error: 'Type your full name exactly to delete the account.', success: null });
            }

            await dbRun(`DELETE FROM account_users WHERE id = ?`, [userId]);
            req.session.destroy(() => {});
            return res.redirect('/');
        } catch (error) {
            console.error('Student delete account failed:', error);
            const userRow = await dbGet(`
                SELECT id, fullName, email, collegeName, department, branch, program, year, section, points, solvedCount, rank, github_link, location
                FROM account_users
                WHERE id = ?
            `, [userId]);
            const user = await buildDisplayUser(req.session.user, userRow);
            return res.status(500).render('student/profile.html', { user, currentPage: 'profile', error: 'Unable to delete your account right now.', success: null });
        }
    });

    // ==========================================
    // STUDENT SETTINGS + PROFILE APIs
    // ==========================================
    router.post('/logout', requireRole('student'), (req, res) => {
        req.session.destroy((err) => {
            if (err) return res.status(500).json({ success: false, message: 'Logout failed' });
            res.clearCookie('connect.sid');
            return res.json({ success: true, message: 'Logged out successfully' });
        });
    });

    router.get('/api/profile', requireRole('student'), async (req, res) => {
        try {
            await ensureProfileColumns();
            const userId = req.session.user.id;
            const user = await dbGet(`
                SELECT id, fullName, email, role, collegeName, branch, year, points, solvedCount, rank,
                       notif_contest_alerts, notif_submission_results, notif_deadline_reminders,
                       pending_college_name, college_request_status, github_link, location
                FROM account_users
                WHERE id = ?
            `, [userId]);
            if (!user) {
                return res.status(404).json({ success: false, message: 'User not found' });
            }
            const parts = String(user.fullName || '').trim().split(' ').filter(Boolean);
            user.firstName = parts[0] || '';
            user.lastName = parts.slice(1).join(' ');
            user.college = user.collegeName || '';
            user.problems_solved = Number(user.solvedCount || 0);
            user.global_rank = user.rank || '#-';
            user.xp = Number(user.points || 0);
            user.github_link = user.github_link || '';
            user.location = user.location || '';
            return res.json({ success: true, user });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    });

    router.post('/request-college-verification', requireRole('student'), async (req, res) => {
        try {
            const userId = req.session.user.id;
            const requestedCollege = String(req.body.collegeName || '').trim();
            if (!requestedCollege) {
                return res.status(400).json({ success: false, message: 'Please select a college.' });
            }

            const college = await dbGet(`SELECT id, name FROM colleges WHERE status = 'active' AND name = ?`, [requestedCollege]);
            if (!college) {
                return res.status(404).json({ success: false, message: 'Selected college is not available.' });
            }

            await dbRun(`
                UPDATE account_users
                SET pending_college_name = ?, college_request_status = 'pending'
                WHERE id = ?
            `, [requestedCollege, userId]);

            return res.json({
                success: true,
                message: 'College verification request submitted. Waiting for college admin approval.',
                request: { status: 'pending', collegeName: requestedCollege }
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    });

    router.post('/send-email-update-otp', requireRole('student'), async (req, res) => {
        try {
            const email = String(req.body.email || '').trim().toLowerCase();
            if (!email) return res.status(400).json({ success: false, message: 'Email is required' });

            const existingUser = await dbGet(`SELECT id FROM account_users WHERE LOWER(email) = ? AND id != ?`, [email, req.session.user.id]);
            if (existingUser) {
                return res.status(409).json({ success: false, message: 'Email already in use' });
            }

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            otpStore.set(`student_email_${req.session.user.id}`, { email, otp, expiresAt: Date.now() + (5 * 60 * 1000) });
            console.log(`[DEV MODE] Student email update OTP for ${email}: ${otp}`);

            if (transporter) {
                const mailOptions = {
                    from: process.env.EMAIL_USER,
                    to: email,
                    subject: 'CampusCode - Email Update OTP',
                    html: `
                        <div style="font-family: sans-serif; padding: 20px;">
                            <h2>Email Update Verification</h2>
                            <p>Your OTP is: <strong style="font-size: 24px; color: #1E4A7A;">${otp}</strong></p>
                            <p>This code expires in 5 minutes.</p>
                        </div>
                    `
                };
                transporter.sendMail(mailOptions).catch((err) => console.error('Student email OTP send failed:', err));
            }

            return res.json({ success: true, message: 'OTP sent successfully' });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    });

    router.post('/verify-email-otp', requireRole('student'), async (req, res) => {
        try {
            const userId = req.session.user.id;
            const email = String(req.body.email || '').trim().toLowerCase();
            const otp = String(req.body.otp || '').trim();
            const stored = otpStore.get(`student_email_${userId}`);

            if (!stored || stored.expiresAt < Date.now() || stored.email !== email || stored.otp !== otp) {
                return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
            }

            await dbRun(`UPDATE account_users SET email = ? WHERE id = ?`, [email, userId]);
            otpStore.delete(`student_email_${userId}`);
            req.session.user.email = email;
            return res.json({ success: true, message: 'Email updated successfully' });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    });

    router.post('/forgot-password-otp', requireRole('student'), async (req, res) => {
        try {
            const userId = req.session.user.id;
            const user = await dbGet(`SELECT email FROM account_users WHERE id = ?`, [userId]);
            const email = String(user?.email || req.session.user.email || '').trim();
            if (!email) return res.status(400).json({ success: false, message: 'No email on record.' });

            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            otpStore.set(`student_fp_${userId}`, { otp, expiresAt: Date.now() + (5 * 60 * 1000), email });
            console.log(`[DEV MODE] Student forgot-password OTP for ${email}: ${otp}`);

            if (transporter) {
                const mailOptions = {
                    from: process.env.EMAIL_USER,
                    to: email,
                    subject: 'CampusCode - Password Reset OTP',
                    html: `
                        <div style="font-family: sans-serif; padding: 20px;">
                            <h2>Password Reset</h2>
                            <p>Your OTP is: <strong style="font-size: 24px; color: #1E4A7A;">${otp}</strong></p>
                            <p>This code expires in 5 minutes.</p>
                        </div>
                    `
                };
                transporter.sendMail(mailOptions).catch((err) => console.error('Student forgot-password OTP send failed:', err));
            }

            return res.json({ success: true, message: 'OTP sent successfully' });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    });

    router.post('/reset-password', requireRole('student'), async (req, res) => {
        try {
            const userId = req.session.user.id;
            const otp = String(req.body.otp || '').trim();
            const newPassword = String(req.body.newPassword || '');
            if (!otp || !newPassword) {
                return res.status(400).json({ success: false, message: 'OTP and new password are required' });
            }

            const stored = otpStore.get(`student_fp_${userId}`);
            if (!stored || stored.expiresAt < Date.now() || stored.otp !== otp) {
                return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await dbRun(`UPDATE account_users SET password = ? WHERE id = ?`, [hashedPassword, userId]);
            otpStore.delete(`student_fp_${userId}`);
            const user = await dbGet(`SELECT email, fullName FROM account_users WHERE id = ?`, [userId]);
            if (transporter && user?.email) {
                const mailOptions = {
                    from: process.env.EMAIL_USER,
                    to: user.email,
                    subject: 'CampusCode - Password Changed',
                    html: `
                        <div style="font-family: sans-serif; padding: 20px;">
                            <h2>Password Updated</h2>
                            <p>Hello ${user.fullName || 'Student'}, your CampusCode password was changed successfully.</p>
                            <p>If this was not you, please reset immediately.</p>
                        </div>
                    `
                };
                transporter.sendMail(mailOptions).catch((err) => console.error('Student password change notification email failed:', err));
            }
            return res.json({ success: true, message: 'Password reset successfully' });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    });

    router.post('/update-profile', requireRole('student'), async (req, res) => {
        try {
            const userId = req.session.user.id;
            const firstName = String(req.body.firstName || '').trim();
            const lastName = String(req.body.lastName || '').trim();
            const fullName = String(req.body.fullName || `${firstName} ${lastName}`.trim()).trim();
            const email = String(req.body.email || '').trim().toLowerCase();
            const hasBranch = Object.prototype.hasOwnProperty.call(req.body, 'branch');
            const hasYear = Object.prototype.hasOwnProperty.call(req.body, 'year');
            const branch = hasBranch ? String(req.body.branch || '').trim() : null;
            const year = hasYear ? String(req.body.year || '').trim() : null;
            const currPass = String(req.body.currPass || '');
            const newPass = String(req.body.newPass || '');
            const notifContestAlerts = req.body.notifContestAlerts === undefined ? 1 : (req.body.notifContestAlerts ? 1 : 0);
            const notifSubmissionResults = req.body.notifSubmissionResults === undefined ? 1 : (req.body.notifSubmissionResults ? 1 : 0);
            const notifDeadlineReminders = req.body.notifDeadlineReminders === undefined ? 1 : (req.body.notifDeadlineReminders ? 1 : 0);

            if (!fullName || !email) {
                return res.status(400).json({ success: false, message: 'Full name and email are required' });
            }

            const emailOwner = await dbGet(`SELECT id FROM account_users WHERE LOWER(email) = ? AND id != ?`, [email, userId]);
            if (emailOwner) {
                return res.status(409).json({ success: false, message: 'Email already in use' });
            }

            if (newPass) {
                const user = await dbGet(`SELECT password FROM account_users WHERE id = ?`, [userId]);
                const match = await bcrypt.compare(currPass, user?.password || '');
                if (!match) {
                    return res.status(400).json({ success: false, message: 'Current password is incorrect' });
                }
                const hashedPassword = await bcrypt.hash(newPass, 10);
                await dbRun(`
                    UPDATE account_users
                    SET fullName = ?, email = ?, branch = COALESCE(?, branch), year = COALESCE(?, year), password = ?,
                        notif_contest_alerts = ?, notif_submission_results = ?, notif_deadline_reminders = ?
                    WHERE id = ?
                `, [fullName, email, branch || null, year || null, hashedPassword, notifContestAlerts, notifSubmissionResults, notifDeadlineReminders, userId]);
                const notifyUser = await dbGet(`SELECT email, fullName FROM account_users WHERE id = ?`, [userId]);
                if (transporter && notifyUser?.email) {
                    const mailOptions = {
                        from: process.env.EMAIL_USER,
                        to: notifyUser.email,
                        subject: 'CampusCode - Password Changed',
                        html: `
                            <div style="font-family: sans-serif; padding: 20px;">
                                <h2>Password Updated</h2>
                                <p>Hello ${notifyUser.fullName || 'Student'}, your CampusCode password was changed successfully.</p>
                                <p>If this was not you, please reset immediately.</p>
                            </div>
                        `
                    };
                    transporter.sendMail(mailOptions).catch((err) => console.error('Student password change notification email failed:', err));
                }
            } else {
                await dbRun(`
                    UPDATE account_users
                    SET fullName = ?, email = ?, branch = COALESCE(?, branch), year = COALESCE(?, year),
                        notif_contest_alerts = ?, notif_submission_results = ?, notif_deadline_reminders = ?
                    WHERE id = ?
                `, [fullName, email, branch || null, year || null, notifContestAlerts, notifSubmissionResults, notifDeadlineReminders, userId]);
            }

            req.session.user.fullName = fullName;
            req.session.user.name = fullName;
            req.session.user.email = email;
            if (hasBranch) req.session.user.branch = branch || '';
            if (hasYear) req.session.user.year = year || '';
            return res.json({ success: true, message: newPass ? 'Password changed successfully' : 'Profile updated successfully' });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    });

    // ==========================================
    // CONTESTS — Scoped Visibility
    // Admin-created → full college
    // Others       → student's own department
    // ==========================================
    router.get('/api/contests', requireRole('student'), async (req, res) => {
        try {
            const sessionUser = req.session.user;
            const { year } = req.query;
            const userId = sessionUser.id;
            const userRow = await dbGet(`SELECT points, solvedCount, rank, year, section, branch, program, fullName, email FROM account_users WHERE id = ?`, [userId]);
            const solvedDifficultyCounts = await getStudentDifficultyCounts(userId);
            const { contests } = await buildContestVisibilityData(sessionUser, userRow, solvedDifficultyCounts, year || '');
            const joinedRows = await dbAll(`SELECT contest_id FROM contest_participants WHERE user_id = ?`, [userId]);
            const joinedSet = new Set(joinedRows.map((row) => Number(row.contest_id)));
            const withJoinState = contests.map((contest) => ({
                ...contest,
                joined: joinedSet.has(Number(contest.id))
            }));
            res.json({ success: true, contests: withJoinState });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    router.get('/api/contests/:id', requireRole('student'), async (req, res) => {
        try {
            const sessionUser = req.session.user;
            const userId = sessionUser.id;
            const contestId = Number(req.params.id);
            if (!Number.isInteger(contestId) || contestId <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid contest id' });
            }
            const userRow = await dbGet(`SELECT points, solvedCount, rank, year, section, branch, program, fullName, email FROM account_users WHERE id = ?`, [userId]);
            const solvedDifficultyCounts = await getStudentDifficultyCounts(userId);
            const { contests } = await buildContestVisibilityData(sessionUser, userRow, solvedDifficultyCounts);
            const contest = contests.find(c => Number(c.id) === contestId);
            if (!contest) return res.status(404).json({ success: false, error: 'Contest not found' });

            const joinedRow = await dbGet(`
                SELECT id FROM contest_participants WHERE contest_id = ? AND user_id = ?
            `, [contestId, userId]);
            const problemIds = await getContestProblemIds(contest);
            let problemRows = [];
            if (problemIds.length) {
                const placeholders = problemIds.map(() => '?').join(',');
                problemRows = await dbAll(`
                    SELECT id, title, difficulty, tags, points
                    FROM problems
                    WHERE id IN (${placeholders})
                    ORDER BY id ASC
                `, problemIds);
            }
            const solvedRows = await dbAll(`
                SELECT DISTINCT problem_id
                FROM submissions
                WHERE contest_id = ? AND user_id = ? AND status = 'accepted'
            `, [contestId, userId]);
            const solvedSet = new Set(solvedRows.map((row) => Number(row.problem_id)));

            const problems = problemRows.map((row) => ({
                id: Number(row.id),
                title: row.title,
                difficulty: row.difficulty || 'Easy',
                tags: row.tags || '',
                points: Number(row.points || 0),
                solved: solvedSet.has(Number(row.id))
            }));

            const leaderboard = await buildContestLeaderboard({ ...contest, id: contestId });
            res.json({
                success: true,
                contest: {
                    ...contest,
                    joined: Boolean(joinedRow),
                    problems
                },
                leaderboard: leaderboard.slice(0, 20)
            });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    router.post('/api/contests/:id/join', requireRole('student'), async (req, res) => {
        try {
            const sessionUser = req.session.user;
            const userId = sessionUser.id;
            const contestId = Number(req.params.id);
            if (!Number.isInteger(contestId) || contestId <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid contest id' });
            }

            const userRow = await dbGet(`SELECT points, solvedCount, rank, year, section, branch, program, fullName, email FROM account_users WHERE id = ?`, [userId]);
            const solvedDifficultyCounts = await getStudentDifficultyCounts(userId);
            const { displayUser, contests } = await buildContestVisibilityData(sessionUser, userRow, solvedDifficultyCounts);
            const contest = contests.find(c => Number(c.id) === contestId);
            if (!contest) return res.status(404).json({ success: false, error: 'Contest not found' });
            if (!contest.can_join) {
                return res.status(403).json({ success: false, error: contest.join_restriction || 'You are not eligible for this contest.' });
            }

            const problemIds = await getContestProblemIds(contest);
            if (!problemIds.length) {
                return res.status(400).json({ success: false, error: 'Contest has no mapped problems yet.' });
            }

            await dbRun(`
                INSERT OR IGNORE INTO contest_participants (contest_id, user_id)
                VALUES (?, ?)
            `, [contestId, userId]);
            return res.json({
                success: true,
                message: 'Joined contest successfully.',
                student_rank_class: displayUser.rank_class
            });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    router.get('/api/contests/:id/leaderboard', requireRole('student'), async (req, res) => {
        try {
            const contestId = Number(req.params.id);
            if (!Number.isInteger(contestId) || contestId <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid contest id' });
            }
            const contest = await dbGet(`SELECT id, title, problems FROM contests WHERE id = ? AND status = 'accepted'`, [contestId]);
            if (!contest) return res.status(404).json({ success: false, error: 'Contest not found' });
            const leaderboard = await buildContestLeaderboard(contest);
            return res.json({ success: true, leaderboard });
        } catch (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};

