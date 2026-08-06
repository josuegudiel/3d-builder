import { AppUI } from './ui/app';

const root = document.getElementById('app');
if (!root) {
  throw new Error('No se encontró el contenedor #app');
}

const app = new AppUI(root);

// Se expone para depuración desde la consola del navegador.
(window as unknown as { form3d: AppUI }).form3d = app;
