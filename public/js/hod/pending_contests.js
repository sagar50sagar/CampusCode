// Sample Contest Data with time and section info for conflict detection
const sampleContests = [
    { id: 1, name: "Weekly Algorithm Challenge", type: "competition", faculty: "Dr. Smith", subject: "DSA", section: "A", duration: "3 hours", startDate: "2026-02-01", startTime: "10:00", endTime: "13:00", status: "pending", participants: 45, maxParticipants: 100 },
    { id: 2, name: "SQL Mastery Test", type: "assessment", faculty: "Prof. Brown", subject: "DBMS", section: "B", duration: "2 hours", startDate: "2026-01-28", startTime: "14:00", endTime: "16:00", status: "accepted", participants: 32, maxParticipants: 50 },
    { id: 3, name: "OS Fundamentals Quiz", type: "practice", faculty: "Dr. Miller", subject: "OS", section: "A", duration: "1 hour", startDate: "2026-02-05", startTime: "11:00", endTime: "12:00", status: "pending", participants: 28, maxParticipants: 75 },
    { id: 4, name: "Network Programming Contest", type: "competition", faculty: "Prof. White", subject: "CN", section: "C", duration: "4 hours", startDate: "2026-02-10", startTime: "09:00", endTime: "13:00", status: "accepted", participants: 52, maxParticipants: 80 },
    { id: 5, name: "Data Structures Sprint", type: "practice", faculty: "Dr. Clark", subject: "DSA", section: "B", duration: "2 hours", startDate: "2026-01-30", startTime: "10:00", endTime: "12:00", status: "active", participants: 67, maxParticipants: 100 },
    { id: 6, name: "OOPS Concepts Test", type: "assessment", faculty: "Dr. Lee", subject: "OOPS", section: "A", duration: "1.5 hours", startDate: "2026-02-03", startTime: "15:00", endTime: "16:30", status: "pending", participants: 38, maxParticipants: 60 },
    { id: 7, name: "MongoDB Challenge", type: "competition", faculty: "Prof. Brown", subject: "DBMS", section: "A", duration: "3 hours", startDate: "2026-02-08", startTime: "10:00", endTime: "13:00", status: "accepted", participants: 41, maxParticipants: 70 },
    { id: 8, name: " Advanced Algorithms", type: "practice", faculty: "Dr. Smith", subject: "DSA", section: "A", duration: "2.5 hours", startDate: "2026-02-12", startTime: "14:00", endTime: "16:30", status: "pending", participants: 55, maxParticipants: 90 },
    // CONFLICT EXAMPLE: Same subject (DSA), Same section (A), Same time (10:00-13:00), Same date (2026-02-01)
    { id: 9, name: "DSA Speed Challenge", type: "competition", faculty: "Dr. Davis", subject: "DSA", section: "A", duration: "3 hours", startDate: "2026-02-01", startTime: "10:00", endTime: "13:00", status: "pending", participants: 42, maxParticipants: 80 },
];

let currentTab = 'all';
let currentPage = 1;
const itemsPerPage = 10;

// ============================================
// CONFLICT DETECTION SYSTEM
// ============================================
// Detects scheduling conflicts between contests:
// - Same subject (e.g., both "DSA")
// - Same section (e.g., both "A")
// - Same date 
// - Overlapping time slots
// Only pending contests are checked (approved/rejected don't matter)

/**
 * Parse time string (HH:MM) to minutes since midnight
 * @param {string} timeStr - Time in format "HH:MM"
 * @returns {number} Minutes since midnight
 */
