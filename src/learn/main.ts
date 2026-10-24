// Learn page entry (learn.html). Content comes from src/learn/content/*.md.
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app mount point');
app.textContent = '3-Body Integrator Explorer: learn (scaffold)';
