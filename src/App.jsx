import { createSignal, For, onMount, onCleanup } from 'solid-js'
import { createStore } from 'solid-js/store'

const SAMPLE_RATE = 44100
const MIN_FREQ = 20
const MAX_FREQ = 20000
const MIN_GAIN = -12
const MAX_GAIN = 12

// Biquad Math for Magnitude Response
const getBiquadMagnitude = (type, freq, gain, q, f) => {
  const w0 = 2 * Math.PI * freq / SAMPLE_RATE
  const cosW0 = Math.cos(w0)
  const sinW0 = Math.sin(w0)
  const alpha = sinW0 / (2 * q)
  const A = Math.pow(10, gain / 40)
  const w = 2 * Math.PI * f / SAMPLE_RATE
  const cosW = Math.cos(w)

  let b0, b1, b2, a0, a1, a2

  if (type === 'PK') {
    b0 = 1 + alpha * A
    b1 = -2 * cosW0
    b2 = 1 - alpha * A
    a0 = 1 + alpha / A
    a1 = -2 * cosW0
    a2 = 1 - alpha / A
  } else if (type === 'LSC') {
    const sqrtA = Math.sqrt(A)
    const beta = 2 * sqrtA * alpha
    b0 = A * ((A + 1) - (A - 1) * cosW0 + beta)
    b1 = 2 * A * ((A - 1) - (A + 1) * cosW0)
    b2 = A * ((A + 1) - (A - 1) * cosW0 - beta)
    a0 = (A + 1) + (A - 1) * cosW0 + beta
    a1 = -2 * ((A - 1) + (A + 1) * cosW0)
    a2 = (A + 1) + (A - 1) * cosW0 - beta
  } else if (type === 'HSC') {
    const sqrtA = Math.sqrt(A)
    const beta = 2 * sqrtA * alpha
    b0 = A * ((A + 1) + (A - 1) * cosW0 + beta)
    b1 = -2 * A * ((A - 1) + (A + 1) * cosW0)
    b2 = A * ((A + 1) + (A - 1) * cosW0 - beta)
    a0 = (A + 1) - (A - 1) * cosW0 + beta
    a1 = 2 * ((A - 1) - (A + 1) * cosW0)
    a2 = (A + 1) - (A - 1) * cosW0 - beta
  } else {
    return 0
  }

  const phi = Math.pow(Math.sin(w / 2), 2)
  const numerator = Math.pow(b0 + b1 + b2, 2) - 4 * (b0 * b1 + b1 * b2 + 4 * b0 * b2) * phi + 16 * b0 * b2 * phi * phi
  const denominator = Math.pow(a0 + a1 + a2, 2) - 4 * (a0 * a1 + a1 * a2 + 4 * a0 * a2) * phi + 16 * a0 * a2 * phi * phi
  
  return 10 * Math.log10(numerator / denominator)
}

