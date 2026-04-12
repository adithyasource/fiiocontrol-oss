import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { MAX_FREQ, MAX_GAIN, MIN_FREQ, SAMPLE_RATE } from "./libs/consts";
import {
  connectDAC,
  handleDisconnect,
  resetToOriginal,
  saveToDAC,
  sendMasterGain,
  syncPreview,
} from "./libs/hidController";
import {
  bands,
  isConnected,
  masterGain,
  productName,
  setBands,
  setIsConnected,
  setMasterGain,
  status,
} from "./libs/hidStore";
import { toast } from "./libs/toastStore";

function App() {
  navigator.hid.addEventListener("disconnect", handleDisconnect);
  onCleanup(() => navigator.hid.removeEventListener("disconnect", handleDisconnect));

  let previewTimeout;
  createEffect(() => {
    // Track changes to bands and masterGain
    JSON.stringify(bands);
    masterGain();

    if (status() === "synced" && isConnected()) {
      clearTimeout(previewTimeout);
      previewTimeout = setTimeout(syncPreview, 250);
    }
  });

  function remToPx(rem) {
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return rem * rootFontSize;
  }

  // ---- VISUAL MATH ----
  let draggingInput = false;

  function handleGainPointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingInput = true;
  }

  function handleGainPointerMove(e) {
    if (!draggingInput) return;

    const rect = e.currentTarget.getBoundingClientRect();

    const padding = 10;
    const trackHeight = 260;

    let y = e.clientY - rect.top - padding;
    y = Math.max(0, Math.min(trackHeight, y));

    // invert (0 = +12, 260 = -12)
    let value = 12 - (y / trackHeight) * 24;

    // clamp
    value = Math.max(-12, Math.min(12, value));

    setMasterGain(value);
    sendMasterGain(value);
  }

  const handleGainPointerUp = (e) => {
    draggingInput = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  let draggingBandIdx = null;

  function handleBandGainPointerDown(index, e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingBandIdx = index;
  }

  function handleBandGainPointerMove(index, e) {
    if (draggingBandIdx !== index) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const trackHeight = 260;
    const padding = 10;

    let y = e.clientY - rect.top - padding;
    y = Math.max(0, Math.min(trackHeight, y));

    // invert (0 = +12, 260 = -12)
    let value = 12 - (y / trackHeight) * 24;

    // clamp
    value = Math.max(-12, Math.min(12, value));

    setBands(index, "gain", Number.parseFloat(value.toFixed(1)));
  }

  function handleBandGainPointerUp(_index, e) {
    draggingBandIdx = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  let svgRef;
  const [dragging, setDragging] = createSignal(null);

  const width = remToPx(34);
  const totalHeight = 340;
  const plotHeight = 310;
  const paddingLeft = 45;
  const paddingRight = 10;
  const chartWidth = width - paddingLeft + 10;

  const freqToX = (f) =>
    paddingLeft + (Math.log10(Math.max(MIN_FREQ, f) / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * chartWidth;
  const xToFreq = (x) => MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, (x - paddingLeft) / chartWidth);
  const gainToY = (g) => plotHeight / 2 - (g / MAX_GAIN) * (plotHeight / 2);
  const yToGain = (y) => ((plotHeight / 2 - y) / (plotHeight / 2)) * MAX_GAIN;

  function handlePointerMove(e) {
    const drag = dragging();
    if (!drag) return;
    const rect = svgRef.getBoundingClientRect();
    const x = Math.max(paddingLeft, Math.min(width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(plotHeight, e.clientY - rect.top));

    if (e.altKey) {
      const deltaY = drag.startY - e.clientY;
      const newQ = Math.max(0.25, Math.min(8, drag.startQ + deltaY * 0.05));
      setBands(drag.index, "q", Number.parseFloat(newQ.toFixed(2)));
    } else {
      setBands(drag.index, "freq", Math.round(xToFreq(x)));
      setBands(drag.index, "gain", Number.parseFloat(yToGain(y).toFixed(1)));
    }
  }

  const eqPath = createMemo(() => {
    let points = [];
    for (let x = paddingLeft; x <= width + paddingRight; x += 3) {
      const f = xToFreq(x);
      let totalGain = 0;
      for (let i = 0; i < bands.length; i++) {
        totalGain += getBiquadMagnitude(bands[i].type, bands[i].freq, bands[i].gain, bands[i].q, f);
      }
      points.push(`${x},${gainToY(totalGain)}`);
    }
    return `M ${points.join(" L ")}`;
  });

  function getBiquadMagnitude(type, freq, gain, q, f) {
    const w0 = (2 * Math.PI * freq) / SAMPLE_RATE;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * q);
    const A = 10 ** (gain / 40);

    let b0;
    let b1;
    let b2;
    let a0;
    let a1;
    let a2;

    if (type === "PK") {
      b0 = 1 + alpha * A;
      b1 = -2 * cosW0;
      b2 = 1 - alpha * A;
      a0 = 1 + alpha / A;
      a1 = -2 * cosW0;
      a2 = 1 - alpha / A;
    } else if (type === "LSC") {
      const sqrtA = Math.sqrt(A);
      const beta = 2 * sqrtA * alpha;
      b0 = A * (A + 1 - (A - 1) * cosW0 + beta);
      b1 = 2 * A * (A - 1 - (A + 1) * cosW0);
      b2 = A * (A + 1 - (A - 1) * cosW0 - beta);
      a0 = A + 1 + (A - 1) * cosW0 + beta;
      a1 = -2 * (A - 1 + (A + 1) * cosW0);
      a2 = A + 1 + (A - 1) * cosW0 - beta;
    } else if (type === "HSC") {
      const sqrtA = Math.sqrt(A);
      const beta = 2 * sqrtA * alpha;
      b0 = A * (A + 1 + (A - 1) * cosW0 + beta);
      b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
      b2 = A * (A + 1 + (A - 1) * cosW0 - beta);
      a0 = A + 1 - (A - 1) * cosW0 + beta;
      a1 = 2 * (A - 1 - (A + 1) * cosW0);
      a2 = A + 1 - (A - 1) * cosW0 - beta;
    } else return 0;

    // Robust complex magnitude calculation
    const w = (2 * Math.PI * f) / SAMPLE_RATE;
    const cosW = Math.cos(w);
    const cos2W = Math.cos(2 * w);
    const sinW = Math.sin(w);
    const sin2W = Math.sin(2 * w);

    const numReal = b0 + b1 * cosW + b2 * cos2W;
    const numImag = -(b1 * sinW + b2 * sin2W);
    const denReal = a0 + a1 * cosW + a2 * cos2W;
    const denImag = -(a1 * sinW + a2 * sin2W);

    const numMagSq = numReal * numReal + numImag * numImag;
    const denMagSq = denReal * denReal + denImag * denImag;

    return 10 * Math.log10(numMagSq / denMagSq);
  }

  function Landing() {
    return (
      <>
        <button class="primary" type="button" onClick={connectDAC}>
          connect device
        </button>

        <br />
        <br />
        <br />

        <div class="info-text">
          <p>the only supported device is the fiio x jadeaudio ja11 since that’s the only one i have :]</p>

          <p>if you want me to reverse engineer other dacs, please do let me know!</p>
        </div>
      </>
    );
  }

  return (
    <div class="">
      <div class="header">
        <button class="secondary" type="button">
          fiiocontrol-oss
        </button>
        <button class="secondary" type="button">
          by adithya
        </button>
      </div>

      <br />
      <br />

      <Show when={isConnected()} fallback={Landing}>
        <div class="header">
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <div class="primary">{productName()}</div>
            <div class="status" data-status={status()}>
              {status()}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.6rem" }}>
            <button onClick={resetToOriginal} type="button" class="primary">
              reset
            </button>
            <button onClick={() => setIsConnected(false)} type="button" class="primary">
              disconnect
            </button>
            <button onClick={saveToDAC} type="button" class="primary">
              write to device
            </button>
          </div>
        </div>

        <br />
        <div class="graph-and-gain">
          <svg
            ref={svgRef}
            width={width + paddingRight}
            height={totalHeight}
            onPointerMove={handlePointerMove}
            onPointerUp={() => setDragging(null)}
            style={{ "touch-action": "none" }}
            aria-label="bandControl"
          >
            <g class="graph-lines">
              {[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((f) => {
                let textAnchor = "middle";
                if (f === 20) {
                  textAnchor = "start";
                }
                if (f === 20000) {
                  textAnchor = "end";
                }
                return (
                  <g>
                    <Show when={![20, 20000].includes(f)}>
                      <line x1={freqToX(f)} y1="0" x2={freqToX(f)} y2={plotHeight} />
                    </Show>
                    <text x={freqToX(f)} y={plotHeight + 20} text-anchor={textAnchor}>
                      {f >= 1000 ? `${f / 1000}k` : f}
                    </text>
                  </g>
                );
              })}

              {[-12, -6, 0, 6, 12].map((g) => {
                let dominant = "middle";
                if (g === 12) {
                  dominant = "hanging";
                }
                if (g === -12) {
                  dominant = "ideographic";
                }
                return (
                  <g>
                    <Show when={![-12, 12].includes(g)}>
                      <line
                        x1={paddingLeft}
                        y1={gainToY(g)}
                        x2={paddingLeft + chartWidth + paddingRight}
                        y2={gainToY(g)}
                      />
                    </Show>
                    <text x={paddingLeft - 15} y={gainToY(g) + 4} text-anchor="end" dominant-baseline={dominant}>
                      {g}
                    </text>
                  </g>
                );
              })}
            </g>

            <path d={eqPath()} fill="none" stroke="#e2e2e2" stroke-width="2" />

            <For each={bands}>
              {(band, i) => {
                const cx = createMemo(() => freqToX(band.freq));
                const cy = createMemo(() => gainToY(band.gain));

                return (
                  <g
                    onPointerDown={(e) => {
                      e.target.setPointerCapture(e.pointerId);
                      setDragging({ index: i(), startY: e.clientY, startQ: band.q });
                    }}
                    style={{ cursor: "move" }}
                    class="eq-point"
                  >
                    <rect x={cx() - 10} y={cy() - 10} width="20" height="20" />
                    <text x={cx()} y={cy()} text-anchor="middle" dy=".3em" pointer-events="none">
                      {i() + 1}
                    </text>
                  </g>
                );
              }}
            </For>
          </svg>

          <div class="master-gain">
            <div
              class="fader"
              onPointerDown={handleGainPointerDown}
              onPointerMove={handleGainPointerMove}
              onPointerUp={handleGainPointerUp}
            >
              <div class="fader-track-line" />
              <div
                class="fader-handle"
                style={{
                  top: `${((12 - masterGain()) / 24) * 260 + 10}px`,
                  transform: "translateY(-50%)",
                }}
              >
                GAIN
              </div>

              <div class="fader-value-box">{masterGain().toFixed(1)}db</div>
            </div>
          </div>
        </div>
        <div class="bands-container">
          <For each={bands}>
            {(band, i) => (
              <div class="band-card">
                <div
                  class="band-fader-container"
                  onPointerDown={(e) => handleBandGainPointerDown(i(), e)}
                  onPointerMove={(e) => handleBandGainPointerMove(i(), e)}
                  onPointerUp={(e) => handleBandGainPointerUp(i(), e)}
                  style={{ "touch-action": "none" }}
                >
                  <div class="fader fader-inverted">
                    <div class="fader-track-line" />
                    <div
                      class="fader-handle"
                      style={{
                        top: `${((12 - band.gain) / 24) * 260 + 10}px`,
                        transform: "translateY(-50%)",
                      }}
                    >
                      {i() + 1}
                    </div>

                    <div class="fader-value-box">{band.gain.toFixed(1)}db</div>
                  </div>
                </div>

                <div class="band-inputs">
                  <select class="secondary" value={band.type} onChange={(e) => setBands(i(), "type", e.target.value)}>
                    <option value="PK">PK</option>
                    <option value="LSC">LSC</option>
                    <option value="HSC">HSC</option>
                  </select>

                  <div class="band-numeric-input">
                    <div class="input-with-unit">
                      <input
                        type="number"
                        value={band.freq}
                        style={{ width: `${band.freq.toString().length}ch` }}
                        onInput={(e) => setBands(i(), "freq", Number.parseInt(e.target.value, 10) || 0)}
                      />
                      <span class="unit">Hz</span>
                    </div>
                  </div>
                  <div class="band-numeric-input">
                    <input
                      type="number"
                      step="0.01"
                      value={band.q}
                      style={{ width: `${band.q.toString().length}ch` }}
                      onInput={(e) =>
                        setBands(i(), "q", Math.max(0.25, Math.min(8, Number.parseFloat(e.target.value) || 0.25)))
                      }
                    />
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={toast()}>
        <div
          style={{
            position: "fixed",
            bottom: "20px",
            right: "20px",
            background: "#333",
            color: "#fff",
            padding: "12px 20px",
            "border-radius": "4px",
            "box-shadow": "0 4px 12px rgba(0,0,0,0.5)",
            "border-left": "4px solid #ff3e00",
            "z-index": 1000,
            animation: "fadeIn 0.3s",
          }}
        >
          {toast()}
        </div>
      </Show>
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

export default App;
