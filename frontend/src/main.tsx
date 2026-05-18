import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { EditorPage } from './pages/EditorPage';
import { ControlPage } from './pages/ControlPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { RendererPage } from './pages/RendererPage';
import { Toaster } from './ui/toast';
import './index.css';

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/templates" replace /> },
  { path: '/templates', element: <TemplatesPage /> },
  { path: '/editor/:id', element: <EditorPage /> },
  { path: '/control', element: <ControlPage /> },
  { path: '/renderer', element: <RendererPage /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <>
    <Toaster />
    <RouterProvider router={router} />
  </>
);
