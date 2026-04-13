import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { BAND_ORDER, MAX_FREQ, MAX_GAIN, MIN_FREQ, SAMPLE_RATE } from "./libs/consts";
import {
  connectDAC,
  exportData,
  handleDisconnect,
  importData,
  resetToDefaults,
  resetToOriginal,
  saveToDAC,
  sendMasterGain,
  syncPreview,
} from "./libs/hidController";
import { bands, isConnected, masterGain, productName, setBands, setMasterGain, status } from "./libs/hidStore";

function App() {
  navigator.hid.addEventListener("disconnect", handleDisconnect);
  onCleanup(() => navigator.hid.removeEventListener("disconnect", handleDisconnect));

  let previewTimeout;
  createEffect(() => {
    // Track changes to bands and masterGain
    for (let i = 0; i < bands.length; i++) {
      bands[i].freq;
      bands[i].gain;
      bands[i].q;
      bands[i].type;
    }
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
    const trackHeight = 280;

    let y = e.clientY - rect.top - padding;
    y = Math.max(0, Math.min(trackHeight, y));

    // invert (0 = +12, 280 = -12)
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
    const trackHeight = 280;
    const padding = 10;

    let y = e.clientY - rect.top - padding;
    y = Math.max(0, Math.min(trackHeight, y));

    // invert (0 = +12, 280 = -12)
    let value = 12 - (y / trackHeight) * 24;

    // clamp
    value = Math.max(-12, Math.min(12, value));

    setBands(index, "gain", Number.parseFloat(value.toFixed(1)));
  }

  function handleBandGainPointerUp(_index, e) {
    draggingBandIdx = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  function handleEqPointerClick(index, e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const newFilterIndex = (BAND_ORDER.indexOf(bands[index].type) + 1) % 3;
      setBands(index, "type", BAND_ORDER[newFilterIndex]);
    }
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

  return (
    <div class="app-container">
      <div class="header">
        <a href="https://github.com/adithyasource/fiiocontrol-oss" class="secondary" target="_blank" rel="noopener">
          fiiocontrol-oss
        </a>
        <div style={{ display: "flex", gap: "0.6rem" }}>
          <a href="http://adithya.zip/" class="secondary" target="_blank" rel="noopener">
            by adithya
          </a>
          <a href="https://ko-fi.com/adithyasource" class="secondary" target="_blank" rel="noopener">
            coffee?
          </a>
        </div>
      </div>

      <Show when={!isConnected()}>
        <br />
        <br />
        <button id="connect-device" class="primary" type="button" onClick={connectDAC}>
          connect device
        </button>

        <div class="mobile-warning">
          <br />
          this website is only supported on a desktop browser / increase the screen width
          <br />
          <br />
          <br />
          <br />
        </div>

        <p>the one supported device is the fiio jadeaudio ja11 since its the only one i have :]</p>
        <br />
        <p>
          if you want me to reverse engineer other dacs, please do let me know!{" "}
          <button
            class="email"
            type="button"
            onClick={async (e) => {
              e.preventDefault();
              await navigator.clipboard.writeText("me@adithya.zip");
              alert("email copied");
            }}
          >
            me@adithya.zip
          </button>
        </p>
        <p>
          the project is open source on{" "}
          <a href="https://github.com/adithyasource/fiiocontrol-oss" target="_blank" class="email">
            github
          </a>{" "}
          so if you face any issues or want to contribute, feel free to open an issue or pull request!
        </p>
      </Show>

      <br />
      <br />

      <div style={{ display: "flex", gap: "0.6rem" }}>
        <div class="secondary">{productName().toLowerCase()}</div>
        <div class="status" data-status={status()}>
          {status()}
        </div>
      </div>

      <br />
      <div style={{ display: "flex", gap: "0.6rem" }}>
        <button onClick={importData} type="button" class="primary">
          import
        </button>

        <button onClick={exportData} type="button" class="primary">
          export
        </button>

        <button onClick={resetToDefaults} type="button" class="primary">
          defaults
        </button>
        <button onClick={resetToOriginal} type="button" class="primary">
          reset
        </button>
        <button onClick={saveToDAC} type="button" class="primary">
          write and exit
        </button>
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

          <path d={eqPath()} fill="none" id="eq-path" stroke-width="2" />

          <For each={bands}>
            {(band, i) => {
              const cx = createMemo(() => freqToX(band.freq));
              const cy = createMemo(() => gainToY(band.gain));

              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: <explanation>
                <g
                  onPointerDown={(e) => {
                    e.target.setPointerCapture(e.pointerId);
                    setDragging({ index: i(), startY: e.clientY, startQ: band.q });
                  }}
                  onClick={(e) => handleEqPointerClick(i(), e)}
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
                top: `${((12 - masterGain()) / 24) * 280 + 15}px`,
                transform: "translateY(-50%)",
              }}
            >
              GAIN
            </div>

            <div class="fader-value-box">{masterGain().toFixed(1)}db</div>
          </div>
        </div>
      </div>
      <table>
        <tr>
          <td>click drag</td>
          <td>adjust gain and freq</td>
        </tr>
        <tr>
          <td>alt+click drag</td>
          <td>adjust Q factor</td>
        </tr>
        <tr>
          <td>ctrl+click</td>
          <td>cycle through filters</td>
        </tr>
      </table>
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
                      top: `${((12 - band.gain) / 24) * 280 + 15}px`,
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
      <br />
      <br />

      <Show when={isConnected()}>
        <p>
          if you want me to reverse engineer other dacs, please do let me know!{" "}
          <button
            class="email"
            type="button"
            onClick={async (e) => {
              e.preventDefault();
              await navigator.clipboard.writeText("me@adithya.zip");
              alert("email copied");
            }}
          >
            me@adithya.zip
          </button>
        </p>
        <p>
          the project is open source on{" "}
          <a href="https://github.com/adithyasource/fiiocontrol-oss" target="_blank" class="email">
            github
          </a>{" "}
          so if you face any issues or want to contribute, feel free to open an issue or pull request!
        </p>

        <br />
      </Show>
    </div>
  );
}

export default App;
