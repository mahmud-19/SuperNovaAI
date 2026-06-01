import { useEffect, useRef, useState } from 'react';
import { Image as KonvaImage, Layer, Line, Stage } from 'react-konva';
import Konva from 'konva';

function useHtmlImage(url?: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!url) { setImage(null); return; }
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = url;
    return () => setImage(null);
  }, [url]);
  return image;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 8;

function useColorizedMask(maskUrl?: string, color: string = '#20a75a') {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!maskUrl) {
      setCanvas(null);
      return;
    }
    const img = new window.Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const display = document.createElement('canvas');
      display.width = img.width || 512;
      display.height = img.height || 512;
      const dctx = display.getContext('2d');
      if (dctx) {
        dctx.drawImage(img, 0, 0);
        const imgData = dctx.getImageData(0, 0, display.width, display.height);
        const dData = imgData.data;

        const hex = color.replace('#', '');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);

        for (let i = 0; i < dData.length; i += 4) {
          const brightness = (dData[i] + dData[i + 1] + dData[i + 2]) / 3;
          if (brightness > 50) {
            dData[i] = r;
            dData[i + 1] = g;
            dData[i + 2] = b;
            dData[i + 3] = 255;
          } else {
            dData[i + 3] = 0;
          }
        }
        dctx.putImageData(imgData, 0, 0);
        setCanvas(display);
      }
    };
    img.src = maskUrl;
    return () => setCanvas(null);
  }, [maskUrl, color]);

  return canvas;
}

export function CaseCanvas({
  imageUrl,
  heatmapUrl,
  maskUrl,
  contours,
  showHeatmap = false,
  showMask = true,
  heatmapOpacity = 0.42,
  maskOpacity = 0.42,
  enableZoom = false,
}: {
  imageUrl?: string;
  heatmapUrl?: string;
  maskUrl?: string;
  contours?: number[][][];
  showHeatmap?: boolean;
  showMask?: boolean;
  heatmapOpacity?: number;
  maskOpacity?: number;
  enableZoom?: boolean;
}) {
  const image = useHtmlImage(imageUrl);
  const heatmap = useHtmlImage(heatmapUrl);
  const maskImage = useColorizedMask(maskUrl);
  const stageRef = useRef<Konva.Stage | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [invert, setInvert] = useState(false);

  const clamp = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

  function zoomAtPoint(next: number, point: { x: number; y: number }) {
    const stage = stageRef.current;
    if (!stage) return;
    const newScale = clamp(next);
    const old = stage.scaleX();
    const worldX = (point.x - stage.x()) / old;
    const worldY = (point.y - stage.y()) / old;
    setScale(newScale);
    setPos({ x: point.x - worldX * newScale, y: point.y - worldY * newScale });
  }

  function handleWheel(event: Konva.KonvaEventObject<WheelEvent>) {
    if (!enableZoom) return;
    event.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) return;
    const factor = 1.1;
    const next = event.evt.deltaY > 0 ? stage.scaleX() / factor : stage.scaleX() * factor;
    zoomAtPoint(next, pointer);
  }

  function reset() { setScale(1); setPos({ x: 0, y: 0 }); }

  function toggleFullscreen() {
    const el = frameRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }

  return (
    <div>
      <div className="canvas-frame" ref={frameRef}>
        <Stage
          width={512} height={512}
          className="konva-stage"
          ref={stageRef}
          scaleX={scale} scaleY={scale}
          x={pos.x} y={pos.y}
          draggable={enableZoom && scale > 1}
          onWheel={handleWheel}
          onDragEnd={(e) => setPos({ x: e.target.x(), y: e.target.y() })}
          style={{ filter: `brightness(${brightness}%) contrast(${contrast}%) invert(${invert ? 100 : 0}%)` }}
        >
          <Layer>
            {image && <KonvaImage image={image} width={512} height={512} />}
            {showHeatmap && heatmap && <KonvaImage image={heatmap} width={512} height={512} opacity={heatmapOpacity} />}
            {showMask && maskImage && <KonvaImage image={maskImage} width={512} height={512} opacity={maskOpacity} />}
            {showMask && (contours || []).map((polygon, i) => (
              <Line key={i} points={polygon.flat()} closed stroke="#10B981" strokeWidth={2.5} fill="rgba(16,185,129,0.12)" lineJoin="round" />
            ))}
          </Layer>
        </Stage>
        <button className="canvas-fullscreen-btn" type="button" onClick={toggleFullscreen} title="Toggle fullscreen">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
          Fullscreen
        </button>
      </div>
      {enableZoom && (
        <div className="zoom-toolbar">
          <button type="button" onClick={() => zoomAtPoint(scale / 1.25, { x: 256, y: 256 })}>−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => zoomAtPoint(scale * 1.25, { x: 256, y: 256 })}>+</button>
          <button type="button" onClick={reset}>Reset</button>
          <small>Scroll to zoom · drag to pan</small>
        </div>
      )}

      {/* Dynamic Image Adjustments panel */}
      <div className="canvas-controls-panel">
        <div className="canvas-controls-title">
          <span>🎛️ Contrast & Exposure Controls</span>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => { setBrightness(100); setContrast(100); setInvert(false); }}
            style={{ padding: '2px 8px', fontSize: '0.75rem', height: 'auto', minHeight: 'auto' }}
          >
            Reset Filters
          </button>
        </div>
        <div className="canvas-controls-grid">
          <div className="control-slider-group">
            <label>Brightness <span>{brightness}%</span></label>
            <input
              type="range"
              min={50}
              max={200}
              value={brightness}
              onChange={e => setBrightness(Number(e.target.value))}
              className="control-slider"
            />
          </div>
          <div className="control-slider-group">
            <label>Contrast <span>{contrast}%</span></label>
            <input
              type="range"
              min={50}
              max={200}
              value={contrast}
              onChange={e => setContrast(Number(e.target.value))}
              className="control-slider"
            />
          </div>
        </div>
        <div className="control-toggles">
          <label className="control-checkbox-label">
            <input
              type="checkbox"
              checked={invert}
              onChange={e => setInvert(e.target.checked)}
              style={{ accentColor: 'var(--primary)', cursor: 'pointer' }}
            />
            Invert Scan Colors
          </label>
        </div>
      </div>
    </div>
  );
}
