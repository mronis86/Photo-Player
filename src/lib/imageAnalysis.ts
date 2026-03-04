/**
 * Image analysis: optional backend API (AI) or local dimension-based only.
 */
import type { AnalysisResult } from './types';

const API_BASE = typeof import.meta.env?.VITE_API_BASE === 'string' ? import.meta.env.VITE_API_BASE : '';

function compositionFromDimensions(w: number, h: number) {
  const ratio = w / h;
  const composition = ratio > 1.2 ? 'landscape' : ratio < 0.8 ? 'portrait' : 'square';
  const recommendedMode = composition === 'landscape' ? 'fullscreen' : composition === 'portrait' ? 'blurbg' : 'fullscreen';
  const recommendReason = composition === 'landscape'
    ? 'Wide image suits full screen.'
    : composition === 'portrait'
      ? 'Portrait works well with blur background.'
      : 'Square fits full screen.';
  const kbAnim = composition === 'landscape' ? 'pan-right' : 'zoom-in';
  const kbAnimReason = composition === 'landscape'
    ? 'Subtle pan suits wide frames.'
    : 'Zoom-in adds depth.';
  return { composition, recommendedMode, recommendReason, kbAnim, kbAnimReason };
}

/** Analysis from dimensions only (no API). Use when "Use AI" is off. */
export function analysisFromDimensions(w: number, h: number): AnalysisResult {
  const { composition, recommendedMode, recommendReason, kbAnim, kbAnimReason } = compositionFromDimensions(w, h);
  return {
    analysis: {
      caption: 'No caption',
      subject: 'No caption',
      mood: 'neutral',
      composition,
      recommendedMode: recommendedMode as AnalysisResult['analysis']['recommendedMode'],
      recommendReason,
      kbAnim,
      kbAnimReason,
      tags: [composition],
      source: 'fallback',
    },
    mode: recommendedMode as AnalysisResult['mode'],
    kbAnim: kbAnim as AnalysisResult['kbAnim'],
  };
}

/**
 * Get image dimensions from a data URL, then run analysis (dimensions-only or API).
 */
export function runImageAnalysis(
  src: string,
  _name: string,
  useAi: boolean
): Promise<AnalysisResult> {
  if (!useAi) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || 1920;
        const h = img.naturalHeight || 1080;
        resolve(analysisFromDimensions(w, h));
      };
      img.onerror = () => reject(new Error('Failed to load image for dimensions'));
      img.src = src;
    });
  }
  const url = `${API_BASE}/api/analyze-image`;
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: src }),
  }).then((res) => {
    if (!res.ok) {
      return res.text().then((t) => { throw new Error(t || `Analysis failed: ${res.status}`); });
    }
    return res.json() as Promise<AnalysisResult>;
  });
}
