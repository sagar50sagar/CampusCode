document.addEventListener("DOMContentLoaded", () => {
    // --- SHELL LOGIC (Sidebar, Theme, Profile) ---
    const sidebar = document.getElementById('mainSidebar');
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const toggleIcon = toggleBtn ? toggleBtn.querySelector('i') : null;

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            if (sidebar.classList.contains('collapsed')) {
                sidebar.classList.replace('w-64', 'w-20');
                const sidebarLogoText = document.getElementById('sidebarLogoText');
                if (sidebarLogoText) { sidebarLogoText.style.opacity = '0'; sidebarLogoText.style.width = '0px'; }
            } else {
                sidebar.classList.replace('w-20', 'w-64');
                const sidebarLogoText = document.getElementById('sidebarLogoText');
                if (sidebarLogoText) { sidebarLogoText.style.opacity = '1'; sidebarLogoText.style.width = 'auto'; }
            }
        });
    }

    const themeBtn = document.getElementById('themeToggleBtn');
    const html = document.documentElement;
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            html.classList.toggle('dark');
            localStorage.theme = html.classList.contains('dark') ? 'dark' : 'light';
        });
    }

    const profileOverlay = document.getElementById("profileOverlay");
    document.getElementById("headerProfileBtn")?.addEventListener("click", () => profileOverlay?.classList.remove("hidden"));
    document.getElementById("closeProfileOverlay")?.addEventListener("click", () => profileOverlay?.classList.add("hidden"));

    // --- REPORT DATA FETCHING (Mock for now, similar to HOD but college-wide) ---
    const getFacultyData = () => [
        { id: "FAC-101", name: "Dr. Alice Smith", dept: "CSE", joined: "2018-08-01", status: "Active", rating: 4.9 },
        { id: "FAC-102", name: "Prof. Bob Johnson", dept: "ECE", joined: "2019-01-15", status: "Active", rating: 4.7 }
    ];

    const getStudentData = () => [
        { id: "STU-5001", name: "John Doe", dept: "CSE", year: "3", section: "A", attendance: 95, gpa: 9.2 },
        { id: "STU-5002", name: "Jane Doe", dept: "ME", year: "2", section: "B", attendance: 88, gpa: 8.5 }
    ];

    const getContestData = () => [
        { id: "CON-901", title: "College Hackathon 2024", date: "2024-03-25", participants: 450, winner: "Team Alpha" },
        { id: "CON-902", title: "Monthly DSA Sprint", date: "2024-04-10", participants: 120, winner: "John Doe" }
    ];

    const getProblemData = () => [
        { id: "P-801", title: "Binary Search Implementation", difficulty: "Medium", tags: "Algorithms", solved: 340 },
        { id: "P-802", title: "Array Rotation", difficulty: "Easy", tags: "Arrays", solved: 1200 }
    ];

    // --- REPORT UI HANDLERS ---
    window.initReportUI = () => {
        const type = document.getElementById('reportType').value;
        const title = document.getElementById('previewTitle');
        const container = document.getElementById('previewTableContainer');
        const badge = document.getElementById('formatBadge');
        const filterContainer = document.getElementById('filterContainer');

        badge.innerText = `${type.toUpperCase()} REPORT`;
        title.innerText = `${type} Management Report`;

        // Simple Filter Setup
        let filterHTML = `<select class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"><option>All Departments</option><option>CSE</option><option>ECE</option></select>`;
        if (type === 'Academic') {
            filterHTML += `<select class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-800 dark:border-gray-700 dark:text-white"><option>All Programs</option><option>B.Tech</option><option>M.Tech</option></select>`;
        }
        filterContainer.innerHTML = filterHTML;

        // Render Table Preview
        renderPreview(type, container);
    };

    const renderPreview = (type, container) => {
        let headers = [];
        let data = [];

        if (type === 'Faculty') {
            headers = ["ID", "Name", "Department", "Performance"];
            data = getFacultyData().map(f => [f.id, f.name, f.dept, f.rating + "/5.0"]);
        } else if (type === 'Students') {
            headers = ["ID", "Name", "Year", "GPA"];
            data = getStudentData().map(s => [s.id, s.name, s.year, s.gpa]);
        } else if (type === 'Contests') {
            headers = ["Title", "Participants", "Status"];
            data = getContestData().map(c => [c.title, c.participants, "Completed"]);
        } else {
            headers = ["Title", "Difficulty", "Total Solves"];
            data = getProblemData().map(p => [p.title, p.difficulty, p.solved]);
        }

        let html = `<table class="w-full text-left text-sm mt-4"><thead class="border-b border-gray-100 dark:border-gray-800"><tr>`;
        headers.forEach(h => html += `<th class="py-3 px-4 font-bold text-gray-500 uppercase text-[10px] tracking-widest">${h}</th>`);
        html += `</tr></thead><tbody class="divide-y divide-gray-50 dark:divide-gray-800/50">`;
        data.slice(0, 5).forEach(row => {
            html += `<tr class="hover:bg-gray-50 dark:hover:bg-gray-800/20 transition-colors">`;
            row.forEach(cell => html += `<td class="py-4 px-4 text-gray-700 dark:text-gray-300 font-medium">${cell}</td>`);
            html += `</tr>`;
        });
        html += `</tbody></table>`;
        container.innerHTML = html;
    };

    const updateDate = () => {
        const d = document.getElementById('currentDate');
        if (d) d.innerText = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    window.handleReportDownload = () => {
        const type = document.getElementById('reportType').value;
        alert(`Exporting ${type} report... This will generate a PDF/Excel via client-side libraries.`);
        // Note: Real implementation would use jspdf/xlsx libraries here as in HOD version
    };

    updateDate();
    window.initReportUI();
});
