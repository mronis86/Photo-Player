/**
 * Static mock of the controller UI for the landing page: PRV/PGM, play control, custom keyframe panel.
 */
const PICSUM = (seed: string, w: number, h: number) =>
  `https://picsum.photos/seed/${seed}/${w}/${h}`;

export function ControllerMock() {
  return (
    <div className="home-mock-wrap">
      <div className="home-mock">
        <div className="home-mock-main">
          <div className="home-mock-panel home-mock-left">
            <div className="home-mock-sec-label">Projects</div>
            <div className="home-mock-btns">
              <span className="home-mock-btn">New</span>
              <span className="home-mock-btn">Save</span>
              <span className="home-mock-btn">Open</span>
            </div>
            <div className="home-mock-sec-label">Load Media</div>
            <div className="home-mock-upload">Drop images or browse</div>
            <div className="home-mock-cuelist">
              <div className="home-mock-cue home-mock-cue-pvw">
                <span className="home-mock-cue-num">01</span>
                <div className="home-mock-thumb-wrap">
                  <img src={PICSUM('ffhero', 108, 72)} alt="" className="home-mock-thumb" />
                  <span className="home-mock-cue-badge home-mock-cue-pvw-badge">PVW</span>
                </div>
                <span className="home-mock-cue-name">Photo 01</span>
              </div>
              <div className="home-mock-cue home-mock-cue-pgm">
                <span className="home-mock-cue-num">02</span>
                <div className="home-mock-thumb-wrap">
                  <img src={PICSUM('ffpgm', 108, 72)} alt="" className="home-mock-thumb" />
                  <span className="home-mock-cue-badge home-mock-cue-pgm-badge">PGM</span>
                </div>
                <span className="home-mock-cue-name">Photo 02</span>
              </div>
              <div className="home-mock-cue">
                <span className="home-mock-cue-num">03</span>
                <div className="home-mock-thumb-wrap">
                  <img src={PICSUM('ffc', 108, 72)} alt="" className="home-mock-thumb" />
                </div>
                <span className="home-mock-cue-name">Photo 03</span>
              </div>
              <div className="home-mock-group">
                <div className="home-mock-group-row open">
                  <span className="home-mock-cue-num">04</span>
                  <span className="home-mock-grp-chevron">▶</span>
                  <div className="home-mock-thumb-wrap home-mock-group-thumb">
                    <img src={PICSUM('ffd', 108, 72)} alt="" className="home-mock-thumb" />
                  </div>
                  <div className="home-mock-cue-info">
                    <span className="home-mock-cue-name" style={{ color: 'var(--accent2)' }}>Slideshow</span>
                    <span className="home-mock-cue-meta">GROUP · 3 img</span>
                  </div>
                </div>
                <div className="home-mock-group-children">
                  <div className="home-mock-group-child">
                    <div className="home-mock-thumb-wrap">
                      <img src={PICSUM('ffd', 108, 72)} alt="" className="home-mock-thumb" />
                    </div>
                    <span className="home-mock-cue-name">Slide A</span>
                  </div>
                  <div className="home-mock-group-child">
                    <div className="home-mock-thumb-wrap">
                      <img src={PICSUM('ffe', 108, 72)} alt="" className="home-mock-thumb" />
                    </div>
                    <span className="home-mock-cue-name">Slide B</span>
                  </div>
                  <div className="home-mock-group-child">
                    <div className="home-mock-thumb-wrap">
                      <img src={PICSUM('fff', 108, 72)} alt="" className="home-mock-thumb" />
                    </div>
                    <span className="home-mock-cue-name">Slide C</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="home-mock-center">
            <div className="home-mock-dual">
              <div className="home-mock-monitor-col">
                <div className="home-mock-monitor-header">
                  <span className="home-mock-monitor-label">PREVIEW</span>
                  <span className="home-mock-cue-name" style={{ flex: 1, marginLeft: 6 }}>Photo 01</span>
                  <span className="home-mock-pvw-play">▶ PLAY</span>
                </div>
                <div className="home-mock-stage">
                  <div className="home-mock-pvw-wrap">
                    <div className="home-mock-preview-inner" style={{ ['--ks' as string]: '1.12' }}>
                      <img src={PICSUM('ffhero', 960, 540)} alt="" className="home-mock-preview-img" />
                    </div>
                    <span className="home-mock-overlay home-mock-pvw-label">PVW</span>
                  </div>
                </div>
              </div>
              <div className="home-mock-splitter" />
              <div className="home-mock-monitor-col">
                <div className="home-mock-monitor-header">
                  <span className="home-mock-monitor-label home-mock-pgm-label">● PROGRAM</span>
                  <span className="home-mock-cue-name" style={{ flex: 1, marginLeft: 6 }}>—</span>
                </div>
                <div className="home-mock-stage home-mock-pgm-stage">
                  <div className="home-mock-pgm-wrap">
                    <div className="home-mock-preview-inner home-mock-pgm-anim" style={{ ['--ks' as string]: '1.12' }}>
                      <img src={PICSUM('ffpgm', 960, 540)} alt="" className="home-mock-preview-img" />
                    </div>
                    <span className="home-mock-overlay home-mock-pgm-label-overlay">PGM</span>
                  </div>
                </div>
              </div>
            </div>
            <div className="home-mock-transport">
              <div className="home-mock-t-nav">
                <span className="home-mock-nav-btn">⏮</span>
                <span className="home-mock-nav-btn">▶</span>
                <span className="home-mock-nav-btn">⏭</span>
              </div>
              <div className="home-mock-t-sep" />
              <div className="home-mock-t-counters">
                <span className="home-mock-t-live">LIVE <b>—</b></span>
                <span className="home-mock-t-next">NEXT <b>01</b></span>
              </div>
              <div className="home-mock-t-sep" />
              <div className="home-mock-t-progress">
                <div className="home-mock-progress-fill" style={{ width: '0%' }} />
              </div>
              <div className="home-mock-t-sep" />
              <span className="home-mock-take">TAKE LIVE</span>
            </div>
          </div>

          <div className="home-mock-panel home-mock-right">
            <div className="home-mock-coll-hdr open">
              <span className="home-mock-sec-label">Motion</span>
              <span className="home-mock-sec-status">Custom</span>
            </div>
            <div className="home-mock-kb-editor">
              <div className="home-mock-kb-hint">Set start & end crop. Resize from corner.</div>
              <div className="home-mock-kb-wrap">
                <img src={PICSUM('ffhero', 320, 180)} alt="" />
                <div className="home-mock-kb-frame home-mock-kb-start" style={{ left: '10%', top: '15%', width: '45%', height: '55%' }}>
                  <span className="home-mock-kb-frame-label">START</span>
                </div>
                <div className="home-mock-kb-frame home-mock-kb-end" style={{ left: '50%', top: '35%', width: '40%', height: '50%' }}>
                  <span className="home-mock-kb-frame-label">END</span>
                </div>
              </div>
              <div className="home-mock-kb-info">
                <span>S: 45×55% @ 10,15</span>
                <span>E: 40×50% @ 50,35</span>
              </div>
              <div className="home-mock-kb-legend">
                <span><i className="home-mock-dot home-mock-dot-start" /> Start</span>
                <span><i className="home-mock-dot home-mock-dot-end" /> End</span>
              </div>
              <div className="home-mock-kb-actions">
                <span className="home-mock-kb-btn">⇄ Swap</span>
                <span className="home-mock-kb-btn">↺ Reset</span>
                <span className="home-mock-kb-btn home-mock-kb-btn-preview">▶ Preview</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
