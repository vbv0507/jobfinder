import os, re

base_dir = r'd:\new\NODE\jobfinder\routes'

# 1. companyRoutes.js
with open(os.path.join(base_dir, 'companyRoutes.js'), 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace('router.use(requireAdmin);', '')
c = c.replace('router.post("/seed", seedCompanyList);', 'router.post("/seed", requireAdmin, seedCompanyList);')
c = c.replace('router.post("/", addCompany);', 'router.post("/", requireAdmin, addCompany);')
c = c.replace('router.get("/", getCompanies);', 'router.get("/", requireViewer, getCompanies);')
with open(os.path.join(base_dir, 'companyRoutes.js'), 'w', encoding='utf-8') as f:
    f.write(c)

# 2. telegramRoutes.js
with open(os.path.join(base_dir, 'telegramRoutes.js'), 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace('router.use(requireAdmin);', '')
c = c.replace('router.get(\'/status\', getStatus);', 'router.get(\'/status\', requireViewer, getStatus);')
c = c.replace('router.get(\'/statistics\', getStatistics);', 'router.get(\'/statistics\', requireViewer, getStatistics);')
c = c.replace('router.get(\'/channels\', getChannels);', 'router.get(\'/channels\', requireViewer, getChannels);')
c = c.replace('router.patch(\'/channels/:id/toggle\', toggleChannel);', 'router.patch(\'/channels/:id/toggle\', requireAdmin, toggleChannel);')
c = c.replace('router.post(\'/channels\', addChannel);', 'router.post(\'/channels\', requireAdmin, addChannel);')
c = c.replace('router.delete(\'/channels/:id\', deleteChannel);', 'router.delete(\'/channels/:id\', requireAdmin, deleteChannel);')
c = c.replace('router.post(\'/reconnect\', reconnect);', 'router.post(\'/reconnect\', requireAdmin, reconnect);')
c = c.replace('router.post(\'/reload\', reload);', 'router.post(\'/reload\', requireAdmin, reload);')
with open(os.path.join(base_dir, 'telegramRoutes.js'), 'w', encoding='utf-8') as f:
    f.write(c)

# 3. profileRoutes.js
with open(os.path.join(base_dir, 'profileRoutes.js'), 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace('router.use(requireAdmin);', '')
c = c.replace('router.get("/", getActiveProfile);', 'router.get("/", requireViewer, getActiveProfile);')
c = c.replace('router.post("/", upsertProfile);', 'router.post("/", requireAdmin, upsertProfile);')
with open(os.path.join(base_dir, 'profileRoutes.js'), 'w', encoding='utf-8') as f:
    f.write(c)

# 4. jobRoutes.js
with open(os.path.join(base_dir, 'jobRoutes.js'), 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace('router.get("/raw", getRawJobs);', 'router.get("/raw", requireViewer, getRawJobs);')
c = c.replace('router.get("/matched", getMatchedJobs);', 'router.get("/matched", requireViewer, getMatchedJobs);')
c = c.replace('router.get("/grouped", getGroupedJobs);', 'router.get("/grouped", requireViewer, getGroupedJobs);')
c = c.replace('router.get("/complete", getCompleteJobs);', 'router.get("/complete", requireViewer, getCompleteJobs);')
c = c.replace('router.get("/logs", getSearchLogs);', 'router.get("/logs", requireViewer, getSearchLogs);')
c = c.replace('router.get("/status", getPipelineStatus);', 'router.get("/status", requireViewer, getPipelineStatus);')
c = c.replace('router.get("/report", getReport);', 'router.get("/report", requireViewer, getReport);')
c = c.replace('router.get("/analytics", getAnalytics);', 'router.get("/analytics", requireViewer, getAnalytics);')
with open(os.path.join(base_dir, 'jobRoutes.js'), 'w', encoding='utf-8') as f:
    f.write(c)

print('Routes patched successfully.')
