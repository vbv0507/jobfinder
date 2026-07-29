import { createSocket } from './socketClient.js';

class LogExplorer {
    constructor() {
        this.socket = null;
        this.logs = []; // Infinite history
        this.filteredIndices = []; // Stores indices of this.logs that match current filters
        
        // Virtual Scroller State
        this.itemHeight = 22; // Fixed height per row in pixels (approx for text-xs)
        this.viewport = document.getElementById('logs-viewport');
        this.spacer = document.getElementById('logs-spacer');
        this.renderWindow = document.getElementById('logs-render-window');
        
        // UI State
        this.isPaused = false;
        this.autoScroll = true;
        this.useUTC = false;
        
        // Filter State
        this.searchQuery = '';
        this.useRegex = false;
        this.matchCase = false;
        this.wholeWord = false;
        this.filterLevel = 'ALL';
        this.filterSystem = 'ALL';
        
        // Stats
        this.stats = {
            errors: 0,
            warnings: 0,
            success: 0,
            startTime: null,
            endTime: null,
            companiesProcessed: new Set()
        };

        // Render throttling
        this.renderPending = false;
        
        this.bindEvents();
        this.initSocket();
    }

    async initSocket() {
        try {
            this.socket = await createSocket();
        } catch (error) {
            console.error("Socket connection failed:", error);
            this.renderWindow.innerHTML = '<p class="text-error text-center p-4">Connection failed. Retrying...</p>';
            return;
        }

        this.socket.on('dashboard:init', (payload) => {
            if (payload.pipeline && payload.pipeline.logs) {
                this.ingestLogs(payload.pipeline.logs, true);
            }
            if (payload.pipeline && payload.pipeline.startTime) {
                this.stats.startTime = new Date(payload.pipeline.startTime);
            }
        });

        this.socket.on('logs:init', (initialLogs) => {
            this.ingestLogs(initialLogs || [], true);
        });

        this.socket.on('logs:new', (logEntry) => {
            if (!this.isPaused) {
                this.ingestLogs([logEntry], false);
            }
        });

        this.socket.emit('dashboard:refresh');
    }

