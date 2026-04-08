document.addEventListener("DOMContentLoaded", () => {
    const reportData = window.__HOS_REPORT_DATA || {};
    const filtersMeta = reportData.filters || {};

    const datasets = {
        Contests: reportData.contests || [],
        Problems: reportData.problems || [],
        Progress: reportData.progress || [],
        Faculty: reportData.faculty || [],
        Students: reportData.students || []
    };

    const typeConfig = {
        Contests: {
            title: "Contest Analytics Report",
            badge: "PDF REPORT",
            columns: ["ID", "Title", "Class", "Subject", "Participants", "Status", "Start", "End"]
        },
        Problems: {
            title: "Problem Bank Inventory",
            badge: "PDF REPORT",
            columns: ["ID", "Title", "Difficulty", "Subject", "Status", "Submissions", "Accepted", "Accept %"]
        },
        Progress: {
            title: "Progress Performance Report",
            badge: "XLSX REPORT",
            columns: ["Month", "Submissions", "Accepted", "Accept %"]
        },
        Faculty: {
            title: "Faculty Performance Report",
            badge: "XLSX REPORT",
            columns: ["ID", "Name", "Email", "Department", "Program", "Role", "Status", "Created"]
        },
        Students: {
            title: "Student Performance Report",
            badge: "XLSX REPORT",
            columns: ["ID", "Name", "Email", "Department", "Year", "Section", "XP", "Solved", "Rank", "Submissions"]
        }
    };

    const getEl = (id) => document.getElementById(id);
    const toNum = (v) => Number(v || 0);
    const uniq = (arr) => [...new Set((arr || []).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
    const safeDate = (v) => {
        if (!v) return "-";
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? "-" : d.toISOString().slice(0, 10);
    };

    const getFacultyData = () =>
        (datasets.Faculty || []).map((f) => ({
            id: `FAC-${f.id}`,
            name: f.fullName || "-",
            email: f.email || "-",
            department: f.department || "-",
            program: f.program || f.course || "-",
            role: String(f.role || f.post || "faculty").toUpperCase(),
            status: f.status || "active",
            created: toNum(f.problems_created)
        }));

    const getStudentData = () =>
        (datasets.Students || []).map((s) => ({
            id: `STU-${s.id}`,
            name: s.fullName || "-",
            email: s.email || "-",
            department: s.department || "-",
            year: s.year || "-",
            section: s.section || "-",
            xp: toNum(s.points),
            solved: toNum(s.solvedCount),
            rank: toNum(s.rank),
            submissions: toNum(s.submissions)
        }));

    const getContestData = () =>
        (datasets.Contests || []).map((c) => ({
            id: `CON-${c.id}`,
            title: c.title || "-",
            contestClass: c.contest_class || c.contestClass || "-",
            subject: c.subject || "-",
            participants: toNum(c.participants),
            status: c.status || "-",
            start: safeDate(c.startDate),
            end: safeDate(c.endDate)
        }));

    const getProblemData = () =>
        (datasets.Problems || []).map((p) => {
            const total = toNum(p.totalSubmissions);
            const accepted = toNum(p.acceptedSubmissions);
            const accept = total ? Math.round((accepted * 10000) / total) / 100 : 0;
            return {
                id: `P-${p.id}`,
                title: p.title || "-",
                difficulty: p.difficulty || "-",
                subject: p.subject || "-",
                status: p.status || "-",
                submissions: total,
                accepted,
                acceptance: accept
            };
        });

    const getProgressData = () =>
        (datasets.Progress || []).map((p) => ({
            month: p.month || "-",
            submissions: toNum(p.totalSubmissions),
            accepted: toNum(p.acceptedSubmissions),
            acceptance: toNum(p.acceptanceRate).toFixed(2)
        }));

    const setCurrentDate = () => {
        const dateEl = getEl("currentDate");
        if (!dateEl) return;
        const d = reportData.generatedAt ? new Date(reportData.generatedAt) : new Date();
        dateEl.textContent = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    };

    const renderMeta = () => {
        const generatedAt = reportData.generatedAt ? new Date(reportData.generatedAt) : new Date();
        const reportRefEl = getEl("reportRef");
        if (reportRefEl) {
            reportRefEl.textContent = `CC-${generatedAt.getFullYear()}-${String(generatedAt.getMonth() + 1).padStart(2, "0")}${String(generatedAt.getDate()).padStart(2, "0")}`;
        }

        const summary = reportData.summary || {};
        const scope = reportData.scope || {};
        const notifTitle1 = getEl("notifTitle1");
        const notifBody1 = getEl("notifBody1");
        const notifTitle2 = getEl("notifTitle2");
        const notifBody2 = getEl("notifBody2");

        if (notifTitle1) notifTitle1.textContent = "Report Summary";
        if (notifBody1) {
            notifBody1.textContent = `${toNum(summary.problemCount)} problems, ${toNum(summary.contestCount)} contests, ${toNum(summary.studentCount)} students tracked.`;
        }
        if (notifTitle2) notifTitle2.textContent = "HOS Scope";
        if (notifBody2) {
            const dept = scope.department || "-";
            const subj = (scope.subjects || []).slice(0, 3).join(", ") || "No subjects";
            notifBody2.textContent = `${dept} • ${subj} • Acceptance ${toNum(summary.acceptanceRate).toFixed(2)}%`;
        }
    };

    const setupShell = () => {
        const sidebar = getEl("mainSidebar");
        const toggleBtn = getEl("sidebarToggleBtn");
        const toggleIcon = toggleBtn ? toggleBtn.querySelector("i") : null;
        const sidebarLogoText = getEl("sidebarLogoText");
        const headerLogoText = getEl("headerLogoText");

        if (toggleBtn && sidebar) {
            toggleBtn.addEventListener("click", () => {
                sidebar.classList.toggle("collapsed");
                if (sidebar.classList.contains("collapsed")) {
                    sidebar.classList.replace("w-64", "w-20");
                    if (toggleIcon) toggleIcon.style.transform = "rotate(180deg)";
                    if (sidebarLogoText) { sidebarLogoText.style.opacity = "0"; sidebarLogoText.style.width = "0px"; }
                    if (headerLogoText) {
                        headerLogoText.classList.remove("hidden");
                        setTimeout(() => headerLogoText.classList.remove("opacity-0", "-translate-x-2"), 50);
                    }
                } else {
                    sidebar.classList.replace("w-20", "w-64");
                    if (toggleIcon) toggleIcon.style.transform = "rotate(0deg)";
                    if (sidebarLogoText) { sidebarLogoText.style.opacity = "1"; sidebarLogoText.style.width = "auto"; }
                    if (headerLogoText) {
                        headerLogoText.classList.add("opacity-0", "-translate-x-2");
                        setTimeout(() => headerLogoText.classList.add("hidden"), 300);
                    }
                }
            });
        }

        const notifBtn = getEl("notificationBtn");
        const notifDropdown = getEl("notificationDropdown");
        if (notifBtn && notifDropdown) {
            notifBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                notifDropdown.classList.toggle("hidden");
            });
            document.addEventListener("click", (e) => {
                if (!notifDropdown.contains(e.target) && !notifBtn.contains(e.target)) {
                    notifDropdown.classList.add("hidden");
                }
            });
        }

        const overlay = getEl("profileOverlay");
        const openProfile = () => overlay?.classList.remove("hidden");
        const closeProfile = () => overlay?.classList.add("hidden");
        getEl("headerProfileBtn")?.addEventListener("click", openProfile);
        getEl("closeProfileOverlay")?.addEventListener("click", closeProfile);
        overlay?.addEventListener("click", (e) => { if (e.target === overlay) closeProfile(); });

        const logout = () => { window.location.href = "/auth/logout"; };
        getEl("logoutBtn")?.addEventListener("click", logout);
    };

    const renderMainFilters = (type) => {
        const container = getEl("filterContainer");
        if (!container) return;
        const options = (arr, label) => [`<option value="all">${label}</option>`]
            .concat((arr || []).map((x) => `<option value="${String(x).replace(/"/g, "&quot;")}">${x}</option>`))
            .join("");

        let html = "";
        if (type === "Contests") {
            html = `
                <select id="mainFilter1" class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white">${options(filtersMeta.subjects || uniq(getContestData().map((c) => c.subject)), "All Subjects")}</select>
                <select id="mainFilter2" class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white">${options(filtersMeta.statuses || uniq(getContestData().map((c) => c.status)), "All Status")}</select>
            `;
        } else if (type === "Problems") {
            html = `
                <select id="mainFilter1" class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white">${options(filtersMeta.difficulties || uniq(getProblemData().map((p) => p.difficulty)), "All Difficulty")}</select>
                <select id="mainFilter2" class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white">${options(filtersMeta.statuses || uniq(getProblemData().map((p) => p.status)), "All Status")}</select>
            `;
        } else if (type === "Faculty") {
            html = `
                <select id="mainFilter1" class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white">${options(filtersMeta.departments || uniq(getFacultyData().map((f) => f.department)), "All Departments")}</select>
                <select id="mainFilter2" class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white">${options(["FACULTY", "HOS"], "All Roles")}</select>
            `;
        } else if (type === "Students") {
            html = `
                <select id="mainFilter1" class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white">${options(filtersMeta.years || uniq(getStudentData().map((s) => s.year)), "All Years")}</select>
                <select id="mainFilter2" class="w-full border rounded-lg p-2 text-sm bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-white">${options(filtersMeta.sections || uniq(getStudentData().map((s) => s.section)), "All Sections")}</select>
            `;
        } else {
            html = `<p class="text-xs text-gray-500 italic">Progress is generated from submissions timeline.</p>`;
        }
        container.innerHTML = html;
        container.querySelectorAll("select").forEach((el) => el.addEventListener("change", () => renderMainPreviewTable(type)));
    };

    const getRowsByType = (type) => {
        if (type === "Faculty") return getFacultyData();
        if (type === "Students") return getStudentData();
        if (type === "Contests") return getContestData();
        if (type === "Progress") return getProgressData();
        return getProblemData();
    };

    const applyMainFilters = (type, rows) => {
        const f1 = getEl("mainFilter1")?.value || "all";
        const f2 = getEl("mainFilter2")?.value || "all";
        if (f1 === "all" && f2 === "all") return rows;
        return rows.filter((r) => {
            if (type === "Contests") {
                return (f1 === "all" || String(r.subject) === f1) && (f2 === "all" || String(r.status) === f2);
            }
            if (type === "Problems") {
                return (f1 === "all" || String(r.difficulty) === f1) && (f2 === "all" || String(r.status) === f2);
            }
            if (type === "Faculty") {
                return (f1 === "all" || String(r.department) === f1) && (f2 === "all" || String(r.role) === f2);
            }
            if (type === "Students") {
                return (f1 === "all" || String(r.year) === f1) && (f2 === "all" || String(r.section) === f2);
            }
            return true;
        });
    };

    const rowToCells = (type, row) => {
        if (type === "Faculty") return [row.id, row.name, row.email, row.department, row.program, row.role, row.status, row.created];
        if (type === "Students") return [row.id, row.name, row.email, row.department, row.year, row.section, row.xp, row.solved, row.rank, row.submissions];
        if (type === "Contests") return [row.id, row.title, row.contestClass, row.subject, row.participants, row.status, row.start, row.end];
        if (type === "Progress") return [row.month, row.submissions, row.accepted, `${row.acceptance}%`];
        return [row.id, row.title, row.difficulty, row.subject, row.status, row.submissions, row.accepted, `${row.acceptance.toFixed(2)}%`];
    };

    const renderMainPreviewTable = (type) => {
        const container = getEl("previewTableContainer");
        if (!container) return;
        const headers = (typeConfig[type] || typeConfig.Problems).columns;
        const rows = applyMainFilters(type, getRowsByType(type)).slice(0, 8);

        let html = `<table class="w-full text-left text-sm"><thead class="border-b-2 border-gray-100"><tr>`;
        headers.forEach((h) => { html += `<th class="py-2 text-xs font-bold text-gray-500 uppercase">${h}</th>`; });
        html += `</tr></thead><tbody class="divide-y divide-gray-50">`;
        rows.forEach((row) => {
            html += "<tr>";
            rowToCells(type, row).forEach((c) => { html += `<td class="py-3 text-gray-700 font-medium">${c}</td>`; });
            html += "</tr>";
        });
        if (!rows.length) {
            html += `<tr><td class="py-6 text-gray-500 italic" colspan="${headers.length}">No data available for selected filters.</td></tr>`;
        }
        html += "</tbody></table>";
        container.innerHTML = html;
    };

    window.initReportUI = () => {
        const type = getEl("reportType")?.value || "Contests";
        const titleEl = getEl("previewTitle");
        const badgeEl = getEl("formatBadge");
        if (titleEl) titleEl.textContent = (typeConfig[type] || typeConfig.Contests).title;
        if (badgeEl) badgeEl.textContent = (typeConfig[type] || typeConfig.Contests).badge;
        renderMainFilters(type);
        renderMainPreviewTable(type);
    };

    const renderExportModal = (type) => {
        const map = {
            Faculty: { headId: "exportTableHeadRow", bodyId: "exportTableBody", countId: "exportPreviewCount" },
            Students: { headId: "studentExportTableHeadRow", bodyId: "studentExportTableBody", countId: "studentPreviewCount" },
            Contests: { headId: "contestTableHeadRow", bodyId: "contestTableBody", countId: "contestPreviewCount" },
            Problems: { headId: "probTableHeadRow", bodyId: "probTableBody", countId: "probPreviewCount" }
        };
        const cfg = map[type];
        if (!cfg) return;
        const headers = (typeConfig[type] || typeConfig.Problems).columns;
        const rows = getRowsByType(type);
        const headEl = getEl(cfg.headId);
        const bodyEl = getEl(cfg.bodyId);
        const countEl = getEl(cfg.countId);
        if (headEl) headEl.innerHTML = headers.map((h) => `<th class="px-6 py-3">${h}</th>`).join("");
        if (bodyEl) {
            bodyEl.innerHTML = rows.map((r) => {
                const cells = rowToCells(type, r);
                return `<tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50">${cells.map((c) => `<td class="px-6 py-4 whitespace-nowrap text-gray-700 dark:text-gray-300 font-medium">${c}</td>`).join("")}</tr>`;
            }).join("");
        }
        if (countEl) countEl.textContent = String(rows.length);
    };

    window.handleReportDownload = () => {
        const type = getEl("reportType")?.value || "Contests";
        if (type === "Faculty") {
            getEl("exportPreviewModal")?.classList.remove("hidden");
            renderExportModal("Faculty");
        } else if (type === "Students") {
            getEl("studentExportPreviewModal")?.classList.remove("hidden");
            renderExportModal("Students");
        } else if (type === "Contests") {
            getEl("exportContestModal")?.classList.remove("hidden");
            renderExportModal("Contests");
        } else if (type === "Problems") {
            getEl("exportProblemsModal")?.classList.remove("hidden");
            renderExportModal("Problems");
        } else {
            alert("Progress export is coming soon.");
        }
    };

    const closeModals = () => document.querySelectorAll('[id$="Modal"]').forEach((m) => m.classList.add("hidden"));
    getEl("closeExportModal")?.addEventListener("click", closeModals);
    getEl("closeStudentExportModal")?.addEventListener("click", closeModals);
    getEl("closeContestModal")?.addEventListener("click", closeModals);
    getEl("closeProblemsModal")?.addEventListener("click", closeModals);

    const exportFile = (format) => {
        const type = getEl("reportType")?.value || "Report";
        const file = `${type}_Report_${new Date().toISOString().slice(0, 10)}.${format}`;
        alert(`Preparing ${file}`);
        closeModals();
    };
    getEl("btnFinalDownloadExcel")?.addEventListener("click", () => exportFile("xlsx"));
    getEl("btnFinalDownloadPDF")?.addEventListener("click", () => exportFile("pdf"));
    getEl("btnStudentDownloadExcel")?.addEventListener("click", () => exportFile("xlsx"));
    getEl("btnStudentDownloadPDF")?.addEventListener("click", () => exportFile("pdf"));
    getEl("btnDownloadContestPDF")?.addEventListener("click", () => exportFile("pdf"));
    getEl("btnDownloadProblemsPDF")?.addEventListener("click", () => exportFile("pdf"));

    setupShell();
    setCurrentDate();
    renderMeta();
    window.initReportUI();
});
