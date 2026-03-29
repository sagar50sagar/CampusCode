// Uses allContests injected from the EJS template via server data
// allContests is a global variable set in pending_contests.ejs

let currentTab = 'all';
let currentPage = 1;
const itemsPerPage = 10;

// ============================================
// CONFLICT DETECTION SYSTEM
// ============================================
function parseTime(timeStr) {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + (minutes || 0);
}

function detectConflicts(contestId) {
    const contest = allContests.find(c => c.id === contestId);
    if (!contest || contest.status !== 'pending') return [];

    const conflicts = [];
    allContests.forEach(other => {
        if (other.id === contestId || other.status !== 'pending') return;

        if (contest.subject === other.subject &&
            contest.section === other.section &&
            contest.start_date === other.start_date) {

            const start1 = parseTime(contest.start_time);
            const end1 = parseTime(contest.end_time);
            const start2 = parseTime(other.start_time);
            const end2 = parseTime(other.end_time);

            if (start1 < end2 && end1 > start2) {
                conflicts.push({
                    contest: other,
                    type: 'time_overlap',
                    message: `Conflicts with "${other.title}" (${other.start_time}-${other.end_time})`
                });
            }
        }
    });
    return conflicts;
}

function hasConflict(contestId) {
    return detectConflicts(contestId).length > 0;
}

