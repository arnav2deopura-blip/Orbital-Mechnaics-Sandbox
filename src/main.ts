// Simulator entry (index.html). Real wiring lands in src/app/controller.ts.
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app mount point');
app.textContent = '3-Body Integrator Explorer: simulator (scaffold)';
