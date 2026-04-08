document.addEventListener("DOMContentLoaded", () => {
    const postsContainer = document.getElementById("postsContainer");
    const forumSearch = document.getElementById("forumSearch");
    const globalSearch = document.getElementById("globalSearch");
    const sortSelect = document.getElementById("sortSelect");
    const topicCards = Array.from(document.querySelectorAll(".topic-card[data-topic]"));
    const filterBtns = Array.from(document.querySelectorAll(".filter-btn[data-filter]"));
    const postsTitle = document.getElementById("postsTitle");
    const clearTopicBtn = document.getElementById("clearTopicBtn");

    if (!postsContainer) return;

    let threads = [];
    let activeTopic = "all";
    let searchQuery = "";
    let activeFilter = "all";

    const timeAgo = (iso) => {
        if (!iso) return "just now";
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return "just now";
        const diff = Math.floor((Date.now() - d.getTime()) / 1000);
        if (diff < 60) return `${diff}s ago`;
        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
        return `${Math.floor(diff / 86400)}d ago`;
    };

    const topicLabel = (topic) => {
        const t = String(topic || "general").toLowerCase();
        if (t === "web") return "Web Development";
        if (t === "backend") return "Backend";
        if (t === "mobile") return "Mobile Dev";
        if (t === "algo" || t === "algorithms") return "Algorithms";
        return "General";
    };

    const topicClass = (topic) => {
        const t = String(topic || "general").toLowerCase();
        if (t === "web") return "bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300";
        if (t === "backend") return "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300";
        if (t === "mobile") return "bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300";
        if (t === "algo" || t === "algorithms") return "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300";
        return "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200";
    };

    const render = () => {
        let rows = threads.slice();
        if (activeTopic !== "all") rows = rows.filter((r) => String(r.topic || "").toLowerCase() === activeTopic);
        if (searchQuery) {
            rows = rows.filter((r) =>
                String(r.title || "").toLowerCase().includes(searchQuery) ||
                String(r.content || "").toLowerCase().includes(searchQuery) ||
                String(r.author_name || "").toLowerCase().includes(searchQuery)
            );
        }

        const sortBy = sortSelect?.value || "recent";
        if (sortBy === "viewed") rows.sort((a, b) => Number(b.views || 0) - Number(a.views || 0));
        else if (sortBy === "commented") rows.sort((a, b) => Number(b.reply_count || 0) - Number(a.reply_count || 0));
        else rows.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        postsContainer.innerHTML = rows.map((t) => `
            <div class="post-card bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden border border-primary-100 dark:border-gray-700 hover:shadow-md transition-all mb-4">
                <div class="p-6">
                    <div class="flex items-center space-x-3 mb-2">
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-medium ${topicClass(t.topic)}">${topicLabel(t.topic)}</span>
                        <span class="text-sm text-primary-500 dark:text-gray-400"><i class="far fa-user mr-1"></i> ${t.author_name || "User"}</span>
                        <span class="text-sm text-primary-400 dark:text-gray-500"><i class="far fa-clock mr-1"></i> ${timeAgo(t.createdAt)}</span>
                    </div>
                    <h3 class="text-lg font-semibold text-primary-700 dark:text-gray-200 mb-2">${t.title || "Untitled Thread"}</h3>
                    <p class="text-primary-500 dark:text-gray-400 mb-4">${(t.content || "").substring(0, 260)}</p>
                    <div class="flex flex-wrap items-center gap-4 text-sm border-t border-gray-100 dark:border-gray-700 pt-4">
                        <span class="flex items-center text-primary-500 dark:text-gray-400"><i class="far fa-comment-alt mr-1"></i> ${Number(t.reply_count || 0)} comments</span>
                        <span class="flex items-center text-primary-500 dark:text-gray-400"><i class="far fa-eye mr-1"></i> ${Number(t.views || 0)} views</span>
                        <div class="flex-1"></div>
                        <button data-thread-id="${t.id}" class="btn-reply px-4 py-1.5 bg-primary-50 text-primary-600 hover:bg-primary-100 dark:bg-gray-700 dark:text-blue-400 dark:hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors">
                            <i class="fas fa-reply mr-1"></i> Reply
                        </button>
                    </div>
                </div>
            </div>
        `).join("");

        if (!rows.length) {
            postsContainer.innerHTML = `
                <div class="bg-white dark:bg-gray-800 rounded-xl p-8 text-center text-gray-500 dark:text-gray-300 border border-primary-100 dark:border-gray-700">
                    No discussions found for current filter.
                </div>
            `;
        }
    };

    const loadThreads = async () => {
        try {
            const sortParam = (sortSelect?.value === "viewed" || sortSelect?.value === "commented") ? "popular" : "latest";
            const q = encodeURIComponent(searchQuery || "");
            const res = await fetch(`/api/forum/threads?filter=global&sort=${sortParam}&search=${q}`);
            const json = await res.json();
            if (!json.success) throw new Error(json.message || "Failed to load threads");
            threads = json.threads || [];
            render();
        } catch (e) {
            postsContainer.innerHTML = `<div class="bg-white dark:bg-gray-800 rounded-xl p-8 text-center text-red-500 border border-red-200">Unable to load forum threads.</div>`;
        }
    };

    postsContainer.addEventListener("click", async (e) => {
        const btn = e.target.closest(".btn-reply");
        if (!btn) return;
        const threadId = btn.getAttribute("data-thread-id");
        const reply = window.prompt("Write your reply:");
        if (!reply || !reply.trim()) return;
        try {
            const res = await fetch("/api/forum/replies", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ thread_id: Number(threadId), content: reply.trim() })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.message || "Reply failed");
            await loadThreads();
        } catch (err) {
            window.alert("Could not post reply.");
        }
    });

    forumSearch?.addEventListener("input", (e) => { searchQuery = String(e.target.value || "").toLowerCase(); loadThreads(); });
    globalSearch?.addEventListener("input", (e) => { searchQuery = String(e.target.value || "").toLowerCase(); loadThreads(); });
    sortSelect?.addEventListener("change", () => loadThreads());

    filterBtns.forEach((btn) => {
        btn.addEventListener("click", () => {
            filterBtns.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            activeFilter = btn.getAttribute("data-filter") || "all";
            if (activeFilter === "recent" && sortSelect) sortSelect.value = "recent";
            loadThreads();
        });
    });

    topicCards.forEach((card) => {
        card.addEventListener("click", () => {
            topicCards.forEach((c) => c.classList.remove("selected", "ring-2", "ring-primary-400"));
            card.classList.add("selected", "ring-2", "ring-primary-400");
            activeTopic = card.getAttribute("data-topic") || "all";
            if (clearTopicBtn) clearTopicBtn.classList.toggle("hidden", activeTopic === "all");
            if (postsTitle) postsTitle.textContent = activeTopic === "all" ? "Recent Discussions" : `${topicLabel(activeTopic)} Discussions`;
            render();
        });
    });

    clearTopicBtn?.addEventListener("click", () => {
        activeTopic = "all";
        topicCards.forEach((c) => c.classList.remove("selected", "ring-2", "ring-primary-400"));
        document.querySelector('.topic-card[data-topic="all"]')?.classList.add("selected", "ring-2", "ring-primary-400");
        clearTopicBtn.classList.add("hidden");
        if (postsTitle) postsTitle.textContent = "Recent Discussions";
        render();
    });

    const modal = document.getElementById("createCommunityModal");
    const btnCreate = document.getElementById("btnCreateCommunity");
    const btnClose = document.getElementById("closeCreateCommunity");
    const btnCancel = document.getElementById("cancelCreateCommunity");
    const oldForm = document.getElementById("createCommunityForm");
    const form = oldForm ? oldForm.cloneNode(true) : null;
    if (oldForm && form) oldForm.parentNode.replaceChild(form, oldForm);

    const closeModal = () => modal?.classList.add("hidden");
    btnCreate?.addEventListener("click", () => modal?.classList.remove("hidden"));
    btnClose?.addEventListener("click", closeModal);
    btnCancel?.addEventListener("click", closeModal);
    modal?.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

    form?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const title = form.querySelector('input[name="title"]')?.value?.trim();
        const topic = form.querySelector('select[name="topic"]')?.value?.trim()?.toLowerCase() || "general";
        const content = form.querySelector('textarea[name="content"]')?.value?.trim();
        if (!title || !content) {
            window.alert("Please enter title and description.");
            return;
        }
        try {
            const res = await fetch("/api/forum/threads", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, content, topic })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.message || "Create failed");
            closeModal();
            form.reset();
            await loadThreads();
        } catch (err) {
            window.alert("Unable to create thread.");
        }
    });

    loadThreads();
});
