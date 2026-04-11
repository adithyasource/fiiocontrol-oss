import { createSignal, For, onCleanup, Show, batch, createMemo, createEffect } from 'solid-js'
import { createStore } from 'solid-js/store'

const SAMPLE_RATE = 44100
const MIN_FREQ = 20
const MAX_FREQ = 20000
const MIN_GAIN = -12
const MAX_GAIN = 12

// ---- HID STATE ----
let device = null
const TYPE_MAP = { PK: 0, LSC: 1, HSC: 2 }
const REV_TYPE_MAP = { 0: 'PK', 1: 'LSC', 2: 'HSC' }

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function App() {
  const [bands, setBands] = createStore([
    { type: 'PK', gain: 0, freq: 100, q: 0.7 },
    { type: 'PK', gain: 0, freq: 500, q: 0.7 },
    { type: 'PK', gain: 0, freq: 1000, q: 0.7 },
    { type: 'PK', gain: 0, freq: 2500, q: 0.7 },
    { type: 'PK', gain: 0, freq: 10000, q: 0.7 },
  ])

  const [masterGain, setMasterGain] = createSignal(0)
  const [isConnected, setIsConnected] = createSignal(false)
  const [status, setStatus] = createSignal("Offline")
  const [toast, setToast] = createSignal(null)

  const [originalBands, setOriginalBands] = createSignal([])
  const [originalMasterGain, setOriginalMasterGain] = createSignal(0)

  const showToast = (message, duration = 3000) => {
    setToast(message)
    setTimeout(() => setToast(null), duration)
  }

  const handleDisconnect = (e) => {
    if (e.device === device) {
      device = null
      setIsConnected(false)
      setStatus("Offline")
      resetToOriginal()
      showToast("Disconnected from DAC")
    }
  }

  navigator.hid.addEventListener("disconnect", handleDisconnect)
  onCleanup(() => navigator.hid.removeEventListener("disconnect", handleDisconnect))

  // ---- HID INPUT HANDLER ----
  const handleInputReport = (e) => {
    const data = new Uint8Array(e.data.buffer)
    const cmd = data[4]
    
    if (cmd === 23) {
      const raw = (data[7] << 8) | data[6]
      const signed = raw > 32767 ? raw - 65536 : raw
      setMasterGain(parseFloat((signed / 2560).toFixed(1)))
    }

    if (cmd === 21) {
      const bandIdx = data[6]
      const rawGain = (data[7] << 8) | data[8]
      const signedGain = rawGain > 32767 ? rawGain - 65536 : rawGain
      const gain = parseFloat((signedGain / 10).toFixed(1))
      const freq = (data[9] << 8) | data[10]
      const qRaw = (data[11] << 8) | data[12]
      const q = parseFloat((qRaw / 100).toFixed(2))
      const type = REV_TYPE_MAP[data[13]] || 'PK'

      if (bandIdx >= 0 && bandIdx < 5) {
        batch(() => {
          setBands(bandIdx, 'freq', freq)
          setBands(bandIdx, 'gain', gain)
          setBands(bandIdx, 'q', q)
          setBands(bandIdx, 'type', type)
        })
      }
    }
  }

  const connectDAC = async () => {
    try {
      const devices = await navigator.hid.requestDevice({ filters: [] })
      device = devices[0]
      if (!device) return
      await device.open()
      device.addEventListener("inputreport", handleInputReport)
      setIsConnected(true)
      setStatus("Connected")
      await fetchAllData()
    } catch (err) {
      setStatus("Error: " + err.message)
    }
  }

  const fetchAllData = async () => {
    if (!device) return
    setStatus("Reading DAC...")
    await device.sendReport(2, new Uint8Array([0xbb, 0x0b, 0, 0, 23, 0, 0, 0xee]))
    await sleep(200)
    for (let i = 0; i < 5; i++) {
      await device.sendReport(2, new Uint8Array([0xbb, 0x0b, 0, 0, 21, 1, i, 0xee]))
      await sleep(150) 
    }
    setOriginalBands(JSON.parse(JSON.stringify(bands)))
    setOriginalMasterGain(masterGain())
    setStatus("Synced")
  }

  const sendMasterGain = async (val) => {
    if (!device) return
    let value = Math.round(Math.max(-12, Math.min(12, val)) * 2560)
    if (value < 0) value = 65536 + value
    await device.sendReport(2, new Uint8Array([0xaa, 0x0a, 0, 0, 23, 2, value & 0xff, (value >> 8) & 0xff, 0, 0xee]))
  }

  const syncPreview = async () => {
    if (!device || status() !== "Synced") return
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i]
      let g = Math.round(b.gain * 10)
      if (g < 0) g = 65536 + g
      const f = Math.round(b.freq)
      const qv = Math.round(b.q * 100)

      const packet = new Uint8Array([
        0xAA, 0x10, 0, 0, 21, 8, i,
        (g >> 8) & 0xff, g & 0xff,
        (f >> 8) & 0xff, f & 0xff,
        (qv >> 8) & 0xff, qv & 0xff,
        TYPE_MAP[b.type], 0, 0xEE
      ])
      await device.sendReport(2, packet)
      await sleep(20)
    }
    await sendMasterGain(masterGain())
  }

  let previewTimeout
  createEffect(() => {
    // Track changes to bands and masterGain
    JSON.stringify(bands)
    masterGain()
    
    if (status() === "Synced" && isConnected()) {
      clearTimeout(previewTimeout)
      previewTimeout = setTimeout(syncPreview, 250)
    }
  })

  const resetToOriginal = () => {
    batch(() => {
      const original = originalBands()
      if (original.length) {
        for (let i = 0; i < original.length; i++) {
          setBands(i, original[i])
        }
      }
      setMasterGain(originalMasterGain())
    })
  }

  const saveToDAC = async () => {
    if (!device) return alert("Not connected")
    setStatus("Saving...")
    for (let i = 0; i < bands.length; i++) {
      const b = bands[i]
      let g = Math.round(b.gain * 10)
      if (g < 0) g = 65536 + g
      const f = Math.round(b.freq)
      const qv = Math.round(b.q * 100)

      const packet = new Uint8Array([
        0xAA, 0x10, 0, 0, 21, 8, i,
        (g >> 8) & 0xff, g & 0xff,
        (f >> 8) & 0xff, f & 0xff,
        (qv >> 8) & 0xff, qv & 0xff,
        TYPE_MAP[b.type], 0, 0xEE
      ])
      await device.sendReport(2, packet)
      await sleep(50)
    }
    await sleep(50)
    await device.sendReport(2, new Uint8Array([0xAA, 0x0A, 0, 0, 25, 1, 3, 0, 0xEE]))
    setStatus("Saved")
  }

  // ---- VISUAL MATH ----
  let svgRef
  const [dragging, setDragging] = createSignal(null)
  
  const width = 800
  const totalHeight = 350
  const plotHeight = 300
  const paddingLeft = 40
  const chartWidth = width - paddingLeft

  const freqToX = (f) => paddingLeft + (Math.log10(Math.max(MIN_FREQ, f) / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * chartWidth
  const xToFreq = (x) => MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, (x - paddingLeft) / chartWidth)
  const gainToY = (g) => plotHeight / 2 - (g / MAX_GAIN) * (plotHeight / 2)
  const yToGain = (y) => (plotHeight / 2 - y) / (plotHeight / 2) * MAX_GAIN

  const handlePointerMove = (e) => {
    const drag = dragging()
    if (!drag) return
    const rect = svgRef.getBoundingClientRect()
    const x = Math.max(paddingLeft, Math.min(width, e.clientX - rect.left))
    const y = Math.max(0, Math.min(plotHeight, e.clientY - rect.top))

    if (e.altKey) {
      const deltaY = drag.startY - e.clientY
      const newQ = Math.max(0.25, Math.min(8, drag.startQ + deltaY * 0.05))
      setBands(drag.index, 'q', parseFloat(newQ.toFixed(2)))
    } else {
      setBands(drag.index, 'freq', Math.max(20, Math.round(xToFreq(x))))
      setBands(drag.index, 'gain', parseFloat(yToGain(y).toFixed(1)))
    }
  }

  const getBiquadMagnitude = (type, freq, gain, q, f) => {
    const w0 = 2 * Math.PI * freq / SAMPLE_RATE
    const cosW0 = Math.cos(w0)
    const sinW0 = Math.sin(w0)
    const alpha = sinW0 / (2 * q)
    const A = Math.pow(10, gain / 40)
    
    let b0, b1, b2, a0, a1, a2

    if (type === 'PK') {
      b0 = 1 + alpha * A; b1 = -2 * cosW0; b2 = 1 - alpha * A
      a0 = 1 + alpha / A; a1 = -2 * cosW0; a2 = 1 - alpha / A
    } else if (type === 'LSC') {
      const sqrtA = Math.sqrt(A); const beta = 2 * sqrtA * alpha
      b0 = A * ((A + 1) - (A - 1) * cosW0 + beta); b1 = 2 * A * ((A - 1) - (A + 1) * cosW0); b2 = A * ((A + 1) - (A - 1) * cosW0 - beta)
      a0 = (A + 1) + (A - 1) * cosW0 + beta; a1 = -2 * ((A - 1) + (A + 1) * cosW0); a2 = (A + 1) + (A - 1) * cosW0 - beta
    } else if (type === 'HSC') {
      const sqrtA = Math.sqrt(A); const beta = 2 * sqrtA * alpha
      b0 = A * ((A + 1) + (A - 1) * cosW0 + beta); b1 = -2 * A * ((A - 1) + (A + 1) * cosW0); b2 = A * ((A + 1) + (A - 1) * cosW0 - beta)
      a0 = (A + 1) - (A - 1) * cosW0 + beta; a1 = 2 * ((A - 1) - (A + 1) * cosW0); a2 = (A + 1) - (A - 1) * cosW0 - beta
    } else return 0

    // Robust complex magnitude calculation
    const w = 2 * Math.PI * f / SAMPLE_RATE
    const cosW = Math.cos(w); const cos2W = Math.cos(2 * w)
    const sinW = Math.sin(w); const sin2W = Math.sin(2 * w)

    const numReal = b0 + b1 * cosW + b2 * cos2W
    const numImag = -(b1 * sinW + b2 * sin2W)
    const denReal = a0 + a1 * cosW + a2 * cos2W
    const denImag = -(a1 * sinW + a2 * sin2W)

    const numMagSq = numReal * numReal + numImag * numImag
    const denMagSq = denReal * denReal + denImag * denImag

    return 10 * Math.log10(numMagSq / denMagSq)
  }

  const eqPath = createMemo(() => {
    let points = []
    for (let x = paddingLeft; x <= width; x += 3) {
      const f = xToFreq(x)
      let totalGain = 0
      for (let i = 0; i < bands.length; i++) {
        totalGain += getBiquadMagnitude(bands[i].type, bands[i].freq, bands[i].gain, bands[i].q, f)
      }
      points.push(`${x},${gainToY(totalGain)}`)
    }
    return `M ${points.join(' L ')}`
  })

  return (
    <div style={{ padding: '20px', 'font-family': 'sans-serif', 'background-color': '#111', color: '#eee', 'min-height': '100vh' }}>
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '20px' }}>
        <div>
          <h1 style={{ margin: 0, color: '#00ff00' }}>FiiO EQ Control</h1>
          <p>Status: <span style={{ color: '#ffcc00' }}>{status()}</span></p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <Show when={!isConnected()}>
            <button onClick={connectDAC} style={{ padding: '8px 15px', background: '#007bff', color: 'white', border: 'none', cursor: 'pointer', 'border-radius': '4px' }}>Connect DAC</button>
          </Show>
          <Show when={isConnected()}>
            <button onClick={resetToOriginal} style={{ padding: '8px 15px', background: '#6c757d', color: 'white', border: 'none', cursor: 'pointer', 'border-radius': '4px' }}>Reset Changes</button>
            <button onClick={() => setIsConnected(false)} style={{ padding: '8px 15px', background: '#444', color: 'white', border: 'none', cursor: 'pointer', 'border-radius': '4px' }}>Disconnect</button>
            <button onClick={saveToDAC} style={{ padding: '8px 15px', background: '#dc3545', color: 'white', border: 'none', cursor: 'pointer', 'border-radius': '4px' }}>SAVE ALL TO DAC</button>
          </Show>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '20px' }}>
        <div style={{ position: 'relative', width: `${width}px`, height: `${totalHeight}px`, background: '#000', border: '1px solid #333' }}>
          <svg ref={svgRef} width={width} height={totalHeight} onPointerMove={handlePointerMove} onPointerUp={() => setDragging(null)} style={{ 'touch-action': 'none' }}>
            {[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map(f => (
              <g>
                <line x1={freqToX(f)} y1="0" x2={freqToX(f)} y2={plotHeight} stroke="#222" />
                <text x={freqToX(f)} y={plotHeight + 20} fill="#888" font-size="10" text-anchor="middle">
                  {f >= 1000 ? (f / 1000) + 'k' : f}
                </text>
              </g>
            ))}
            {[-12, -6, 0, 6, 12].map(g => (
              <g>
                <line x1={paddingLeft} y1={gainToY(g)} x2={width} y2={gainToY(g)} stroke="#222" />
                <text x="5" y={gainToY(g) + 4} fill="#888" font-size="10">
                  {g}
                </text>
              </g>
            ))}
            
            <path d={eqPath()} fill="none" stroke="#ff3e00" stroke-width="2" />
            
            <For each={bands}>{(band, i) => {
              const cx = createMemo(() => freqToX(band.freq))
              const cy = createMemo(() => gainToY(band.gain))
              
              return (
                <g onPointerDown={(e) => {
                  e.target.setPointerCapture(e.pointerId)
                  setDragging({ index: i(), startY: e.clientY, startQ: band.q })
                }} style={{ cursor: 'move' }}>
                  <circle cx={cx()} cy={cy()} r="10" fill={dragging()?.index === i() ? '#ff3e00' : '#333'} stroke="#eee" />
                  <text x={cx()} y={cy()} text-anchor="middle" dy=".3em" font-size="10" fill="#fff" pointer-events="none">{i() + 1}</text>
                </g>
              )
            }}</For>
          </svg>
        </div>

        <div style={{ border: '1px solid #333', background: '#222', padding: '15px', display: 'flex', 'flex-direction': 'column', 'align-items': 'center', width: '100px', 'border-radius': '4px', height: `${plotHeight}px` }}>
          <h3 style={{ margin: '0 0 10px 0', 'font-size': '14px', color: '#ffcc00' }}>Master</h3>
          <label style={{ 'font-size': '12px', color: '#ffcc00' }}>{masterGain()} dB</label>
          <input type="range" min="-12" max="12" step="0.1" orient="vertical" value={masterGain()} 
            onInput={(e) => { 
              const val = parseFloat(e.target.value)
              setMasterGain(val)
              sendMasterGain(val)
            }} 
            style={{ 'writing-mode': 'bt-lr', '-webkit-appearance': 'slider-vertical', width: '30px', height: '180px' }} 
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '15px', 'flex-wrap': 'wrap', 'margin-top': '20px' }}>
        <For each={bands}>{(band, i) => (
          <div style={{ border: '1px solid #333', background: '#222', padding: '15px', display: 'flex', 'flex-direction': 'column', 'align-items': 'center', width: '130px', 'border-radius': '4px' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#ffcc00' }}>Band {i() + 1}</h3>
            
            <div style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'margin-bottom': '15px' }}>
              <label style={{ 'font-size': '12px', 'margin-bottom': '5px', color: '#ffcc00' }}>{band.gain} dB</label>
              <input type="range" min={MIN_GAIN} max={MAX_GAIN} step="0.1" orient="vertical" value={band.gain} 
                onInput={(e) => setBands(i(), 'gain', parseFloat(e.target.value))} 
                style={{ 'writing-mode': 'bt-lr', '-webkit-appearance': 'slider-vertical', width: '20px', height: '120px' }} 
              />
            </div>

            <div style={{ 'display': 'flex', 'flex-direction': 'column', gap: '8px', 'width': '100%' }}>
              <select style={{ width: '100%', background: '#333', color: '#eee', border: 'none', padding: '4px' }} value={band.type} onChange={(e) => setBands(i(), 'type', e.target.value)}>
                <option value="PK">PK</option><option value="LSC">LSC</option><option value="HSC">HSC</option>
              </select>
              
              <div style={{ 'font-size': '11px', width: '100%' }}>
                <div style={{ display: 'flex', 'justify-content': 'space-between', 'margin-bottom': '2px' }}>
                  <span>Freq:</span>
                  <input type="number" value={band.freq} onInput={(e) => setBands(i(), 'freq', parseInt(e.target.value) || 0)} style={{ width: '55px', background: 'transparent', color: '#eee', border: 'none', 'text-align': 'right' }} />
                </div>
                <div style={{ display: 'flex', 'justify-content': 'space-between' }}>
                  <span>Q:</span>
                  <input type="number" step="0.01" value={band.q} onInput={(e) => setBands(i(), 'q', Math.max(0.25, Math.min(8, parseFloat(e.target.value) || 0.25)))} style={{ width: '55px', background: 'transparent', color: '#eee', border: 'none', 'text-align': 'right' }} />
                </div>
              </div>
            </div>
          </div>
        )}</For>
      </div>

      <Show when={toast()}>
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: '#333',
          color: '#fff',
          padding: '12px 20px',
          'border-radius': '4px',
          'box-shadow': '0 4px 12px rgba(0,0,0,0.5)',
          'border-left': '4px solid #ff3e00',
          'z-index': 1000,
          animation: 'fadeIn 0.3s'
        }}>
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
  )
}

export default App
