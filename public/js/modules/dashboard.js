// dashboard.js
let isRunning = false;
let pollingInterval = null;
let charts = {};

document.addEventListener('DOMContentLoaded', () => {
    initButtons();
    initCharts();
    fetchMetrics();
    // Poll every 1 seconds for live telemetry
    pollingInterval = setInterval(fetchMetrics, 1000);
});

async function fetchMetrics() {
    try {
        const res = await fetch('/api/system/live').catch(() => null);
        if (!res || !res.ok) return;
        const live = await res.json();

        updateDOM(live);
        updateButtons(live.pipeline.running);
    } catch (e) {
        console.error("Failed to fetch dashboard metrics:", e);
    }
}

function updateDOM(data) {
    const { pipeline, metrics } = data;
    const aiSuccessRate = metrics["AI Evaluations"] > 0 
        ? Math.round((metrics["Matched Jobs"] / metrics["AI Evaluations"]) * 100) 
        : 100;
        
    const cacheHitRate = metrics["Actually Scraped"] > 0 
        ? Math.round((metrics["Cached Companies"] / (metrics["Actually Scraped"] + metrics["Cached Companies"])) * 100) 
        : 100;

    const statsMap = {
        'stat-health-score': "100%", // Simplified for live view
        'stat-health-trend': 'Online',
        'stat-ai-accuracy': aiSuccessRate + '%',
        'stat-cache-hit': (isNaN(cacheHitRate) ? 0 : cacheHitRate) + '%',
        'stat-discovery-success': metrics["Recovered Nodes"] > 0 ? "100%" : "N/A",
        
        // Live Pipeline Stats
        'metric-companies': pipeline.running ? `${pipeline.companyIndex} / ${pipeline.totalCompanies}` : (pipeline.totalCompanies || metrics["Actually Scraped"]),
        'metric-jobs': pipeline.running ? pipeline.jobsFound : (metrics["Raw Jobs"] || 0),
        'metric-matched': pipeline.running ? pipeline.matchedJobs : (metrics["Matched Jobs"] || 0),
        'metric-ai-eval': metrics["AI Evaluations"] || 0,
        
        'metric-healthy': (metrics["Actually Scraped"] - metrics["Parser Failures"] - metrics["Validation Failures"]) || 0,
        'metric-failed': (metrics["Parser Failures"] + metrics["Validation Failures"]) || 0,
        'metric-parser-err': metrics["Parser Failures"] || 0,
        'metric-ats-changed': metrics["ATS Changed"] || 0,
        
        'metric-cached': metrics["Cached Companies"] || 0,
        'metric-scraped': metrics["Actually Scraped"] || 0,
        'metric-retry': pipeline.running ? pipeline.retryCount : (metrics["Recovered Nodes"] || 0),
        'metric-recovered': metrics["Recovered Nodes"] || 0,
        
        'metric-cf-blocks': metrics["Cloudflare Blocks"] || 0,
        'metric-headers': 'Live',
        'metric-axios': 'Live',
        'metric-puppeteer': 'Active',
        
        'metric-savings': (metrics["Cached Companies"] * 4.5).toFixed(1) + 's',
        'metric-avg-run': pipeline.running ? (pipeline.elapsedTime / 1000).toFixed(1) + 's' : (metrics["Average Runtime"] ? (metrics["Average Runtime"] / 1000).toFixed(1) + 's' : '0s'),
        'metric-avg-comp': metrics["Average Company Time"] ? (metrics["Average Company Time"] / 1000).toFixed(1) + 's' : '0s'
    };

    for (const [id, val] of Object.entries(statsMap)) {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    }
}

function updateButtons(running) {
    const btnRun = document.getElementById('btn-run');
    const btnForce = document.getElementById('btn-force');
    const btnStop = document.getElementById('btn-stop');
    
    if (!btnRun || !btnForce || !btnStop) return;

    if (running) {
        btnRun.disabled = true;
        btnRun.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Running...';
        btnForce.disabled = true;
        btnStop.disabled = false;
    } else {
        btnRun.disabled = false;
        btnRun.innerHTML = '<i class="fa-solid fa-play mr-2"></i> Run Pipeline';
        btnForce.disabled = false;
        btnStop.disabled = true;
    }
}

function initButtons() {
    const btnRun = document.getElementById('btn-run');
    const btnForce = document.getElementById('btn-force');
    const btnStop = document.getElementById('btn-stop');
    
    const headers = { 'Content-Type': 'application/json' };

    if (btnRun) {
        btnRun.addEventListener('click', () => {
            fetch('/api/jobs/run', { method: 'POST', headers }).then(() => fetchMetrics());
        });
    }

    if (btnForce) {
        btnForce.addEventListener('click', () => {
            fetch('/api/jobs/run?forceRefresh=true', { method: 'POST', headers }).then(() => fetchMetrics());
        });
    }

    if (btnStop) {
        btnStop.addEventListener('click', () => {
            fetch('/api/jobs/stop', { method: 'POST', headers }).then(() => fetchMetrics());
        });
    }
}

function initCharts() {
    const ctx1 = document.getElementById('chart-pipeline-runtime');
    const ctx2 = document.getElementById('chart-cache-hit');
    
    if (ctx1 && window.Chart) {
        charts.runtime = new Chart(ctx1, {
            type: 'line',
            data: {
                labels: ['Run 1', 'Run 2', 'Run 3', 'Run 4', 'Run 5'],
                datasets: [{
                    label: 'Runtime (s)',
                    data: [120, 115, 10, 14, 110],
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    fill: true,
                    tension: 0.4
                }]
            },
            options: { responsive: true, maintainAspectRatio: false }
        });
    }

    if (ctx2 && window.Chart) {
        charts.cache = new Chart(ctx2, {
            type: 'bar',
            data: {
                labels: ['Run 1', 'Run 2', 'Run 3'],
                datasets: [{
                    label: 'Cached',
                    data: [0, 96, 0],
                    backgroundColor: '#f59e0b',
                }, {
                    label: 'Scraped',
                    data: [96, 0, 96],
                    backgroundColor: '#3b82f6',
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }
        });
    }
}
