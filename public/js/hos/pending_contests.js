// Premium Pending Contests Controller
let currentTab = 'pending';
let currentSearch = '';
let currentSubject = '';

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

// Tab Switching
function switchTab(tab) {
    currentTab = tab;
    ['pending', 'accepted', 'rejected', 'active', 'conflicts'].forEach(t => {
        const el = document.getElementById(`tab-${t}`);
        if (!el) return;
        if (t === tab) {
            el.className = 'px-6 py-5 text-sm font-black active-tab transition-all';
        } else {
            el.className = 'px-6 py-5 text-sm font-bold border-b-2 border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-all';
        }
    });
    renderTable();
}

// Global exposure for onClick handlers
window.switchTab = switchTab;

// API calling
async function apiApproveContest(contestId, status, comments) {
    const resp = await fetch('/hos/approve-contest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contestId, status, comments })
    });
    const data = await resp.json();
    if (!data.success) throw new Error(data.error || 'Failed');
    
    const c = allContests.find(x => x.id === contestId);
    if (c) c.status = status;
    return data;
}

// Render Table
function renderTable() {
    const tbody = document.getElementById('contestsTableBody');
    const noData = document.getElementById('noDataMessage');
    
    let filteredData = [...allContests];

    // Status Tab Filtering
    if (currentTab === 'pending') filteredData = filteredData.filter(c => c.status === 'pending');
    else if (currentTab === 'accepted') filteredData = filteredData.filter(c => c.status === 'accepted' || c.status === 'approved');
    else if (currentTab === 'rejected') filteredData = filteredData.filter(c => c.status === 'rejected');
    else if (currentTab === 'active') filteredData = filteredData.filter(c => c.status === 'accepted' && new Date(c.start_date) <= new Date());
    else if (currentTab === 'conflicts') filteredData = getAllConflictingContests();

    // Subject Filter
    if (currentSubject) {
        filteredData = filteredData.filter(c => c.subject === currentSubject);
    }

    // Search Filter
    if (currentSearch) {
        const s = currentSearch.toLowerCase();
        filteredData = filteredData.filter(c => 
            (c.title || '').toLowerCase().includes(s) || 
            (c.faculty || '').toLowerCase().includes(s) ||
            (c.creatorName || '').toLowerCase().includes(s)
        );
    }

    document.getElementById('displayCount').textContent = `${filteredData.length} item(s) showing`;

    if (filteredData.length === 0) {
        tbody.innerHTML = '';
        noData.classList.remove('hidden');
        return;
    }
    noData.classList.add('hidden');

    tbody.innerHTML = filteredData.map(c => {
        const conflicts = detectConflicts(c.id);
        const hasConflicts = conflicts.length > 0;
        const contestName = c.title || c.name || 'Untitled';
        
        return `
            <tr class="group hover:bg-slate-50 dark:hover:bg-dark-lighter/30 transition-all duration-200 border-b border-slate-50 dark:border-dark-border last:border-0" data-id="${c.id}">
                <td class="px-8 py-5 text-center">
                    <input type="checkbox" class="row-checkbox rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 bg-transparent cursor-pointer">
                </td>
                <td class="px-6 py-5">
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500 shrink-0">
                            <i class="fas fa-trophy"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2 mb-0.5">
                                <span class="text-sm font-bold text-slate-900 dark:text-white leading-tight">${contestName}</span>
                                ${hasConflicts ? '<span class="px-1.5 py-0.5 text-[8px] font-black rounded-lg bg-rose-500 text-white uppercase animate-pulse">Conflict</span>' : ''}
                            </div>
                            <div class="flex items-center gap-3 text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
                                <span>Sec ${c.section || 'All'}</span>
                                <span class="w-1 h-1 rounded-full bg-slate-200 dark:bg-slate-700"></span>
                                <span class="text-blue-500">${c.subject || 'General'}</span>
                            </div>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-5">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-slate-700 dark:text-slate-200">${c.start_date ? new Date(c.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'TBD'}</span>
                        <span class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${c.start_time || 'No Time'}</span>
                    </div>
                </td>
                <td class="px-6 py-5">
                    <span class="text-sm font-medium text-slate-600 dark:text-slate-400">${c.faculty || c.creatorName || 'Faculty'}</span>
                </td>
                <td class="px-6 py-5">
                    ${getStatusBadge(c)}
                </td>
                <td class="px-8 py-5 text-right">
                    <button onclick="showContestDetails(${c.id})" class="p-2 text-slate-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">
                        <i class="fas fa-chevron-right"></i>
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function getStatusBadge(c) {
    if (c.status === 'accepted' || c.status === 'approved') {
        return `<span class="px-3 py-1 text-[10px] font-black rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 uppercase">Approved</span>`;
    }
    if (c.status === 'rejected') {
        return `<span class="px-3 py-1 text-[10px] font-black rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20 uppercase">Rejected</span>`;
    }
    return `<span class="px-3 py-1 text-[10px] font-black rounded-full bg-blue-500/10 text-blue-500 border border-blue-500/20 uppercase animate-pulse">Awaiting</span>`;
}

// Confirmation Proxy
async function showConfirm(title, message, type = 'info') {
    return new Promise((resolve) => {
        const dialog = document.getElementById('confirmDialog');
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = message;
        
        const iconDiv = document.getElementById('confirmIcon');
        if (type === 'danger') {
            iconDiv.className = 'w-20 h-20 bg-rose-50 dark:bg-rose-900/20 text-rose-500 rounded-full flex items-center justify-center mx-auto text-3xl';
            iconDiv.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
        } else if (type === 'warning') {
            iconDiv.className = 'w-20 h-20 bg-amber-50 dark:bg-amber-900/20 text-amber-500 rounded-full flex items-center justify-center mx-auto text-3xl';
            iconDiv.innerHTML = '<i class="fas fa-exclamation-circle"></i>';
        } else {
            iconDiv.className = 'w-20 h-20 bg-blue-50 dark:bg-blue-900/20 text-blue-500 rounded-full flex items-center justify-center mx-auto text-3xl';
            iconDiv.innerHTML = '<i class="fas fa-question-circle"></i>';
        }

        dialog.classList.remove('hidden');
        
        const handleCancel = () => {
            dialog.classList.add('hidden');
            resolve(false);
            cleanup();
        };
        const handleProceed = () => {
            dialog.classList.add('hidden');
            resolve(true);
            cleanup();
        };
        const cleanup = () => {
            document.getElementById('btnConfirmCancel').removeEventListener('click', handleCancel);
            document.getElementById('btnConfirmProceed').removeEventListener('click', handleProceed);
        };

        document.getElementById('btnConfirmCancel').addEventListener('click', handleCancel);
        document.getElementById('btnConfirmProceed').addEventListener('click', handleProceed);
    });
}

// Show Contest Details Modal
function showContestDetails(id) {
    const contest = allContests.find(c => c.id === id);
    if (!contest) return;
    const content = document.getElementById('contestDetailContent');
    const conflicts = detectConflicts(id);

    content.innerHTML = `
        <div class="space-y-10">
            ${conflicts.length > 0 ? `
                <div class="bg-rose-500/5 border border-rose-500/20 rounded-3xl p-6 flex items-start gap-5">
                    <div class="w-12 h-12 rounded-2xl bg-rose-500 flex items-center justify-center text-white shrink-0 shadow-lg shadow-rose-500/20">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <div>
                        <h4 class="text-sm font-black text-rose-500 uppercase tracking-widest mb-1">Scheduling Conflict Alert</h4>
                        <p class="text-sm text-slate-600 dark:text-slate-400 mb-4">This contest overlaps with <b>${conflicts.length}</b> other pending events. Please resolve before approval.</p>
                        <div class="grid md:grid-cols-2 gap-3">
                            ${conflicts.map(con => `
                                <div class="bg-white dark:bg-dark-border p-3 rounded-xl border border-rose-100 dark:border-rose-900/30">
                                    <p class="text-xs font-bold text-slate-900 dark:text-white truncate">${con.contest.title}</p>
                                    <p class="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">${con.contest.start_time} - ${con.contest.end_time}</p>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
            ` : ''}

            <div class="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div class="p-6 rounded-3xl bg-slate-50 dark:bg-dark-sub border border-slate-100 dark:border-dark-border">
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Subject</p>
                    <p class="font-black text-slate-900 dark:text-white">${contest.subject || 'All'}</p>
                </div>
                <div class="p-6 rounded-3xl bg-slate-50 dark:bg-dark-sub border border-slate-100 dark:border-dark-border">
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Target</p>
                    <p class="font-black text-slate-900 dark:text-white">${contest.section ? 'Sec ' + contest.section : 'All Sections'}</p>
                </div>
                <div class="p-6 rounded-3xl bg-slate-50 dark:bg-dark-sub border border-slate-100 dark:border-dark-border">
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Format</p>
                    <p class="font-black text-slate-900 dark:text-white capitalize">${contest.type || 'Standard'}</p>
                </div>
                <div class="p-6 rounded-3xl bg-slate-50 dark:bg-dark-sub border border-slate-100 dark:border-dark-border">
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Classification</p>
                    <p class="font-black text-slate-900 dark:text-white capitalize">${contest.contest_class || 'Standard'}</p>
                </div>
            </div>

            <div class="border-t border-slate-100 dark:border-dark-border pt-10">
                <div class="flex flex-col md:flex-row justify-between gap-6">
                    <div class="space-y-2 max-w-2xl">
                        <h3 class="text-3xl font-black text-slate-900 dark:text-white tracking-tight">${contest.title}</h3>
                        <p class="text-sm font-medium text-slate-500 dark:text-slate-400">${contest.description || 'No description provided.'}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Submission By</p>
                        <p class="text-lg font-black text-blue-600">${contest.faculty || contest.creatorName || 'Faculty'}</p>
                    </div>
                </div>
            </div>

            <div class="grid md:grid-cols-2 gap-10">
                <div class="space-y-4">
                    <h5 class="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <i class="fas fa-clock text-blue-500"></i> temporal window
                    </h5>
                    <div class="p-6 rounded-3xl border border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sub/50 space-y-4 text-sm">
                        <div class="flex justify-between items-center"><span class="text-slate-500">Date</span><span class="font-black">${contest.start_date || 'TBD'}</span></div>
                        <div class="flex justify-between items-center"><span class="text-slate-500">Start</span><span class="font-black">${contest.start_time || 'No Time'}</span></div>
                        <div class="flex justify-between items-center"><span class="text-slate-500">Duration</span><span class="font-black text-blue-600 font-black">${contest.duration || '60'} Mins</span></div>
                    </div>
                </div>
                <div class="space-y-4">
                    <h5 class="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <i class="fas fa-award text-amber-500"></i> Scoping & Credits
                    </h5>
                    <div class="p-6 rounded-3xl border border-slate-100 dark:border-dark-border bg-slate-50/50 dark:bg-dark-sub/50 space-y-4 text-sm">
                        <div class="flex justify-between items-center"><span class="text-slate-500">Visibility</span><span class="font-black uppercase">${contest.visibility_scope || 'College'}</span></div>
                        <div class="flex justify-between items-center"><span class="text-slate-500">Prize</span><span class="font-black text-amber-600 font-black">${contest.prize || 'Standard XP'}</span></div>
                    </div>
                </div>
            </div>

            <div class="pt-10 border-t border-slate-100 dark:border-dark-border space-y-4">
                <label class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Feedback Comment (Mandatory on rejection)</label>
                <textarea id="modalComment" class="w-full px-6 py-5 bg-slate-50 dark:bg-dark-sub border-2 border-transparent focus:border-blue-500 outline-none rounded-3xl text-sm font-medium transition-all" rows="3" placeholder="Add specific notes or feedback for the faculty..."></textarea>
            </div>

            <div class="flex gap-4 pt-6">
                ${contest.status === 'pending' ? `
                    <button onclick="handleAction(${id}, 'approve')" class="flex-[2] py-5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl text-sm font-black transition-all shadow-xl shadow-emerald-500/20 flex items-center justify-center gap-3">
                        <i class="fas fa-check-circle"></i> APPROVE & PUBLISH
                    </button>
                    <button onclick="handleAction(${id}, 'reject')" class="flex-1 py-5 bg-rose-600/10 hover:bg-rose-600 text-rose-600 hover:text-white border border-rose-600/20 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-3">
                        <i class="fas fa-times-circle"></i> REJECT
                    </button>
                ` : `
                    <div class="flex-1 py-5 bg-slate-100 dark:bg-dark-sub rounded-2xl text-center text-xs font-black text-slate-500 uppercase tracking-widest">
                        Final Action Recorded: <span class="${contest.status === 'accepted' || contest.status === 'approved' ? 'text-emerald-500' : 'text-rose-500'}">${contest.status.toUpperCase()}</span>
                    </div>
                `}
            </div>
        </div>
    `;
    document.getElementById('contestDetailModal').classList.remove('hidden');
}

// Global modal exposure
window.showContestDetails = showContestDetails;

async function handleAction(id, action) {
    const comments = document.getElementById('modalComment').value.trim();
    if (action === 'reject' && !comments) {
        alert('Please provide a reason for rejection in the comments.');
        return;
    }

    const title = action === 'approve' ? 'Approve Contest?' : 'Reject Contest?';
    const message = action === 'approve' ? 'This contest will be published and students will be able to register.' : 'This contest proposal will be sent back to the faculty with your feedback.';
    
    const proceed = await showConfirm(title, message, action === 'approve' ? 'info' : 'danger');
    if (proceed) {
        try {
            const status = action === 'approve' ? 'accepted' : 'rejected';
            await apiApproveContest(id, status, comments);
            document.getElementById('contestDetailModal').classList.add('hidden');
            renderTable();
            updateStats();
        } catch (e) {
            alert(e.message);
        }
    }
}

// Global exposure
window.handleAction = handleAction;

function updateStats() {
    document.getElementById('statPending').textContent = allContests.filter(c => c.status === 'pending').length;
    document.getElementById('statApproved').textContent = allContests.filter(c => c.status === 'accepted' || c.status === 'approved').length;
    document.getElementById('statRejected').textContent = allContests.filter(c => c.status === 'rejected').length;
    document.getElementById('statConflicts').textContent = getAllConflictingContests().length;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('closeContestModal').addEventListener('click', () => {
        document.getElementById('contestDetailModal').classList.add('hidden');
    });

    document.getElementById('searchInput').addEventListener('input', (e) => {
        currentSearch = e.target.value;
        renderTable();
    });

    document.getElementById('filterSubject').addEventListener('change', (e) => {
        currentSubject = e.target.value;
        renderTable();
    });

    document.getElementById('btnResetFilters').addEventListener('click', () => {
        document.getElementById('searchInput').value = '';
        document.getElementById('filterSubject').value = '';
        currentSearch = '';
        currentSubject = '';
        renderTable();
    });

    // Bulk Approve
    const selectAll = document.getElementById('selectAll');
    if (selectAll) {
        selectAll.addEventListener('change', (e) => {
            document.querySelectorAll('.row-checkbox').forEach(cb => cb.checked = e.target.checked);
            updateBulkVisibility();
        });
    }

    document.getElementById('contestsTableBody').addEventListener('change', (e) => {
        if (e.target.classList.contains('row-checkbox')) {
            updateBulkVisibility();
        }
    });

    function updateBulkVisibility() {
        const checked = document.querySelectorAll('.row-checkbox:checked').length;
        const btn = document.getElementById('btnBulkApprove');
        if (checked > 0 && currentTab === 'pending') btn.classList.remove('hidden');
        else btn.classList.add('hidden');
    }

    document.getElementById('btnBulkApprove').addEventListener('click', async () => {
        const checked = document.querySelectorAll('.row-checkbox:checked');
        const ids = Array.from(checked).map(cb => parseInt(cb.closest('tr').dataset.id));
        
        const proceed = await showConfirm(`Approve ${ids.length} Contests?`, 'Bulk approval will publish all selected contests instantly.', 'warning');
        if (proceed) {
            for (const id of ids) {
                try { await apiApproveContest(id, 'accepted', 'Bulk approved'); } catch(e) {}
            }
            renderTable();
            updateStats();
            updateBulkVisibility();
        }
    });

    // Initial render
    renderTable();
    updateStats();
});
