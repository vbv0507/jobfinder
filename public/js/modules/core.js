// core.js
document.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initMobileSidebar();
});

function initNavigation() {
    const path = window.location.pathname;
    const links = document.querySelectorAll('.nav-link');
    
    links.forEach(link => {
        if (link.getAttribute('href') === path || (path !== '/' && link.getAttribute('href') !== '/' && path.startsWith(link.getAttribute('href')))) {
            link.classList.add('bg-surface', 'text-textMain', 'shadow-sm');
            link.classList.remove('text-textMuted');
            const icon = link.querySelector('i');
            if (icon) {
                icon.classList.add('text-primary');
            }
        }
    });
}

function initMobileSidebar() {
    const btn = document.getElementById('mobile-menu-btn');
    const sidebar = document.getElementById('sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');
    
    if (!btn || !sidebar || !backdrop) return;

    function toggle() {
        const isOpen = sidebar.classList.contains('translate-x-0');
        if (isOpen) {
            sidebar.classList.remove('translate-x-0');
            sidebar.classList.add('-translate-x-full');
            backdrop.classList.add('opacity-0');
            setTimeout(() => backdrop.classList.add('hidden'), 300);
        } else {
            sidebar.classList.remove('-translate-x-full');
            sidebar.classList.add('translate-x-0');
            backdrop.classList.remove('hidden');
            setTimeout(() => backdrop.classList.remove('opacity-0'), 10);
        }
    }

    btn.addEventListener('click', toggle);
    backdrop.addEventListener('click', toggle);
}
