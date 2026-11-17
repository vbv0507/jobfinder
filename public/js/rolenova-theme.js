/* Presentation only: preserve all auth, data and pipeline logic. */
(() => {
 const token = name => `var(--rn-${name})`;
 if (window.tailwind) window.tailwind.config = { darkMode: 'class', theme: { extend: {
 fontFamily: { sans: ['-apple-system','BlinkMacSystemFont','Segoe UI','sans-serif'], mono: ['ui-monospace','SFMono-Regular','monospace'] },
 colors: { background: token('canvas'), bg: token('canvas'), surface: token('surface'), surfaceHover: token('subtle'), secondary: token('subtle'), dark: token('surface'), border: token('border'), primary: token('accent'), primaryHover: token('accent-hover'), text: token('ink'), textMain: token('ink'), textMuted: token('muted'), success: token('success'), error: token('error'), warning: token('warning') }
 } } };
 document.addEventListener('DOMContentLoaded', () => {
 if (window.Chart) {
 const styles = getComputedStyle(document.documentElement);
 const value = name => styles.getPropertyValue('--rn-' + name).trim();
 const palette = ['accent','info','warning','muted','success','error'].map(value);
 window.Chart.defaults.color = value('muted');
 window.Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
 window.Chart.register({id:'rolenova-palette',beforeUpdate(chart){const circular=['pie','doughnut','polarArea'].includes(chart.config.type);chart.data.datasets.forEach((set,index)=>{set.borderColor=circular?value('surface'):palette[index%palette.length];set.backgroundColor=circular?palette:palette[index%palette.length];set.borderWidth=circular?2:1.5;});}});
 }
 document.querySelectorAll('#sidebar nav a').forEach(link=>{if(link.getAttribute('href')===window.location.pathname)link.setAttribute('aria-current','page');});
 const menu=document.getElementById('mobile-menu-btn'),sidebar=document.getElementById('sidebar');
 if(menu&&sidebar){menu.setAttribute('aria-label','Open navigation');menu.setAttribute('aria-controls','sidebar');const update=()=>menu.setAttribute('aria-expanded',String(sidebar.classList.contains('translate-x-0')));new MutationObserver(update).observe(sidebar,{attributes:true,attributeFilter:['class']});update();document.addEventListener('keydown',event=>{if(event.key==='Escape'&&window.innerWidth<1024&&sidebar.classList.contains('translate-x-0')){menu.click();menu.focus();}});}
 });
})();