function parseTime(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

/**
 * Detect all conflicts for a specific contest
 * @param {number} contestId - ID of the contest to check
 * @returns {Array} Array of conflict objects with details
 */
function detectConflicts(contestId) {
    const contest = sampleContests.find(c => c.id === contestId);
    if (!contest) return [];

    // Only check conflicts if this contest is pending
    if (contest.status !== 'pending') return [];

    const conflicts = [];

    sampleContests.forEach(other => {
        if (other.id === contestId) return; // Skip self

        // Only check conflicts with OTHER PENDING contests
        if (other.status !== 'pending') return;

        // Check if same subject, section AND date
        if (contest.subject === other.subject &&
            contest.section === other.section &&
            contest.startDate === other.startDate) {

            // Check time overlap
            const start1 = parseTime(contest.startTime);
            const end1 = parseTime(contest.endTime);
            const start2 = parseTime(other.startTime);
            const end2 = parseTime(other.endTime);

            // Time overlap logic: (start1 < end2) AND (end1 > start2)
            if (start1 < end2 && end1 > start2) {
                conflicts.push({
                    contest: other,
                    type: 'time_overlap',
                    message: `Conflicts with "${other.name}" (${other.startTime}-${other.endTime})`
                });
            }
        }
    });

    return conflicts;
}

/**
 * Check if a contest has any conflicts
 * @param {number} contestId - ID of the contest
 * @returns {boolean} True if conflicts exist
 */
function hasConflict(contestId) {
    return detectConflicts(contestId).length > 0;
}

/**
 * Get all pending contests that have conflicts
 * Used for the \"Conflicts\" tab filtering
 * @returns {Array} Array of pending contests with conflicts
 */
function getAllConflictingContests() {
    // Only show pending contests that have conflicts
    return sampleContests.filter(c => c.status === 'pending' && hasConflict(c.id));
}

// Theme Toggle
const themeToggleBtn = document.getElementById('themeToggleBtn');
const html = document.documentElement;

function applyTheme(theme) {
    if (theme === 'dark') {
        html.classList.add('dark');
        themeToggleBtn.querySelector('i').classList.replace('fa-moon', 'fa-sun');
    } else {
        html.classList.remove('dark');
        themeToggleBtn.querySelector('i').classList.replace('fa-sun', 'fa-moon');
    }
    localStorage.theme = theme;
}

themeToggleBtn.addEventListener('click', () => {
    applyTheme(html.classList.contains('dark') ? 'light' : 'dark');
});

const savedTheme = localStorage.theme || 'light';
applyTheme(savedTheme);

// Sidebar Toggle
const sidebar = document.getElementById('mainSidebar');
const sidebarToggleBtn = document.getElementById('sidebarToggleBtn');
const toggleIcon = sidebarToggleBtn.querySelector('i');
const sidebarLogoText = document.getElementById('sidebarLogoText');
const headerLogoText = document.getElementById('headerLogoText');

sidebarToggleBtn.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    if (sidebar.classList.contains('collapsed')) {
        sidebar.classList.replace('w-64', 'w-20');
        toggleIcon.style.transform = 'rotate(180deg)';
        sidebarLogoText.style.opacity = '0';
        headerLogoText.classList.remove('hidden');
        setTimeout(() => headerLogoText.classList.remove('opacity-0', '-translate-x-2'), 50);
    } else {
        sidebar.classList.replace('w-20', 'w-64');
        toggleIcon.style.transform = 'rotate(0deg)';
        sidebarLogoText.style.opacity = '1';
        headerLogoText.classList.add('opacity-0', '-translate-x-2');
        setTimeout(() => headerLogoText.classList.add('hidden'), 300);
    }
});

// Tab Switching
const tabs = document.querySelectorAll('.approval-tab');
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => {
            t.classList.remove('active', 'text-primary-600', 'dark:text-primary-400', 'border-primary-500');
            t.classList.add('text-gray-500', 'dark:text-gray-400');
        });
        tab.classList.add('active', 'text-primary-600', 'dark:text-primary-400', 'border-primary-500');
        tab.classList.remove('text-gray-500', 'dark:text-gray-400');
        currentTab = tab.dataset.tab;
        renderTable();
    });
});

