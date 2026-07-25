// logs.js
let socket = null;
let allLogs = [];

document.addEventListener('DOMContentLoaded', () => {
    initSocket();
});

function initSocket() {
    if (!window.io) {
        console.error("Socket.IO not loaded!");
        return;
    }

    socket = io();

    socket.on('dashboard:init', (payload) => {
        if (payload.pipeline && payload.pipeline.logs) {
            allLogs = [...payload.pipeline.logs];
            renderLogs(allLogs);
        }
    });

    socket.on('logs:new', (logEntry) => {
        allLogs.unshift(logEntry);
        if (allLogs.length > 500) allLogs.pop();
        renderLogs(allLogs);
    });
}

function renderLogs(logs) {
    const container = document.getElementById('logs-container');
    if (!container) return;
    
    let html = '';
    
    // Reverse logs so oldest is at the top, or keep them as is depending on how UI expects it
    // The pipelineState prepends logs, so index 0 is newest.
    const displayLogs = [...logs].reverse();
    
    displayLogs.forEach(log => {
        const time = new Date(log.time).toISOString();
        let eLevel = log.level.padEnd(4, ' ');
        let eColorClass = 'text-primary';
        let eBgClass = '';
        
        if (log.level === 'ERROR') {
            eLevel = 'ERR ';
            eColorClass = 'text-error';
            eBgClass = 'bg-error/10 border border-error/20';
        } else if (log.level === 'WARNING') {
            eLevel = 'WARN';
            eColorClass = 'text-warning';
        } else if (log.level === 'SUCCESS') {
            eLevel = 'SUCC';
            eColorClass = 'text-success';
        }
        
        html += `
        <div class="flex items-start gap-3 hover:bg-white/5 py-0.5 rounded px-1 transition-colors ${eBgClass}">
            <span class="text-textMuted shrink-0 w-[160px] sticky left-0 bg-transparent">[${time}]</span>
            <span class="${eColorClass} font-bold shrink-0 w-12">[${eLevel}]</span>
            <span class="text-textMain break-all ${eColorClass}">${log.message}</span>
        </div>`;
    });
    
    const wasScrolledToBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 50;
    
    container.innerHTML = html;
    
    const autoScroll = document.querySelector('input[type="checkbox"]')?.checked ?? true;
    if (autoScroll && wasScrolledToBottom) {
        container.scrollTop = container.scrollHeight;
    }
}