function getAllConflictingContests() {
    return allContests.filter(c => c.status === 'pending' && hasConflict(c.id));
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

// API call for approve/reject
async function apiApproveContest(contestId, status, comments) {
    const resp = await fetch('/hos/approve-contest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contestId, status, comments })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    // Update local array
    const c = allContests.find(x => x.id === contestId);
    if (c) c.status = status;
    return data;
}

// Render Table
function renderTable() {
    const tbody = document.getElementById('contestsTableBody');
    let filteredData = [...allContests];

    // Tab filtering
    if (currentTab === 'accepted') filteredData = filteredData.filter(c => c.status === 'accepted');
    else if (currentTab === 'rejected') filteredData = filteredData.filter(c => c.status === 'rejected');
    else if (currentTab === 'active') filteredData = filteredData.filter(c => c.status === 'active');
    else if (currentTab === 'conflicts') filteredData = getAllConflictingContests();

    document.getElementById('displayCount').textContent = filteredData.length;

    // Update conflict stats
    const conflictingCount = getAllConflictingContests().length;
    document.getElementById('statConflicts').textContent = conflictingCount;

    if (filteredData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-gray-500 dark:text-gray-400"><i class="fas fa-inbox text-3xl mb-2 block"></i>No contests found.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredData.map(c => {
        const typeColors = {
            'practice': 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
            'assessment': 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
            'competition': 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
        };

        function getStatusBadge(c) {
            if (c.status === 'accepted') {
                return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">✓ Accepted</span>`;
            }
            if (c.status === 'rejected') {
                return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">✗ Rejected</span>`;
            }
            // Partial approvals
            const hosStr = c.hos_verified
                ? `<span class="block px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-green-100 text-green-700 border border-green-300">✓ HOS Done</span>`
                : `<span class="block px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-yellow-100 text-yellow-700 border border-yellow-300 animate-pulse">⏳ Pending HOS</span>`;
            const hodStr = c.hod_verified
                ? `<span class="block px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-green-100 text-green-700 border border-green-300">✓ HOD Done</span>`
                : `<span class="block px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-yellow-100 text-yellow-700 border border-yellow-300 animate-pulse">⏳ Pending HOD</span>`;
            return `<div class="flex flex-col gap-0.5 items-center">${hosStr}${hodStr}</div>`;
        }

        const conflicts = detectConflicts(c.id);
        const hasConflicts = conflicts.length > 0;
        const contestName = c.title || c.name || 'Untitled';

        return `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${hasConflicts ? 'bg-red-50/50 dark:bg-red-900/10' : ''}" data-id="${c.id}">
                <td class="px-4 py-3">
                    <input type="checkbox" class="row-checkbox rounded border-gray-300 text-primary-600">
                </td>
                <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                        <div class="text-sm font-medium text-gray-900 dark:text-white">${contestName}</div>
                        ${hasConflicts ? '<span class="conflict-badge px-2 py-0.5 text-xs font-bold rounded-full bg-red-500 text-white">⚠ CONFLICT</span>' : ''}
                    </div>
                </td>
                <td class="px-4 py-3">
                    <span class="px-2 py-1 text-xs font-medium rounded-full ${typeColors[c.type] || 'bg-gray-100 text-gray-800'}">${(c.type || 'N/A').charAt(0).toUpperCase() + (c.type || '').slice(1)}</span>
                </td>
                <td class="px-4 py-3">
                    <span class="px-2 py-1 text-xs font-medium rounded-full bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300">${c.section ? 'Section ' + c.section : 'N/A'}</span>
                </td>
                <td class="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">${c.subject || 'N/A'}</td>
                <td class="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">${c.start_time || ''} - ${c.end_time || ''}</td>
                <td class="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">${c.start_date ? new Date(c.start_date).toLocaleDateString() : 'N/A'}</td>
                <td class="px-4 py-3">
                    ${c.status === 'pending' ? `
                        <select class="status-dropdown px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700" data-id="${c.id}">
                            <option value="pending" selected>Pending</option>
                            <option value="approve">Approve</option>
                            <option value="reject">Reject</option>
                        </select>
                        <div class="mt-1">${getStatusBadge(c)}</div>
                    ` : getStatusBadge(c)}
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

    if (newStatus === 'approve') {
        const conflicts = detectConflicts(contestId);
        let message = 'Are you sure you want to approve this contest?';

        if (conflicts.length > 0) {
            message += `\n\n⚠️ WARNING: This contest has ${conflicts.length} conflict(s):\n`;
            conflicts.forEach(c => {
                message += `\n• ${c.contest.title || c.contest.name} (Section ${c.contest.section}, ${c.contest.start_time}-${c.contest.end_time})`;
            });
            const contest = allContests.find(x => x.id === contestId);
            message += '\n\nApproving may cause scheduling conflicts for students in Section ' + (contest ? contest.section : '');
        }

        const confirmed = await showConfirm(message, 'Approve Contest', conflicts.length > 0 ? 'warning' : 'info');
        if (confirmed) {
            try {
                await apiApproveContest(contestId, 'accepted', '');
                showToast('Contest approved successfully.', 'success', 'Approved');
                renderTable();
            } catch (err) { showToast(err.message, 'error', 'Error'); e.target.value = 'pending'; }
        } else { e.target.value = 'pending'; }
    } else if (newStatus === 'reject') {
        const confirmed = await showConfirm('Are you sure you want to reject this contest?', 'Reject Contest', 'danger');
        if (confirmed) {
            try {
                await apiApproveContest(contestId, 'rejected', '');
                showToast('Contest rejected.', 'info', 'Rejected');
                renderTable();
            } catch (err) { showToast(err.message, 'error', 'Error'); e.target.value = 'pending'; }
        } else { e.target.value = 'pending'; }
    }
}

// Show Contest Details
function showContestDetails(id) {
    const contest = allContests.find(c => c.id === parseInt(id));
    if (!contest) return;
    const modal = document.getElementById('contestDetailModal');
    const content = document.getElementById('contestDetailContent');

    const conflicts = detectConflicts(contest.id);
    const hasConflicts = conflicts.length > 0;
    const contestName = contest.title || contest.name || 'Untitled';

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
                                        <p class="font-semibold text-sm text-gray-900 dark:text-white">${c.contest.title || c.contest.name}</p>
                                        <div class="grid grid-cols-3 gap-2 mt-2 text-xs text-gray-600 dark:text-gray-400">
                                            <div><span class="font-medium">Subject:</span> ${c.contest.subject}</div>
                                            <div><span class="font-medium">Section:</span> ${c.contest.section}</div>
                                            <div><span class="font-medium">Time:</span> ${c.contest.start_time}-${c.contest.end_time}</div>
                                        </div>
                                        <p class="text-xs text-red-600 dark:text-red-400 mt-2">
                                            <i class="fas fa-info-circle"></i> Submitted by ${c.contest.faculty || 'N/A'}
                                        </p>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            ` : ''}

            <div class="grid grid-cols-4 gap-4 pb-4 border-b border-gray-200 dark:border-gray-700">
                <div>
                    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Contest ID</p>
                    <p class="text-sm font-medium text-gray-900 dark:text-white">#${contest.id}</p>
                </div>
                <div>
                    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Type</p>
                    <span class="inline-flex px-3 py-1 text-xs font-semibold rounded-full ${contest.type === 'practice' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' :
            contest.type === 'assessment' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400' :
                'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400'
        }">${(contest.type || 'N/A').toUpperCase()}</span>
                </div>
                <div>
                    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Subject</p>
                    <p class="text-sm font-medium text-gray-900 dark:text-white">${contest.subject || 'N/A'}</p>
                </div>
                <div>
                    <p class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase mb-1">Section</p>
                    <p class="text-sm font-medium text-gray-900 dark:text-white">${contest.section ? 'Section ' + contest.section : 'N/A'}</p>
                </div>
            </div>

            <div>
                <h3 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">${contestName}</h3>
                <p class="text-sm text-gray-600 dark:text-gray-400">Organized by <span class="font-semibold">${contest.faculty || 'N/A'}</span></p>
            </div>

            ${contest.description ? `
            <div class="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg">
                <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <i class="fas fa-info-circle text-primary-500"></i> Contest Description
                </h4>
                <div class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line">${contest.description}</div>
            </div>` : ''}

            <div class="grid md:grid-cols-2 gap-4">
                <div class="bg-blue-50 dark:bg-blue-900/10 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                    <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                        <i class="fas fa-calendar-alt text-blue-500"></i> Schedule
                    </h4>
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-gray-600 dark:text-gray-400">Start Date:</span>
                            <span class="font-semibold text-gray-900 dark:text-white">${contest.start_date ? new Date(contest.start_date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600 dark:text-gray-400">Time Slot:</span>
                            <span class="font-semibold text-gray-900 dark:text-white">${contest.start_time || ''} - ${contest.end_time || ''}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600 dark:text-gray-400">Duration:</span>
                            <span class="font-semibold text-gray-900 dark:text-white">${contest.duration || 'N/A'}</span>
                        </div>
                    </div>
                </div>

                <div class="bg-green-50 dark:bg-green-900/10 p-4 rounded-lg border border-green-200 dark:border-green-800">
                    <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                        <i class="fas fa-users text-green-500"></i> Participation
                    </h4>
                    <div class="space-y-2 text-sm">
                        <div class="flex justify-between">
                            <span class="text-gray-600 dark:text-gray-400">Max Participants:</span>
                            <span class="font-semibold text-gray-900 dark:text-white">${contest.max_participants || 'N/A'}</span>
                        </div>
                        <div class="flex justify-between">
                            <span class="text-gray-600 dark:text-gray-400">Status:</span>
                            <span class="font-semibold text-gray-900 dark:text-white capitalize">${contest.status}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="bg-gray-50 dark:bg-gray-700/30 p-4 rounded-lg">
                <h4 class="text-sm font-bold text-gray-900 dark:text-white mb-3 flex items-center gap-2">
                    <i class="fas fa-comments text-primary-500"></i> Add Comment
                </h4>
                <textarea id="modalContestComment"
                    class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500 resize-none"
                    rows="3" placeholder="Add your comments..."></textarea>
            </div>

            <div class="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
                ${contest.status === 'pending' ? `
                    <button onclick="handleApproveFromModal(${contest.id})" class="flex-1 px-4 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-semibold transition-colors shadow-md flex items-center justify-center gap-2">
                        <i class="fas fa-check-circle"></i> Approve Contest
                    </button>
                    <button onclick="handleRejectFromModal(${contest.id})" class="flex-1 px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-semibold transition-colors shadow-md flex items-center justify-center gap-2">
                        <i class="fas fa-times-circle"></i> Reject Contest
                    </button>
                ` : `
                    <div class="flex-1 px-4 py-3 bg-gray-100 dark:bg-gray-700 rounded-lg text-center">
                        <span class="text-sm font-semibold text-gray-600 dark:text-gray-400">
                            Status: <span class="${contest.status === 'accepted' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">${contest.status.toUpperCase()}</span>
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
        message += `\n\n⚠️ WARNING: This contest has ${conflicts.length} conflict(s). Approving may cause scheduling conflicts.`;
    }

    const confirmed = await showConfirm(message, 'Approve Contest', conflicts.length > 0 ? 'warning' : 'info');
    if (confirmed) {
        try {
            const comments = document.getElementById('modalContestComment') ? document.getElementById('modalContestComment').value : '';
            await apiApproveContest(id, 'accepted', comments);
            showToast('Contest approved successfully.', 'success', 'Approved');
            document.getElementById('contestDetailModal').classList.add('hidden');
            renderTable();
        } catch (err) { showToast(err.message, 'error', 'Error'); }
    }
}

// Handle reject from modal
async function handleRejectFromModal(id) {
    const confirmed = await showConfirm('Are you sure you want to reject this contest?', 'Reject Contest', 'danger');
    if (confirmed) {
        try {
            const comments = document.getElementById('modalContestComment') ? document.getElementById('modalContestComment').value : '';
            await apiApproveContest(id, 'rejected', comments);
            showToast('Contest rejected.', 'info', 'Rejected');
            document.getElementById('contestDetailModal').classList.add('hidden');
            renderTable();
        } catch (err) { showToast(err.message, 'error', 'Error'); }
    }
}

document.getElementById('closeContestModal').addEventListener('click', () => {
    document.getElementById('contestDetailModal').classList.add('hidden');
});

// Filters
document.getElementById('btnApplyFilters').addEventListener('click', renderTable);
document.getElementById('btnResetFilters').addEventListener('click', () => {
    document.getElementById('filterSubject').value = '';
    if (document.getElementById('filterType')) document.getElementById('filterType').value = '';
    document.getElementById('filterDateFrom').value = '';
    document.getElementById('filterDateTo').value = '';
    if (document.getElementById('filterApprovedBy')) document.getElementById('filterApprovedBy').value = '';
    renderTable();
});

// Profile & Notification
const notifBtn = document.getElementById('notificationBtn');
const notifDropdown = document.getElementById('notificationDropdown');
const profileBtn = document.getElementById('headerProfileBtn');
const profileOverlay = document.getElementById('profileOverlay');
const closeProfileBtn = document.getElementById('closeProfileOverlay');

notifBtn.addEventListener('click', (e) => { e.stopPropagation(); notifDropdown.classList.toggle('hidden'); });
profileBtn.addEventListener('click', () => profileOverlay.classList.remove('hidden'));
closeProfileBtn.addEventListener('click', () => profileOverlay.classList.add('hidden'));
document.addEventListener('click', (e) => { if (!notifDropdown.contains(e.target) && !notifBtn.contains(e.target)) notifDropdown.classList.add('hidden'); });

// Bulk Approve
const btnBulkApprove = document.getElementById('btnBulkApprove');
if (btnBulkApprove) {
    btnBulkApprove.addEventListener('click', async () => {
        const selected = document.querySelectorAll('.row-checkbox:checked');
        if (selected.length === 0) {
            showToast('Please select at least one contest.', 'warning', 'No Selection');
            return;
        }
        const confirmed = await showConfirm(`Are you sure you want to approve ${selected.length} contest(s)?`, 'Bulk Approve', 'warning');
        if (confirmed) {
            const ids = [];
            selected.forEach(cb => {
                const row = cb.closest('tr');
                if (row && row.dataset.id) ids.push(parseInt(row.dataset.id));
            });
            for (const id of ids) {
                try { await apiApproveContest(id, 'accepted', ''); } catch (e) { /* skip failed */ }
            }
            showToast(`${ids.length} contest(s) approved.`, 'success', 'Bulk Approved');
            renderTable();
        }
    });
}

// Initialize
renderTable();
