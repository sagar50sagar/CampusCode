
function applyTheme(t) {
    const html = document.documentElement;
    if (t === 'dark') { html.classList.add('dark'); localStorage.theme = 'dark'; }
    else if (t === 'light') { html.classList.remove('dark'); localStorage.theme = 'light'; }
    else { localStorage.removeItem('theme'); if (window.matchMedia('(prefers-color-scheme: dark)').matches) html.classList.add('dark'); else html.classList.remove('dark'); }
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) themeBtn.querySelector('i').className = html.classList.contains('dark') ? 'fas fa-sun text-xl' : 'fas fa-moon text-xl';
}

document.addEventListener("DOMContentLoaded", function () {
    applyTheme(localStorage.theme || 'system');
    const themeBtn = document.getElementById('themeToggleBtn');
    if (themeBtn) themeBtn.addEventListener('click', () => applyTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark'));
    
    // Profile Overlay
    const overlay = document.getElementById("profileOverlay");
    if(overlay) {
        const headerProfileBtn = document.getElementById("headerProfileBtn");
        const closeBtn = document.getElementById("closeProfileOverlay");
        if(headerProfileBtn) headerProfileBtn.addEventListener("click", () => overlay.classList.remove("hidden"));
        if(closeBtn) closeBtn.addEventListener("click", () => overlay.classList.add("hidden"));
        overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.add("hidden"); });
    }
});