function App() {
  const [bands, setBands] = createStore([
    { type: 'LSC', gain: 2, freq: 80, q: 0.707 },
    { type: 'PK', gain: -3, freq: 300, q: 1.0 },
    { type: 'PK', gain: 2.5, freq: 2000, q: 1.2 },
    { type: 'PK', gain: -1, freq: 6000, q: 8 },
    { type: 'HSC', gain: 6, freq: 15000, q: 0.707 },
  ])

  let svgRef
  const [dragging, setDragging] = createSignal(null)
  const width = 800
  const height = 300

  const freqToX = (f) => (Math.log10(f / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * width
  const xToFreq = (x) => MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, x / width)
  const gainToY = (g) => height / 2 - (g / MAX_GAIN) * (height / 2)
  const yToGain = (y) => (height / 2 - y) / (height / 2) * MAX_GAIN

  const handlePointerDown = (i, e) => {
    e.target.setPointerCapture(e.pointerId)
    setDragging({ index: i, startY: e.clientY, startQ: bands[i].q })
  }

  const handlePointerMove = (e) => {
    const drag = dragging()
    if (!drag) return

    const rect = svgRef.getBoundingClientRect()
    const x = Math.max(0, Math.min(width, e.clientX - rect.left))
    const y = Math.max(0, Math.min(height, e.clientY - rect.top))

    if (e.altKey) {
      const deltaY = drag.startY - e.clientY
      const newQ = Math.max(0.25, Math.min(8, drag.startQ + deltaY * 0.05))
      setBands(drag.index, 'q', parseFloat(newQ.toFixed(2)))
    } else {
      setBands(drag.index, 'freq', Math.round(xToFreq(x)))
      setBands(drag.index, 'gain', parseFloat(yToGain(y).toFixed(1)))
    }
  }

  const handlePointerUp = () => setDragging(null)

  const curvePath = () => {
    let points = []
    for (let x = 0; x <= width; x += 2) {
      const f = xToFreq(x)
      let totalGain = 0
      for (let i = 0; i < bands.length; i++) {
        totalGain += getBiquadMagnitude(bands[i].type, bands[i].freq, bands[i].gain, bands[i].q, f)
      }
      points.push(`${x},${gainToY(totalGain)}`)
    }
    return `M ${points.join(' L ')}`
  }

  const gridLines = () => {
    const freqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
    const gains = [-12, -6, 0, 6, 12]
    return (
      <>
        {freqs.map(f => (
          <line x1={freqToX(f)} y1="0" x2={freqToX(f)} y2={height} stroke="#333" stroke-width="1" />
        ))}
        {gains.map(g => (
          <line x1="0" y1={gainToY(g)} x2={width} y2={gainToY(g)} stroke="#333" stroke-width="1" />
        ))}
      </>
    )
  }

  return (
    <div style={{ padding: '20px', 'font-family': 'sans-serif', 'background-color': '#111', color: '#eee', 'min-height': '100vh' }}>
      <h1>5-Band Parametric EQ</h1>
      
      <div style={{ position: 'relative', width: `${width}px`, height: `${height}px`, background: '#1a1a1a', border: '1px solid #333', 'margin-bottom': '20px' }}>
        <svg 
          ref={svgRef}
          width={width} 
          height={height} 
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ 'touch-action': 'none' }}
        >
          {gridLines()}
          <path d={curvePath()} fill="none" stroke="#ff3e00" stroke-width="2" />
          
          <For each={bands}>{(band, i) => (
            <g 
              onPointerDown={(e) => handlePointerDown(i(), e)}
              style={{ cursor: 'move' }}
            >
              <circle 
                cx={freqToX(band.freq)} 
                cy={gainToY(band.gain)} 
                r="10" 
                fill={dragging()?.index === i() ? '#ff3e00' : '#555'}
                stroke="#eee"
                stroke-width="2"
              />
              <text 
                x={freqToX(band.freq)} 
                y={gainToY(band.gain)} 
                text-anchor="middle" 
                dy=".3em" 
                font-size="10" 
                fill="#eee"
                pointer-events="none"
              >
                {i() + 1}
              </text>
            </g>
          )}</For>
        </svg>
      </div>

      <div style={{ display: 'flex', gap: '15px', 'flex-wrap': 'wrap' }}>
        <For each={bands}>{(band, i) => (
          <div style={{ 
            border: '1px solid #333', 
            background: '#222',
            padding: '15px', 
            display: 'flex', 
            'flex-direction': 'column', 
            'align-items': 'center',
            width: '120px',
            'border-radius': '4px'
          }}>
            <h3 style={{ margin: '0 0 10px 0' }}>Band {i() + 1}</h3>
            
            <div style={{ display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'margin-bottom': '15px' }}>
              <label style={{ 'font-size': '12px' }}>{band.gain} dB</label>
              <input 
                type="range" 
                min={MIN_GAIN} 
                max={MAX_GAIN} 
                step="0.1"
                orient="vertical"
                value={band.gain} 
                onInput={(e) => setBands(i(), 'gain', parseFloat(e.target.value))} 
                style={{
                  'writing-mode': 'bt-lr',
                  '-webkit-appearance': 'slider-vertical',
                  width: '20px',
                  height: '120px',
                  margin: '10px 0'
                }}
              />
            </div>

            <div style={{ 'display': 'flex', 'flex-direction': 'column', gap: '8px', 'width': '100%' }}>
              <div>
                <label style={{ display: 'block', 'font-size': '11px', color: '#888' }}>Type</label>
                <select 
                  style={{ width: '100%', background: '#333', color: '#eee', border: 'none' }}
                  value={band.type} 
                  onChange={(e) => setBands(i(), 'type', e.target.value)}
                >
                  <option value="LSC">LSC</option>
                  <option value="PK">PK</option>
                  <option value="HSC">HSC</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', 'font-size': '11px', color: '#888' }}>Freq (Hz)</label>
                <input 
                  type="number" 
                  style={{ width: '100%', background: '#333', color: '#eee', border: 'none' }}
                  value={band.freq} 
                  onInput={(e) => setBands(i(), 'freq', parseInt(e.target.value) || 0)} 
                />
              </div>

              <div>
                <label style={{ display: 'block', 'font-size': '11px', color: '#888' }}>Q</label>
                <input 
                  type="number" 
                  step="0.01"
                  min="0.25"
                  max="8"
                  style={{ width: '100%', background: '#333', color: '#eee', border: 'none' }}
                  value={band.q} 
                  onInput={(e) => {
                    const val = Math.max(0.25, Math.min(8, parseFloat(e.target.value) || 0.25))
                    setBands(i(), 'q', parseFloat(val.toFixed(2)))
                  }} 
                />
              </div>
            </div>
          </div>
        )}</For>
      </div>

      <button 
        onClick={() => console.log(JSON.stringify(bands, null, 2))} 
        style={{ 'margin-top': '30px', padding: '10px 20px', cursor: 'pointer', background: '#333', color: '#eee', border: '1px solid #555' }}
      >
        Print EQ Data to Console
      </button>
    </div>
  )
}

export default App