    bindEvents() {
        // Scrolling
        this.viewport.addEventListener('scroll', () => {
            if (this.autoScroll) {
                const isAtBottom = this.viewport.scrollHeight - this.viewport.clientHeight <= this.viewport.scrollTop + 50;
                if (!isAtBottom) {
                    this.autoScroll = false;
                    document.getElementById('toggle-autoscroll').checked = false;
                }
            }
            this.queueRender();
        });

        // Search & Filters
        document.getElementById('search-input').addEventListener('input', (e) => {
            this.searchQuery = e.target.value;
            this.applyFilters();
        });

        const toggleState = (btnId, prop) => {
            const btn = document.getElementById(btnId);
            btn.addEventListener('click', () => {
                this[prop] = !this[prop];
                btn.classList.toggle('text-textMuted', !this[prop]);
                btn.classList.toggle('text-primary', this[prop]);
                btn.classList.toggle('bg-primary/20', this[prop]);
                this.applyFilters();
            });
        };
        toggleState('toggle-regex', 'useRegex');
        toggleState('toggle-case', 'matchCase');
        toggleState('toggle-word', 'wholeWord');

        document.getElementById('filter-level').addEventListener('change', (e) => {
            this.filterLevel = e.target.value;
            this.applyFilters();
        });
        document.getElementById('filter-system').addEventListener('change', (e) => {
            this.filterSystem = e.target.value;
            this.applyFilters();
        });

        // Toggles
        document.getElementById('toggle-utc').addEventListener('change', (e) => {
            this.useUTC = e.target.checked;
            this.queueRender();
        });
        document.getElementById('toggle-autoscroll').addEventListener('change', (e) => {
            this.autoScroll = e.target.checked;
            if (this.autoScroll) this.scrollToBottom();
        });
        const btnPause = document.getElementById('btn-pause-stream');
        btnPause.addEventListener('click', () => {
            this.isPaused = !this.isPaused;
            btnPause.innerHTML = this.isPaused 
                ? '<i class="fa-solid fa-play"></i> Resume Stream'
                : '<i class="fa-solid fa-pause"></i> Pause Stream';
            btnPause.classList.toggle('text-warning', this.isPaused);
        });

        // Export Buttons
        document.getElementById('btn-dl-pdf').addEventListener('click', () => this.exportPDF());
        document.getElementById('btn-dl-json').addEventListener('click', () => this.exportFile('json'));
        document.getElementById('btn-dl-csv').addEventListener('click', () => this.exportFile('csv'));
        document.getElementById('btn-dl-txt').addEventListener('click', () => this.exportFile('txt'));

        // Copy Buttons
        document.getElementById('btn-copy-all').addEventListener('click', () => this.copyToClipboard(this.filteredIndices));
        document.getElementById('btn-copy-visible').addEventListener('click', () => {
            const { start, end } = this.getVisibleRange();
            this.copyToClipboard(this.filteredIndices.slice(start, end));
        });
        document.getElementById('btn-copy-selected').addEventListener('click', () => {
            document.execCommand('copy');
        });

        // Keyboard Shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'f') {
                e.preventDefault();
                document.getElementById('search-input').focus();
            }
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                this.exportPDF();
            }
        });
    }

    extractSystem(message) {
        const match = message.match(/^\[(.*?)\]/);
        return match ? match[1] : 'App';
    }

    ingestLogs(newLogs, reset = false) {
        if (reset) {
            this.logs = [];
            this.stats = { errors: 0, warnings: 0, success: 0, companiesProcessed: new Set(), startTime: this.stats.startTime, endTime: null };
        }

        let needsFilterRefresh = false;

        newLogs.forEach(log => {
            // Stats parsing
            if (log.level === 'ERROR') this.stats.errors++;
            if (log.level === 'WARNING' || log.level === 'WARN') this.stats.warnings++;
            if (log.level === 'SUCCESS') this.stats.success++;
            
            // Company parsing (simple regex heuristic on backend strings)
            const companyMatch = log.message.match(/scraping\s+([^\[]+)\[/i) || log.message.match(/Saved matched job.*?at\s+([^\.]+)/i);
            if (companyMatch) this.stats.companiesProcessed.add(companyMatch[1].trim());

            const sys = this.extractSystem(log.message);
            const entry = {
                ...log,
                time: new Date(log.time || Date.now()),
                system: sys
            };
            
            this.logs.push(entry);
            
            if (this.isMatch(entry)) {
                this.filteredIndices.push(this.logs.length - 1);
                needsFilterRefresh = true;
            }
        });

        this.updateStats();

        if (needsFilterRefresh) {
            this.updateVirtualScrollerDimensions();
            this.queueRender();
            if (this.autoScroll) this.scrollToBottom();
        }
    }

    isMatch(log) {
        // Level Filter
        if (this.filterLevel !== 'ALL' && log.level !== this.filterLevel) return false;
        
        // System Filter
        if (this.filterSystem !== 'ALL') {
            const sys = log.system.toUpperCase();
            const target = this.filterSystem.toUpperCase();
            if (target === 'AI' && !sys.includes('AI') && !sys.includes('GEMINI') && !sys.includes('GROQ')) return false;
            if (target === 'ATS' && sys !== 'ATS') return false;
            if (target === 'TELEGRAM' && sys !== 'TELEGRAM') return false;
            if (target === 'PIPELINE' && sys !== 'PIPELINE') return false;
            if (target === 'CACHE' && sys !== 'CACHE') return false;
            if (target === 'SOCKET' && sys !== 'SOCKET') return false;
        }

        // Search Filter
        if (!this.searchQuery) return true;

        let target = log.message;
        let query = this.searchQuery;

        if (this.useRegex) {
            try {
                const flags = this.matchCase ? 'g' : 'gi';
                const prefix = this.wholeWord ? '\\b' : '';
                const suffix = this.wholeWord ? '\\b' : '';
                const re = new RegExp(prefix + query + suffix, flags);
                return re.test(target);
            } catch (e) {
                return false; // invalid regex
            }
        } else {
            if (!this.matchCase) {
                target = target.toLowerCase();
                query = query.toLowerCase();
            }
            if (this.wholeWord) {
                const re = new RegExp(`\\b${this.escapeRegExp(query)}\\b`, this.matchCase ? '' : 'i');
                return re.test(target);
            }
            return target.includes(query);
        }
    }

    escapeRegExp(string) {
        return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    applyFilters() {
        this.filteredIndices = [];
        for (let i = 0; i < this.logs.length; i++) {
            if (this.isMatch(this.logs[i])) {
                this.filteredIndices.push(i);
            }
        }
        
        document.getElementById('search-results-count').innerText = `${this.filteredIndices.length} matches`;
        this.updateVirtualScrollerDimensions();
        this.queueRender();
        if (this.autoScroll) this.scrollToBottom();
    }

    updateVirtualScrollerDimensions() {
        const totalHeight = this.filteredIndices.length * this.itemHeight;
        this.spacer.style.height = `${totalHeight}px`;
    }

    scrollToBottom() {
        this.viewport.scrollTop = this.viewport.scrollHeight;
    }

    getVisibleRange() {
        const scrollTop = this.viewport.scrollTop;
        const viewportHeight = this.viewport.clientHeight;
        
        // Calculate start and end indices based on scroll position
        const buffer = 10; // render extra items above and below
        let start = Math.floor(scrollTop / this.itemHeight) - buffer;
        let end = Math.ceil((scrollTop + viewportHeight) / this.itemHeight) + buffer;
        
        start = Math.max(0, start);
        end = Math.min(this.filteredIndices.length, end);
        
        return { start, end };
    }

    queueRender() {
        if (!this.renderPending) {
            this.renderPending = true;
            requestAnimationFrame(() => {
                this.renderVisibleLogs();
                this.renderPending = false;
            });
        }
    }

    renderVisibleLogs() {
        if (this.filteredIndices.length === 0) {
            this.renderWindow.style.transform = `translateY(0px)`;
            this.renderWindow.innerHTML = `<p class="text-textMuted text-center p-4 italic">No logs match the current filters.</p>`;
            return;
        }

        const { start, end } = this.getVisibleRange();
        
        // Position the render window accurately
        const offsetY = start * this.itemHeight;
        this.renderWindow.style.transform = `translateY(${offsetY}px)`;
        
        let html = '';
        
        for (let i = start; i < end; i++) {
            const logIdx = this.filteredIndices[i];
            const log = this.logs[logIdx];
            
            const timeStr = this.useUTC ? log.time.toISOString() : log.time.toLocaleTimeString() + '.' + String(log.time.getMilliseconds()).padStart(3, '0');
            
            let levelLabel = String(log.level || 'INFO').padEnd(4, ' ').substring(0, 4);
            let colorClass = 'text-primary';
            let bgClass = '';

            if (log.level === 'ERROR') {
                colorClass = 'text-error';
                bgClass = 'bg-error/10 border-l-2 border-error';
            } else if (log.level === 'WARNING' || log.level === 'WARN') {
                colorClass = 'text-warning';
                bgClass = 'bg-warning/5 border-l-2 border-warning/50';
            } else if (log.level === 'SUCCESS') {
                colorClass = 'text-success';
                bgClass = 'bg-success/5 border-l-2 border-success/50';
            }

            let msg = log.message;
            if (this.searchQuery) {
                // Highlight matches
                try {
                    let re;
                    if (this.useRegex) {
                        const flags = this.matchCase ? 'g' : 'gi';
                        const prefix = this.wholeWord ? '\\b' : '';
                        const suffix = this.wholeWord ? '\\b' : '';
                        re = new RegExp(`(${prefix}${this.searchQuery}${suffix})`, flags);
                    } else {
                        const escaped = this.escapeRegExp(this.searchQuery);
                        const prefix = this.wholeWord ? '\\b' : '';
                        const suffix = this.wholeWord ? '\\b' : '';
                        re = new RegExp(`(${prefix}${escaped}${suffix})`, this.matchCase ? 'g' : 'gi');
                    }
                    msg = msg.replace(re, '<mark class="bg-primary/40 text-white rounded px-0.5">$1</mark>');
                } catch(e) {}
            }

            // Enforce strictly 1-line layout via css to keep itemHeight accurate (truncate or hide overflow)
            html += `
            <div class="flex items-start gap-3 hover:bg-white/5 px-2 rounded-r transition-colors h-[22px] overflow-hidden whitespace-nowrap ${bgClass}">
                <span class="text-textMuted shrink-0 w-[170px] select-none">[${timeStr}]</span>
                <span class="${colorClass} font-bold shrink-0 w-10 select-none">[${levelLabel}]</span>
                <span class="text-textMain flex-1 overflow-hidden text-ellipsis ${colorClass}">${msg}</span>
            </div>`;
        }

        this.renderWindow.innerHTML = html;
    }

    updateStats() {
        document.getElementById('stat-total').innerText = this.logs.length.toLocaleString();
        document.getElementById('stat-errors').innerText = this.stats.errors.toLocaleString();
        document.getElementById('stat-warnings').innerText = this.stats.warnings.toLocaleString();
        document.getElementById('stat-companies').innerText = this.stats.companiesProcessed.size;
        
        if (this.stats.startTime && this.logs.length > 0) {
            const lastLog = this.logs[this.logs.length - 1];
            const durationMs = lastLog.time.getTime() - this.stats.startTime.getTime();
            document.getElementById('stat-duration').innerText = (Math.max(0, durationMs) / 1000).toFixed(1) + 's';
        }

        if (performance && performance.memory) {
            document.getElementById('stat-memory').innerText = (performance.memory.usedJSHeapSize / 1048576).toFixed(1) + ' MB';
        }
    }

    // Exports
    formatLogsForExport() {
        return this.filteredIndices.map(idx => {
            const log = this.logs[idx];
            return {
                timestamp: log.time.toISOString(),
                level: log.level,
                system: log.system,
                message: log.message
            };
        });
    }

    copyToClipboard(indicesArray) {
        if (!indicesArray.length) return;
        const text = indicesArray.map(idx => {
            const log = this.logs[idx];
            return `[${log.time.toISOString()}] [${log.level}] ${log.message}`;
        }).join('\n');
        
        navigator.clipboard.writeText(text).then(() => {
            alert(`Copied ${indicesArray.length} logs to clipboard!`);
        });
    }

    exportFile(type) {
        const data = this.formatLogsForExport();
        if (!data.length) return alert("No logs to export.");

        let blob, filename;
        const now = new Date().toISOString().replace(/[:.]/g, '-');

        if (type === 'json') {
            blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            filename = `rolenova_logs_${now}.json`;
        } else if (type === 'csv') {
            const csv = ['Timestamp,Level,System,Message'];
            data.forEach(row => {
                const escapedMsg = row.message.replace(/"/g, '""');
                csv.push(`"${row.timestamp}","${row.level}","${row.system}","${escapedMsg}"`);
            });
            blob = new Blob([csv.join('\n')], { type: 'text/csv' });
            filename = `rolenova_logs_${now}.csv`;
        } else if (type === 'txt') {
            const txt = data.map(row => `[${row.timestamp}] [${row.level}] ${row.message}`).join('\n');
            blob = new Blob([txt], { type: 'text/plain' });
            filename = `rolenova_logs_${now}.txt`;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }

    exportPDF() {
        if (!window.jspdf) {
            return alert("PDF library not loaded yet.");
        }
        
        const data = this.formatLogsForExport();
        if (!data.length) return alert("No logs to export.");

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('landscape');

        // Header
        doc.setFontSize(18);
        doc.text("RoleNova Runtime Logs Report", 14, 22);
        
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Generated at: ${new Date().toISOString()}`, 14, 30);
        
        // Stats
        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.text(`Total Filtered Logs: ${data.length}`, 14, 40);
        doc.text(`Errors: ${this.stats.errors}`, 80, 40);
        doc.text(`Warnings: ${this.stats.warnings}`, 120, 40);

        // Table
        const tableColumn = ["Time", "Level", "System", "Message"];
        const tableRows = data.map(log => [
            log.timestamp.split('T')[1].replace('Z', ''),
            log.level,
            log.system,
            log.message
        ]);

        doc.autoTable({
            startY: 45,
            head: [tableColumn],
            body: tableRows,
            theme: 'striped',
            styles: { fontSize: 8, font: 'courier' },
            columnStyles: {
                0: { cellWidth: 25 },
                1: { cellWidth: 15 },
                2: { cellWidth: 25 },
                3: { cellWidth: 'auto' }
            },
            willDrawCell: function (data) {
                if (data.row.section === 'body' && data.column.index === 1) {
                    if (data.cell.raw === 'ERROR') {
                        doc.setTextColor(220, 38, 38); // red
                    } else if (data.cell.raw === 'WARNING' || data.cell.raw === 'WARN') {
                        doc.setTextColor(217, 119, 6); // yellow
                    } else if (data.cell.raw === 'SUCCESS') {
                        doc.setTextColor(22, 163, 74); // green
                    }
                }
            },
            didDrawPage: function (data) {
                // Footer
                const pageCount = doc.internal.getNumberOfPages();
                doc.setFontSize(8);
                doc.text(`Page ${pageCount}`, doc.internal.pageSize.width - 20, doc.internal.pageSize.height - 10);
            }
        });

        doc.save(`rolenova_report_${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.logExplorer = new LogExplorer();
});
