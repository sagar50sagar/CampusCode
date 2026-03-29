const express = require('express');
const { requireRole } = require('../middleware/auth');
const { checkScope } = require('../middleware/authMiddleware');

module.exports = (db) => {
    const router = express.Router();

    // Helper: Convert Semester to Year
    const semToYear = (sem) => {
        if (sem <= 2) return '1st Year';
        if (sem <= 4) return '2nd Year';
        if (sem <= 6) return '3rd Year';
        return '4th Year';
    };

    // HOD: Assign Role (HOS or Faculty) within their own department
    router.post('/hod/assign-role', requireRole('hod'), (req, res) => {
        const { targetUserId, newRole, subject } = req.body;
        const hodDept = req.session.user.department;
        const collegeName = req.session.user.collegeName;

        if (!['hos', 'faculty'].includes(newRole)) {
            return res.status(400).json({ success: false, error: "Invalid role. HODs can only assign 'hos' or 'faculty'." });
        }

        if (newRole === 'hos' && (!subject || subject.trim() === '')) {
            return res.status(400).json({ success: false, error: "A subject must be selected to promote a teacher to HOS." });
        }

        // Strict Departmental Isolation: Verify target user is in the same department
        db.get(`SELECT id FROM users WHERE id = ? AND department = ? AND collegeName = ?`, 
            [targetUserId, hodDept, collegeName], (err, row) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (!row) return res.status(403).json({ success: false, error: "Access Denied: You can only manage roles within your own department." });

                const roleSubject = newRole === 'hos' ? subject : '';
                db.run(`UPDATE users SET role = ?, subject = ? WHERE id = ?`, [newRole, roleSubject, targetUserId], function(err) {
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
                                    db.run(`INSERT OR IGNORE INTO user_assignments (user_id, subject, year, section, assigned_by_id, collegeName) VALUES (?, ?, ?, ?, ?, ?)`,
                                        [targetUserId, subject, year, row.sectionName, req.session.user.id, collegeName]);
                                });
                            }
                        });
                    }

                    res.json({ success: true, message: `Role updated to ${newRole} for ${newRole === 'hos' ? subject : 'teaching'} successfully.` });
                });
            });
    });

    // HOD: Global Teacher Search & Profile View
    router.get('/hod/view-profile/:id', requireRole('hod'), (req, res) => {
        const collegeName = req.session.user.collegeName;
        db.get(`SELECT id, fullName, email, role, department, mobile, post FROM users WHERE id = ? AND collegeName = ?`, 
            [req.params.id, collegeName], (err, row) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                if (!row) return res.status(404).json({ success: false, error: "Teacher not found." });
                res.json({ success: true, profile: row });
            });
    });


    // HOD: 100% Dynamic Oversight Dashboard
    router.get('/hod/dashboard-data', requireRole('hod'), (req, res) => {
        const hodDept = req.session.user.department;
        const collegeName = req.session.user.collegeName;

        const data = {};
        
        // Fetch Pending Questions from Department
        db.all(`SELECT p.*, u.fullName as facultyName 
                FROM problems p 
                JOIN users u ON p.faculty_id = u.id 
                WHERE u.department = ? AND p.status = 'pending' AND u.collegeName = ?`, 
            [hodDept, collegeName], (err, problems) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                data.pendingQuestions = problems;

                // Fetch Pending Contests from Department
                db.all(`SELECT c.*, u.fullName as creatorName 
                        FROM contests c 
                        JOIN users u ON c.createdBy = u.id 
                        WHERE u.department = ? AND c.status = 'pending' AND u.collegeName = ?`, 
                    [hodDept, collegeName], (err, contests) => {
                        if (err) return res.status(500).json({ success: false, error: err.message });
                        data.pendingContests = contests;

                        // Fetch Department Faculty
                        db.all(`SELECT id, fullName, email, role, post FROM users WHERE department = ? AND collegeName = ? AND (role != 'hod' AND (is_hod = 0 OR is_hod IS NULL))`, 
                            [hodDept, collegeName], (err, faculty) => {
                                if (err) return res.status(500).json({ success: false, error: err.message });
                                data.departmentFaculty = faculty;
                                res.json({ success: true, data });
                            });
                    });
            });
    });

    // Unified HOD Dashboard
    router.get('/hod/dashboard', requireRole('hod'), checkScope, (req, res) => {
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        // Statistics
        const statsQuery = `
            SELECT 
                (SELECT COUNT(*) FROM users WHERE role = 'faculty' AND department = ? AND collegeName = ?) as facultyCount,
                (SELECT COUNT(*) FROM users WHERE role = 'student' AND department = ? AND collegeName = ?) as studentCount,
                (SELECT COUNT(*) FROM problems WHERE department = ? AND status = 'pending') as pendingQuestionsCount,
                (SELECT COUNT(*) FROM contests WHERE department = ? AND status = 'pending') as pendingContestsCount
        `;

        // Recently Pending Items
        const questionsQuery = `SELECT * FROM problems WHERE department = ? AND status = 'pending' ORDER BY id DESC LIMIT 5`;
        const contestsQuery  = `SELECT * FROM contests WHERE department = ? AND status = 'pending' ORDER BY id DESC LIMIT 5`;

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

        db.get(statsQuery, [dept, college, dept, college, dept, dept], (err, stats) => {
            if (err) return res.status(500).send(err.message);

            db.all(questionsQuery, [dept], (err, pendingQuestions) => {
                if (err) return res.status(500).send(err.message);

                db.all(contestsQuery, [dept], (err, pendingContests) => {
                    if (err) return res.status(500).send(err.message);

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

                            const graphData = { difficultySpread, trendLabels, trendCounts };

                            res.render('hod/dashboard', {
                                user: req.session.user,
                                stats,
                                pendingQuestions,
                                pendingContests,
                                graphData,
                                currentPage: 'dashboard'
                            });
                        });
                    });
                });
            });
        });
    });


    // Faculty Management
    router.get('/hod/faculty', requireRole('hod'), checkScope, (req, res) => {
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        // Fetch faculty and their assignments
        const facultyQuery = `
            SELECT 
                u.id, u.fullName, u.email, u.role, u.status, u.department, u.subject as hosSubject, u.joiningDate,
                GROUP_CONCAT(ua.subject || ' (' || ua.year || ' - ' || ua.section || ')') as assignments
            FROM users u
            LEFT JOIN user_assignments ua ON u.id = ua.user_id AND ua.collegeName = ?
            WHERE u.collegeName = ? AND u.role IN ('faculty', 'hos') AND u.department = ? AND (u.is_hod = 0 OR u.is_hod IS NULL)
            GROUP BY u.id
        `;

        db.all(facultyQuery, [college, college, dept], (err, faculty) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            
            res.render('hod/faculty', {
                user: req.session.user,
                departmentFaculty: faculty,
                currentPage: 'faculty',
                dropdownData: res.locals.dropdownData
            });
        });
    });

    // HOD: Create Faculty Account
    router.post('/hod/faculty/create', requireRole('hod'), (req, res) => {
        const { fullName, email, mobile, post } = req.body;
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        if (!fullName || !email) {
            return res.redirect('/college/hod/faculty?error=Name+and+email+are+required');
        }

        // Check if email already exists
        db.get(`SELECT id FROM users WHERE email = ?`, [email], (err, existing) => {
            if (err) return res.status(500).send(err.message);
            if (existing) {
                return res.redirect('/college/hod/faculty?error=A+user+with+this+email+already+exists');
            }

            const bcrypt = require('bcrypt');
            const tempPassword = 'changeme123';
            bcrypt.hash(tempPassword, 10, (err, hash) => {
                if (err) return res.status(500).send(err.message);

                db.run(
                    `INSERT INTO users (fullName, email, password, role, department, collegeName, mobile, post, status)
                     VALUES (?, ?, ?, 'faculty', ?, ?, ?, ?, 'pending')`,
                    [fullName, email, hash, dept, college, mobile || '', post || ''],
                    function(err) {
                        if (err) return res.status(500).send(err.message);
                        res.redirect('/college/hod/faculty?created=1');
                    }
                );
            });
        });
    });

    // HOD: Assign Sections and Years
    router.post('/hod/assign-sections-years', requireRole('hod'), (req, res) => {
        const { facultyId, assignedYears, assignedSections, subjectName } = req.body;
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;
        const hodId = req.session.user.id;

        if (!subjectName || !assignedYears || !assignedSections) {
            return res.redirect('/college/hod/faculty?error=Missing+assignment+details');
        }

        // Ensure the faculty exists in the same college
        db.get(`SELECT id FROM users WHERE id = ? AND collegeName = ? AND role IN ('faculty', 'hos')`, 
            [facultyId, college], (err, row) => {
            if (err) return res.status(500).send(err.message);
            if (!row) return res.status(403).send("Unauthorized or Invalid Faculty ID.");

            // Insert into user_assignments
            db.run(
                `INSERT INTO user_assignments (user_id, subject, year, section, assigned_by_id, collegeName)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [facultyId, subjectName, assignedYears, assignedSections, hodId, college],
                function(err) {
                    if (err) return res.status(500).send(err.message);
                    res.redirect('/college/hod/faculty?assigned=1');
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

        db.get(`SELECT id FROM users WHERE id = ? AND collegeName = ? AND role IN ('faculty', 'hos')`, 
            [facultyId, college], (err, row) => {
            if (err) return res.status(500).send(err.message);
            if (!row) return res.status(403).send("Unauthorized or Invalid Faculty ID.");

            // Also putting it into user_assignments with 'All' defaults for year/section if just assigning subject
            db.run(
                `INSERT INTO user_assignments (user_id, subject, year, section, assigned_by_id, collegeName) 
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
        db.all(`SELECT * FROM users WHERE role = 'student' AND department = ? AND collegeName = ?`, [dept, college], (err, students) => {
            if (err) return res.status(500).send(err.message);
            res.render('hod/student', { user: req.session.user, students: students || [], currentPage: 'student' });
        });
    });

    // Question Bank / Problem Management
    router.get('/hod/problem', requireRole('hod'), checkScope, (req, res) => {
        const user = req.session.user;
        const dept = user.department;
        const college = user.collegeName;
        db.all(
            `SELECT p.*, u.fullName as facultyName FROM problems p 
             JOIN users u ON p.faculty_id = u.id 
             WHERE (p.department = ?) OR (p.status = 'accepted' AND u.collegeName = ? AND LOWER(p.visibility_scope) = 'global')
             ORDER BY p.createdAt DESC`, 
            [dept, college], 
            (err, problems) => {
            if (err) return res.status(500).send(err.message);
            res.render('hod/problem', { user: req.session.user, problems: problems || [], currentPage: 'problem' });
        });
    });

    // Contest Management
    router.get('/hod/contest', requireRole('hod'), checkScope, (req, res) => {
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;
        const hodId = req.session.user.id;
        db.all(
            `SELECT c.*, u.role as creatorRole FROM contests c
             LEFT JOIN users u ON c.createdBy = u.id
             WHERE (c.status = 'accepted' AND c.collegeName = ?)
                OR (c.department = ? AND c.collegeName = ?)
                OR c.createdBy = ?
             ORDER BY c.id DESC`,
            [college, dept, college, hodId],
            (err, contests) => {
                if (err) return res.status(500).send(err.message);
                res.render('hod/contest', { user: req.session.user, contests: contests || [], currentPage: 'contest' });
            }
        );
    });

    // Community Forum
    router.get('/hod/community', requireRole('hod'), checkScope, (req, res) => {
        res.render('hod/community', { user: req.session.user, currentPage: 'community' });
    });

    // Reports & Analytics
    router.get('/hod/report', requireRole('hod'), checkScope, (req, res) => {
        res.render('hod/report', { user: req.session.user, currentPage: 'report' });
    });

    // Settings
    router.get('/hod/settings', requireRole('hod'), checkScope, (req, res) => {
        db.get(`SELECT * FROM users WHERE id = ?`, [req.session.user.id], (err, user) => {
            if (err) return res.status(500).send(err.message);
            const success = req.query.saved === '1';
            res.render('hod/settings', { user, currentPage: 'settings', success });
        });
    });

    // Settings Update
    router.post('/hod/settings/update', requireRole('hod'), (req, res) => {
        const { fullName, email, gender, mobile } = req.body;
        const id = req.session.user.id;
        db.run(
            `UPDATE users SET fullName = ?, email = ?, gender = ?, mobile = ? WHERE id = ?`,
            [fullName, email, gender, mobile, id],
            function(err) {
                if (err) return res.status(500).send(err.message);
                // Refresh session
                req.session.user.fullName = fullName;
                req.session.user.email = email;
                res.redirect('/college/hod/settings?saved=1');
            }
        );
    });

    // Help & Support
    router.get('/hod/help', requireRole('hod'), checkScope, (req, res) => {
        res.render('hod/help', { user: req.session.user, currentPage: 'help' });
    });

    // Pending Questions (Dedicated Page)
    router.get('/hod/pending-questions', requireRole('hod'), checkScope, (req, res) => {
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        // Fetch all questions for listing (we'll filter in EJS or handle with query params)
        const status = req.query.status || 'pending';
        
        const statsQuery = `
            SELECT 
                (SELECT COUNT(*) FROM problems WHERE department = ? AND status = 'pending') as pendingCount,
                (SELECT COUNT(*) FROM problems WHERE department = ? AND status = 'accepted') as approvedCount,
                (SELECT COUNT(*) FROM problems WHERE department = ? AND status = 'rejected') as rejectedCount,
                (SELECT COUNT(*) FROM problems WHERE department = ? AND createdAt >= date('now', '-7 days')) as thisWeekCount
        `;

        const subjectsQuery = `SELECT DISTINCT subject FROM problems WHERE department = ?`;

        const problemsQuery = `
            SELECT p.*, u.fullName as facultyName 
            FROM problems p 
            JOIN users u ON p.faculty_id = u.id 
            WHERE p.department = ? 
            ORDER BY p.id DESC
        `;

        db.get(statsQuery, [dept, dept, dept, dept], (err, stats) => {
            if (err) return res.status(500).send(err.message);
            
            db.all(subjectsQuery, [dept], (err, subjects) => {
                if (err) return res.status(500).send(err.message);
                
                db.all(problemsQuery, [dept], (err, allQuestions) => {
                    if (err) return res.status(500).send(err.message);
                    
                    res.render('hod/pending_questions', { 
                        user: req.session.user, 
                        allQuestions, 
                        subjects: subjects || [],
                        stats: stats || {},
                        currentPage: 'dashboard' 
                    });
                });
            });
        });
    });

    // Pending Contests (Refined with Stats and Filters)
    router.get('/hod/pending-contests', requireRole('hod'), checkScope, (req, res) => {
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;
        const { subject, type, dateFrom, dateTo, hos_approved, tab } = req.query;

        // Fetch stats
        const statsQuery = `
            SELECT 
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pendingCount,
                COUNT(CASE WHEN status = 'accepted' THEN 1 END) as approvedCount,
                COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejectedCount,
                COUNT(CASE WHEN status = 'accepted' AND startDate > datetime('now') THEN 1 END) as upcomingCount
            FROM contests 
            WHERE department = ?
        `;

        // Fetch all contests for conflict detection and filtering
        let filterQuery = `
            SELECT c.*, u.fullName as creatorName 
            FROM contests c 
            JOIN users u ON c.createdBy = u.id 
            WHERE c.department = ? AND u.collegeName = ?
        `;
        const params = [dept, college];

        db.get(statsQuery, [dept], (err, stats) => {
            if (err) return res.status(500).send(err.message);

            db.all(filterQuery, params, (err, allContests) => {
                if (err) return res.status(500).send(err.message);

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

                // Filtering the list based on Tab and Query Params
                let filteredContests = allContests;

                // Tab Filter
                if (tab === 'approved') filteredContests = filteredContests.filter(c => c.status === 'accepted');
                else if (tab === 'rejected') filteredContests = filteredContests.filter(c => c.status === 'rejected');
                else if (tab === 'active') filteredContests = filteredContests.filter(c => c.status === 'accepted' && new Date(c.startDate) <= new Date() && new Date(c.endDate) >= new Date());
                else if (tab === 'conflicts') filteredContests = filteredContests.filter(c => c.conflicts.length > 0);
                else if (!tab || tab === 'all') {
                    // Default to pending for "All" if that's what user prefers, but image implies "All"
                    // We'll show all but user can select
                }

                // Query Params Filter
                if (subject && subject !== 'All Subjects') filteredContests = filteredContests.filter(c => c.subject === subject);
                if (type && type !== 'All Types') filteredContests = filteredContests.filter(c => c.type === type);
                if (dateFrom) filteredContests = filteredContests.filter(c => new Date(c.startDate) >= new Date(dateFrom));
                if (dateTo) filteredContests = filteredContests.filter(c => new Date(c.startDate) <= new Date(dateTo));
                if (hos_approved && hos_approved !== 'All') {
                    const val = hos_approved === 'Yes' ? 1 : 0;
                    filteredContests = filteredContests.filter(c => c.hos_approved === val);
                }

                // Get unique subjects for filter dropdown
                const subjects = [...new Set(allContests.map(c => c.subject))].filter(Boolean);
                const types = [...new Set(allContests.map(c => c.type))].filter(Boolean);

                res.render('hod/pending_contests', { 
                    user: req.session.user, 
                    pendingContests: filteredContests, 
                    stats,
                    subjects,
                    types,
                    query: req.query,
                    currentPage: 'dashboard' 
                });
            });
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
                return res.render('hod/profile', { user, managedResources: [], currentPage: 'profile' });
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

            res.render('hod/profile', { user, managedResources, currentPage: 'profile' });
        });
    });

    // --- HOD API Endpoints ---

    // Verify Faculty
    router.post('/hod/api/verify-faculty', requireRole('hod'), (req, res) => {
        const { id } = req.body;
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        db.run('UPDATE users SET status = "active" WHERE id = ? AND department = ? AND collegeName = ? AND status = "pending"', [id, dept, college], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (this.changes === 0) return res.status(404).json({ success: false, message: 'Faculty not found, already verified, or not in your department' });
            res.json({ success: true, message: 'Faculty verified successfully' });
        });
    });

    // Assign Role (Faculty/HOS)
    router.post('/hod/api/assign-role', requireRole('hod'), (req, res) => {
        const { id, role, subject } = req.body;
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        if (!['faculty', 'hos'].includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role' });
        }

        // If promoting to HOS, a subject must be selected
        if (role === 'hos' && (!subject || subject.trim() === '')) {
            return res.status(400).json({ success: false, message: 'A subject must be selected to promote a teacher to HOS.' });
        }

        const checkConflict = () => {
            if (role === 'hos') {
                // Check if another HOS already exists for this specific subject in this department
                const conflictQuery = `
                    SELECT fullName 
                    FROM users 
                    WHERE role = 'hos' 
                    AND department = ? 
                    AND subject = ? 
                    AND collegeName = ? 
                    AND id != ?
                    LIMIT 1
                `;
                db.get(conflictQuery, [dept, subject, college, id], (err, row) => {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    if (row) {
                        return res.status(400).json({ success: false, message: `Conflict: ${row.fullName} is already the HOS for ${subject} in this department.` });
                    }
                    performUpdate();
                });
            } else {
                performUpdate();
            }
        };

        const performUpdate = () => {
            const roleSubject = role === 'hos' ? subject : '';
            db.run('UPDATE users SET role = ?, subject = ? WHERE id = ? AND department = ? AND collegeName = ?', 
                [role, roleSubject, id, dept, college], function(err) {
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
                                db.run(`INSERT OR IGNORE INTO user_assignments (user_id, subject, year, section, assigned_by_id, collegeName) VALUES (?, ?, ?, ?, ?, ?)`,
                                    [id, subject, year, row.sectionName, req.session.user.id, college]);
                            });
                        }
                    });
                }

                if (this.changes === 0) return res.status(404).json({ success: false, message: 'Faculty not found or not in your department' });
                res.json({ success: true, message: `Role assigned successfully. ${role === 'hos' ? 'User is now HOS for ' + subject : ''}` });
            });
        };

        checkConflict();
    });

    // Update Faculty Profile (from HOD)
    router.post('/hod/api/update-faculty', requireRole('hod'), (req, res) => {
        const { id, fullName, email, joiningDate } = req.body;
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        db.run('UPDATE users SET fullName = ?, email = ?, joiningDate = ? WHERE id = ? AND department = ? AND collegeName = ? AND (is_hod = 0 OR is_hod IS NULL)', [fullName, email, joiningDate, id, dept, college], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (this.changes === 0) return res.status(404).json({ success: false, message: 'Faculty not found or not in your department' });
            res.json({ success: true, message: 'Faculty profile updated successfully' });
        });
    });

    // Global Search Teachers (College-wide)
    router.get('/hod/api/search-teachers', requireRole('hod'), (req, res) => {
        const { q } = req.query;
        const college = req.session.user.collegeName;

        if (!q) return res.json([]);

        const searchQuery = `
            SELECT id, fullName, email, role, department 
            FROM users 
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
        db.get(`SELECT id, role, department FROM users WHERE id = ? AND collegeName = ?`, [userId, college], (err, targetUser) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (!targetUser) return res.status(403).json({ success: false, message: "Faculty not found in your college." });

            const checkHOS = () => {
                if (targetUser.role === 'hos') {
                    // Check if another HOS is already assigned to this subject name in this department
                    const hosCheckQuery = `
                        SELECT u.fullName 
                        FROM user_assignments ua
                        JOIN users u ON ua.user_id = u.id
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
                db.run(`INSERT INTO user_assignments (user_id, subject, year, section, assigned_by_id, collegeName) VALUES (?, ?, 'All Years', 'All Sections', ?, ?)`, 
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

        db.get(`SELECT id FROM users WHERE id = ? AND collegeName = ?`, [facultyId, college], (err, row) => {
            if (err) return res.status(500).json({ success: false, message: err.message });
            if (!row) return res.status(403).json({ success: false, message: "Faculty not found." });

            db.run(
                `INSERT INTO user_assignments (user_id, subject, year, section, assigned_by_id, collegeName)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [facultyId, subjectName, assignedYears, assignedSections, hodId, college],
                function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Sections assigned successfully' });
                }
            );
        });
    });

    // Bulk Approve Contests (HOD sets hod_verified; accepts only when both verified)
    router.post('/hod/api/bulk-approve-contests', requireRole('hod'), (req, res) => {
        const { ids } = req.body;
        const dept = req.session.user.department;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'No contests selected' });
        }

        const placeholders = ids.map(() => '?').join(',');
        // First set hod_verified=1 for all
        db.run(
            `UPDATE contests SET hod_verified = 1 WHERE id IN (${placeholders}) AND department = ?`,
            [...ids, dept],
            function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                // Then accept those where hos_verified is also already 1
                db.run(
                    `UPDATE contests SET status = 'accepted', isVerified = 1, visibility_scope = 'department'
                     WHERE id IN (${placeholders}) AND department = ? AND hos_verified = 1`,
                    [...ids, dept],
                    function(err2) {
                        if (err2) return res.status(500).json({ success: false, message: err2.message });
                        res.json({ success: true, message: `${this.changes} contests fully approved. Others are pending HOS approval.` });
                    }
                );
            }
        );
    });

    // Approve Content (Problem/Contest) — Dual-Approval Logic
    router.post('/hod/api/approve-content', requireRole(['hod', 'hos']), (req, res) => {
        const { id, type, action } = req.body;
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        if (!id || !type) return res.status(400).json({ success: false, message: 'Missing id or type' });

        if (type === 'problem') {
            if (action === 'reject') {
                return db.run(`UPDATE problems SET status = 'rejected' WHERE id = ? AND department = ?`, [id, dept], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Problem rejected.' });
                });
            }
            // OR rule: HOD alone can accept a problem
            db.run(
                `UPDATE problems SET hod_verified = 1, status = 'accepted', is_public = 1 WHERE id = ? AND department = ?`,
                [id, dept],
                function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    if (this.changes === 0) return res.status(404).json({ success: false, message: 'Problem not found or not in your department' });
                    res.json({ success: true, message: 'Problem accepted and published globally.' });
                }
            );

        } else if (type === 'contest') {
            if (action === 'reject') {
                return db.run(`UPDATE contests SET status = 'rejected' WHERE id = ? AND department = ?`, [id, dept], function(err) {
                    if (err) return res.status(500).json({ success: false, message: err.message });
                    res.json({ success: true, message: 'Contest rejected.' });
                });
            }
            // AND rule: set hod_verified=1, then check if hos_verified is also 1
            db.run(`UPDATE contests SET hod_verified = 1 WHERE id = ? AND department = ?`, [id, dept], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                if (this.changes === 0) return res.status(404).json({ success: false, message: 'Contest not found or not in your department' });

                db.get(`SELECT hos_verified FROM contests WHERE id = ?`, [id], (err, row) => {
                    if (err) return res.status(500).json({ success: false, message: err.message });

                    if (row && row.hos_verified === 1) {
                        db.run(
                            `UPDATE contests SET status = 'accepted', isVerified = 1, visibility_scope = 'department' WHERE id = ?`,
                            [id],
                            function(err) {
                                if (err) return res.status(500).json({ success: false, message: err.message });
                                res.json({ success: true, message: 'Contest accepted! Both HOD and HOS have approved.' });
                            }
                        );
                    } else {
                        res.json({ success: true, message: 'HOD approval recorded. Waiting for HOS approval.' });
                    }
                });
            });
        } else {
            res.status(400).json({ success: false, message: 'Invalid type' });
        }
    });

    // --- HOD Contest APIs ---

    // Get Assigned Data (Subjects, Years, Sections)
    router.get('/hod/api/assigned-data', requireRole('hod'), (req, res) => {
        const userId = req.session.user.id;
        const college = req.session.user.collegeName;

        db.all(`SELECT DISTINCT subject, year, section FROM user_assignments WHERE user_id = ? AND collegeName = ?`, [userId, college], (err, rows) => {
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

        // Fetch problems: created by HOD OR in HOD's department
        const query = `
            SELECT p.*, u.fullName as facultyName 
            FROM problems p
            LEFT JOIN users u ON p.faculty_id = u.id
            WHERE (p.department = ? AND u.collegeName = ?)
               OR (p.status = 'accepted' AND u.collegeName = ? AND LOWER(p.visibility_scope) = 'global')
            ORDER BY p.id DESC
        `;
        db.all(query, [dept, college, college], (err, rows) => {
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
             LEFT JOIN users u ON c.createdBy = u.id
             WHERE (c.status = 'accepted' AND c.collegeName = ?)
                OR (c.department = ? AND c.collegeName = ?)
                OR c.createdBy = ?
             ORDER BY c.id DESC`,
            [college, dept, college, hodId],
            (err, rows) => {
                if (err) return res.status(500).json({ success: false, message: err.message });
                res.json({ success: true, data: rows });
            }
        );
    });

    // Create Contest
    router.post('/hod/api/create-contest', requireRole('hod'), (req, res) => {
        const { title, date, duration, deadline, description, rulesAndDescription, eligibility, problems } = req.body;
        const createdBy = req.session.user.id;
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        if (!title || !date || !duration || !deadline) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const query = `
            INSERT INTO contests (
                title, date, duration, deadline, description, rulesAndDescription, 
                eligibility, problems, department, createdBy, status, isVerified, createdAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', 1, CURRENT_TIMESTAMP)
        `;
        const params = [
            title, date, duration, deadline, description, rulesAndDescription, 
            eligibility, problems || '[]', dept, createdBy
        ];

        db.run(query, params, function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, id: this.lastID, message: 'Contest created successfully' });
        });
    });

    // Update Contest
    router.post('/hod/api/update-contest', requireRole('hod'), (req, res) => {
        const { id, title, date, duration, deadline, description, rulesAndDescription, eligibility, problems } = req.body;
        const dept = req.session.user.department;

        if (!id) return res.status(400).json({ success: false, message: 'Missing contest ID' });

        const query = `
            UPDATE contests SET 
                title = ?, date = ?, duration = ?, deadline = ?, description = ?, 
                rulesAndDescription = ?, eligibility = ?, problems = ?
            WHERE id = ? AND department = ?
        `;
        const params = [
            title, date, duration, deadline, description, rulesAndDescription, 
            eligibility, problems || '[]', id, dept
        ];

        db.run(query, params, function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Contest updated successfully' });
        });
    });

    // Delete Contest
    router.post('/hod/api/delete-contest', requireRole('hod'), (req, res) => {
        const { id } = req.body;
        const dept = req.session.user.department;
        db.run(`DELETE FROM contests WHERE id = ? AND department = ?`, [id, dept], function(err) {
            if (err) return res.status(500).json({ success: false, message: err.message });
            res.json({ success: true, message: 'Contest deleted successfully' });
        });
    });

    // Delete Faculty (from HOD)
    router.post('/hod/api/delete-faculty', requireRole('hod'), (req, res) => {
        const { id } = req.body;
        const dept = req.session.user.department;
        const college = req.session.user.collegeName;

        db.serialize(() => {
            db.run('DELETE FROM user_assignments WHERE user_id = ? AND collegeName = ?', [id, college]);
            db.run('DELETE FROM users WHERE id = ? AND department = ? AND collegeName = ? AND (is_hod = 0 OR is_hod IS NULL)', [id, dept, college], function(err) {
                if (err) return res.status(500).json({ success: false, message: err.message });
                if (this.changes === 0) return res.status(404).json({ success: false, message: 'Faculty not found or not in your department' });
                res.json({ success: true, message: 'Faculty removed successfully' });
            });
        });
    });

    return router;
};
