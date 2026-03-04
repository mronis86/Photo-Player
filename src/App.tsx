import { Routes, Route, Navigate } from 'react-router-dom';
import { Controller } from './components/controller/Controller';
import { Stage } from './components/playout/Stage';
import { ProtectedRoute } from './components/ProtectedRoute';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/app" element={<ProtectedRoute><Controller /></ProtectedRoute>} />
      <Route path="/playout" element={<Stage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
