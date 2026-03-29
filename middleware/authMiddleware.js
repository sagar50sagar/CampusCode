// middleware/authMiddleware.js
const db = require('../database');

/**
 * Middleware: checkScope
 * Role: Senior Backend Engineer
 * Purpose: Determines the data visibility scope for a user based on their hierarchy.
 * Results are attached to req.userScope and res.locals.dropdownData for use in routes and views.
 */
async function checkScope(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const { id, role, collegeName, department } = req.session.user;
    const userRole = role.toLowerCase();

    // Default structure for dropdown population
    const dropdownData = {
        colleges: [],
        departments: [],
        subjects: [],
        years: [],
        sections: []
    };

    try {
        // 1. SUPERADMIN: Global visibility
        if (userRole === 'superadmin') {
            req.userScope = { type: 'global' };
            
            const [colleges, departments, allSubjects, allSections] = await Promise.all([
                new Promise(resolve => db.all(`SELECT name FROM colleges`, (err, rows) => resolve(rows || []))),
                new Promise(resolve => db.all(`SELECT DISTINCT department FROM users WHERE department != ''`, (err, rows) => resolve(rows || []))),
                new Promise(resolve => db.all(`SELECT DISTINCT name FROM subjects`, (err, rows) => resolve(rows || []))),
                new Promise(resolve => db.all(`SELECT DISTINCT name FROM sections`, (err, rows) => resolve(rows || [])))
            ]);

            dropdownData.colleges = colleges.map(c => c.name);
            dropdownData.departments = departments.map(d => d.department);
            dropdownData.subjects = allSubjects.map(s => s.name);
            dropdownData.years = ['1st Year', '2nd Year', '3rd Year', '4th Year']; // Standard academic years
            dropdownData.sections = allSections.map(s => s.name);
            
            res.locals.dropdownData = dropdownData;
            return next();
        }

        // 2. ADMIN: College-wide visibility
        if (userRole === 'admin') {
            req.userScope = { type: 'college', collegeName };
            
            const [departments, collSubjects, collSections] = await Promise.all([
                new Promise(resolve => db.all(`SELECT DISTINCT department FROM users WHERE collegeName = ? AND department != ''`, [collegeName], (err, rows) => resolve(rows || []))),
                new Promise(resolve => db.all(`SELECT DISTINCT name FROM subjects WHERE collegeName = ?`, [collegeName], (err, rows) => resolve(rows || []))),
                new Promise(resolve => db.all(`SELECT DISTINCT name FROM sections WHERE collegeName = ?`, [collegeName], (err, rows) => resolve(rows || [])))
            ]);

            dropdownData.colleges = [collegeName];
            dropdownData.departments = departments.map(d => d.department);
            dropdownData.subjects = collSubjects.length ? collSubjects.map(s => s.name) : ["Data Structures", "Algorithms", "Operating Systems", "Computer Networks", "Database Management"];
            dropdownData.years = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
            dropdownData.sections = collSections.length ? collSections.map(s => s.name) : ["Section A", "Section B", "Section C", "Section D"];
            
            res.locals.dropdownData = dropdownData;
            return next();
        }

        // 3. HOD: Departmental visibility
        if (userRole === 'hod') {
            req.userScope = { type: 'department', collegeName, department };

            // HOD sees all subjects/sections mapped to their branch/department
            const [branchSubjects, branchSections, subjectMappings] = await Promise.all([
                new Promise(resolve => {
                    db.all(`SELECT DISTINCT s.name 
                            FROM subjects s 
                            JOIN sections sec ON s.section_id = sec.id 
                            JOIN branches b ON sec.branch_id = b.id 
                            WHERE b.collegeName = ? AND (b.name = ? OR b.abbreviation = ? OR b.code = ?)`, 
                    [collegeName, department, department, department], (err, rows) => resolve(rows || []));
                }),
                new Promise(resolve => {
                    db.all(`SELECT DISTINCT sec.name 
                            FROM sections sec 
                            JOIN branches b ON sec.branch_id = b.id 
                            WHERE b.collegeName = ? AND (b.name = ? OR b.abbreviation = ? OR b.code = ?)`, 
                    [collegeName, department, department, department], (err, rows) => resolve(rows || []));
                }),
                new Promise(resolve => {
                    db.all(`SELECT s.name as subjectName, sec.semester, sec.name as sectionName
                            FROM subjects s
                            JOIN sections sec ON s.section_id = sec.id
                            JOIN branches b ON sec.branch_id = b.id
                            WHERE b.collegeName = ? AND (b.name = ? OR b.abbreviation = ? OR b.code = ?)`,
                    [collegeName, department, department, department], (err, rows) => resolve(rows || []));
                })
            ]);

            dropdownData.colleges = [collegeName];
            dropdownData.departments = [department];
            dropdownData.subjects = branchSubjects.length ? branchSubjects.map(s => s.name) : [];
            dropdownData.years = ['1st Year', '2nd Year', '3rd Year', '4th Year'];
            dropdownData.sections = branchSections.length ? branchSections.map(s => s.name) : [];
            
            // Helper to convert semester to year
            const semToYear = (sem) => {
                if (sem <= 2) return '1st Year';
                if (sem <= 4) return '2nd Year';
                if (sem <= 6) return '3rd Year';
                return '4th Year';
            };

            // Build subject-to-section mapping
            dropdownData.subjectMapping = {};
            subjectMappings.forEach(m => {
                if (!dropdownData.subjectMapping[m.subjectName]) {
                    dropdownData.subjectMapping[m.subjectName] = [];
                }
                dropdownData.subjectMapping[m.subjectName].push({
                    year: semToYear(m.semester),
                    section: m.sectionName
                });
            });

            res.locals.dropdownData = dropdownData;
            return next();
        }

        // 4. FACULTY / HOS: Assignment-based visibility
        if (userRole === 'faculty' || userRole === 'hos') {
            req.userScope = { type: 'specific', collegeName, department, userId: id };

            // Return only their assigned subject, year, and section from user_assignments
            const myAssignments = await new Promise(resolve => {
                db.all(`SELECT subject, year, section FROM user_assignments WHERE user_id = ? AND collegeName = ?`, 
                [id, collegeName], (err, rows) => resolve(rows || []));
            });

            dropdownData.colleges = [collegeName];
            dropdownData.departments = [department];
            
            if (myAssignments.length > 0) {
                dropdownData.subjects = [...new Set(myAssignments.map(a => a.subject))];
                dropdownData.years = [...new Set(myAssignments.map(a => a.year))];
                dropdownData.sections = [...new Set(myAssignments.map(a => a.section))];
            } else {
                dropdownData.subjects = [];
                dropdownData.years = [];
                dropdownData.sections = [];
            }

            req.userScope.assignments = myAssignments;
            res.locals.dropdownData = dropdownData;
            return next();
        }

        // Fallback for roles like 'student' or undefined
        res.locals.dropdownData = dropdownData;
        next();

    } catch (err) {
        console.error("Critical: Scope Middleware Failure:", err.message);
        res.status(500).json({ success: false, error: 'Internal Authorization Error' });
    }
}

module.exports = { checkScope };
