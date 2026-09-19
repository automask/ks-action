import { mountGallery } from './main.js';

mountGallery().catch(error => {
    console.error(error);
    const box = document.getElementById('err');
    box.style.display = 'block';
    box.textContent = error.stack || String(error);
    document.getElementById('loader')?.remove();
});
