document.addEventListener("DOMContentLoaded", function () {
    const sidebar = document.getElementById('mainSidebar');
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const toggleIcon = toggleBtn ? toggleBtn.querySelector('i') : null;
    const sidebarLogoText = document.getElementById('sidebarLogoText');
    const headerLogoText = document.getElementById('headerLogoText');
    const sidebarHeader = document.getElementById('sidebarHeader');
    const sidebarLogoIcon = document.getElementById('sidebarLogoIcon');

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            const isCollapsed = sidebar.classList.contains('collapsed');
            
            if (isCollapsed) {
                sidebar.classList.replace('w-64', 'w-20');
                if (toggleIcon) toggleIcon.style.transform = 'rotate(180deg)';
                if (sidebarHeader) sidebarHeader.classList.replace('p-6', 'p-2');
                if (sidebarLogoIcon) sidebarLogoIcon.style.display = 'none';
                if (sidebarLogoText) { 
                    sidebarLogoText.textContent = "CC"; 
                    sidebarLogoText.style.opacity = '1'; 
                }
                if (headerLogoText) { 
                    headerLogoText.classList.remove('hidden'); 
                    setTimeout(() => { headerLogoText.classList.remove('opacity-0', '-translate-x-2'); }, 50); 
                }
            } else {
                sidebar.classList.replace('w-20', 'w-64');
                if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
                if (sidebarHeader) sidebarHeader.classList.replace('p-2', 'p-6');
                if (sidebarLogoIcon) sidebarLogoIcon.style.display = '';
                if (sidebarLogoText) { 
                    sidebarLogoText.textContent = "CampusCode"; 
                    sidebarLogoText.style.opacity = '1'; 
                }
                if (headerLogoText) { 
                    headerLogoText.classList.add('opacity-0', '-translate-x-2'); 
                    setTimeout(() => { headerLogoText.classList.add('hidden'); }, 300); 
                }
            }
            // Save preference
            localStorage.setItem('sidebarCollapsed', isCollapsed);
        });

        // Restore preference
        if (localStorage.getItem('sidebarCollapsed') === 'true') {
            toggleBtn.click();
        }
    }
});
