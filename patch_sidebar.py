import os, re

base_dir = r'd:\new\NODE\jobfinder\views\partials'
sidebar_path = os.path.join(base_dir, 'sidebar.ejs')

with open(sidebar_path, 'r', encoding='utf-8') as f:
    sidebar = f.read()

sidebar = sidebar.replace('<p id="sidebar-user-name" class="text-sm font-semibold text-white truncate"></p>', 
                          '<p id="sidebar-user-name" class="text-sm font-semibold text-white truncate"><%= locals.user ? (locals.user.fullName || locals.user.email) : \'\' %></p>')
sidebar = sidebar.replace('<span id="user-role-badge" class="inline-flex items-center mt-1 px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-300"></span>',
                          '<span id="user-role-badge" class="inline-flex items-center mt-1 px-2 py-0.5 rounded text-xs font-medium <%= locals.user && locals.user.role === \'admin\' ? \'bg-purple-900/30 text-purple-300\' : \'bg-blue-900/30 text-blue-300\' %>"><%= locals.user ? locals.user.role.toUpperCase() : \'\' %></span>')

if '<% if (locals.user && locals.user.role === \'admin\') { %>' not in sidebar:
    sidebar = sidebar.replace('<div class="p-4 border-t border-gray-800 shrink-0">', 
                              '<% if (locals.user && locals.user.role === \'admin\') { %>\n    <div class="p-4 border-t border-gray-800 shrink-0">')
    sidebar = sidebar.replace('</button>\n    </div>', '</button>\n    </div>\n    <% } %>')
    
    admin_links = '''            <% if (locals.user && locals.user.role === 'admin') { %>
            <div class="mt-8"></div>
            <p class="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Admin</p>
            <a href="/admin/users" class="flex items-center px-3 py-2 text-sm font-medium rounded-md hover:bg-gray-800 hover:text-white group min-h-[44px]">
                <i class="fas fa-users w-6 text-gray-400 group-hover:text-white"></i> User Management
            </a>
            <% } %>'''
    sidebar = sidebar.replace('</nav>', admin_links + '\n        </nav>')

with open(sidebar_path, 'w', encoding='utf-8') as f:
    f.write(sidebar)

header_path = os.path.join(base_dir, 'header.ejs')
with open(header_path, 'r', encoding='utf-8') as f:
    header = f.read()

# Remove the JS that populates the sidebar
header = re.sub(r'const roleBadge = document\.getElementById\(\'user-role-badge\'\);[\s\S]*?if \(sidebarUserName\) \{[\s\S]*?\}', '', header)

with open(header_path, 'w', encoding='utf-8') as f:
    f.write(header)

print('Sidebar and Header updated.')
