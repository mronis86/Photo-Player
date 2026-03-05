import { Link } from 'react-router-dom';
import { ControllerMock } from '../components/home/ControllerMock';

export function HomePage() {
  return (
    <div className="home-page">
      <header className="home-header">
        <span className="home-logo">FRAMEFLOW</span>
        <span className="home-logo-sub">Image Motion Playback</span>
        <div className="home-header-right">
          <Link to="/login" className="home-btn home-btn-ghost">Sign in</Link>
          <Link to="/signup" className="home-btn home-btn-primary">Get started</Link>
        </div>
      </header>

      <main className="home-main">
        <div className="home-mock-container">
          <ControllerMock />
        </div>
        <p className="home-cta-text">Visual playback for OBS and vMix. Import, set motion, go live.</p>
        <Link to="/signup" className="home-cta-primary">Get started free</Link>
      </main>
    </div>
  );
}
