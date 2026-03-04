import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Stage } from './components/playout/Stage';
import './styles/playout.css';

function PlayoutRoot() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<Stage />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PlayoutRoot />
  </React.StrictMode>
);