// Render Table
function renderTable() {
    const tbody = document.getElementById('contestsTableBody');
    let filteredData = [...sampleContests];

    // Tab filtering
    if (currentTab === 'approved') filteredData = filteredData.filter(c => c.status === 'approved');
    else if (currentTab === 'rejected') filteredData = filteredData.filter(c => c.status === 'rejected');
    else if (currentTab === 'active') filteredData = filteredData.filter(c => c.status === 'active');
    else if (currentTab === 'conflicts') filteredData = getAllConflictingContests();

    document.getElementById('displayCount').textContent = filteredData.length;

    // Update conflict stats
    const conflictingCount = getAllConflictingContests().length;
    document.getElementById('statConflicts').textContent = conflictingCount;

    tbody.innerHTML = filteredData.map(c => {
        const typeColors = {
            'practice': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
            'assessment': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
            'competition': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
        };

        const statusColors = {
            'pending': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
            'approved': 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
            'rejected': 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
            'active': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
        };

        const conflicts = detectConflicts(c.id);
        const hasConflicts = conflicts.length > 0;

        return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${hasConflicts ? 'bg-red-50/50 dark:bg-red-900/10' : ''}" data-id="${c.id}">
                <td class="px-4 py-3">
                    <input type="checkbox" class="row-checkbox rounded border-gray-300 text-primary-600">
                </td>
                <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                        <div class="text-sm font-medium text-gray-900 dark:text-white">${c.name}</div>
                        ${hasConflicts ? '<span class="conflict-badge px-2 py-0.5 text-xs font-bold rounded-full bg-red-500 text-white">⚠ CONFLICT</span>' : ''}
                    </div>
                </td>
                <td class="px-4 py-3">
                    <span class="px-2 py-1 text-xs font-medium rounded-full ${typeColors[c.type]}">${c.type.charAt(0).toUpperCase() + c.type.slice(1)}</span>
                </td>
                <td class="px-4 py-3">
                    <span class="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300">Section ${c.section}</span>
                </td>
                <td class="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">${c.subject}</td>
                <td class="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">${c.startTime} - ${c.endTime}</td>
                <td class="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">${new Date(c.startDate).toLocaleDateString()}</td>
                <td class="px-4 py-3">
                    ${c.status === 'pending' ? `
                        <select class="status-dropdown px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" data-id="${c.id}">
                            <option value="pending" selected>Pending</option>
                            <option value="approve">Approve</option>
                            <option value="reject">Reject</option>
                        </select>
                    ` : `
                        <span class="px-2 py-1 text-xs font-medium rounded-full ${statusColors[c.status]}">${c.status.charAt(0).toUpperCase() + c.status.slice(1)}</span>
                    `}
                </td>
                <td class="px-4 py-3 text-center">
                    <button class="btn-view-details text-primary-600 hover:text-primary-800 transition-colors" data-id="${c.id}">
                        <i class="fas fa-eye"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // Attach event listeners
    document.querySelectorAll('.status-dropdown').forEach(dropdown => {
        dropdown.addEventListener('change', handleStatusChange);
    });

    document.querySelectorAll('.btn-view-details').forEach(btn => {
        btn.addEventListener('click', () => showContestDetails(btn.dataset.id));
    });
}

async function handleStatusChange(e) {
    const contestId = parseInt(e.target.dataset.id);
    const newStatus = e.target.value;

    // Check for conflicts before approving
    if (newStatus === 'approve') {
        const conflicts = detectConflicts(contestId);
        let message = 'Are you sure you want to approve this contest?';

        if (conflicts.length > 0) {
            message += `\n\n⚠️ WARNING: This contest has ${conflicts.length} conflict(s):\n`;
            conflicts.forEach(c => {
                message += `\n• ${c.contest.name} (Section ${c.contest.section}, ${c.contest.startTime}-${c.contest.endTime})`;
            });
            message += '\n\nApproving may cause scheduling conflicts for students in Section ' + sampleContests.find(x => x.id === contestId).section;
        }

        const confirmed = await showConfirm(message, 'Approve Contest', conflicts.length > 0 ? 'warning' : 'info');
        if (confirmed) {
            const contest = sampleContests.find(c => c.id === contestId);
            contest.status = 'approved';
            renderTable();
        } else {
            e.target.value = 'pending'; // Reset dropdown
        }
    } else if (newStatus === 'reject') {
        const confirmed = await showConfirm('Are you sure you want to reject this contest?', 'Reject Contest', 'danger');
        if (confirmed) {
            const contest = sampleContests.find(c => c.id === contestId);
            contest.status = 'rejected';
            renderTable();
        } else {
            e.target.value = 'pending'; // Reset dropdown
        }
    }
}

// Show Contest Details with complete description
function showContestDetails(id) {
    const contest = sampleContests.find(c => c.id === parseInt(id));
    const modal = document.getElementById('contestDetailModal');
    const content = document.getElementById('contestDetailContent');

    const conflicts = detectConflicts(contest.id);
    const hasConflicts = conflicts.length > 0;

    // Generate complete contest description
    let description = '';
    let rules = '';
    let eligibility = '';
    let scoring = '';

    if (contest.name === "Weekly Algorithm Challenge") {
        description = `Join us for an exciting algorithmic problem-solving competition designed to test your coding skills and algorithmic thinking. This contest features a curated set of challenging problems ranging from basic data structures to advanced algorithms.

Participants will solve problems in a timed environment, competing against peers to achieve the highest score. This is a great opportunity to improve your problem-solving skills, learn new algorithmic techniques, and showcase your coding prowess.`;

        rules = `<ul class="list-disc ml-6 space-y-2 text-sm">
    <li>All submissions must be your own original work. Plagiarism will result in disqualification.</li>
    <li>You may use any programming language from the approved list: C++, Java, Python, JavaScript</li>
    <li>Internet access is allowed for documentation reference only. Communication with other participants is strictly prohibited.</li>
    <li>Each problem has a time limit of 1-2 seconds and memory limit of 256MB</li>
    <li>Partial credit may be awarded for solutions that pass some test cases</li>
    <li>The contest will start promptly at the scheduled time. Late entries will not be accepted.</li>
    <li>Your final ranking is determined by: (1) Number of problems solved (2) Total time taken (3) Penalty for wrong submissions</li>
</ul>`;

        eligibility = `<ul class="list-disc ml-6 space-y-1 text-sm">
    <li>All students currently enrolled in Section ${contest.section}</li>
    <li>Students who have completed Introduction to Programming</li>
    <li>Basic knowledge of data structures and algorithms required</li>
    <li>No prior competitive programming experience necessary</li>
</ul>`;

        scoring = `<div class="space-y-3 text-sm">
    <div class="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg">
        <p class="font-semibold mb-1">Problem Points:</p>
        <ul class="list-disc ml-6 space-y-1">
            <li>Easy Problems: 100 points each</li>
            <li>Medium Problems: 200 points each</li>
            <li>Hard Problems: 300 points each</li>
        </ul>
    </div>
    <div class="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg">
        <p class="font-semibold mb-1">Time Penalty:</p>
        <p>+20 minutes for each wrong submission before the accepted solution</p>
    </div>
    <div class="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-lg">
        <p class="font-semibold mb-1">Tie Breaker:</p>
        <p>In case of a tie, the participant who reached their score earlier wins</p>
    </div>
</div>`;
    } else {
        // Generic template for other contests
        description = `This ${contest.type} contest is designed to evaluate students' understanding and proficiency in ${contest.subject}. Participants will engage with carefully crafted problems that test both theoretical knowledge and practical application skills.

The contest provides a structured environment for students to demonstrate their capabilities, compete with peers, and gain valuable experience in timed problem-solving scenarios.`;

        rules = `<ul class="list-disc ml-6 space-y-2 text-sm">
    <li>Follow all academic integrity policies. No collaboration or communication with other participants during the contest.</li>
    <li>Use only approved resources and tools as specified in the contest guidelines.</li>
    <li>Submit solutions within the time limit for each problem.</li>
    <li>Late submissions will not be accepted after the contest end time.</li>
    <li>Rankings are based on total score and time taken.</li>
</ul>`;

        eligibility = `<ul class="list-disc ml-6 space-y-1 text-sm">
    <li>Students enrolled in Section ${contest.section}</li>
    <li>Prerequisite courses completed as per curriculum</li>
    <li>Regular attendance in ${contest.subject} lectures</li>
</ul>`;

        scoring = `<div class="space-y-2 text-sm">
    <p>Points are awarded based on the correctness and efficiency of solutions. Partial credit may be given for incomplete or suboptimal solutions.</p>
    <p class="font-semibold mt-2">Total Contest Points: ${contest.type === 'competition' ? '500' : contest.type === 'assessment' ? '300' : '200'}</p>
</div>`;
    }

    content.innerHTML = `
        <div class="space-y-6">
            ${hasConflicts ? `
                <div class="bg-red-50 dark:bg-red-900/20 border-2 border-red-500 dark:border-red-700 rounded-xl p-4">
                    <div class="flex items-start gap-3">
                        <i class="fas fa-exclamation-triangle text-red-500 text-2xl mt-1 conflict-badge"></i>
                        <div class="flex-1">
                            <h3 class="text-lg font-bold text-red-900 dark:text-red-200 mb-2">⚠️ SCHEDULING CONFLICT DETECTED</h3>
                            <p class="text-sm text-red-800 dark:text-red-300 mb-3">
                                This contest conflicts with ${conflicts.length} other contest(s) for the same subject, section, and time slot:
                            </p>
                            <div class="space-y-2">
                                ${conflicts.map(c => `
                                    <div class="bg-white dark:bg-gray-800 p-3 rounded-lg border border-red-300 dark:border-red-700">
                                        <p class="font-semibold text-sm text-gray-900 dark:text-white">${c.contest.name}</p>
                                        <div class="grid grid-cols-3 gap-2 mt-2 text-xs text-gray-600 dark:text-gray-400">
                                            <div><span class="font-medium">Subject:</span> ${c.contest.subject}</div>
                                            <div><span class="font-medium">Section:</span> ${c.contest.section}</div>
                                            <div><span class="font-medium">Time:</span> ${c.contest.startTime}-${c.contest.endTime}</div>
                                        </div>
                                        <p class="text-xs text-red-600 dark:text-red-400 mt-2">
                                            <i class="fas fa-info-circle"></i> Submitted by ${c.contest.faculty}
                                        </p>
                                    </div>
                                `).join('')}
                            </div>
                            <p class="text-sm text-red-800 dark:text-red-300 mt-3 font-medium">
                                <i class="fas fa-lightbulb"></i> Recommendation: Reject one contest or reschedule to different time slots to avoid student conflicts in Section ${contest.section}.
                            </p>
                        </div>
                    </div>
                </div>
            ` : ''}

            <!-- Metadata Header -->
            <div class="grid grid-cols-4 gap-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                <div>
                    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Contest ID</p>
                    <p class="text-sm font-medium text-gray-900 dark:text-white">#CTX-${2000 + contest.id}</p>
                </div>
                <div>
                    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Type</p>
                    <span class="inline-flex px-3 py-1 text-xs font-semibold rounded-full ${contest.type === 'practice' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
            contest.type === 'assessment' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
                'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
        }">${contest.type.toUpperCase()}</span>
                </div>
                <div>
                    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Subject</p>
                    <p class="text-sm font-medium text-gray-900 dark:text-white">${contest.subject}</p>
                </div>
                <div>
                    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Section</p>
                    <p class="text-sm font-medium text-gray-900 dark:text-white">Section ${contest.section}</p>
                </div>
            </div>

            <!-- Contest Title -->
            <div>
                <h3 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">${contest.name}</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">Organized by <span class="font-semibold">${contest.faculty}</span></p>
            </div>

            <!-- Description -->
            <div class="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg">
                <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <i class="fas fa-info-circle text-primary-500"></i>
                    Contest Description
                </h4>
                <div class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed space-y-2">
                    ${description}
                </div>
            </div>

            <!-- Schedule & Timeline -->
            <div class="grid md:grid-cols-2 gap-4">
                <div class="bg-blue-50 dark:bg-blue-900/10 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                    <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                        <i class="fas fa-calendar-alt text-blue-500"></i>
                        Schedule
                    </h4>
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-gray-600 dark:text-gray-400">Start Date:</span>
                            <span class="font-semibold text-gray-900 dark:text-white">${new Date(contest.startDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600 dark:text-gray-400">Time Slot:</span>
                            <span class="font-semibold text-gray-900 dark:text-white">${contest.startTime} - ${contest.endTime}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600 dark:text-gray-400">Duration:</span>
                            <span class="font-semibold text-gray-900 dark:text-white">${contest.duration}</span>
                        </div>
                    </div>
                </div>

                <div class="bg-green-50 dark:bg-green-900/10 p-4 rounded-lg border border-green-200 dark:border-green-800">
                    <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                        <i class="fas fa-users text-green-500"></i>
                        Participation
                    </h4>
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-gray-600 dark:text-gray-400">Registered:</span>
                            <span class="font-semibold text-gray-900 dark:text-white">${contest.participants} students</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600 dark:text-gray-400">Capacity:</span>
                            <span class="font-semibold text-gray-900 dark:text-white">${contest.maxParticipants} max</span>
                        </div>
                        <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mt-2">
                            <div class="bg-green-500 h-2 rounded-full" style="width: ${(contest.participants / contest.maxParticipants * 100)}%"></div>
                        </div>
                        <p class="text-xs text-gray-500 dark:text-gray-400 text-center">${Math.round(contest.participants / contest.maxParticipants * 100)}% filled</p>
                    </div>
                </div>
            </div>

            <!-- Eligibility & Rules -->
            <div>
                <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <i class="fas fa-user-check text-primary-500"></i>
                    Eligibility Criteria
                </h4>
                <div class="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg">
                    ${eligibility}
                </div>
            </div>

            <!-- Contest Rules -->
            <div class="bg-orange-50 dark:bg-orange-900/10 p-4 rounded-lg border border-orange-200 dark:border-orange-800">
                <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <i class="fas fa-gavel text-orange-500"></i>
                    Contest Rules
                </h4>
                ${rules}
            </div>

            <!-- Scoring System -->
            <div class="bg-purple-50 dark:bg-purple-900/10 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
                <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <i class="fas fa-trophy text-purple-500"></i>
                    Scoring & Ranking
                </h4>
                ${scoring}
            </div>

            <!-- Prizes & Recognition -->
            <div class="bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-900/10 dark:to-orange-900/10 p-4 rounded-lg border border-yellow-300 dark:border-yellow-700">
                <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <i class="fas fa-medal text-yellow-500"></i>
                    Prizes & Recognition
                </h4>
                <div class="grid md:grid-cols-3 gap-3 text-sm">
                    <div class="bg-white dark:bg-gray-800 p-3 rounded-lg text-center border border-yellow-300 dark:border-yellow-700">
                        <div class="text-3xl mb-2">🥇</div>
                        <p class="font-bold text-gray-900 dark:text-white">1st Place</p>
                        <p class="text-xs text-gray-600 dark:text-gray-400 mt-1">Certificate + Bonus Points</p>
                    </div>
                    <div class="bg-white dark:bg-gray-800 p-3 rounded-lg text-center border border-gray-300 dark:border-gray-600">
                        <div class="text-3xl mb-2">🥈</div>
                        <p class="font-bold text-gray-900 dark:text-white">2nd Place</p>
                        <p class="text-xs text-gray-600 dark:text-gray-400 mt-1">Certificate</p>
                    </div>
                    <div class="bg-white dark:bg-gray-800 p-3 rounded-lg text-center border border-orange-300 dark:border-orange-600">
                        <div class="text-3xl mb-2">🥉</div>
                        <p class="font-bold text-gray-900 dark:text-white">3rd Place</p>
                        <p class="text-xs text-gray-400 mt-1">Certificate</p>
                    </div>
                </div>
            </div>

            <!-- HOD Comments -->
            <div class="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg">
                <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <i class="fas fa-comments text-primary-500"></i>
                    HOD Comments
                </h4>
                <textarea 
                    class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 resize-none" 
                    rows="3" 
                    placeholder="Add your comments or feedback about this contest..."></textarea>
            </div>

            <!-- Action Buttons -->
            <div class="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                ${contest.status === 'pending' ? `
                    <button onclick="handleApproveFromModal(${contest.id})" class="flex-1 px-4 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-semibold transition-colors shadow-md hover:shadow-lg flex items-center justify-center gap-2">
                        <i class="fas fa-check-circle"></i>
                        Approve Contest
                    </button>
                    <button onclick="handleRejectFromModal(${contest.id})" class="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-semibold transition-colors shadow-md hover:shadow-lg flex items-center justify-center gap-2">
                        <i class="fas fa-times-circle"></i>
                        Reject Contest
                    </button>
                ` : `
                    <div class="flex-1 px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg text-center">
                        <span class="text-sm font-semibold text-gray-600 dark:text-gray-400">
                            Status: <span class="${contest.status === 'approved' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">${contest.status.toUpperCase()}</span>
                        </span>
                    </div>
                `}
                <button onclick="document.getElementById('contestDetailModal').classList.add('hidden')" class="px-6 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm font-semibold transition-colors">
                    Close
                </button>
            </div>
        </div>
    `;

    modal.classList.remove('hidden');
}

// Handle approve from modal
async function handleApproveFromModal(id) {
    const conflicts = detectConflicts(id);
    let message = 'Are you sure you want to approve this contest?';

    if (conflicts.length > 0) {
        message += `\n\n⚠️ WARNING: This contest has ${conflicts.length} conflict(s). Approving may cause scheduling conflicts for students.`;
    }

    const confirmed = await showConfirm(message, 'Approve Contest', conflicts.length > 0 ? 'warning' : 'info');
    if (confirmed) {
        const contest = sampleContests.find(c => c.id === id);
        contest.status = 'approved';
        document.getElementById('contestDetailModal').classList.add('hidden');
        renderTable();
    }
}

// Handle reject from modal
async function handleRejectFromModal(id) {
    const confirmed = await showConfirm('Are you sure you want to reject this contest?', 'Reject Contest', 'danger');
    if (confirmed) {
        const contest = sampleContests.find(c => c.id === id);
        contest.status = 'rejected';
        document.getElementById('contestDetailModal').classList.add('hidden');
        renderTable();
    }
}

document.getElementById('closeContestModal').addEventListener('click', () => {
    document.getElementById('contestDetailModal').classList.add('hidden');
});

// Filters
document.getElementById('btnApplyFilters').addEventListener('click', renderTable);
document.getElementById('btnResetFilters').addEventListener('click', () => {
    document.getElementById('filterSubject').value = '';
    document.getElementById('filterType').value = '';
    document.getElementById('filterDateFrom').value = '';
    document.getElementById('filterDateTo').value = '';
    document.getElementById('filterApprovedBy').value = '';
    renderTable();
});

// Profile & Notification
const notifBtn = document.getElementById('notificationBtn');
const notifDropdown = document.getElementById('notificationDropdown');
const profileBtn = document.getElementById('headerProfileBtn');
const profileOverlay = document.getElementById('profileOverlay');
const closeProfileBtn = document.getElementById('closeProfileOverlay');

notifBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    notifDropdown.classList.toggle('hidden');
});

profileBtn.addEventListener('click', () => profileOverlay.classList.remove('hidden'));
closeProfileBtn.addEventListener('click', () => profileOverlay.classList.add('hidden'));

document.addEventListener('click', (e) => {
    if (!notifDropdown.contains(e.target) && !notifBtn.contains(e.target)) {
        notifDropdown.classList.add('hidden');
    }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
    window.location.href = '/auth/logout';
});

// Initialize
renderTable();
