import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { NoAds } from './components/AdSlot.jsx';
import { useAuth } from './lib/auth.jsx';
import Home from './pages/Home.jsx';
import Problems from './pages/Problems.jsx';
import Problem from './pages/Problem.jsx';
import Login from './pages/Login.jsx';
import Tests from './pages/Tests.jsx';
import TestLobby from './pages/TestLobby.jsx';
import TestRunner from './pages/TestRunner.jsx';
import TestResult from './pages/TestResult.jsx';
import Practice from './pages/Practice.jsx';
import Progress from './pages/Progress.jsx';
import Profile from './pages/Profile.jsx';
import Pro from './pages/Pro.jsx';
import Privacy from './pages/Privacy.jsx';
import Subject from './pages/Subject.jsx';
import Chapter from './pages/Chapter.jsx';

const Admin = lazy(() => import('./pages/Admin.jsx'));

function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="spinner" />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      {/* Full-screen exam view, no site nav */}
      <Route path="/test/:id/take" element={<RequireAuth><TestRunner /></RequireAuth>} />
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/problems" element={<Problems />} />
        <Route path="/problems/:qid" element={<Problem />} />
        <Route path="/contests" element={<Tests kind="contest" />} />
        <Route path="/mocks" element={<Tests kind="mock" />} />
        <Route path="/practice" element={<RequireAuth><Practice /></RequireAuth>} />
        <Route path="/test/:id" element={<TestLobby />} />
        <Route path="/test/:id/result" element={<RequireAuth><TestResult /></RequireAuth>} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/leaderboard" element={<Progress />} />
        <Route path="/u/:username" element={<Profile />} />
        <Route path="/pro" element={<Pro />} />
        <Route path="/privacy" element={<Privacy />} />
        {['physics', 'chemistry', 'maths'].map((s) => [
          <Route key={s} path={`/${s}`} element={<Subject subject={s} key={s} />} />,
          <Route key={`${s}-ch`} path={`/${s}/:slug`} element={<Chapter subject={s} key={s} />} />,
        ])}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Login register />} />
        <Route path="/admin/*" element={<RequireAuth><Suspense fallback={<div className="spinner" />}><Admin /></Suspense></RequireAuth>} />
        <Route path="*" element={<div className="empty"><NoAds /><h2>Page not found</h2></div>} />
      </Route>
    </Routes>
  );
}
